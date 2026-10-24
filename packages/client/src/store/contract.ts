/**
 * The client-side contract.
 *
 * `store/index.ts` implements this and is the *only* place that talks to the
 * server. Screens read state and call `send()`; they never fetch, never roll,
 * and never mutate `state` — the server is authoritative (architecture §4.1)
 * and the local mirror only ever changes by applying a server patch.
 */

import type {
  ResolvedCharacter,
  FlairChoice,
  JournalResponse,
  KidProfileView,
  AbilityCatalog,
  Campaign,
  Chapter,
  ClientIntent,
  IntentPreview,
  ItemCatalog,
  PartyMember,
  Presentation,
  ProgressionUpdate,
  RoomMode,
  RulesContent,
  RunState,
  SharedDevicePlayer,
  SharedSeatRequest,
  WorldMap,
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
  /**
   * This device opened the room, so it sees who arrives and may take them out
   * (#267). The server decides; this only says which buttons to draw.
   */
  host?: boolean;
  /**
   * This device started the guest household the room plays in, so it is the
   * one phone that may keep it by signing in (#265). The server decides, and
   * checks again on the claim; this only says whether to draw the offer.
   */
  keeper?: boolean;
}

/** Somebody who just joined the room (`ArrivalMessage`), held until dismissed. */
export interface Arrival {
  playerId: string;
  name: string;
  color: string;
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

/** A player's live pick and the decision it was made for (`previewContext`). */
/** A spectator's cheer, heard live (#388). `key` tells two of the same cheer apart. */
export interface HeardCheer {
  key: number;
  /** A `CHEERS` id. */
  cheer: string;
}

export interface HeldPreview {
  preview: IntentPreview;
  context: string;
}

/** What `loadJournal` hands the journal: the book, and whether it is last time's. */
export interface JournalLoad {
  journal: JournalResponse;
  /** ISO, when this is a saved copy because the server could not be reached. */
  savedAt: string | null;
}

export interface GameStore {
  connection: ConnectionStatus;
  /**
   * Whether the mirror is caught up with the server (#413). True from the
   * snapshot a room is entered with; false from the moment the stream drops
   * (or is replaced on a wake) until the catch-up after it reopens has been
   * applied. An open stream alone is not enough: the old scene's question is
   * still on screen until that catch-up lands. While false, the phone offers
   * no decisions and `send` refuses every intent.
   */
  synced: boolean;
  session: ClientSession | null;
  /** The server's authoritative run state, mirrored. Never written directly. */
  state: RunState | null;
  presentation: PresentationEvent | null;
  /** Last ordered progression update; subscribers dedupe by its server seq. */
  progression: ProgressionEvent | null;
  /**
   * What each player has tapped but not confirmed yet, by playerId — the live
   * `PreviewMessage`s, for the shared screen to light up. Not part of the
   * mirror: never in a snapshot, emptied on leaving or re-attaching, and
   * possibly stale, so a reader checks a preview still fits the state.
   */
  previews: Readonly<Record<string, HeldPreview>>;
  /**
   * What this phone has picked but not confirmed, or null: the half-made
   * answer a reload would lose (sw/calm.ts, #456). Set by `preview`.
   */
  myPreview: IntentPreview | null;
  /**
   * Who has joined since this screen attached, newest last (#267). Live only,
   * like `previews`: an arrival is news, never part of the mirror, so a screen
   * that attaches later starts with none.
   */
  arrivals: readonly Arrival[];
  /**
   * Arrivals the host's list let go of because it was full (`arrivals` holds
   * the newest). Non-zero only in a flood, which is the screen's cue to say so.
   */
  arrivalsDropped: number;
  /**
   * Spectators' cheers since this screen attached, oldest first (#388). Live
   * only, like `arrivals`; the shared screen floats each one up and lets it
   * go (`dropCheer`).
   */
  cheers: readonly HeardCheer[];
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
  /**
   * The world map's key (content/world.json): where every place is on the
   * realm painting, so the phone can stand the party on the chapter's biome.
   * Loaded on demand by the map alone — nothing else needs it, so it is not
   * part of `loadContent`'s batch.
   */
  world: WorldMap | null;

  /** Loads rules, items, the campaign and the ability catalog. Idempotent. */
  loadContent(): Promise<void>;
  /** Loads the named chapter's content. Idempotent per id; failures are quiet. */
  loadChapter(chapterId: string): Promise<void>;
  /** Loads the world map's key. Idempotent; failures are quiet. */
  loadWorld(): Promise<void>;
  /**
   * On a shared tablet (#250), `seat` names the kid picked, and is required:
   * the tablet itself is nobody.
   */
  createRoom(mode: RoomMode, displayName: string, seat?: SharedSeatRequest): Promise<ClientSession>;
  /**
   * Party Mode from the TV: open a room with this device as its screen, seat
   * nobody, and land on `/tv/:code` — the lobby the phones join (spec §2.1).
   */
  openOnThisScreen(): Promise<void>;
  joinRoom(code: string, displayName: string, seat?: SharedSeatRequest): Promise<ClientSession>;
  /**
   * The "who's playing?" picker on a shared tablet (#250). `null` when this
   * is not one, or no longer is: a forgotten tablet goes back to an ordinary
   * start, and the caller re-renders as one.
   */
  loadSharedPlayers(): Promise<SharedDevicePlayer[] | null>;
  /**
   * This player's saved characters, for bringing one back instead of making a
   * new one. Seating one is `send({ type: "SEAT_CHARACTER", characterId })`.
   */
  listHeroes(): Promise<ResolvedCharacter[]>;
  /**
   * What this phone can study with no game running (screens/JournalScreen):
   * its heroes, the household's Field Guide, where the party last was. `null`
   * when this phone has never played (or has only been a TV), so there is
   * nobody to look at.
   *
   * Offline, it is the last book this browser read, with `savedAt` saying
   * when; `savedAt` is `null` for a fresh read. Throws only when there is
   * neither, or the server refused the binding outright.
   */
  loadJournal(): Promise<JournalLoad | null>;
  /**
   * Save what she picked for her own page (#299). Throws when it could not be
   * saved (no signal, or the server said no); on success the saved copy of the
   * book is brought up to date so it opens the same offline.
   */
  saveFlair(choice: FlairChoice): Promise<KidProfileView>;
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
  /**
   * Tell the table what this phone has picked but not confirmed, or `null`
   * once it has backed out or confirmed. Fire-and-forget: a lost preview costs
   * a highlight on the TV, never a turn, so it neither retries nor reports.
   */
  preview(preview: IntentPreview | null, context: string | null): void;
  /**
   * Tell the room this phone is still here, or (`leaving`) that its page is
   * closing (#258, server handlers/presence.ts). Production's only presence:
   * nothing else tells the server a phone has gone. Fire-and-forget, like a
   * preview: the next beat says it again.
   */
  beat(leaving?: boolean): void;
  /**
   * The screen woke from sleep (#264): open a fresh stream and catch up from
   * the last applied seq, the way a hard refresh does (architecture §4.3). A
   * no-op when there is no room to catch up on.
   */
  reconnect(): void;
  /** Stops showing an arrival. */
  dismissArrival(playerId: string): void;
  /**
   * A spectator's cheer for the shared screen (#388, server handlers/cheer.ts).
   * Resolves `false` when it was not sent (too many too fast, or no longer
   * watching); nothing else depends on it, so nothing lands in `error`.
   */
  cheer(cheer: string): Promise<boolean>;
  /** The shared screen has finished floating a cheer up. */
  dropCheer(key: number): void;
  /**
   * "Just watch" on this phone (`true`), or back to making a hero (`false`)
   * (#388, server handlers/watch.ts). Resolves `true` once the server has it;
   * a refusal lands in `error` and resolves `false`.
   */
  spectate(watching: boolean): Promise<boolean>;
  /**
   * The host takes a player out of the room (#267). Resolves `true` once the
   * server has done it; a refusal lands in `error` and resolves `false`.
   */
  removePlayer(playerId: string): Promise<boolean>;
  /**
   * The host hands the keeper role to a phone in the room (#272), so that
   * phone, and no other, is offered the chance to keep a guest game. Resolves
   * like `removePlayer`.
   */
  handKeeper(playerId: string): Promise<boolean>;
  /**
   * The host locks the room to new joins, or opens it again (#263). Everybody
   * on the roster (`RunState.seats`) can still come back. Resolves like
   * `removePlayer`.
   */
  lockRoom(locked: boolean): Promise<boolean>;
  /**
   * The host turns quiet mode on for every device in the room, or off again
   * (#260). Resolves like `removePlayer`.
   */
  quietRoom(quiet: boolean): Promise<boolean>;
  /** The host closes the room for everybody (#263). Resolves like `removePlayer`. */
  closeRoom(): Promise<boolean>;
  /**
   * The host saves the chapter and closes the room, to pick it up another day
   * (#259). Resolves like `removePlayer`.
   */
  stopForToday(): Promise<boolean>;
  /**
   * Any seated player takes the household's saved chapter into this room
   * (#259). Resolves `true` once the server has put the party back; a
   * refusal lands in `error` and resolves `false`.
   */
  resumeGame(): Promise<boolean>;
  /**
   * Where each of this player's heroes is saved in a stopped game (#259),
   * by hero id, as the last `listHeroes` found it. `at` names another table.
   */
  savedHeroes: Record<string, { at?: string }>;
  /**
   * The host of a stopped game lets a hero go from it (#259). Resolves like
   * `removePlayer`.
   */
  releaseSavedHero(characterId: string, homeHouseholdId?: string): Promise<boolean>;
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
