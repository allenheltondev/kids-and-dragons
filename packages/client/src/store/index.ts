/**
 * The game store — the implementation of `store/contract.ts`.
 *
 * This is the only module in the client that talks to the server. Screens read
 * state and call `send()`; nothing else fetches, and nothing anywhere writes
 * `state` by hand. The mirror moves forward in exactly one place — the
 * sequencer's `onState` handler below — which is what makes "the server is
 * authoritative" (architecture §4.1) a structural property rather than a
 * convention people remember to follow.
 */

import { useEffect, useRef } from "react";
import { create } from "zustand";
import type { StateCreator } from "zustand";
import type {
  AbilityCatalog,
  ActionResponse,
  Campaign,
  Chapter,
  ClientIntent,
  IntentPreview,
  JoinRoomResponse,
  ItemCatalog,
  PartyMember,
  Presentation,
  Prompt,
  RoomMode,
  SharedSeatRequest,
  RulesContent,
  RunState,
  WorldMap,
} from "@kad/shared";
import { previewContext, rollerAway, turnHolderAway } from "@kad/shared";
import { isMyCombatTurn, parseAbilityCatalog } from "./combat";
import type {
  ClientSession,
  ConnectionStatus,
  GameStore,
  HeldPreview,
  PresentationEvent,
  ProgressionEvent,
} from "./contract";
import {
  clearSession,
  clearSharedDevice,
  defaultStorage,
  loadSharedDevice,
  saveSharedDevice,
  tabStorage,
  asPlayerIdentity,
  clearSavedJournal,
  loadIdentity,
  loadPlayerDeviceToken,
  loadSavedJournal,
  loadSession,
  saveJournal,
  saveIdentity,
  saveSession,
  type KeyValueStorage,
} from "./persistence";
import {
  api as defaultApi,
  eventsUrl as defaultEventsUrl,
  ApiError,
  REQUEST_TIMEOUT_MS,
  type Api,
  type ClientConfig,
  type HostAuth,
  type HostControl,
} from "../sync/client";
import {
  MessageSequencer,
  backoffDelay,
  openChannel as defaultOpenChannel,
  type Channel,
  type EventSourceLike,
  type PresentationGate,
} from "../sync/channel";
import { appSyncEventSource } from "../sync/appsync-socket";
import { setFieldGuideDiscoveries } from "./field-guide-discoveries";
import { announceFieldGuideNews, clearFieldGuideNews } from "./field-guide-news";
import { navigate } from "../router";

/**
 * The campaign a new room is opened for. Gemfall is the authored arc; the
 * Hollow Crown is the engine's reference chapter, which the browser suite pins
 * with `VITE_LAUNCH_CAMPAIGN` so its scripted walk does not move when the story
 * does. It is the lobby's first option, not its only one: the server adds every
 * campaign the household has under way, and the party votes between them
 * (`RunState.campaignOptions`, shared `lobbyCampaign`).
 */
const LAUNCH_CAMPAIGN: string =
  (import.meta.env.VITE_LAUNCH_CAMPAIGN as string | undefined) || "gemfall";

// ---------------------------------------------------------------------------
// Store surface
// ---------------------------------------------------------------------------

/**
 * Beyond the contract, the store carries three things the shells need and the
 * screens do not:
 *
 *  - `attach()`   — recover a surface from its URL alone, which is what makes a
 *                   hard refresh survivable on any device (architecture §4.3),
 *                   and what lets `/tv/:code` connect with no player identity
 *                   at all (spec §2.1: the TV is a pure display client).
 *  - `pendingCode`— the room code in the URL before we have a session, so a
 *                   scanned QR lands on a prefilled join.
 *  - `registerPresentationPlayer()` — see `sync/channel.ts`. Whichever surface
 *                   renders the world registers itself; nobody reads the mode.
 */
export interface InternalGameStore extends GameStore {
  pendingCode: string | null;
  attach(code: string, role: SurfaceRole): Promise<void>;
  registerPresentationPlayer(gate: PresentationGate | null): () => void;
}

export type SurfaceRole = "player" | "display";

export interface GameStoreDeps {
  api: Api;
  storage: KeyValueStorage;
  /**
   * Where a shared tablet keeps its room session (#250): this tab only, so
   * the next kid to pick it up is asked who they are. Defaults to
   * `sessionStorage`.
   */
  tabStorage?: KeyValueStorage;
  openChannel: typeof defaultOpenChannel;
  eventsUrl: typeof defaultEventsUrl;
  /** Injected so tests can assert routing without a DOM. */
  navigate: typeof navigate;
}

export function defaultDeps(): GameStoreDeps {
  return {
    api: defaultApi,
    storage: defaultStorage(),
    tabStorage: tabStorage(),
    openChannel: defaultOpenChannel,
    eventsUrl: defaultEventsUrl,
    navigate,
  };
}

// ---------------------------------------------------------------------------
// Pure selectors — exported so they can be tested without a store
// ---------------------------------------------------------------------------

export function selectMe(state: RunState | null, playerId: string): PartyMember | null {
  if (!state || !playerId) return null;
  return state.party.find((member) => member.playerId === playerId) ?? null;
}

/**
 * "Is this prompt mine?" A display client (`playerId === ""`) is never the
 * answerer — the TV has no authority (spec §2.1).
 */
export function isPromptForPlayer(
  prompt: Prompt | null,
  playerId: string,
  party: readonly PartyMember[],
): boolean {
  if (!prompt || !playerId) return false;

  switch (prompt.kind) {
    case "choice":
      // A turn holder whose phone dropped leaves the story beat to anyone
      // (spec §6.1) — the engine takes the answer, so the button has to show.
      return (
        prompt.forPlayerIds.length === 0 ||
        prompt.forPlayerIds.includes(playerId) ||
        turnHolderAway(party, prompt)
      );
    case "ready":
      return prompt.forPlayerIds.length === 0 || prompt.forPlayerIds.includes(playerId);
    case "roll": {
      // The nominee's phone dropped: anyone at the table can roll instead.
      if (rollerAway(party, prompt)) return party.some((m) => m.playerId === playerId);
      // A whole-party check is yours until you have rolled your own die.
      if (prompt.group) {
        const mine = party.find((member) => member.playerId === playerId);
        return mine !== undefined && prompt.group.pending.includes(mine.character.id);
      }
      const owner = party.find((member) => member.character.id === prompt.characterId);
      return owner?.playerId === playerId;
    }
    case "item_swap": {
      const owner = party.find((member) => member.character.id === prompt.characterId);
      return owner?.playerId === playerId;
    }
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface Runtime {
  sequencer: MessageSequencer | null;
  channel: Channel | null;
  gate: PresentationGate | null;
  content: Promise<void> | null;
  resyncing: Promise<void> | null;
  resyncAgain: boolean;
  resyncRetry: ReturnType<typeof setTimeout> | null;
  resyncAttempt: number;
  connectRetry: ReturnType<typeof setTimeout> | null;
  /**
   * Watchdog for a broadcast the server owes us. A successful action response
   * names the seq it committed; the patch normally arrives on the channel a
   * beat later. If it never does — the server's publish failed after the
   * commit — nothing else would notice until the *next* message opened a gap,
   * and between scenes that next message can be minutes away. This timer is
   * the recovery contract: response says N, sequencer still behind N after a
   * grace period, resync.
   */
  broadcastWatchdog: ReturnType<typeof setTimeout> | null;
  /**
   * In-flight attach, so React 19's double-invoked effect joins once — keyed
   * by room code, because "an attach is running" is not the same fact as "an
   * attach *to this room* is running". Handing back the old promise for a new
   * code would resolve the caller against the wrong room.
   */
  attaching: { code: string; task: Promise<void> } | null;
  /**
   * Which realtime transport this deployment uses, resolved once from
   * `/api/config` (architecture §4.4). `null` — the local dev answer — means
   * SSE against the dev server's `/events/<code>`.
   */
  realtime: Promise<ClientConfig["realtime"] | null> | null;
  /** In-flight chapter fetch, keyed by id — same shape as `attaching`. */
  chapter: { id: string; task: Promise<void> } | null;
  /** In-flight world map fetch. */
  world: Promise<void> | null;
  /**
   * This phone's preview sender: what the server last heard, and the newest
   * one waiting while a post is in the air. One post at a time so they cannot
   * land out of order — the TV must never end on a tap the player has
   * already moved past — and only the latest waiting one is ever sent.
   */
  previewSent: string;
  previewInFlight: boolean;
  previewNext: { key: string; preview: IntentPreview | null; context: string | null } | null;
}

/**
 * How long an action's committed patch may take to arrive on the channel
 * before the client stops waiting and resyncs. Generous next to the
 * sequencer's 750ms gap timer, because this timer's normal fate is to be
 * cleared: it has to outlast an ordinary broadcast plus a presentation-gated
 * beat, so it only ever fires when the broadcast genuinely never left.
 */
const BROADCAST_GRACE_MS = 4_000;

/**
 * Arrivals a non-host screen holds at once. A burst of phones joining a lobby
 * is a handful; past this, the oldest notice goes.
 */
const MAX_ARRIVALS = 6;

/**
 * Arrivals the host holds until it dismisses or removes them (see
 * `onArrival`). Far more than any real table, and still a bound: past it the
 * host is being flooded, and the oldest go, counted in `arrivalsDropped`.
 */
const MAX_HOST_ARRIVALS = 50;

export function gameStoreCreator(deps: GameStoreDeps): StateCreator<InternalGameStore> {
  return (set, get) => {
    const runtime: Runtime = {
      sequencer: null,
      channel: null,
      gate: null,
      content: null,
      resyncing: null,
      resyncAgain: false,
      resyncRetry: null,
      resyncAttempt: 0,
      connectRetry: null,
      attaching: null,
      realtime: null,
      broadcastWatchdog: null,
      chapter: null,
      world: null,
      previewSent: "[null,null]",
      previewInFlight: false,
      previewNext: null,
    };

    /** Cache successful discovery, including the explicit local 404 answer. */
    function realtimeConfig(): Promise<ClientConfig["realtime"] | null> {
      const task = runtime.realtime ??= deps.api
        .fetchConfig()
        .then((config) => config?.realtime ?? null)
        .catch((error: unknown) => {
          if (runtime.realtime === task) runtime.realtime = null;
          throw error;
        });
      return task;
    }

    /**
     * The `createEventSource` for this session, or `undefined` for SSE.
     *
     * A viewer token and a session token are the same thing to the transport —
     * the authorizer accepts either and checks that it names this room — so the
     * TV and a phone open the channel through identical code.
     */
    async function transportFor(
      session: ClientSession,
    ): Promise<((url: string) => EventSourceLike) | undefined> {
      const realtime = await realtimeConfig();
      if (!realtime) return undefined;
      return appSyncEventSource({
        httpDomain: realtime.httpDomain,
        realtimeDomain: realtime.realtimeDomain,
        namespace: realtime.namespace,
        roomCode: session.roomCode,
        token: session.sessionToken,
      });
    }

    /** The one and only writer of `state`. */
    function makeSequencer(): MessageSequencer {
      const sequencer = new MessageSequencer({
        gate: runtime.gate,
        handlers: {
          onState: (state) => {
            set({ state });
            // The household's Field Guide rides the mirror (`RunState.fieldGuide`);
            // its own store is a projection of it (the journal borrows it only
            // out of a room — see field-guide-discoveries.ts).
            setFieldGuideDiscoveries(state.fieldGuide);
          },
          onPresentation: (presentation) => set({ presentation }),
          onProgression: (progression) => set({ progression }),
          // Live-only "new page!" ids (#106) — queued for #110 to celebrate.
          onDiscovered: ({ runId, seq, canonIds }) => announceFieldGuideNews(runId, seq, canonIds),
          onPreview: ({ runId, playerId, preview, context }) => {
            if (runtime.sequencer !== sequencer || get().state?.runId !== runId) return;
            const { [playerId]: _old, ...rest } = get().previews;
            set({
              previews:
                preview === null || context === null ? rest : { ...rest, [playerId]: { preview, context } },
            });
          },
          onArrival: ({ runId, playerId, name, color }) => {
            if (runtime.sequencer !== sequencer || get().state?.runId !== runId) return;
            // A phone that joins twice (a reload on the join screen) is one arrival.
            const others = get().arrivals.filter((a) => a.playerId !== playerId);
            const arrivals = [...others, { playerId, name, color }];
            // The host's are its way to remove somebody, so they hold far more
            // than news does. Still bounded: anyone with the code can join as a
            // new player over and over, and an unbounded list would bury the
            // very controls the host needs. What falls off is counted, so the
            // screen can say a flood is happening rather than hide it.
            const cap = get().session?.host ? MAX_HOST_ARRIVALS : MAX_ARRIVALS;
            const dropped = Math.max(0, arrivals.length - cap);
            set({
              arrivals: arrivals.slice(-cap),
              ...(dropped > 0 && get().session?.host ? { arrivalsDropped: get().arrivalsDropped + dropped } : {}),
            });
          },
          onGap: (sinceSeq) => {
            // Repeated hole notifications must respect a failed fetch's backoff.
            if (runtime.resyncRetry === null) void resync(sinceSeq).catch(() => undefined);
          },
        },
      });
      return sequencer;
    }

    async function resync(sinceSeq: number): Promise<void> {
      const session = get().session;
      const sequencer = runtime.sequencer;
      if (!session || !sequencer) return;
      if (runtime.resyncing) {
        runtime.resyncAgain = true;
        return runtime.resyncing;
      }
      if (runtime.resyncRetry !== null) clearTimeout(runtime.resyncRetry);
      runtime.resyncRetry = null;

      const task = (async () => {
        do {
          runtime.resyncAgain = false;
          const response = await deps.api.fetchState(
            { runId: session.runId, code: session.roomCode, sinceSeq },
            session.sessionToken || undefined,
          );
          if (runtime.sequencer !== sequencer) return;
          if (response.state) sequencer.reset(response.state, response.seq);
          else if (response.events) sequencer.ingestAll(response.events);
          runtime.resyncAttempt = 0;
          sinceSeq = sequencer.seq;
        } while (runtime.resyncAgain);
      })().catch((error: unknown) => {
        if (runtime.sequencer === sequencer) {
          runtime.resyncRetry = setTimeout(() => {
            runtime.resyncRetry = null;
            void resync(sequencer.seq).catch(() => undefined);
          }, backoffDelay(runtime.resyncAttempt++));
        }
        throw error;
      }).finally(() => {
        if (runtime.resyncing === task) runtime.resyncing = null;
      });

      runtime.resyncing = task;
      return task;
    }

    async function connect(
      session: ClientSession,
      snapshot: RunState,
      seq: number,
    ): Promise<void> {
      disconnect();
      const sequencer = makeSequencer();
      runtime.sequencer = sequencer;
      // The mirror is seeded *before* the transport is resolved, so the surface
      // has state to render during the one config fetch of a page load rather
      // than a blank screen.
      sequencer.reset(snapshot, seq);

      let attempt = 0;
      const openTransport = async (): Promise<void> => {
        try {
          const createEventSource = await transportFor(session);
          if (runtime.sequencer !== sequencer) return;
          runtime.channel = deps.openChannel({
            url: (sinceSeq) =>
              deps.eventsUrl(session.roomCode, sinceSeq, session.sessionToken || undefined),
            sequencer,
            onStatus: (connection) => set({ connection }),
            resync,
            ...(createEventSource ? { createEventSource } : {}),
          });
        } catch {
          if (runtime.sequencer !== sequencer) return;
          set({ connection: "reconnecting" });
          runtime.connectRetry = setTimeout(() => {
            runtime.connectRetry = null;
            void openTransport();
          }, backoffDelay(attempt++));
        }
      };
      await openTransport();
    }

    function disconnect(): void {
      // Previews and arrivals are live-only: a fresh channel starts from nobody
      // picking and nobody new.
      set({ previews: {}, arrivals: [], arrivalsDropped: 0 });
      runtime.previewSent = "[null,null]";
      runtime.previewNext = null;
      runtime.channel?.close();
      runtime.channel = null;
      runtime.sequencer?.dispose();
      runtime.sequencer = null;
      runtime.resyncing = null;
      runtime.resyncAgain = false;
      runtime.resyncAttempt = 0;
      if (runtime.resyncRetry !== null) clearTimeout(runtime.resyncRetry);
      runtime.resyncRetry = null;
      if (runtime.connectRetry !== null) clearTimeout(runtime.connectRetry);
      runtime.connectRetry = null;
      if (runtime.broadcastWatchdog) {
        clearTimeout(runtime.broadcastWatchdog);
        runtime.broadcastWatchdog = null;
      }
    }

    /**
     * Hold the server to the broadcast its action response promised (see the
     * field's comment on Runtime). One timer, latest target wins — every ok
     * response re-arms it, and it disarms itself when the sequencer has caught
     * up, which is the overwhelmingly normal case.
     */
    function expectBroadcast(seq: number): void {
      const sequencer = runtime.sequencer;
      if (!sequencer || sequencer.seq >= seq) return;
      if (runtime.broadcastWatchdog) clearTimeout(runtime.broadcastWatchdog);
      runtime.broadcastWatchdog = setTimeout(() => {
        runtime.broadcastWatchdog = null;
        const current = runtime.sequencer;
        if (!current || current.seq >= seq) return;
        const recovery = runtime.resyncRetry === null ? resync(current.seq) : Promise.resolve();
        void recovery
          .catch(() => undefined)
          .finally(() => {
            if (runtime.sequencer === sequencer && runtime.broadcastWatchdog === null) {
              expectBroadcast(seq);
            }
          });
      }, BROADCAST_GRACE_MS);
    }

    /**
     * Where this device keeps room sessions. A shared tablet's live in the tab
     * (#250); everybody else's survive a closed browser, as §4.3 wants.
     */
    function sessions(): KeyValueStorage {
      return loadSharedDevice(deps.storage) ? (deps.tabStorage ?? tabStorage()) : deps.storage;
    }

    /**
     * A shared tablet the server no longer knows (forgotten by its owner):
     * stop being one, so the home screen is an ordinary start again.
     */
    function forgottenIf(error: unknown): void {
      if (error instanceof ApiError && error.status === 401) {
        clearSharedDevice(deps.storage, deps.tabStorage ?? tabStorage());
      }
    }

    async function establish(session: ClientSession, snapshot: RunState): Promise<void> {
      saveSession(session, sessions());
      set({ session, error: null, pendingCode: null });
      await connect(session, snapshot, snapshot.seq);
    }

    /**
     * One attempt at resuming a stored session.
     *
     * No `sinceSeq`: attaching is always a cold start — the mirror did not
     * survive the refresh, so we want the snapshot. Sending 0 would mean
     * "caught up through seq 0", and a room still sitting at seq 0 would
     * correctly answer with an empty event list and no state (§4.3).
     */
    async function resumeStored(
      stored: ClientSession,
      roomCode: string,
      current: () => boolean,
      timeoutMs: number,
    ): Promise<void> {
      const response = await deps.api.fetchState(
        { runId: stored.runId, code: roomCode },
        stored.sessionToken || undefined,
        timeoutMs,
      );
      if (!current()) return;
      if (!response.state) throw new ApiError(410, "That room has expired.");
      await establish(stored, response.state);
    }

    /**
     * Whether a failed resume is worth trying again.
     *
     * The distinction is the whole safety of retrying at all. A room that is
     * genuinely gone, or a token this device may no longer use, will answer the
     * same way forever — retrying those would spin a spinner until somebody
     * gives up, which is a worse failure than the honest one.
     *
     * Everything else is treated as weather: a dropped connection, a cold
     * Lambda, a 5xx, a phone that woke up before its wifi did. Those are the
     * cases where the room is still there and the surface simply has to ask
     * again. Unknown errors retry too — a network stack has more ways to fail
     * transiently than any list can name, and the cost of retrying a permanent
     * error is a few seconds of spinner, while the cost of *not* retrying a
     * transient one is a phone offering to start a second game.
     */
    function worthRetrying(error: unknown): boolean {
      if (!(error instanceof ApiError)) return true;
      // 404/410: no such room, or it has expired. 401/403: this token cannot
      // have it. 429: too many wrong codes from here, and every retry would
      // ask again. None of those change by asking twice.
      return ![401, 403, 404, 410, 429].includes(error.status);
    }

    /**
     * The whole recovery's budget, wall-clock — the contract a review had to
     * correct. The first version bounded recovery by *attempt count* alone and
     * described itself as "about seven seconds"; against the exact failure it
     * exists for — a dropped-but-open connection, where every attempt runs to
     * the request funnel's full 10s — five attempts plus backoff is nearly a
     * minute of spinner. Attempt counts bound work; only a deadline bounds
     * waiting.
     *
     * Twenty seconds: room for a cold start plus one honest retry on a woken
     * wifi, and short enough that a genuinely dead connection fails while the
     * table's patience is still intact. Each attempt's request is bounded by
     * whatever budget remains, so the last attempt cannot overshoot the
     * deadline by its own full timeout.
     */
    const RESUME_DEADLINE_MS = 20_000;
    /** Attempts stay bounded too — a fast-failing server should not be hammered. */
    const RESUME_ATTEMPTS = 5;
    /** Under this there is no time for a real round trip; stop honestly. */
    const RESUME_FLOOR_MS = 500;

    async function withRetry(
      current: () => boolean,
      attempt: (timeoutMs: number) => Promise<void>,
    ): Promise<void> {
      const deadline = Date.now() + RESUME_DEADLINE_MS;
      let lastError: unknown = new ApiError(0, "The game took too long to answer. Tap again.");
      for (let tries = 0; tries < RESUME_ATTEMPTS; tries += 1) {
        const remaining = deadline - Date.now();
        if (remaining < RESUME_FLOOR_MS) break;
        try {
          await attempt(Math.min(remaining, REQUEST_TIMEOUT_MS));
          return;
        } catch (error) {
          // A superseded attach stops quietly: the URL moved on, and this
          // room's failure is no longer anybody's problem.
          if (!current()) return;
          if (!worthRetrying(error)) throw error;
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, backoffDelay(tries, { baseMs: 500, maxMs: 4_000 })));
          if (!current()) return;
        }
      }
      throw lastError;
    }

    /**
     * Take a seat from whatever seated us — create or join, they answer with
     * the same shape — and keep the device binding that came with it.
     */
    async function adopt(
      roomCode: string,
      seated: JoinRoomResponse & { deviceToken?: string },
      displayName: string,
    ): Promise<ClientSession> {
      // A shared tablet is nobody, whoever is sitting at it (#250): it keeps
      // no identity, and the server sends it no device token to keep.
      if (!loadSharedDevice(deps.storage)) {
        const identity = loadIdentity(deps.storage);
        // Seated, so a player now — even a browser that had only been a TV.
        saveIdentity(
          { ...asPlayerIdentity(identity, seated.deviceToken), displayName, playerId: seated.playerId },
          deps.storage,
        );
      }

      const session: ClientSession = {
        runId: seated.runId,
        roomCode,
        playerId: seated.playerId,
        mode: seated.mode,
        sessionToken: seated.sessionToken,
        ...(seated.host ? { host: true } : {}),
        ...(seated.keeper ? { keeper: true } : {}),
      };
      await establish(session, seated.state);
      deps.navigate({ name: "player", code: roomCode }, { replace: true });
      return session;
    }

    /**
     * How this screen proves it opened the room (#263, #267). A shared tablet
     * holds no device binding and must not mint one: its own token and the
     * seated kid's session name the host (#250). Anywhere else it is the
     * device binding, which a TV holds too. `null` when there is neither.
     */
    function hostAuth(session: ClientSession): HostAuth | null {
      const shared = loadSharedDevice(deps.storage);
      if (shared) return { sharedToken: shared.token, sessionToken: session.sessionToken };
      const deviceToken = loadIdentity(deps.storage).deviceToken;
      return deviceToken ? { deviceToken } : null;
    }

    /**
     * One host control, start to finish. Resolves `true` once the server has
     * done it; a refusal lands in `error` and resolves `false`. What changed
     * reaches this screen the way it reaches every other: as the run's patch.
     */
    async function hostControl(
      control: HostControl,
      body: Record<string, unknown>,
      failure: string,
    ): Promise<boolean> {
      const session = get().session;
      if (!session?.host) return false;
      const auth = hostAuth(session);
      if (!auth) return false;
      try {
        await deps.api.hostControl(session.roomCode, control, body, auth);
        return true;
      } catch (error) {
        set({ error: error instanceof Error ? error.message : failure });
        return false;
      }
    }

    function failWith(error: unknown): never {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Something went wrong.";
      set({ error: message, connection: "error" });
      throw error;
    }

    return {
      connection: "idle",
      session: null,
      state: null,
      presentation: null,
      progression: null,
      previews: {},
      arrivals: [],
      arrivalsDropped: 0,
      error: null,
      rules: null,
      items: null,
      campaign: null,
      abilities: null,
      chapter: null,
      world: null,
      pendingCode: null,

      async loadContent() {
        if (get().rules && get().items && get().campaign && get().abilities) return;
        if (runtime.content) return runtime.content;

        const task = (async () => {
          // The campaign is loaded alongside the rules because the lobby needs
          // to name the chapter it asks the server to start, and content must
          // never require a deploy of game code. LAUNCH_CAMPAIGN is the only
          // hardcoded id in the client; picking between campaigns is roadmap
          // Chapter 5's problem. The ability catalog rides the same batch: it
          // is what `legalActions` needs to draw the combat action cards
          // (store/combat.ts), served exactly like rules and items.
          const [rules, items, campaign, rawAbilities] = await Promise.all([
            deps.api.loadRules(),
            deps.api.loadItems(),
            deps.api.loadCampaign(LAUNCH_CAMPAIGN),
            deps.api.loadAbilities(),
          ]);
          set({ rules, items, campaign, abilities: parseAbilityCatalog(rawAbilities) });
        })()
          .catch((error: unknown) => {
            set({
              error: error instanceof Error ? error.message : "Could not load game content.",
            });
          })
          .finally(() => {
            runtime.content = null;
          });

        runtime.content = task;
        return task;
      },

      /**
       * The chapter in play, for the renderer's sake: the biome that picks the
       * combat tile sheet and the enemy art on encounter scenes. Loaded over
       * HTTP like every other piece of content, cached by id — a run stays in
       * one chapter for a whole sitting, so this fires once per chapter and a
       * re-render costs nothing. A failed fetch stays quiet: the board falls
       * back to flat tiles and placeholder silhouettes, which is a shabbier
       * fight, not a broken one.
       */
      async loadChapter(chapterId: string) {
        if (!chapterId) return;
        if (get().chapter?.id === chapterId) return;
        if (runtime.chapter?.id === chapterId) return runtime.chapter.task;

        const task = deps.api
          .loadChapter(chapterId)
          .then((chapter) => {
            if (runtime.chapter?.task === task) set({ chapter });
          })
          .catch(() => {
            /* dressing only — see above */
          })
          .finally(() => {
            if (runtime.chapter?.task === task) runtime.chapter = null;
          });

        runtime.chapter = { id: chapterId, task };
        return task;
      },

      /**
       * The world map's key, for the phone's map and nothing else. Fetched
       * once, on the first look at the map, and kept: the realm does not
       * change between chapters. A failed fetch stays quiet, like the
       * chapter's — the map says it is still unrolling and the game goes on.
       */
      async loadWorld() {
        if (get().world) return;
        if (runtime.world) return runtime.world;
        const task = deps.api
          .loadWorld()
          .then((world) => {
            set({ world });
          })
          .catch(() => {
            /* dressing only — see above */
          })
          .finally(() => {
            runtime.world = null;
          });
        runtime.world = task;
        return task;
      },

      /**
       * Creating a room seats the host in it, so the response *is* a join.
       * Joining again on top of it would seat a second player, leave an orphan
       * profile behind in every room, and throw away the device binding the
       * server issued — after which this browser rejoins as a stranger instead
       * of recovering its own character (architecture §4.5).
       */
      async createRoom(mode: RoomMode, displayName: string, seat?: SharedSeatRequest) {
        set({ connection: "connecting", error: null });
        const shared = loadSharedDevice(deps.storage);
        if (shared) {
          try {
            if (!seat) throw new ApiError(400, "Pick who is playing first.");
            const room = await deps.api.createRoomShared(
              { mode, campaignId: LAUNCH_CAMPAIGN },
              shared.token,
              seat,
            );
            return await adopt(room.code, room, displayName);
          } catch (error) {
            forgottenIf(error);
            return failWith(error);
          }
        }
        const identity = loadIdentity(deps.storage);
        saveIdentity({ ...identity, displayName }, deps.storage);
        try {
          const room = await deps.api.createRoom({
            householdId: identity.householdId,
            mode,
            // So the server can tell the lobby which chapter is next.
            campaignId: LAUNCH_CAMPAIGN,
            displayName,
            ...(identity.deviceToken ? { deviceToken: identity.deviceToken } : {}),
          });
          const roomCode = room.code;
          return await adopt(roomCode, room, displayName);
        } catch (error) {
          return failWith(error);
        }
      },

      /**
       * The TV opening the room. Nothing is seated, so there is no session to
       * adopt: keep the device binding (the room's placeholder household
       * until the first phone joins and claims it), then go to `/tv/:code` and let `attach`
       * watch the room exactly as it would after a refresh.
       */
      async openOnThisScreen() {
        set({ connection: "connecting", error: null });
        const identity = loadIdentity(deps.storage);
        try {
          const room = await deps.api.openDisplayRoom({
            householdId: identity.householdId,
            campaignId: LAUNCH_CAMPAIGN,
            ...(identity.deviceToken ? { deviceToken: identity.deviceToken } : {}),
          });
          // A binding minted here is the room's placeholder household, held by
          // a screen that is nobody — not a player with a book to open. But a
          // browser that has already been a player stays one: a phone hosting
          // Party Mode on itself must not lose its book for doing so.
          if (room.deviceToken) {
            const wasPlayer = identity.deviceToken !== undefined && identity.screenOnly !== true;
            saveIdentity(
              { ...identity, deviceToken: room.deviceToken, ...(wasPlayer ? {} : { screenOnly: true }) },
              deps.storage,
            );
          }
          deps.navigate({ name: "tv", code: room.code }, { replace: true });
        } catch (error) {
          failWith(error);
        }
      },

      async listHeroes() {
        const session = get().session;
        if (!session?.playerId) return [];
        const { heroes } = await deps.api.listHeroes(session.sessionToken);
        return heroes;
      },

      async loadJournal() {
        const deviceToken = loadPlayerDeviceToken(deps.storage);
        if (!deviceToken) return null;
        try {
          const journal = await deps.api.loadJournal(deviceToken);
          saveJournal({ deviceToken, savedAt: new Date().toISOString(), journal }, deps.storage);
          return { journal, savedAt: null };
        } catch (error) {
          /*
           * The server answering "no" is news: the binding is gone (a guest
           * household swept after its week away), and a saved copy would show
           * heroes that no longer exist. Anything else — no signal, a timeout,
           * a 5xx — is the car, and last time's book is the right answer.
           */
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            clearSavedJournal(deps.storage);
            throw error;
          }
          const saved = loadSavedJournal(deviceToken, deps.storage);
          if (!saved) throw error;
          return { journal: saved.journal, savedAt: saved.savedAt };
        }
      },

      async loadSharedPlayers() {
        const shared = loadSharedDevice(deps.storage);
        if (!shared) return null;
        try {
          const { players, rotatedToken } = await deps.api.listSharedPlayers(shared.token);
          // The tablet's 30 days slide like a phone's, and this is where it hears.
          if (rotatedToken) saveSharedDevice({ ...shared, token: rotatedToken }, deps.storage);
          return players;
        } catch (error) {
          forgottenIf(error);
          if (error instanceof ApiError && error.status === 401) return null;
          throw error;
        }
      },

      async joinRoom(code: string, name: string, seat?: SharedSeatRequest) {
        const roomCode = code.trim().toUpperCase();
        set({ connection: "connecting", error: null });
        const shared = loadSharedDevice(deps.storage);
        if (shared) {
          try {
            if (!seat) throw new ApiError(400, "Pick who is playing first.");
            const joined = await deps.api.joinRoomShared(roomCode, shared.token, seat);
            return await adopt(roomCode, joined, name.trim());
          } catch (error) {
            forgottenIf(error);
            return failWith(error);
          }
        }
        const identity = loadIdentity(deps.storage);
        // The home screen no longer asks for a name when joining; the character
        // flow does. Keep whatever this phone used last, else a placeholder.
        const displayName = name.trim() || identity.displayName || "Player";
        saveIdentity({ ...identity, displayName }, deps.storage);

        try {
          const joined = await deps.api.joinRoom(roomCode, {
            playerId: identity.playerId,
            displayName,
            // Presenting the binding is what makes this the same player as last
            // time rather than a new one.
            ...(identity.deviceToken ? { deviceToken: identity.deviceToken } : {}),
          });
          return await adopt(roomCode, joined, displayName);
        } catch (error) {
          return failWith(error);
        }
      },

      /**
       * Recover a surface from its URL. Two paths:
       *
       *  - a stored session for this code → resume as that player;
       *  - otherwise, and only for `/tv/:code`, attach with no identity at all.
       *    The TV holds no token because it can do nothing (spec §2.1); it
       *    reads state and renders.
       */
      async attach(code: string, role: SurfaceRole) {
        const roomCode = code.trim().toUpperCase();
        const existing = get().session;
        if (existing && existing.roomCode === roomCode) return;
        if (runtime.attaching) {
          // Same room: join the in-flight attach (React 19's double-invoked
          // effect). Different room — the URL changed under us — supersede it:
          // drop whatever the old attach has wired up so far and let its
          // remaining steps see they are stale and bail.
          if (runtime.attaching.code === roomCode) return runtime.attaching.task;
          disconnect();
        }

        const stored = loadSession(roomCode, sessions());
        set({ connection: "connecting", pendingCode: roomCode });

        /** Still the newest attach? Checked after every await — a resolved
            fetch for a superseded room must not clobber the current one. */
        const current = (): boolean => runtime.attaching?.task === task;

        const task: Promise<void> = (async () => {
          if (stored) {
            /*
             * Retried, and this is the half of architecture §4.3 that was
             * missing.
             *
             * §4.3 promises a surface can be hard-refreshed mid-encounter and
             * recover. That held only when the *first* `fetchState` succeeded:
             * one failure set `connection: "error"` and stopped forever, and
             * because `session` is still null on a cold load, `App.pickLayout`
             * then rendered the **home screen** — on the `/p/CODE` URL, with
             * the run still live on the server and the token still in storage.
             *
             * The stranding is not the worst part. The home screen's first
             * button is "Start a game", so the obvious thing to do at a table
             * creates a *second* room and abandons the evening in progress.
             * A phone that cannot reach the server for a moment must wait, not
             * offer to throw the game away.
             *
             * So: a stored session is a claim on a room, and it is worth more
             * than one attempt. `connection` stays `"connecting"` throughout,
             * which is what keeps the spinner up instead of the home screen.
             */
            await withRetry(current, (timeoutMs) => resumeStored(stored, roomCode, current, timeoutMs));
            return;
          }

          if (role !== "display") {
            // A phone with no stored session has to join, and joining needs a
            // name. App falls back to HomeScreen with `pendingCode` prefilled.
            set({ connection: "idle" });
            return;
          }

          /*
           * `watch` rather than `state`, because in prod the channel is
           * authorised per subscriber and a screen with no token is a screen
           * that never receives a patch. The token it hands back names this
           * room and nothing else — it cannot act, and `playerId: ""` below is
           * still what actually denies authority (spec §2.1).
           *
           * Retried for the same reason the stored-session path above is —
           * caught by review, because the first fix covered only the phones.
           * The TV *is* §4.3's headline case ("The TV can be hard-refreshed
           * mid-encounter and recover"), it recovers from the URL alone, and
           * one cold Lambda on that one attempt used to leave the room's
           * biggest screen on an error card for the rest of the evening.
           */
          await withRetry(current, async (timeoutMs) => {
            // A TV that opened this room still holds the binding it was given,
            // and presenting it is how it learns it is still the host (#267).
            const screenToken = loadIdentity(deps.storage).deviceToken;
            const response = screenToken
              ? await deps.api.watchRoom(roomCode, timeoutMs, screenToken)
              : await deps.api.watchRoom(roomCode, timeoutMs);
            if (!current()) return;
            const display: ClientSession = {
              runId: response.runId,
              roomCode,
              playerId: "", // no player on this device — it is a screen, not a seat
              mode: response.mode,
              sessionToken: response.viewerToken,
              ...(response.host ? { host: true } : {}),
            };
            // Deliberately not persisted: a display client has nothing worth
            // storing, and it recovers from the URL alone.
            set({ session: display, error: null, pendingCode: null });
            await connect(display, response.state, response.state.seq);
          });
        })()
          .catch((error: unknown) => {
            // A superseded attach's failure is not this surface's failure.
            if (!current()) return;
            const message = error instanceof Error ? error.message : "Could not reach the game.";
            set({ error: message, connection: "error" });
          })
          .finally(() => {
            if (runtime.attaching?.task === task) runtime.attaching = null;
          });

        runtime.attaching = { code: roomCode, task };
        return task;
      },

      async send(intent: ClientIntent): Promise<boolean> {
        const session = get().session;
        if (!session) return false;
        if (!session.playerId) return false; // display clients send nothing, ever

        const post = (seq?: number): Promise<ActionResponse> =>
          deps.api.postAction(
            {
              runId: session.runId,
              playerId: session.playerId,
              // Last-seen server seq. The server rejects a stale intent rather
              // than applying it out of order (architecture §4.2).
              seq: seq ?? get().state?.seq ?? runtime.sequencer?.seq ?? 0,
              intent,
            },
            session.sessionToken,
          );

        try {
          let response = await post();

          if (response.error?.code === "STALE_SEQ") {
            /*
             * Behind, not wrong — and with three people tapping at once, being
             * a beat behind is the normal case, not an error case. A rejected
             * intent never applied, so catching up and sending it once more
             * cannot double-apply it, and the engine still refuses anything
             * that is no longer legal.
             *
             * The alternative is a tap that silently does nothing, which at a
             * table with an 8-year-old is the worst outcome available.
             */
            await resync(runtime.sequencer?.seq ?? 0);
            /*
             * Retry at the seq the *server* reported, not the mirror's. The
             * mirror may still be behind on purpose: a patch carrying a dice
             * roll sits behind the WorldView animation for its ~1.5s, so in
             * Travel Mode — where the same phone renders both surfaces — the
             * catch-up has landed but `state.seq` has not moved yet. Re-posting
             * the mirror's seq would be rejected as stale a second time and the
             * tap would vanish after all.
             */
            response = await post(response.seq);
          }

          if (response.ok) {
            /*
             * The response names the seq the server committed; the patch is
             * supposed to follow on the channel. If the server's publish
             * failed after the commit, that patch never comes — and the tap
             * would look like it did nothing while the state quietly
             * advanced. The watchdog turns "the broadcast never arrived"
             * into a resync instead of a mystery.
             */
            expectBroadcast(response.seq);
            return true;
          }
          set({ error: response.error?.message ?? "That isn't allowed right now." });
          return false;
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "Could not reach the game.",
          });
          return false;
        }
      },

      preview(preview: IntentPreview | null, context: string | null) {
        const session = get().session;
        if (!session?.playerId || !session.sessionToken) return;
        // A pick with no decision to belong to is not worth sending.
        if (preview !== null && context === null) preview = null;
        const key = JSON.stringify([preview, preview === null ? null : context]);
        runtime.previewNext = { key, preview, context: preview === null ? null : context };
        if (runtime.previewInFlight) return;

        const pump = async (): Promise<void> => {
          runtime.previewInFlight = true;
          try {
            for (;;) {
              const next = runtime.previewNext;
              runtime.previewNext = null;
              if (next === null) return;
              if (next.key === runtime.previewSent) continue;
              const current = get().session;
              if (current?.sessionToken !== session.sessionToken) return;
              try {
                await deps.api.postPreview(next.preview, next.context, session.sessionToken);
                runtime.previewSent = next.key;
              } catch {
                // A highlight, not a turn: drop it and let the next tap speak.
              }
            }
          } finally {
            runtime.previewInFlight = false;
          }
        };
        void pump();
      },

      leave() {
        const session = get().session;
        runtime.attaching = null;
        disconnect();
        if (session) clearSession(session.roomCode, sessions());
        // The book and its news belong to the room's household; out of the
        // room there is neither.
        setFieldGuideDiscoveries(null);
        clearFieldGuideNews();
        set({
          connection: "idle",
          session: null,
          state: null,
          presentation: null,
          progression: null,
          error: null,
          pendingCode: null,
        });
        deps.navigate({ name: "home" });
      },

      dismissError() {
        set({ error: null });
      },

      dismissArrival(playerId: string) {
        set({ arrivals: get().arrivals.filter((a) => a.playerId !== playerId) });
      },

      async removePlayer(playerId: string) {
        const done = await hostControl("remove", { playerId }, "Could not take them out.");
        if (done) set({ arrivals: get().arrivals.filter((a) => a.playerId !== playerId) });
        return done;
      },

      lockRoom(locked: boolean) {
        return hostControl("lock", { locked }, locked ? "Could not lock the room." : "Could not unlock the room.");
      },

      quietRoom(quiet: boolean) {
        return hostControl("quiet", { quiet }, "Could not change quiet mode.");
      },

      closeRoom() {
        return hostControl("close", {}, "Could not close the room.");
      },

      registerPresentationPlayer(gate: PresentationGate | null) {
        runtime.gate = gate;
        runtime.sequencer?.setGate(gate);
        return () => {
          if (runtime.gate !== gate) return;
          runtime.gate = null;
          runtime.sequencer?.setGate(null);
        };
      },
    };
  };
}

export const useGameStore = create<InternalGameStore>()(gameStoreCreator(defaultDeps()));

// ---------------------------------------------------------------------------
// Selector hooks — the screens' entire view of the store (contract.ts)
//
// Every one of these returns a value that already lives in state, so the
// reference is stable between renders and zustand's snapshot comparison stays
// honest. Do not add a hook that builds a new object or array.
// ---------------------------------------------------------------------------

export function useRunState(): RunState | null {
  return useGameStore((store) => store.state);
}

export function useSession(): ClientSession | null {
  return useGameStore((store) => store.session);
}

export function useConnection(): ConnectionStatus {
  return useGameStore((store) => store.connection);
}

export function useMe(): PartyMember | null {
  return useGameStore((store) => selectMe(store.state, store.session?.playerId ?? ""));
}

const NO_PARTY: readonly PartyMember[] = [];

export function useParty(): PartyMember[] {
  return useGameStore((store) => store.state?.party ?? (NO_PARTY as PartyMember[]));
}

/** The open prompt, already filtered to "is this for me?". */
export function usePrompt(): Prompt | null {
  return useGameStore((store) => {
    const prompt = store.state?.prompt ?? null;
    return isPromptForPlayer(prompt, store.session?.playerId ?? "", store.state?.party ?? NO_PARTY)
      ? prompt
      : null;
  });
}

export function useIsMyPrompt(): boolean {
  return useGameStore((store) =>
    isPromptForPlayer(
      store.state?.prompt ?? null,
      store.session?.playerId ?? "",
      store.state?.party ?? NO_PARTY,
    ),
  );
}

export function useSend(): (intent: ClientIntent) => Promise<boolean> {
  return useGameStore((store) => store.send);
}

/** Every player's unconfirmed tap, by playerId (`GameStore.previews`). */
export function usePreviews(): Readonly<Record<string, HeldPreview>> {
  return useGameStore((store) => store.previews);
}

/**
 * Keep the table told what this phone has picked but not confirmed. Sends on
 * change and sends `null` when the picking surface goes away — a confirmed
 * choice, a turn that ended, a screen that closed — so the TV never holds a
 * highlight for something nobody is still deciding.
 */
export function useSharePreview(preview: IntentPreview | null): void {
  const send = useGameStore((store) => store.preview);
  // Stamped with the decision it is made in, from this phone's own mirror —
  // which is also what the selection it describes was made against.
  const context = useGameStore((store) => previewContext(store.state));
  const key = JSON.stringify([preview, context]);
  useEffect(() => {
    const [next, made] = JSON.parse(key) as [IntentPreview | null, string | null];
    send(next, made);
  }, [send, key]);
  useEffect(() => () => send(null, null), [send]);
}

export function useRules(): RulesContent | null {
  return useGameStore((store) => store.rules);
}

export function useItems(): ItemCatalog | null {
  return useGameStore((store) => store.items);
}

export function useCampaign(): Campaign | null {
  return useGameStore((store) => store.campaign);
}

export function useAbilities(): AbilityCatalog | null {
  return useGameStore((store) => store.abilities);
}

export function useChapter(): Chapter | null {
  return useGameStore((store) => store.chapter);
}

export function useWorld(): WorldMap | null {
  return useGameStore((store) => store.world);
}

/**
 * "Is the combat clock on me?" The layout shells use it the way they use
 * `useIsMyPrompt`: a combat turn is a question without a Prompt object, and
 * §2.2's "your turn comes to you" applies to it just the same.
 */
/**
 * Identity of the decision currently requiring this player's attention.
 *
 * A boolean `isMyTurn` misses back-to-back prompts assigned to the same
 * player: the boolean stays true even though the question changed. Use a
 * stable key so a new question brings the controls forward without yanking
 * the map away when only a vote count or other state update changes.
 */
export function useMyTurnKey(): string | null {
  return useGameStore((store) => {
    const state = store.state;
    if (!state) return null;
    const playerId = store.session?.playerId ?? "";
    if (!selectMe(state, playerId)) return "creation";

    const prompt = state.prompt;
    if (isPromptForPlayer(prompt, playerId, state.party) && prompt) {
      // Progress on the current question is not a new question. Votes, a
      // friend's offered help and the rest of the party rolling a group check
      // all rewrite the prompt in place; only what identifies the check counts.
      // A group check names its next roller in `characterId`, which moves as
      // others roll, so it is left out there and kept for a single roller.
      const stablePrompt =
        prompt.kind === "choice"
          ? { ...prompt, votes: undefined }
          : prompt.kind === "roll"
            ? {
                ...prompt,
                helper: undefined,
                group: prompt.group ? true : undefined,
                characterId: prompt.group ? undefined : prompt.characterId,
              }
            : prompt;
      // Revisiting the same authored scene is a *new* question, even when
      // it uses the same choice ids and narration.
      return `prompt:${state.chapterId ?? ""}:${state.visited?.length ?? 0}:${JSON.stringify(stablePrompt)}`;
    }

    if (isMyCombatTurn(state, playerId) && state.encounter) {
      const { round, turnIndex, encoreActor } = state.encounter;
      return `combat:${state.chapterId ?? ""}:${state.sceneId ?? ""}:${round}:${turnIndex}:${encoreActor ?? ""}`;
    }
    return null;
  });
}

export function useIsMyCombatTurn(): boolean {
  return useGameStore((store) => isMyCombatTurn(store.state, store.session?.playerId ?? ""));
}

export function useError(): string | null {
  return useGameStore((store) => store.error);
}

/**
 * The room's mode. **Layout shells only.**
 *
 * `WorldView` and `PlayerView` must never call this — that rule is the whole
 * reason the two modes are one app (architecture §4.6 rule 1, roadmap
 * "Mode-agnostic surfaces"). Prefers the authoritative run state so a
 * mid-session mode switch (`SET_MODE`) re-lays-out every device at once.
 */
export function useLayoutMode(): RoomMode {
  return useGameStore((store) => store.state?.mode ?? store.session?.mode ?? "party");
}

/** What `watchPresentation` needs from the store — narrowed so tests can hand
    it a plain vanilla store instead of the app singleton. */
interface PresentationSource {
  getState(): { presentation: PresentationEvent | null };
  subscribe(listener: (state: { presentation: PresentationEvent | null }) => void): () => void;
}

/**
 * The delivery core of `usePresentation`, extracted so the mount-time replay
 * below can be tested without a DOM.
 *
 * Delivers the event already sitting in the store *before* subscribing: the
 * event that causes a surface to mount — the ROLL that summons the dice
 * overlay, the LEVEL_UP whose patch flipped the phase to chapter_complete —
 * has been written by the time that surface's effect runs, and seeding the
 * watermark from the store (as this used to) skipped exactly that event.
 * The watermark lives with the component instance, not the subscription, so
 * nothing is delivered twice however many times React 19 strict mode
 * resubscribes — and a fresh page load replays nothing, because a fresh store
 * holds no presentation.
 */
export function watchPresentation<K extends Presentation["kind"]>(
  source: PresentationSource,
  kind: K,
  watermark: { current: number },
  handler: (presentation: Extract<Presentation, { kind: K }>, event: PresentationEvent) => void,
): () => void {
  const deliver = (event: PresentationEvent | null): void => {
    if (!event || event.seq <= watermark.current) return;
    watermark.current = event.seq;
    if (event.presentation.kind !== kind) return;
    handler(event.presentation as Extract<Presentation, { kind: K }>, event);
  };
  deliver(source.getState().presentation);
  return source.subscribe((state) => deliver(state.presentation));
}

/**
 * Subscribe to one kind of presentation event.
 *
 * Fires once per event this component instance has not yet handled — including
 * the event that arrived just before mount (see `watchPresentation`). A hard
 * refresh must not replay a dice roll that already happened, and it cannot:
 * the refreshed store holds no presentation. Dedupes on `seq`, since React 19
 * strict mode subscribes twice.
 */
export function usePresentation<K extends Presentation["kind"]>(
  kind: K,
  handler: (presentation: Extract<Presentation, { kind: K }>, event: PresentationEvent) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  // Per component instance, deliberately not per effect run: strict mode's
  // resubscribe must not replay what this instance already played.
  const watermark = useRef(0);

  useEffect(
    () =>
      watchPresentation(useGameStore, kind, watermark, (presentation, event) => {
        handlerRef.current(presentation, event);
      }),
    [kind],
  );
}

/** Narrow source used by progression subscribers and their unit tests. */
interface ProgressionSource {
  getState(): { progression: ProgressionEvent | null };
  subscribe(listener: (state: { progression: ProgressionEvent | null }) => void): () => void;
}

/**
 * Delivers each ordered progression update once to a subscriber instance,
 * including an update that arrived immediately before the subscriber mounted.
 */
export function watchProgression(
  source: ProgressionSource,
  watermark: { current: number },
  handler: (event: ProgressionEvent) => void,
): () => void {
  const deliver = (event: ProgressionEvent | null): void => {
    if (!event || event.seq <= watermark.current) return;
    watermark.current = event.seq;
    handler(event);
  };
  deliver(source.getState().progression);
  return source.subscribe((state) => deliver(state.progression));
}

/** Subscribe to ordered, replay-safe level/tier progression updates. */
export function useProgression(handler: (event: ProgressionEvent) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const watermark = useRef(0);

  useEffect(
    () =>
      watchProgression(useGameStore, watermark, (event) => {
        handlerRef.current(event);
      }),
    [],
  );
}
