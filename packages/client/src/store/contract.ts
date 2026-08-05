/**
 * The client-side contract.
 *
 * `store/index.ts` implements this and is the *only* place that talks to the
 * server. Screens read state and call `send()`; they never fetch, never roll,
 * and never mutate `state` — the server is authoritative (architecture §4.1)
 * and the local mirror only ever changes by applying a server patch.
 */

import type {
  AbilityCatalog,
  Campaign,
  Chapter,
  ClientIntent,
  ItemCatalog,
  PartyMember,
  Presentation,
  ProgressionUpdate,
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

export interface ProgressionEvent {
  seq: number;
  progression: ProgressionUpdate;
}

export interface GameStore {
  connection: ConnectionStatus;
  session: ClientSession | null;
  /** The server's authoritative run state, mirrored. Never written directly. */
  state: RunState | null;
  presentation: PresentationEvent | null;
  /** Last ordered progression update; subscribers dedupe by its server seq. */
  progression: ProgressionEvent | null;
  /** Set when an intent was rejected. Cleared by `dismissError()`. */
  error: string | null;
  rules: RulesContent | null;
  items: ItemCatalog | null;
  /**
   * The campaign in play. Loaded like the rest of the content — the client
   * needs it to name the chapter it is asking the server to start, and adding
   * a campaign must never mean deploying game code.
   */
  campaign: Campaign | null;
  /**
   * The combat ability catalog (content/abilities.json), parsed. What
   * `legalActions` needs to draw the action cards during an encounter — the
   * same catalog the server validates against, loaded the same way as rules.
   */
  abilities: AbilityCatalog | null;
  /**
   * The chapter in play, for rendering only: its biome picks the combat tile
   * sheet, its encounter scenes carry the enemy art ids. Never consulted for
   * rules — the server runs the chapter; this is what it looks like.
   */
  chapter: Chapter | null;

  /** Loads rules, items, the campaign and the ability catalog. Idempotent. */
  loadContent(): Promise<void>;
  /** Loads the named chapter's content. Idempotent per id; failures are quiet. */
  loadChapter(chapterId: string): Promise<void>;
  createRoom(mode: RoomMode, displayName: string): Promise<ClientSession>;
  joinRoom(code: string, displayName: string): Promise<ClientSession>;
  /**
   * Fire an intent at the server. Resolves `true` when the server accepted it
   * and `false` when it did not — a rejection is a normal part of the protocol
   * (architecture §4.2), not an exception, so it does not throw.
   *
   * Callers that discard work on success have to check: a creation flow that
   * resets on a resolved promise throws away five screens of a child's choices
   * the one time the phone was on a bad connection.
   */
  send(intent: ClientIntent): Promise<boolean>;
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
 *   useSend()        — (intent: ClientIntent) => Promise<boolean>
 *   useRules()       — RulesContent | null
 *   useItems()       — ItemCatalog | null
 *   useCampaign()    — Campaign | null
 *   useAbilities()   — AbilityCatalog | null
 *   useChapter()     — Chapter | null
 *   useIsMyCombatTurn() — boolean (the combat clock is on this device)
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
