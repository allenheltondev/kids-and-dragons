/**
 * The AppSync Events Lambda authorizer — who is allowed on `room/<code>/<runId>`.
 *
 * The Event API is configured with two auth providers (§4.4): **IAM** for
 * publishing, which only the game Lambda's execution role can do, and **this**
 * for connecting and subscribing, which is how a phone or a TV gets on the
 * channel. That split is the security model in one line — clients can listen to
 * their own room and nothing else, and nothing but the server can ever say
 * anything on it.
 *
 * The rule that matters most is the last one: a subscribe must name the room the
 * token was issued for. Without it, any valid session token would be a licence
 * to watch *every* family's game, since the room code is the only thing
 * separating them and four letters is a small space.
 */

import { runChannelSegment } from "@kad/shared";
import { DynamoRepository } from "../store/dynamo-repository.ts";
import { ssmParameterSource, TokenIdentity } from "../token-identity.ts";
import { requiredEnv } from "./runtime.ts";
import { isOut } from "../handlers/remove.ts";
import { viewerStillShows } from "../handlers/viewer.ts";

/**
 * What AppSync sends. Only the fields this function reads.
 *
 * AppSync Events names its operations `EVENT_CONNECT`, `EVENT_SUBSCRIBE` and
 * `EVENT_PUBLISH`, and passes the channel as a string such as
 * `/room/ABCD/r_1`; it is absent on a connect. The bare operation names and an
 * object carrying `path` or `segments` are accepted as well, so a difference in
 * spelling can only ever lose a connection, never skip the room check.
 */
export interface ChannelAuthorizerEvent {
  authorizationToken?: string;
  requestContext: {
    channelNamespace?: string;
    channel?: string | { path?: string; segments?: string[] } | null;
    operation?: string;
  };
}

export interface ChannelAuthorizerResult {
  isAuthorized: boolean;
  /** Surfaces in the subscription's context; useful in AppSync logs. */
  handlerContext?: Record<string, string>;
  ttlOverride?: number;
}

const DENY: ChannelAuthorizerResult = { isAuthorized: false };

/** How long AppSync may hold a player's "yes" (see `ttlOverride` below). */
const SESSION_CACHE_SECONDS = 60;

/**
 * Cached for the life of the container. The signing key is fetched once and
 * every verification after that is local arithmetic — this function sits in
 * front of every subscribe, so a network round trip here is a network round trip
 * on every phone that reconnects.
 *
 * Read-only, deliberately: no `createIfMissing`. This function only ever sees
 * tokens the API has already issued, so it cannot legitimately be the first to
 * want the key, and a parameter that is missing here means something is wrong
 * rather than new.
 */
let identity: TokenIdentity | null = null;
let repo: DynamoRepository | null = null;

function table(): DynamoRepository {
  repo ??= new DynamoRepository({ tableName: requiredEnv("TABLE_NAME") });
  return repo;
}

function service(): TokenIdentity {
  identity ??= new TokenIdentity({
    repo: table(),
    secret: ssmParameterSource(requiredEnv("TOKEN_KEY_PARAMETER")),
  });
  return identity;
}

/**
 * On the run's `removed` list (#267), the run closed (#263), or the player
 * retired by an organizer (#248). A run that cannot be read is not proof of any.
 */
async function removedFromRun(runId: string, playerId: string, householdId: string): Promise<boolean> {
  const state = await table().getState(runId);
  if (!state) return false;
  // A run its host closed (#263) has nobody left to subscribe for.
  return state.closed === true || (await isOut(state, playerId, householdId, table()));
}

/** A viewer token's game is still open: see `viewerStillShows`. */
function viewerLive(runId: string, roomCode: string): Promise<boolean> {
  return viewerStillShows(table(), runId, roomCode);
}

export async function handler(
  event: ChannelAuthorizerEvent,
): Promise<ChannelAuthorizerResult> {
  return authorize(event, service(), Date.now, removedFromRun, viewerLive);
}

/** Just the two token kinds a client can present. */
type Resolver = Pick<TokenIdentity, "resolveSession" | "resolveViewer">;

/**
 * The decision itself, free of AWS and the environment so it can be tested
 * exhaustively — which for the one function standing between a family's session
 * and every other family's is worth more than the indirection costs.
 */
export async function authorize(
  event: ChannelAuthorizerEvent,
  identity: Resolver,
  now: () => number = Date.now,
  /**
   * Was this player taken out of the run by the host (#267)? Their session
   * token stays well-formed until the room ends, so only the run can say.
   * Asked of session tokens alone: a viewer token has no player to take out.
   */
  removed: (runId: string, playerId: string, householdId: string) => Promise<boolean> = async () => false,
  /**
   * Is the game a viewer token names still open, and still this run's? A token
   * outlives Close, and Close frees the room's four letters for another
   * family, so only the room can say. Asked of viewer tokens alone.
   */
  viewerOpen: (runId: string, roomCode: string) => Promise<boolean> = async () => true,
): Promise<ChannelAuthorizerResult> {
  const token = event.authorizationToken ?? "";
  if (!token) return DENY;

  // An operation this function does not know is a deny, never a default-allow.
  const operation = operationOf(event);
  if (operation === null) return DENY;

  /*
   * Publishing is IAM-only. A client that could publish could forge a patch —
   * and the server being authoritative for everything that matters (§4.1) is
   * what makes the dice fair and the replay honest. Denying here is defence in
   * depth: the API's publish auth mode does not include this authorizer.
   */
  if (operation === "PUBLISH") return DENY;

  // Either credential gets you onto a room: a player's session token, or the
  // TV's read-only viewer token. Neither is issued without the room code.
  const session = await identity.resolveSession(token);
  const viewer = session ? null : await identity.resolveViewer(token);
  const grant = session ?? viewer;
  if (!grant) return DENY;
  if (session && (await removed(session.runId, session.playerId, session.householdId))) return DENY;
  if (viewer && !(await viewerOpen(viewer.runId, viewer.roomCode))) return DENY;

  if (operation === "SUBSCRIBE" && !subscribesTo(event, grant)) return DENY;

  return {
    isAuthorized: true,
    handlerContext: {
      runId: grant.runId,
      roomCode: grant.roomCode,
      ...(session ? { playerId: session.playerId } : { viewer: "true" }),
    },
    /*
     * AppSync caches an authorization decision for this long. Capped by the
     * token's own remaining life so a room that has expired — or a device that
     * was just revoked — cannot keep a subscription alive on a stale yes.
     * Every yes is held a minute rather than five. A player's is the one a host
     * can take back (#267), and a removed phone reconnecting inside the cache
     * would otherwise be let straight back on. A viewer's can be taken back by
     * Close, and a follower screen's token is shared with other places.
     */
    ttlOverride: Math.max(
      0,
      Math.min(SESSION_CACHE_SECONDS, Math.floor((grant.expiresAt - now()) / 1000)),
    ),
  };
}

/** `EVENT_SUBSCRIBE` or `SUBSCRIBE` → `SUBSCRIBE`; anything else this function does not serve is `null`. */
function operationOf(event: ChannelAuthorizerEvent): "CONNECT" | "SUBSCRIBE" | "PUBLISH" | null {
  const raw = event.requestContext.operation;
  if (typeof raw !== "string") return null;
  const bare = raw.toUpperCase().replace(/^EVENT_/, "");
  return bare === "CONNECT" || bare === "SUBSCRIBE" || bare === "PUBLISH" ? bare : null;
}

/** `/room/ABCD/r_1` → `["room", "ABCD", "r_1"]`, from the string AppSync passes or the object form. */
function channelSegments(event: ChannelAuthorizerEvent): string[] | null {
  const channel = event.requestContext.channel;
  if (typeof channel === "string") return channel.split("/").filter(Boolean);
  if (channel && typeof channel === "object") {
    if (Array.isArray(channel.segments) && channel.segments.length > 0) return channel.segments;
    if (typeof channel.path === "string") return channel.path.split("/").filter(Boolean);
  }
  return null;
}

/**
 * A subscribe must name exactly the channel of the token's own game:
 * `room/<code>/<run>`, the run written as `runChannelSegment` does. The run is
 * part of the name so that a subscription,
 * which AppSync keeps for as long as the socket lives, is for one game and
 * never for whoever later takes the same four letters. Exact equality also
 * refuses a wildcard, which AppSync allows on a subscribe, a bare `room/<code>`
 * and a deeper path. No channel at all is "cannot prove", which is a deny.
 */
function subscribesTo(event: ChannelAuthorizerEvent, grant: { roomCode: string; runId: string }): boolean {
  const segments = channelSegments(event);
  if (!segments || segments.length !== 3) return false;
  const [namespace, code, runId] = segments;
  // The run's segment is its id as a channel name allows (`runChannelSegment`);
  // an id with none can subscribe to nothing.
  const own = runChannelSegment(grant.runId);
  return own !== null && namespace === "room" && code?.toUpperCase() === grant.roomCode.toUpperCase() && runId === own;
}
