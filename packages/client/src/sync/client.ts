/**
 * The HTTP half of the sync protocol (architecture §4.2–§4.3).
 *
 * Thin on purpose: no retries, no state, no caching. The store decides what a
 * failure means, because only the store knows whether a resync is in flight.
 */

import type {
  ActionRequest,
  ActionResponse,
  Campaign,
  Chapter,
  CreateRoomRequest,
  CreateRoomResponse,
  ItemCatalog,
  JoinRoomRequest,
  JoinRoomResponse,
  RoomMode,
  RulesContent,
  RunState,
  StateResponse,
} from "@kad/shared";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Until Chapter 1's device binding exists, a joining device names itself.
 * The field is additive to the wire type so the eventual `deviceToken` path
 * drops in without touching callers.
 */
export interface LocalJoinRequest extends JoinRoomRequest {
  displayName?: string;
}

export interface CreateRoomInput extends Omit<CreateRoomRequest, "householdId"> {
  householdId: string;
  mode: RoomMode;
  displayName?: string;
  deviceToken?: string;
}

/**
 * Creating a room also seats the host, so the response carries a full join
 * alongside the room itself — plus the dev stand-in for QR pairing, the device
 * binding this browser should keep (architecture §4.5). Joining a second time
 * to get all that would seat a *second* player and orphan the first.
 */
export interface LocalCreateRoomResponse extends CreateRoomResponse, JoinRoomResponse {
  deviceToken?: string;
}

export interface StateQuery {
  /** Preferred. A display client that only knows the room code sends `code`. */
  runId?: string;
  code?: string;
  sinceSeq?: number;
}

/**
 * Served rather than baked into the bundle, so the same artifact can be
 * deployed to a second stack without a rebuild (see `lambda/http.ts`). Absent
 * in local dev, where there is no user pool — which is exactly how the sign-in
 * offer knows not to appear.
 */
export interface ClientConfig {
  region: string;
  realtime: { httpDomain: string; realtimeDomain: string; namespace: string };
  auth: { userPoolId: string; clientId: string };
}

/** What `POST /api/auth/link` gives back — architecture §4.5. */
export interface LinkAccountResponse {
  householdId: string;
  /** True when a guest household just became permanent. The thing worth saying. */
  claimed: boolean;
  players: { id: string; displayName: string; color: string; role: string }[];
  characters: { id: string; name: string; species: string; ownerPlayerId: string }[];
  deviceToken?: string;
  playerId?: string;
}

/**
 * How a display client attaches — architecture §4.5, "The TV, which is nobody".
 *
 * It has no device and no player, but the realtime channel is authorised per
 * subscriber in prod, so it still needs something to present. This is where it
 * gets it: a token naming one room, valid until that room expires.
 */
export interface WatchRoomResponse {
  runId: string;
  mode: RoomMode;
  expiresAt: string;
  viewerToken: string;
  state: RunState;
}

export interface Api {
  createRoom(body: CreateRoomInput): Promise<LocalCreateRoomResponse>;
  joinRoom(code: string, body: LocalJoinRequest): Promise<JoinRoomResponse>;
  watchRoom(code: string): Promise<WatchRoomResponse>;
  postAction(body: ActionRequest, token: string): Promise<ActionResponse>;
  fetchState(query: StateQuery, token?: string): Promise<StateResponse>;
  loadRules(): Promise<RulesContent>;
  loadItems(): Promise<ItemCatalog>;
  loadCampaign(id: string): Promise<Campaign>;
  /**
   * The chapter in play, for what the *renderer* needs from it: the biome that
   * picks the combat tile sheet, and the enemy art ids on encounter scenes.
   * The engine's copy lives server-side; this one is read-only dressing.
   */
  loadChapter(id: string): Promise<Chapter>;
  /**
   * The combat ability catalog, raw. `content/abilities.json` wraps the
   * catalog in `{ version, abilities }` with authoring `$comment`s throughout;
   * `parseAbilityCatalog` (store/combat.ts) is what turns it into the
   * `AbilityCatalog` that `legalActions` takes, and it stays a separate pure
   * step so the shape-tolerance is testable without a fetch.
   */
  loadAbilities(): Promise<unknown>;

  /** `null` when the deployment has no user pool, i.e. local dev. */
  fetchConfig(): Promise<ClientConfig | null>;
  /** Claims the household this device is playing in for a signed-in account. */
  linkAccount(idToken: string, deviceToken?: string): Promise<LinkAccountResponse>;
  /** Binds this device to an existing player — the new-phone path (§4.5). */
  adoptDevice(
    idToken: string,
    householdId: string,
    playerId: string,
  ): Promise<{ deviceToken: string; playerId: string }>;
}

const JSON_HEADERS = { "content-type": "application/json" };

async function request<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    headers: {
      ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const shaped = body as { error?: { code?: string; message?: string }; message?: string } | null;
    throw new ApiError(
      response.status,
      shaped?.error?.message ?? shaped?.message ?? `Request failed (${response.status})`,
      shaped?.error?.code,
    );
  }

  return body as T;
}

function stateQueryString(query: StateQuery): string {
  const params = new URLSearchParams();
  if (query.runId) params.set("runId", query.runId);
  if (query.code) params.set("code", query.code);
  if (query.sinceSeq !== undefined) params.set("sinceSeq", String(query.sinceSeq));
  return params.toString();
}

/** The SSE endpoint for a room. `sync/channel.ts` opens it. */
export function eventsUrl(code: string, sinceSeq: number, token?: string): string {
  const params = new URLSearchParams({ sinceSeq: String(sinceSeq) });
  if (token) params.set("token", token);
  return `/events/${encodeURIComponent(code)}?${params.toString()}`;
}

export const api: Api = {
  createRoom(body) {
    return request<LocalCreateRoomResponse>("/api/room", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
  },

  joinRoom(code, body) {
    return request<JoinRoomResponse>(`/api/room/${encodeURIComponent(code)}/join`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
  },

  watchRoom(code) {
    return request<WatchRoomResponse>(`/api/room/${encodeURIComponent(code)}/watch`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
  },

  /**
   * `ActionRequest.seq` carries the client's last-seen server seq so the server
   * can reject a stale intent (architecture §4.2). The store never retries a
   * rejection — it resyncs.
   */
  postAction(body, token) {
    return request<ActionResponse>("/api/action", {
      method: "POST",
      headers: JSON_HEADERS,
      token,
      body: JSON.stringify(body),
    });
  },

  fetchState(query, token) {
    return request<StateResponse>(`/api/state?${stateQueryString(query)}`, { token });
  },

  /* Content is data, served statically and never deployed with game code
     (roadmap, "Content as data"). */
  loadRules() {
    return request<RulesContent>("/content/rules.json");
  },

  loadItems() {
    return request<ItemCatalog>("/content/items.json");
  },

  loadCampaign(id) {
    return request<Campaign>(`/content/campaigns/${id}.json`);
  },

  loadChapter(id) {
    return request<Chapter>(`/content/chapters/${encodeURIComponent(id)}.json`);
  },

  loadAbilities() {
    return request<unknown>("/content/abilities.json");
  },

  // --- optional sign-in (architecture §4.5) --------------------------------

  async fetchConfig() {
    try {
      return await request<ClientConfig>("/api/config");
    } catch {
      /*
       * The dev server has no `/api/config` and no user pool, so this 404s on a
       * laptop — which is the correct answer, not a failure. Sign-in is offered
       * only where it can actually work; locally, anonymous play is all there
       * is, and that is the whole point of anonymous play.
       */
      return null;
    }
  },

  linkAccount(idToken, deviceToken) {
    return request<LinkAccountResponse>("/api/auth/link", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        ...(deviceToken ? { "x-kad-device-token": deviceToken } : {}),
      },
      // The *Cognito* id token, not a room session token — this is the one
      // request in the client that carries an account credential.
      token: idToken,
      body: JSON.stringify({}),
    });
  },

  adoptDevice(idToken, householdId, playerId) {
    return request<{ deviceToken: string; playerId: string }>("/api/auth/device", {
      method: "POST",
      headers: JSON_HEADERS,
      token: idToken,
      body: JSON.stringify({ householdId, playerId }),
    });
  },
};
