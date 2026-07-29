/**
 * The AppSync Events Lambda authorizer — who is allowed on `room/<code>`.
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

import { KMSClient } from "@aws-sdk/client-kms";
import { KmsIdentity } from "../kms-identity.ts";
import { DynamoRepository } from "../store/dynamo-repository.ts";
import { requiredEnv } from "./runtime.ts";

/** What AppSync sends. Only the fields this function reads. */
export interface ChannelAuthorizerEvent {
  authorizationToken?: string;
  requestContext: {
    channelNamespace?: string;
    /** Absent on CONNECT — there is no channel yet. */
    channel?: { path?: string; segments?: string[] };
    operation?: "CONNECT" | "SUBSCRIBE" | "PUBLISH";
  };
}

export interface ChannelAuthorizerResult {
  isAuthorized: boolean;
  /** Surfaces in the subscription's context; useful in AppSync logs. */
  handlerContext?: Record<string, string>;
  ttlOverride?: number;
}

const DENY: ChannelAuthorizerResult = { isAuthorized: false };

/**
 * Cached for the life of the container. The KMS public key is fetched once and
 * every verification after that is local arithmetic — this function sits in
 * front of every subscribe, so a network round trip here is a network round trip
 * on every phone that reconnects.
 */
let identity: KmsIdentity | null = null;

function service(): KmsIdentity {
  identity ??= new KmsIdentity({
    repo: new DynamoRepository({ tableName: requiredEnv("TABLE_NAME") }),
    keyId: requiredEnv("KMS_KEY_ID"),
    client: new KMSClient({}),
  });
  return identity;
}

export async function handler(
  event: ChannelAuthorizerEvent,
): Promise<ChannelAuthorizerResult> {
  return authorize(event, service());
}

/** Just the two token kinds a client can present. */
type Resolver = Pick<KmsIdentity, "resolveSession" | "resolveViewer">;

/**
 * The decision itself, free of KMS and the environment so it can be tested
 * exhaustively — which for the one function standing between a family's session
 * and every other family's is worth more than the indirection costs.
 */
export async function authorize(
  event: ChannelAuthorizerEvent,
  identity: Resolver,
  now: () => number = Date.now,
): Promise<ChannelAuthorizerResult> {
  const token = event.authorizationToken ?? "";
  if (!token) return DENY;

  const operation = event.requestContext.operation ?? "CONNECT";

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

  if (operation === "SUBSCRIBE") {
    const code = roomCodeOf(event);
    // No code means we cannot prove the subscription is for this token's room,
    // and "cannot prove" is a deny.
    if (!code || code !== grant.roomCode.toUpperCase()) return DENY;
  }

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
     */
    ttlOverride: Math.max(0, Math.min(300, Math.floor((grant.expiresAt - now()) / 1000))),
  };
}

/** `/room/ABCD` → `ABCD`, from either the path or the segments. */
function roomCodeOf(event: ChannelAuthorizerEvent): string | null {
  const channel = event.requestContext.channel;
  const fromSegments = channel?.segments?.[1];
  if (fromSegments) return fromSegments.toUpperCase();
  const fromPath = channel?.path?.split("/").filter(Boolean)[1];
  return fromPath ? fromPath.toUpperCase() : null;
}
