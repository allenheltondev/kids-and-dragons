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
  Campaign,
  ClientIntent,
  ItemCatalog,
  PartyMember,
  Presentation,
  Prompt,
  RoomMode,
  RulesContent,
  RunState,
} from "@kad/shared";
import type { ClientSession, ConnectionStatus, GameStore, PresentationEvent } from "./contract";
import {
  clearSession,
  defaultStorage,
  loadIdentity,
  loadSession,
  saveIdentity,
  saveSession,
  type KeyValueStorage,
} from "./persistence";
import { api as defaultApi, eventsUrl as defaultEventsUrl, ApiError, type Api } from "../sync/client";
import {
  MessageSequencer,
  openChannel as defaultOpenChannel,
  type Channel,
  type PresentationGate,
} from "../sync/channel";
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
  /** In-flight attach, so React 19's double-invoked effect joins once. */
  attaching: Promise<void> | null;
}

export function gameStoreCreator(deps: GameStoreDeps): StateCreator<InternalGameStore> {
  return (set, get) => {
    const runtime: Runtime = {
      sequencer: null,
      channel: null,
      gate: null,
      content: null,
      resyncing: null,
      attaching: null,
    };

    /** The one and only writer of `state`. */
    function makeSequencer(): MessageSequencer {
      const sequencer = new MessageSequencer({
        gate: runtime.gate,
        handlers: {
          onState: (state) => set({ state }),
          onPresentation: (presentation) => set({ presentation }),
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

    function connect(session: ClientSession, snapshot: RunState, seq: number): void {
      disconnect();
      const sequencer = makeSequencer();
      runtime.sequencer = sequencer;
      sequencer.reset(snapshot, seq);

      runtime.channel = deps.openChannel({
        url: (sinceSeq) =>
          deps.eventsUrl(session.roomCode, sinceSeq, session.sessionToken || undefined),
        sequencer,
        onStatus: (connection) => set({ connection }),
        resync,
      });
    }

    function disconnect(): void {
      runtime.channel?.close();
      runtime.channel = null;
      runtime.sequencer?.dispose();
      runtime.sequencer = null;
      runtime.resyncing = null;
    }

    function establish(session: ClientSession, snapshot: RunState): void {
      saveSession(session, deps.storage);
      set({ session, error: null, pendingCode: null });
      connect(session, snapshot, snapshot.seq);
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
      error: null,
      rules: null,
      items: null,
      campaign: null,
      pendingCode: null,

      async loadContent() {
        if (get().rules && get().items && get().campaign) return;
        if (runtime.content) return runtime.content;

        const task = (async () => {
          // The campaign is loaded alongside the rules because the lobby needs
          // to name the chapter it asks the server to start, and content must
          // never require a deploy of game code. LAUNCH_CAMPAIGN is the only
          // hardcoded id in the client; picking between campaigns is roadmap
          // Chapter 5's problem.
          const [rules, items, campaign] = await Promise.all([
            deps.api.loadRules(),
            deps.api.loadItems(),
            deps.api.loadCampaign(LAUNCH_CAMPAIGN),
          ]);
          set({ rules, items, campaign });
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

      async createRoom(mode: RoomMode, displayName: string) {
        set({ connection: "connecting", error: null });
        const identity = loadIdentity(deps.storage);
        saveIdentity({ ...identity, displayName }, deps.storage);
        try {
          const room = await deps.api.createRoom({ householdId: identity.householdId, mode });
          return await get().joinRoom(room.code, displayName);
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
          });
          const session: ClientSession = {
            runId: joined.runId,
            roomCode,
            playerId: joined.playerId,
            mode: joined.mode,
            sessionToken: joined.sessionToken,
          };
          establish(session, joined.state);
          deps.navigate({ name: "player", code: roomCode }, { replace: true });
          return session;
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
        if (runtime.attaching) return runtime.attaching;

        const stored = loadSession(roomCode, deps.storage);
        set({ connection: "connecting", pendingCode: roomCode });

        const task = (async () => {
          if (stored) {
            // No `sinceSeq`: attaching is always a cold start — the mirror did
            // not survive the refresh, so we want the snapshot. Sending 0 would
            // mean "caught up through seq 0", and a room still sitting at seq 0
            // would correctly answer with an empty event list and no state
            // (architecture §4.3).
            const response = await deps.api.fetchState(
              { runId: stored.runId, code: roomCode },
              stored.sessionToken || undefined,
            );
            if (!response.state) throw new ApiError(410, "That room has expired.");
            establish(stored, response.state);
            return;
          }

          if (role !== "display") {
            // A phone with no stored session has to join, and joining needs a
            // name. App falls back to HomeScreen with `pendingCode` prefilled.
            set({ connection: "idle" });
            return;
          }

          const response = await deps.api.fetchState({ code: roomCode });
          if (!response.state) throw new ApiError(404, "No such room.");
          const display: ClientSession = {
            runId: response.state.runId,
            roomCode,
            playerId: "", // no player on this device — it is a screen, not a seat
            mode: response.state.mode,
            sessionToken: "",
          };
          // Deliberately not persisted: a display client has nothing worth
          // storing, and it recovers from the URL alone.
          set({ session: display, error: null, pendingCode: null });
          connect(display, response.state, response.state.seq);
        })()
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "Could not reach the game.";
            set({ error: message, connection: "error" });
          })
          .finally(() => {
            runtime.attaching = null;
          });

        runtime.attaching = task;
        return task;
      },

      async send(intent: ClientIntent) {
        const { session, state } = get();
        if (!session) return;
        if (!session.playerId) return; // display clients send nothing, ever

        try {
          const response = await deps.api.postAction(
            {
              runId: session.runId,
              playerId: session.playerId,
              // Last-seen server seq. The server rejects a stale intent rather
              // than applying it out of order (architecture §4.2).
              seq: state?.seq ?? runtime.sequencer?.seq ?? 0,
              intent,
            },
            session.sessionToken,
          );

          if (response.ok) return;

          if (response.error?.code === "STALE_SEQ") {
            // We were behind, not wrong. Catch up and let the player retap;
            // replaying the intent blind is how you double-spend a turn.
            await resync(runtime.sequencer?.seq ?? 0);
            return;
          }
          set({ error: response.error?.message ?? "That isn't allowed right now." });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "Could not reach the game.",
          });
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

export function useSend(): (intent: ClientIntent) => Promise<void> {
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

/**
 * Subscribe to one kind of presentation event.
 *
 * Fires only for events that arrive while mounted: a refresh must not replay a
 * dice roll that already happened. Dedupes on `seq`, since React 19 strict mode
 * subscribes twice.
 */
export function usePresentation<K extends Presentation["kind"]>(
  kind: K,
  handler: (presentation: Extract<Presentation, { kind: K }>, event: PresentationEvent) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let seen = useGameStore.getState().presentation?.seq ?? 0;
    return useGameStore.subscribe((store) => {
      const event = store.presentation;
      if (!event || event.seq <= seen) return;
      seen = event.seq;
      if (event.presentation.kind !== kind) return;
      handlerRef.current(event.presentation as Extract<Presentation, { kind: K }>, event);
    });
  }, [kind]);
}
