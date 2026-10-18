/**
 * The HTTP half of the sync protocol (architecture §4.2–§4.3).
 *
 * Thin on purpose: no retries, no state, no caching. The store decides what a
 * failure means, because only the store knows whether a resync is in flight.
 */

import { itemCatalog } from "@kad/shared";
import type {
  ResolvedCharacter,
  ActionRequest,
  ActionResponse,
  Campaign,
  Chapter,
  CreateRoomRequest,
  CreateRoomResponse,
  IntentPreview,
  ItemCatalog,
  JoinRoomRequest,
  JoinRoomResponse,
  JournalResponse,
  OrganizerDevicesResponse,
  OrganizerHouseholdsResponse,
  OrganizerHouseholdSummary,
  OrganizerHouseholdView,
  OrganizerInvite,
  TransferAccepted,
  TransferCode,
  RoomMode,
  RulesContent,
  RunState,
  SetVisitorsResponse,
  SharedDevicePlayersResponse,
  SharedSeatRequest,
  ShareDeviceResponse,
  StateResponse,
  WorldMap,
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

/**
 * The TV opening a room (`display: true`): the room and the device binding,
 * and no join — the TV is the lobby, not a seat (spec §2.1).
 */
export interface LocalOpenDisplayResponse extends CreateRoomResponse {
  deviceToken?: string;
  /** Always true: the screen that opens a room is its host (#267). */
  host?: boolean;
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
  /**
   * `null` when the account owns more than one household and nothing said
   * which (#248): `households` lists them, and the client asks.
   */
  householdId: string | null;
  /** True when a guest household just became permanent. The thing worth saying. */
  claimed: boolean;
  players: { id: string; displayName: string; color: string }[];
  characters: { id: string; name: string; species: string; ownerPlayerId: string }[];
  deviceToken?: string;
  playerId?: string;
  /** This phone already plays in `householdId`; no player to pick. Absent from older servers. */
  deviceBound?: boolean;
  /**
   * Every household the account owns (#248): more than one is a grown-up who
   * runs a group as well as a family, and is asked which. Absent from older servers.
   */
  households?: OrganizerHouseholdSummary[];
}

/** One change an organizer makes to a household (#248). Each answers with the whole household. */
export type OrganizerEdit =
  | { action: "rename-household"; householdId: string; displayName: string }
  | { action: "add-player"; householdId: string; displayName: string }
  | { action: "rename-player"; householdId: string; playerId: string; displayName: string }
  | { action: "retire-player"; householdId: string; playerId: string; retired: boolean };

const ORGANIZER_EDIT_PATH: Record<OrganizerEdit["action"], string> = {
  "rename-household": "/api/organizer/household/rename",
  "add-player": "/api/organizer/players",
  "rename-player": "/api/organizer/players/rename",
  "retire-player": "/api/organizer/players/retire",
};

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
  /** This screen opened the room, so it may take a player out (#267). */
  host?: boolean;
}

/** The picker's answer, plus the tablet's renewed token when the server slid it. */
export interface SharedPlayersLoad extends SharedDevicePlayersResponse {
  rotatedToken?: string;
}

/** What the host may do to its room (#263, #267). */
export type HostControl = "remove" | "lock" | "quiet" | "close";

/**
 * How the host proves it is the host: a phone's (or TV's) own device token,
 * or a shared tablet's token with the seated kid's room session (#250).
 */
export type HostAuth = { deviceToken: string } | { sharedToken: string; sessionToken: string };

export interface Api {
  createRoom(body: CreateRoomInput): Promise<LocalCreateRoomResponse>;
  /** Party Mode, opened from the TV itself: nobody is seated. */
  openDisplayRoom(body: Omit<CreateRoomInput, "mode" | "display">): Promise<LocalOpenDisplayResponse>;
  joinRoom(code: string, body: LocalJoinRequest): Promise<JoinRoomResponse>;
  /**
   * `deviceToken`, when this screen has one, is how a TV that opened the room
   * learns after a refresh that it is still the host (#267). It grants nothing else.
   */
  watchRoom(code: string, timeoutMs?: number, deviceToken?: string): Promise<WatchRoomResponse>;
  /**
   * The host running the room (#263, #267): take a player out
   * (`{ playerId }`), lock it to new joins (`{ locked }`), or close it.
   */
  hostControl(code: string, control: HostControl, body: Record<string, unknown>, auth: HostAuth): Promise<void>;
  postAction(body: ActionRequest, token: string): Promise<ActionResponse>;
  /** An unconfirmed tap, relayed to the room's screens (`IntentPreview`). */
  postPreview(preview: IntentPreview | null, context: string | null, token: string): Promise<void>;
  /**
   * `timeoutMs` narrows the request funnel's default bound for this one call.
   * Refresh recovery passes the *remaining* recovery budget here, so five
   * retries against a dead connection share one deadline instead of each
   * spending the full default (store `withRetry`).
   */
  fetchState(query: StateQuery, token?: string, timeoutMs?: number): Promise<StateResponse>;
  /** This player's saved characters, to bring one back (spec §5). */
  listHeroes(token: string): Promise<{ heroes: ResolvedCharacter[] }>;
  /**
   * What this phone can study between games — its heroes, the household's
   * Field Guide, where the party last was. The device token, not a room
   * session: there is no room.
   */
  loadJournal(deviceToken: string): Promise<JournalResponse>;
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
   * The world map's key — every placed biome and location with its anchor on
   * the realm painting (`content/world.json`, generated from canon). What the
   * phone's map needs to stand the party on the right country.
   */
  loadWorld(): Promise<WorldMap>;
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
  /** True only on the local dev server, which signs people in without a user pool. */
  probeDevAuth(): Promise<boolean>;
  /** Claims the household this device is playing in for a signed-in account. */
  /**
   * `preferExisting` is the home-screen sign-in: an account that already has a
   * household returns to it rather than claiming this phone's guest game.
   */
  linkAccount(
    idToken: string,
    deviceToken?: string,
    preferExisting?: boolean,
    /** One of `households` from an earlier answer (#248). */
    householdId?: string,
  ): Promise<LinkAccountResponse>;
  /** Binds this device to an existing player — the new-phone path (§4.5). */
  adoptDevice(
    idToken: string,
    householdId: string,
    playerId: string,
  ): Promise<{ deviceToken: string; playerId: string }>;

  // --- shared tablets (#250) -------------------------------------------------
  /**
   * A signed-in owner makes this device the household's shared tablet. The
   * device token it held, if any, goes along to be revoked.
   */
  shareDevice(
    idToken: string,
    deviceToken?: string,
    sharedToken?: string,
    /** Which household, when the account owns more than one (#248). */
    householdId?: string,
  ): Promise<ShareDeviceResponse>;
  /** "Forget this device": the tablet's own token names it. */
  forgetDevice(idToken: string, sharedToken: string): Promise<void>;
  /**
   * A signed-in owner opening a room to visitors, or closing it to new ones
   * (#249). The id token is the grown-up's; the room is named by its code.
   */
  setVisitors(idToken: string, code: string, open: boolean): Promise<SetVisitorsResponse>;
  /** The "who's playing?" picker. */
  listSharedPlayers(sharedToken: string): Promise<SharedPlayersLoad>;
  /** Seat the kid picked on the tablet. Answers with a session, never a device token. */
  joinRoomShared(code: string, sharedToken: string, seat: SharedSeatRequest): Promise<JoinRoomResponse>;
  createRoomShared(
    body: { mode: RoomMode; campaignId?: string },
    sharedToken: string,
    seat: SharedSeatRequest,
  ): Promise<LocalCreateRoomResponse>;

  // --- organizers (#248) -----------------------------------------------------
  /** Every household the signed-in account owns. */
  listHouseholds(idToken: string): Promise<OrganizerHouseholdsResponse>;
  /** A new group, owned by this account, with nobody in it yet. */
  createGroup(idToken: string, displayName: string): Promise<OrganizerHouseholdSummary>;
  viewHousehold(idToken: string, householdId: string): Promise<OrganizerHouseholdView>;
  /** The household's shared tablets (#273). */
  listSharedDevices(idToken: string, householdId: string): Promise<OrganizerDevicesResponse>;
  /** Forget a shared tablet by id, from any signed-in device (#273). */
  forgetDeviceById(idToken: string, deviceId: string): Promise<void>;
  editHousehold(idToken: string, edit: OrganizerEdit): Promise<OrganizerHouseholdView>;
  createOrganizerInvite(idToken: string, householdId: string): Promise<OrganizerInvite>;
  acceptOrganizerInvite(idToken: string, code: string): Promise<OrganizerHouseholdSummary>;
  /** A single-use code that moves one kid to another home (#251). */
  createTransferCode(idToken: string, householdId: string, playerId: string): Promise<TransferCode>;
  /** Redeem one: into `householdId`, which you own, or a new home when it is absent. */
  acceptTransfer(idToken: string, code: string, householdId?: string): Promise<TransferAccepted>;
  /** Take a co-organizer off, or leave (`ownerId` is your own). */
  removeOrganizer(idToken: string, householdId: string, ownerId: string): Promise<{ householdId: string; left: boolean }>;
}

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * How long any one request may live before the client gives up on it.
 *
 * This bound is what stands between a flaky network and a bricked phone. Every
 * screen that sends an intent disables its buttons while the send is in
 * flight (`busy`), and un-disables them when the promise settles — so a fetch
 * that never settles is a controller whose every button is "Sending…" until
 * somebody hard-refreshes it. That is not hypothetical: a single hung
 * `/action` through the dev proxy was the intermittent e2e failure, and a
 * phone on a dropped-but-open wifi connection at a real table is the same
 * brick. A timeout turns it into a ten-second hiccup with a toast, and the
 * answer to a toast is the game's normal answer: tap it again.
 *
 * Ten seconds: comfortably past a Lambda cold start plus a slow hop, and
 * comfortably inside the patience of an eight-year-old holding the phone.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Exported for its tests, which cannot fake `AbortSignal.timeout` — it lives
 * below the JS timer layer — and so pass a tiny real `timeoutMs` instead.
 * Nothing in the app passes one; the default is the contract.
 */
export async function request<T>(
  path: string,
  init: RequestInit & { token?: string; timeoutMs?: number; onHeaders?: (headers: Headers) => void } = {},
): Promise<T> {
  const { token, headers, timeoutMs, onHeaders, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      headers: {
        ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // The abort arrives as a DOMException whose message ("The operation was
    // aborted due to timeout") is written for a developer. The person holding
    // the phone gets the sentence that tells them what to do about it.
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new ApiError(0, "The game took too long to answer. Tap again.");
    }
    throw error;
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const shaped = body as { error?: { code?: string; message?: string }; message?: string } | null;
    throw new ApiError(
      response.status,
      shaped?.error?.message ?? shaped?.message ?? `Request failed (${response.status})`,
      shaped?.error?.code,
    );
  }

  onHeaders?.(response.headers);
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

  openDisplayRoom(body) {
    return request<LocalOpenDisplayResponse>("/api/room", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...body, mode: "party", display: true }),
    });
  },

  joinRoom(code, body) {
    return request<JoinRoomResponse>(`/api/room/${encodeURIComponent(code)}/join`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
  },

  watchRoom(code, timeoutMs, deviceToken) {
    return request<WatchRoomResponse>(`/api/room/${encodeURIComponent(code)}/watch`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...(deviceToken ? { "x-kad-device-token": deviceToken } : {}) },
      body: JSON.stringify({}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  },

  async hostControl(code, control, body, auth) {
    await request<{ ok: true }>(`/api/room/${encodeURIComponent(code)}/${control}`, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        ...("deviceToken" in auth ? { "x-kad-device-token": auth.deviceToken } : { "x-kad-shared-token": auth.sharedToken }),
      },
      ...("sessionToken" in auth ? { token: auth.sessionToken } : {}),
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

  async postPreview(preview, context, token) {
    await request<{ ok: boolean }>("/api/preview", {
      method: "POST",
      headers: JSON_HEADERS,
      token,
      body: JSON.stringify({ preview, context }),
    });
  },

  listHeroes(token) {
    return request<{ heroes: ResolvedCharacter[] }>("/api/heroes", { token });
  },

  loadJournal(deviceToken) {
    return request<JournalResponse>("/api/journal", { headers: { "x-kad-device-token": deviceToken } });
  },

  fetchState(query, token, timeoutMs) {
    return request<StateResponse>(`/api/state?${stateQueryString(query)}`, {
      token,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  },

  /* Content is data, served statically and never deployed with game code
     (roadmap, "Content as data"). */
  loadRules() {
    return request<RulesContent>("/content/rules.json");
  },

  loadItems() {
    /* Generated (D7) and carries a `$comment` header; `itemCatalog` strips it
       so the catalog the UI indexes holds only real items. */
    return request<Record<string, unknown>>("/content/items.json").then(itemCatalog);
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

  loadWorld() {
    return request<WorldMap>("/content/world.json");
  },

  // --- optional sign-in (architecture §4.5) --------------------------------

  async fetchConfig() {
    try {
      const config = await request<ClientConfig>("/api/config");
      const fields = [config?.region, config?.realtime?.httpDomain,
        config?.realtime?.realtimeDomain, config?.realtime?.namespace,
        config?.auth?.userPoolId, config?.auth?.clientId];
      if (!fields.every((field) => typeof field === "string" && field.length > 0)) {
        throw new Error("Invalid game configuration.");
      }
      return config;
    } catch (error) {
      // Only the local server's missing endpoint means SSE. Network failures,
      // server errors and malformed responses must be retried as failures.
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },

  async probeDevAuth() {
    try {
      const result = await request<{ dev?: boolean }>("/api/auth/dev");
      return result?.dev === true;
    } catch {
      return false;
    }
  },

  linkAccount(idToken, deviceToken, preferExisting = false, householdId) {
    return request<LinkAccountResponse>("/api/auth/link", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        ...(deviceToken ? { "x-kad-device-token": deviceToken } : {}),
      },
      // The *Cognito* id token, not a room session token — this is the one
      // request in the client that carries an account credential.
      token: idToken,
      body: JSON.stringify({
        ...(preferExisting ? { preferExisting: true } : {}),
        ...(householdId ? { householdId } : {}),
      }),
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

  shareDevice(idToken, deviceToken, sharedToken, householdId) {
    return request<ShareDeviceResponse>("/api/auth/shared-device", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        ...(deviceToken ? { "x-kad-device-token": deviceToken } : {}),
        ...(sharedToken ? { "x-kad-shared-token": sharedToken } : {}),
      },
      token: idToken,
      body: JSON.stringify(householdId ? { householdId } : {}),
    });
  },

  async forgetDevice(idToken, sharedToken) {
    await request<unknown>("/api/auth/forget-device", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-kad-shared-token": sharedToken },
      token: idToken,
      body: JSON.stringify({}),
    });
  },

  setVisitors(idToken, code, open) {
    return request<SetVisitorsResponse>(`/api/room/${encodeURIComponent(code)}/visitors`, {
      method: "POST",
      headers: JSON_HEADERS,
      token: idToken,
      body: JSON.stringify({ open }),
    });
  },

  async listSharedPlayers(sharedToken) {
    let rotatedToken: string | null = null;
    const body = await request<SharedDevicePlayersResponse>("/api/household/players", {
      headers: { "x-kad-shared-token": sharedToken },
      onHeaders: (headers) => {
        rotatedToken = headers.get("x-kad-shared-token");
      },
    });
    return { ...body, ...(rotatedToken ? { rotatedToken } : {}) };
  },

  // --- organizers (#248): every one carries the *Cognito* id token ----------

  listHouseholds(idToken) {
    return request<OrganizerHouseholdsResponse>("/api/organizer/households", { token: idToken });
  },

  createGroup(idToken, displayName) {
    return request<OrganizerHouseholdSummary>("/api/organizer/households", {
      method: "POST",
      headers: JSON_HEADERS,
      token: idToken,
      body: JSON.stringify({ displayName }),
    });
  },

  viewHousehold(idToken, householdId) {
    return request<OrganizerHouseholdView>(
      `/api/organizer/household?${new URLSearchParams({ householdId }).toString()}`,
      { token: idToken },
    );
  },

  listSharedDevices(idToken, householdId) {
    return request<OrganizerDevicesResponse>(
      `/api/organizer/devices?${new URLSearchParams({ householdId }).toString()}`,
      { token: idToken },
    );
  },

  async forgetDeviceById(idToken, deviceId) {
    await request<unknown>("/api/auth/forget-device", {
      method: "POST",
      headers: JSON_HEADERS,
      token: idToken,
      body: JSON.stringify({ deviceId }),
    });
  },

  editHousehold(idToken, edit) {
    const { action, ...body } = edit;
    return request<OrganizerHouseholdView>(ORGANIZER_EDIT_PATH[action], {
      method: "POST",
      headers: JSON_HEADERS,
      token: idToken,
      body: JSON.stringify(body),
    });
  },

  createOrganizerInvite(idToken, householdId) {
    return request<OrganizerInvite>("/api/organizer/invite", {
      method: "POST",
      headers: JSON_HEADERS,
      token: idToken,
      body: JSON.stringify({ householdId }),
    });
  },

  acceptOrganizerInvite(idToken, code) {
    return request<OrganizerHouseholdSummary>("/api/organizer/invite/accept", {
      method: "POST",
      headers: JSON_HEADERS,
      token: idToken,
      body: JSON.stringify({ code }),
    });
  },

  createTransferCode(idToken, householdId, playerId) {
    return request<TransferCode>("/api/organizer/transfer", {
      method: "POST",
      headers: JSON_HEADERS,
      token: idToken,
      body: JSON.stringify({ householdId, playerId }),
    });
  },

  acceptTransfer(idToken, code, householdId) {
    return request<TransferAccepted>("/api/organizer/transfer/accept", {
      method: "POST",
      headers: JSON_HEADERS,
      token: idToken,
      body: JSON.stringify(householdId ? { code, householdId } : { code }),
    });
  },

  removeOrganizer(idToken, householdId, ownerId) {
    return request<{ householdId: string; left: boolean }>("/api/organizer/owners/remove", {
      method: "POST",
      headers: JSON_HEADERS,
      token: idToken,
      body: JSON.stringify({ householdId, ownerId }),
    });
  },

  joinRoomShared(code, sharedToken, seat) {
    return request<JoinRoomResponse>(`/api/room/${encodeURIComponent(code)}/join`, {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-kad-shared-token": sharedToken },
      body: JSON.stringify(seat),
    });
  },

  createRoomShared(body, sharedToken, seat) {
    return request<LocalCreateRoomResponse>("/api/room", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-kad-shared-token": sharedToken },
      body: JSON.stringify({ ...body, ...seat }),
    });
  },
};
