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
  JoinRoomResponse,
  ItemCatalog,
  PartyMember,
  Presentation,
  Prompt,
  RoomMode,
  RulesContent,
  RunState,
} from "@kad/shared";
import { isMyCombatTurn, parseAbilityCatalog } from "./combat";
import type {
  ClientSession,
  ConnectionStatus,
  GameStore,
  PresentationEvent,
  ProgressionEvent,
} from "./contract";
import {
  clearSession,
  defaultStorage,
  loadIdentity,
  loadSession,
  saveIdentity,
  saveSession,
  type KeyValueStorage,
} from "./persistence";
import {
  api as defaultApi,
  eventsUrl as defaultEventsUrl,
  ApiError,
  type Api,
  type ClientConfig,
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
import { navigate } from "../router";

/**
 * The campaign the lobby starts. One campaign exists today; choosing between
 * several is roadmap Chapter 5's problem, and the id lives here rather than in
 * a component so there is exactly one place to change when it is.
 */
const LAUNCH_CAMPAIGN = "the-hollow-crown";

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
  openChannel: typeof defaultOpenChannel;
  eventsUrl: typeof defaultEventsUrl;
  /** Injected so tests can assert routing without a DOM. */
  navigate: typeof navigate;
}

export function defaultDeps(): GameStoreDeps {
  return {
    api: defaultApi,
    storage: defaultStorage(),
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
      return prompt.forPlayerIds.length === 0 || prompt.forPlayerIds.includes(playerId);
    case "ready":
      return prompt.forPlayerIds.length === 0 || prompt.forPlayerIds.includes(playerId);
    case "roll":
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
}

/**
 * How long an action's committed patch may take to arrive on the channel
 * before the client stops waiting and resyncs. Generous next to the
 * sequencer's 750ms gap timer, because this timer's normal fate is to be
 * cleared: it has to outlast an ordinary broadcast plus a presentation-gated
 * beat, so it only ever fires when the broadcast genuinely never left.
 */
const BROADCAST_GRACE_MS = 4_000;

export function gameStoreCreator(deps: GameStoreDeps): StateCreator<InternalGameStore> {
  return (set, get) => {
    const runtime: Runtime = {
      sequencer: null,
      channel: null,
      gate: null,
      content: null,
      resyncing: null,
      attaching: null,
      realtime: null,
      broadcastWatchdog: null,
      chapter: null,
    };

    /**
     * Which transport to open, asked once per page load.
     *
     * The seam already existed on the server (`RoomChannel`) and in the
     * sequencer (`EventSourceLike`); this is the third and last place that has
     * to know both exist. Failing the lookup falls back to SSE rather than
     * throwing — on a laptop that is simply the right answer, and in prod a
     * `/api/config` that cannot be reached means the API is down, which the
     * reconnect loop already handles better than a hard failure here would.
     */
    function realtimeConfig(): Promise<ClientConfig["realtime"] | null> {
      runtime.realtime ??= deps.api
        .fetchConfig()
        .then((config) => config?.realtime ?? null)
        .catch(() => null);
      return runtime.realtime;
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
          onState: (state) => set({ state }),
          onPresentation: (presentation) => set({ presentation }),
          onProgression: (progression) => set({ progression }),
          onGap: (sinceSeq) => void resync(sinceSeq),
        },
      });
      return sequencer;
    }

    async function resync(sinceSeq: number): Promise<void> {
      const session = get().session;
      const sequencer = runtime.sequencer;
      if (!session || !sequencer) return;
      if (runtime.resyncing) return runtime.resyncing;

      const task = (async () => {
        const response = await deps.api.fetchState(
          { runId: session.runId, code: session.roomCode, sinceSeq },
          session.sessionToken || undefined,
        );
        // The server chooses: replay the missed events, or hand back a whole
        // snapshot when the gap was too big to be worth replaying (§4.3).
        if (response.state) sequencer.reset(response.state, response.seq);
        else if (response.events) sequencer.ingestAll(response.events);
      })().finally(() => {
        runtime.resyncing = null;
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

      const createEventSource = await transportFor(session);
      // A `leave()` or a second attach can land during that await.
      if (runtime.sequencer !== sequencer) return;

      runtime.channel = deps.openChannel({
        url: (sinceSeq) =>
          deps.eventsUrl(session.roomCode, sinceSeq, session.sessionToken || undefined),
        sequencer,
        onStatus: (connection) => set({ connection }),
        resync,
        ...(createEventSource ? { createEventSource } : {}),
      });
    }

    function disconnect(): void {
      runtime.channel?.close();
      runtime.channel = null;
      runtime.sequencer?.dispose();
      runtime.sequencer = null;
      runtime.resyncing = null;
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
        void resync(current.seq);
      }, BROADCAST_GRACE_MS);
    }

    async function establish(session: ClientSession, snapshot: RunState): Promise<void> {
      saveSession(session, deps.storage);
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
    ): Promise<void> {
      const response = await deps.api.fetchState(
        { runId: stored.runId, code: roomCode },
        stored.sessionToken || undefined,
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
      // have it. None of those change by asking twice.
      return ![401, 403, 404, 410].includes(error.status);
    }

    /**
     * How many times a stored session is worth re-asserting, and how long that
     * takes: ~0.5s, 1s, 2s, 4s between five attempts, so a surface spends about
     * seven seconds trying before it admits defeat.
     *
     * Long enough to cover a server cold start or a phone's wifi waking up;
     * short enough that a genuinely dead room does not hold a spinner for a
     * minute in front of an eight-year-old.
     */
    const RESUME_ATTEMPTS = 5;

    async function withRetry(current: () => boolean, attempt: () => Promise<void>): Promise<void> {
      for (let tries = 0; ; tries += 1) {
        try {
          await attempt();
          return;
        } catch (error) {
          // A superseded attach stops quietly: the URL moved on, and this
          // room's failure is no longer anybody's problem.
          if (!current()) return;
          if (tries >= RESUME_ATTEMPTS - 1 || !worthRetrying(error)) throw error;
          await new Promise((resolve) => setTimeout(resolve, backoffDelay(tries, { baseMs: 500, maxMs: 4_000 })));
          if (!current()) return;
        }
      }
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
      const identity = loadIdentity(deps.storage);
      saveIdentity(
        {
          ...identity,
          displayName,
          playerId: seated.playerId,
          ...(seated.deviceToken ? { deviceToken: seated.deviceToken } : {}),
        },
        deps.storage,
      );

      const session: ClientSession = {
        runId: seated.runId,
        roomCode,
        playerId: seated.playerId,
        mode: seated.mode,
        sessionToken: seated.sessionToken,
      };
      await establish(session, seated.state);
      deps.navigate({ name: "player", code: roomCode }, { replace: true });
      return session;
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
      error: null,
      rules: null,
      items: null,
      campaign: null,
      abilities: null,
      chapter: null,
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
       * Creating a room seats the host in it, so the response *is* a join.
       * Joining again on top of it would seat a second player, leave an orphan
       * profile behind in every room, and throw away the device binding the
       * server issued — after which this browser rejoins as a stranger instead
       * of recovering its own character (architecture §4.5).
       */
      async createRoom(mode: RoomMode, displayName: string) {
        set({ connection: "connecting", error: null });
        const identity = loadIdentity(deps.storage);
        saveIdentity({ ...identity, displayName }, deps.storage);
        try {
          const room = await deps.api.createRoom({
            householdId: identity.householdId,
            mode,
            displayName,
            ...(identity.deviceToken ? { deviceToken: identity.deviceToken } : {}),
          });
          const roomCode = room.code;
          return await adopt(roomCode, room, displayName);
        } catch (error) {
          return failWith(error);
        }
      },

      async joinRoom(code: string, displayName: string) {
        const roomCode = code.trim().toUpperCase();
        set({ connection: "connecting", error: null });
        const identity = loadIdentity(deps.storage);
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

        const stored = loadSession(roomCode, deps.storage);
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
            await withRetry(current, () => resumeStored(stored, roomCode, current));
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
           */
          const response = await deps.api.watchRoom(roomCode);
          if (!current()) return;
          const display: ClientSession = {
            runId: response.runId,
            roomCode,
            playerId: "", // no player on this device — it is a screen, not a seat
            mode: response.mode,
            sessionToken: response.viewerToken,
          };
          // Deliberately not persisted: a display client has nothing worth
          // storing, and it recovers from the URL alone.
          set({ session: display, error: null, pendingCode: null });
          await connect(display, response.state, response.state.seq);
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

      leave() {
        const session = get().session;
        disconnect();
        if (session) clearSession(session.roomCode, deps.storage);
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

/**
 * "Is the combat clock on me?" The layout shells use it the way they use
 * `useIsMyPrompt`: a combat turn is a question without a Prompt object, and
 * §2.2's "your turn comes to you" applies to it just the same.
 */
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
