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
  CreateRoomRequest,
  CreateRoomResponse,
  ItemCatalog,
  JoinRoomRequest,
  JoinRoomResponse,
  RoomMode,
  RulesContent,
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
}

export interface StateQuery {
  /** Preferred. A display client that only knows the room code sends `code`. */
  runId?: string;
  code?: string;
  sinceSeq?: number;
}

export interface Api {
  createRoom(body: CreateRoomInput): Promise<CreateRoomResponse>;
  joinRoom(code: string, body: LocalJoinRequest): Promise<JoinRoomResponse>;
  postAction(body: ActionRequest, token: string): Promise<ActionResponse>;
  fetchState(query: StateQuery, token?: string): Promise<StateResponse>;
  loadRules(): Promise<RulesContent>;
  loadItems(): Promise<ItemCatalog>;
  loadCampaign(id: string): Promise<Campaign>;
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
    return request<CreateRoomResponse>("/api/room", {
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
};
