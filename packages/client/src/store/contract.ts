/**
 * The client-side contract.
 *
 * `store/index.ts` implements this and is the *only* place that talks to the
 * server. Screens read state and call `send()`; they never fetch, never roll,
 * and never mutate `state` — the server is authoritative (architecture §4.1)
 * and the local mirror only ever changes by applying a server patch.
 */

import type {
  ClientIntent,
  ItemCatalog,
  PartyMember,
  Presentation,
  RoomMode,
  RulesContent,
  RunState,
} from "@kad/shared";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "error";

export interface ClientSession {
  runId: string;
  roomCode: string;
  playerId: string;
  mode: RoomMode;
  sessionToken: string;
}

/** The last presentation event, with a monotonic id so effects can dedupe. */
export interface PresentationEvent {
  seq: number;
  presentation: Presentation;
}

export interface GameStore {
  connection: ConnectionStatus;
  session: ClientSession | null;
  /** The server's authoritative run state, mirrored. Never written directly. */
  state: RunState | null;
  presentation: PresentationEvent | null;
  /** Set when an intent was rejected. Cleared by `dismissError()`. */
  error: string | null;
  rules: RulesContent | null;
  items: ItemCatalog | null;

  /** Loads content/rules.json and content/items.json. Idempotent. */
  loadContent(): Promise<void>;
  createRoom(mode: RoomMode, displayName: string): Promise<ClientSession>;
  joinRoom(code: string, displayName: string): Promise<ClientSession>;
  /** Fire an intent at the server. Resolves once the server has accepted it. */
  send(intent: ClientIntent): Promise<void>;
  /** Drops the session and disconnects. Does not delete anything server-side. */
  leave(): void;
  dismissError(): void;
}

/**
 * `store/index.ts` must also export these selector hooks. Screens use them
 * rather than reaching into the store shape, so the shape stays free to change.
 *
 *   useGameStore     — the zustand hook itself, typed as GameStore
 *   useRunState()    — RunState | null
 *   useMe()          — PartyMember | null   (this device's player)
 *   useParty()       — PartyMember[]
 *   usePrompt()      — Prompt | null, already filtered to "is this for me?"
 *   useIsMyPrompt()  — boolean
 *   useSend()        — (intent: ClientIntent) => Promise<void>
 *   useRules()       — RulesContent | null
 *   useItems()       — ItemCatalog | null
 *   usePresentation(kind, handler) — subscribe to one presentation kind
 */
export type MaybeMember = PartyMember | null;

/**
 * Components `screens/index.ts` must export. The layout shells in `layout/`
 * compose them; nothing else imports from `screens/` directly.
 *
 * | Export                | Surface     | Rendered when                        |
 * |-----------------------|-------------|--------------------------------------|
 * | `HomeScreen`          | full page   | no session                           |
 * | `LobbyContent`        | WorldView   | phase === "lobby"                    |
 * | `NarrationPanel`      | WorldView   | phase is scene-like                  |
 * | `DiceOverlay`         | WorldView   | a ROLL presentation arrives          |
 * | `ChapterCompletePanel`| WorldView   | phase === "chapter_complete"         |
 * | `CreationPreview`     | WorldView   | phase === "creation"                 |
 * | `CreationFlow`        | PlayerView  | phase === "creation" and I have none |
 * | `PlayerPanel`         | PlayerView  | otherwise                            |
 *
 * Every one of them takes no props: they read the store. That keeps the
 * WorldView/PlayerView split honest — neither surface knows the room mode
 * (architecture §4.6), so neither can pass mode-dependent props down.
 */
export interface ScreenExports {
  readonly _doc?: never;
}
