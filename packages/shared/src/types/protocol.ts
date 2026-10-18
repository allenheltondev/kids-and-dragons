/**
 * Wire protocol — docs/architecture.md §4.
 *
 * Clients send intents. The server validates, applies, persists, and broadcasts
 * a { patch, presentation } pair. Phones apply the patch and ignore
 * presentation; the WorldView plays the presentation, *then* applies the patch.
 * State and spectacle stay decoupled.
 */

import type {
  Appearance,
  ClassId,
  ResolvedCharacter,
  SpeciesId,
  StatId,
  Stats,
  TierId,
} from "./domain.js";
import type { RiftActionKind } from "./campaign-graph.js";
import type { ChapterOutcome } from "./chapter.js";
import type { RoomMode, RunState, DiceRoll } from "./state.js";
import type { FieldGuideFind } from "../field-guide-record.js";
import type { EncounterEvent } from "../encounter.js";

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

export type ClientIntent =
  | { type: "READY"; ready: boolean }
  | {
      type: "CREATE_CHARACTER";
      name: string;
      species: SpeciesId;
      class: ClassId;
      /** Points the player assigned, before species bonus. */
      stats: Stats;
      /**
       * Ignored: the engine assigns each new character its colors
       * (player-colors.ts). Accepted so an older client still gets through.
       */
      appearance?: Appearance;
      /**
       * Joining a party already underway (spec §8.4) — 1, or the party's tier
       * floor. Absent means 1. Validated in `newCharacter()`, never trusted:
       * it arrives from a phone and decides how strong the character is.
       */
      startingLevel?: number;
    }
  /**
   * Bring a saved character to this table instead of making a new one (spec
   * §5: a character "can be reused across campaigns"). The server loads the
   * household's row and the engine checks it is this player's to bring.
   */
  | { type: "SEAT_CHARACTER"; characterId: string }
  | { type: "START_CHAPTER"; chapterId: string }
  /**
   * "Play the next chapter of this campaign." The client cannot know which
   * chapter that is — where the party got to and which road it took live on
   * the household's campaign attempt, across evenings and rooms — so the server
   * answers it and turns this into a START_CHAPTER before the engine sees it.
   *
   * Which campaign is the lobby's call, not the tapper's: when the room offers
   * more than one (`RunState.campaignOptions`), the server plays the one the
   * vote picked and `campaignId` is ignored. It is only read on a run that
   * predates the options.
   */
  | { type: "CONTINUE_CAMPAIGN"; campaignId?: string }
  /**
   * Take a way on out of the node a graph campaign's journey is at (#194) —
   * the choice `CampaignView.journey.exits` draws. Resolved by the server
   * against the household's attempt, like CONTINUE_CAMPAIGN, and never seen
   * by the engine: which exits are open is a fact about the journey, which no
   * phone holds the authority for.
   *
   * It moves the journey and nothing else. The party arrives at the new place
   * and CONTINUE_CAMPAIGN plays it (or, at a `"pass"` revisit, the party is
   * straight back at a choice). Legal between chapters only — in the lobby or
   * on the completion screen — because there is no leaving a node mid-chapter.
   *
   * `visit` echoes `JourneyView.visit`, and with `edgeId` is the idempotence
   * key: the same crossing reported twice (a double tap, a retry after a lost
   * response) is answered as already done, and a crossing from a visit the
   * journey has since left is refused as stale. `campaignId` defaults to the
   * run's `campaignId`.
   */
  | { type: "CHOOSE_EXIT"; edgeId: string; visit: number; campaignId?: string }
  /**
   * Act on a rift where a graph campaign's party stands (#197) — the choice
   * `CampaignView.journey.riftActions` draws: discover, open, close, steady or
   * turn one. Resolved by the server against the household's journey (shared
   * `takeRiftAction`), exactly like CHOOSE_EXIT and for the same reason, and
   * legal at the same moments: between chapters, while the party is choosing.
   *
   * It changes the rift and nothing else; the party stays where it is, and
   * the exits it is offered are re-answered on the same patch. `visit`
   * echoes `JourneyView.visit`, and with `action`, `edgeId` and `to` is the
   * idempotence key: the same action sent twice is answered as done, never
   * applied twice. `to` is a redirect's destination (`JourneyRiftActionView.to`).
   *
   * `way` (#199) names which of several ways to the same action this is
   * (`JourneyRiftActionView.way`) — the Starweaver's attunement, the
   * Thornguard's shove, the hermit's help. The server judges that way's
   * `requires` against the seated party and refuses it when nobody seated
   * can (`"party-cannot"`).
   */
  | {
      type: "RIFT_ACTION";
      action: RiftActionKind;
      edgeId: string;
      visit: number;
      to?: string;
      way?: string;
      campaignId?: string;
    }
  /**
   * A lobby vote for which campaign to play (`RunState.campaignVotes`). Tapped
   * on the ready screen; changing your mind is another vote.
   */
  | { type: "VOTE_CAMPAIGN"; campaignId: string }
  | { type: "CHOOSE"; choiceId: string }
  /**
   * `spendBuff` answers the roll prompt's `"choose"` buff offer (#222): the
   * offered buff's id spends it on this roll; absent saves it. Naming a buff
   * the prompt no longer offers (a stale tap: a friend spent it first) rolls
   * without one, and never spends something else in its place.
   */
  | { type: "ROLL"; spendBuff?: string }
  /** Offer your help on the check someone else is about to roll. */
  | { type: "HELP" }
  | { type: "ADVANCE" }
  /**
   * `targetId` is for a thrown consumable during the holder's combat turn —
   * the Thunder Acorn needs a monster to land on. Ignored outside a fight,
   * where the only usable effect is a heal and it lands on the user.
   */
  | { type: "USE_ITEM"; itemId: string; targetId?: string }
  | { type: "RESOLVE_ITEM_SWAP"; dropItemId: string | null }
  | { type: "SPEND_STAT_POINT"; stat: StatId }
  /**
   * Trading at a Rest scene, spec §9.4 — offer, then the other phone answers.
   *
   * Two intents rather than one because it is two taps on two devices, and the
   * gap between them is the point: "drag on your phone, tap to accept on
   * theirs" is a conversation, not a transfer. Nothing leaves the giver's bag
   * until the answer arrives.
   */
  | { type: "OFFER_ITEM"; itemId: string; toPlayerId: string }
  /**
   * `accept: true` is the receiver's alone. `accept: false` is either end of
   * it — declining and taking it back are the same event from opposite sides,
   * and an offer nobody can retract is an offer that strands an item.
   *
   * `dropItemId` answers §9.1's "keep it and drop one, or leave it" when the
   * receiver's six slots are full. It rides on the accept rather than raising
   * a separate swap prompt so the whole hand-off stays *one* event: a prompt
   * would put the item in limbo between the accept and the answer — out of the
   * giver's bag, not yet in the receiver's — and "leave it behind" would then
   * have to mean "give it back", which is a rule nobody at the table would
   * guess. One intent, and the item is either where it was or where it went.
   */
  | { type: "RESOLVE_TRADE"; tradeId: string; accept: boolean; dropItemId?: string }
  | { type: "SET_MODE"; mode: RoomMode }
  /**
   * Combat, spec §7.2 — move up to your steps, then take one action.
   *
   * Three intents rather than one because they are three different taps with
   * three different undo stories: a move is committed the moment the figure
   * arrives, an action is committed once a target is confirmed, and ending a
   * turn is the only one that hands control to somebody else. Folding them
   * together would make "I moved and then changed my mind about who to hit" a
   * protocol error instead of a normal thing an eight-year-old does.
   */
  | { type: "MOVE"; to: { x: number; y: number } }
  /**
   * `targetIds` / `targetTiles` are the multi-select forms (Storm of Blades'
   * two enemies, Bramble Wall's two tiles). The singular fields stay for every
   * one-target ability; a request may send either shape and the engine reads
   * the plural first (encounter.ts CombatActionRequest).
   */
  | {
      type: "COMBAT_ACTION";
      abilityId: string;
      targetId?: string;
      targetTile?: { x: number; y: number };
      targetIds?: string[];
      targetTiles?: { x: number; y: number }[];
    }
  | { type: "END_TURN" }
  /**
   * Playtest mode (roadmap chapter 6). Both are refused with FORBIDDEN unless
   * `EngineContext.playtest` is true, which only `dev-server.ts` ever sets —
   * `lambda/runtime.ts` passes a literal `false`, so a deployed build has no
   * path to them at all. See playtest.ts for why the gate is here rather than
   * in a separate dev-only code path.
   *
   * They are in the shared protocol rather than a side channel because they go
   * through `applyIntent` like everything else: a jump has to run `onEnter`,
   * open the scene's prompt and heal at a Rest, or the author is playtesting a
   * scene the game does not produce.
   */
  | { type: "PLAYTEST_GOTO"; sceneId: string }
  /** The next d20 this run rolls, or null to let the dice go back to normal. */
  | { type: "PLAYTEST_SET_DIE"; die: number | null };

export interface ActionRequest {
  runId: string;
  playerId: string;
  /** The client's last-seen server seq. The server rejects stale intents. */
  seq: number;
  intent: ClientIntent;
}

export interface ActionResponse {
  ok: boolean;
  seq: number;
  /** Set when ok is false. Clients resync rather than retrying blindly. */
  error?: { code: "STALE_SEQ" | "ILLEGAL" | "NOT_FOUND" | "FORBIDDEN"; message: string };
}

// ---------------------------------------------------------------------------
// Server → clients
// ---------------------------------------------------------------------------

/** RFC 6902. */
export type JsonPatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown }
  | { op: "move"; from: string; path: string }
  | { op: "copy"; from: string; path: string }
  | { op: "test"; path: string; value: unknown };

/** How the WorldView should animate a transition. Never load-bearing. */
export type Presentation =
  | { kind: "SCENE_ENTER"; sceneId: string; art?: string }
  | { kind: "ROLL"; roll: DiceRoll }
  | { kind: "CHOICE_MADE"; choiceId: string; byPlayerId: string }
  /**
   * A fight has started: the board is up and initiative is rolled.
   *
   * Carried as a presentation rather than left to the patch because the client
   * has to play the "everyone takes their places" beat *before* the new state
   * lands, exactly like a chapter's ending beat below — a board that simply
   * appears mid-scene reads as a glitch.
   */
  | {
      kind: "ENCOUNTER_BEGAN";
      mapId: string;
      firstActorId: string | null;
      /** Enemy turns that resolved before the first player could act. */
      events?: readonly EncounterEvent[];
      /** A branch reached if those opening turns immediately ended the fight. */
      after?: Presentation;
    }
  | {
      kind: "COMBAT_SEQUENCE";
      /** Every move, roll and state-changing effect, in resolution order. */
      events: readonly EncounterEvent[];
      /** A scene transition that must wait until the combat beats finish. */
      after?: Presentation;
    }
  | { kind: "ATTACK"; sourceId: string; targetId: string; roll: DiceRoll; damage: number }
  | { kind: "HEAL"; targetId: string; amount: number }
  | { kind: "DOWN"; targetId: string }
  | { kind: "REVIVE"; targetId: string }
  | { kind: "LEVEL_UP"; characterId: string; level: number }
  | { kind: "TRANSFORM"; characterId: string; tier: string }
  /**
   * `outcome` is the one thing on a presentation that a client cannot recompute
   * from the patch alone in time to use it: the ending beat has to be chosen
   * *before* the state lands (see the WorldView's play-then-apply order above),
   * and a setback plays a different one (spec §8.2).
   */
  | { kind: "CHAPTER_COMPLETE"; chapterId: string; xp: number; outcome: ChapterOutcome };

/** A character-specific progression trigger emitted by a chapter XP award. */
export interface ProgressionAward {
  characterId: string;
  /** Present only when this award crossed at least one level boundary. */
  leveledTo?: number;
  /** Present only when this award crossed an appearance-tier boundary. */
  newTier?: TierId;
}

/**
 * Progression data that accompanies the authoritative state patch.
 *
 * `characters` deliberately repeats the resolved snapshots represented by the
 * patch. It gives UI trigger code one self-contained payload while the patch
 * remains the source of truth for every existing client.
 */
export interface ProgressionUpdate {
  characters: ResolvedCharacter[];
  /** Present for chapter XP awards; campaign-only transitions have no awards. */
  awards?: ProgressionAward[];
}

export interface ServerMessage {
  seq: number;
  runId: string;
  patch: JsonPatchOp[];
  presentation?: Presentation;
  /** Additive progression data; older clients safely ignore this field. */
  progression?: ProgressionUpdate;
  /**
   * Field Guide ids this step added to the household's book for the first
   * time — the "new entry!" signal (#106; #110 celebrates it). The entries
   * themselves arrive in this message's `patch`, under `/fieldGuide`.
   *
   * **Live only.** Set on the broadcast and never written to the event log,
   * so `GET /state` — a snapshot or a replay of missed events (§4.3) — can
   * never announce a discovery a second time. A client that misses the live
   * message still gets the book, just not the fanfare. Taken from what the
   * store reported as newly added, so two rooms of one household cannot both
   * announce the same find.
   */
  discovered?: string[];
}

/** A full snapshot, sent on join and whenever a client's gap is too large. */
export interface SnapshotMessage {
  seq: number;
  runId: string;
  state: RunState;
}

/**
 * What a player has tapped on their phone but not yet confirmed — the
 * half-made choice the shared screen lights up so the table can see it coming
 * (a story option, a tile to walk to, an ability and who it is aimed at).
 *
 * A hint, never an intent: nothing here is validated against the rules or
 * applied to anything, and the confirmed intent that follows is checked as if
 * this had never been sent. Each carries the decision it was made for
 * (`previewContext`); the server refuses one whose decision has passed and the
 * TV shows one only while its state still names that decision, so a stale
 * preview fades on its own rather than needing an undo.
 */
export type IntentPreview =
  | { kind: "choice"; choiceId: string }
  | { kind: "move"; to: { x: number; y: number } }
  /** An ability, with whatever has been aimed so far — maybe nothing yet. */
  | {
      kind: "action";
      abilityId: string;
      targetIds?: string[];
      tiles?: { x: number; y: number }[];
    }
  | { kind: "item"; itemId: string; targetId?: string }
  | { kind: "end_turn" };

/**
 * A live-only relay of one player's `IntentPreview`, or `null` when they backed
 * out. Never committed and never in the event log, so it has no seq of its
 * own: `seq` is the run's seq when it was relayed, carried only so every
 * message on the channel has one, and the sequencer never orders by it. A
 * preview that went through the state instead would bump the seq on every tap,
 * and a second player's real move would bounce off STALE_SEQ for it.
 */
export interface PreviewMessage {
  seq: number;
  runId: string;
  playerId: string;
  preview: IntentPreview | null;
  /**
   * The decision this preview was made for (`previewContext`), as the phone
   * saw it. A screen draws the preview only while its own state gives the same
   * context, so a late or orphaned one cannot surface on a later turn or a
   * later question. Null on a clearing `preview: null`.
   */
  context: string | null;
}

/**
 * Somebody joined the room (#267). Live only, like a preview: it is not a step
 * of the state and never moves `seq`, so a screen that attaches later never
 * sees it. It exists so the room sees who arrived, at the moment they arrive,
 * including a phone that has not made a character yet and so is nowhere in
 * `RunState.party`.
 */
export interface ArrivalMessage {
  /** The state's seq when they arrived. Ordering only; never applied. */
  seq: number;
  runId: string;
  playerId: string;
  /** Their hero's name when they have one seated, else the name the phone gave. */
  name: string;
  color: string;
}

export type ChannelMessage =
  | ({ kind: "patch" } & ServerMessage)
  | ({ kind: "snapshot" } & SnapshotMessage)
  | ({ kind: "preview" } & PreviewMessage)
  | ({ kind: "arrival" } & ArrivalMessage);

// ---------------------------------------------------------------------------
// Transport seam — architecture §4.4
// ---------------------------------------------------------------------------

export type Unsubscribe = () => void;

export interface RoomChannel {
  publish(roomCode: string, message: ChannelMessage): Promise<void>;
  subscribe(roomCode: string, onMessage: (m: ChannelMessage) => void): Unsubscribe;
}

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

export interface CreateRoomRequest {
  householdId: string;
  mode: RoomMode;
  campaignId?: string;
  /**
   * The device opening the room is the TV, not a player (spec §2.1): open the
   * room and seat nobody. The TV then attaches with `/watch` like any screen.
   * Party Mode only — Travel Mode has no screen that is not also a seat.
   */
  display?: boolean;
}

export interface CreateRoomResponse {
  code: string;
  runId: string;
  mode: RoomMode;
  expiresAt: string;
}

/**
 * On a create, a join or a watch: whether the device that asked is the one
 * that opened this room (`RoomRecord.hostDeviceId`), and so may take a player
 * out of it (#267). Absent means no.
 */
export interface RoomHostFlag {
  host?: boolean;
}

/**
 * On a create or a join: whether this device started the guest household the
 * room plays in (`Household.founderDeviceId`), and so is the one phone that
 * may keep it by signing in (#265). Absent means no, and the offer is not drawn.
 */
export interface KeeperFlag {
  keeper?: boolean;
}

export interface JoinRoomRequest {
  /** The device-bound token. In local dev, a playerId is accepted directly. */
  deviceToken?: string;
  playerId?: string;
}

export interface JoinRoomResponse extends RoomHostFlag, KeeperFlag {
  runId: string;
  playerId: string;
  mode: RoomMode;
  sessionToken: string;
  state: RunState;
}

/**
 * One face on a shared tablet's "who's playing?" picker (#250): a household
 * profile, drawn as a big avatar with no typing.
 */
export interface SharedDevicePlayer {
  id: string;
  displayName: string;
  color: string;
  /** This kid's heroes' names, furthest-taken first, for "Ada · Sparklehoof". */
  heroes: string[];
}

/** `GET /api/household/players`, on a shared tablet's token. */
export interface SharedDevicePlayersResponse {
  householdId: string;
  players: SharedDevicePlayer[];
}

/**
 * `POST /api/auth/shared-device`: a signed-in owner makes this device the
 * household's shared tablet. The token names the household and nobody in it.
 */
export interface ShareDeviceResponse extends SharedDevicePlayersResponse {
  sharedToken: string;
}

// ---------------------------------------------------------------------------
// Organizers (#248): one or more signed-in grown-ups running a household
// ---------------------------------------------------------------------------

/** One household an account owns: a family, or a group of kids from many. */
export interface OrganizerHouseholdSummary {
  id: string;
  displayName: string;
  /** Profiles still on the pickers. */
  players: number;
}

/** `GET /api/organizer/households`. */
export interface OrganizerHouseholdsResponse {
  households: OrganizerHouseholdSummary[];
}

/** A hero, as an organizer sees it on a profile. */
export interface OrganizerHero {
  id: string;
  name: string;
  species: string;
  class: string;
  level: number;
}

export interface OrganizerPlayer {
  id: string;
  displayName: string;
  color: string;
  /** Off the pickers (`PlayerProfile.retired`). */
  retired: boolean;
  /** Furthest-taken first. */
  heroes: OrganizerHero[];
}

/** A grown-up who may manage the household. */
export interface OrganizerOwner {
  /** Opaque. What `POST /api/organizer/owners/remove` names. */
  id: string;
  /** As they signed in, when known. */
  email?: string;
  /** The account asking. */
  you: boolean;
  /** Claimed or created the household. Nobody can remove them. */
  founding: boolean;
}

/** `GET /api/organizer/household?householdId=`: everything an owner manages. */
export interface OrganizerHouseholdView {
  id: string;
  displayName: string;
  owners: OrganizerOwner[];
  players: OrganizerPlayer[];
}

/** A tablet bound to the household, as its owners see it. */
export interface OrganizerDevice {
  /** What `POST /api/auth/forget-device` names. */
  deviceId: string;
  /** As the tablet's browser announced itself; absent when it did not. */
  userAgent?: string;
  /** ISO time of the tablet's last request. */
  lastSeen: string;
  revoked: boolean;
}

/** `GET /api/organizer/devices?householdId=`: the household's shared tablets, most recently used first. */
export interface OrganizerDevicesResponse {
  devices: OrganizerDevice[];
}

/** `POST /api/organizer/invite`: a code a second grown-up signs in with to co-organize. */
export interface OrganizerInvite {
  code: string;
  expiresAt: string;
}

/**
 * On a shared tablet, a join or a create names who is playing (#250): one of
 * the household's profiles, or a new kid by name. Sent with the tablet's
 * `x-kad-shared-token`; the answer carries a session token and never a
 * device token.
 */
export interface SharedSeatRequest {
  playerId?: string;
  newPlayer?: string;
}

/**
 * `GET /api/journal` — what a phone can study with no game running.
 *
 * Authorised by the device token alone, not a room session: between games
 * there is no room, and the journal is the household's and this player's, not
 * a run's. Read-only by construction; nothing here can be changed from it.
 */
export interface JournalResponse {
  /** This player's own heroes, furthest-taken first — the same list WelcomeBack offers. */
  heroes: ResolvedCharacter[];
  /** The household's Field Guide: canon id → who found it first and when. */
  fieldGuide: Record<string, FieldGuideFind>;
  /**
   * Player id → the name a find is credited to. In play the party names the
   * finder; out of play there is no party, so the household says who is who.
   */
  finders: Record<string, string>;
  /**
   * Where the household last adventured — the chapter of its most recent run
   * that got past the lobby, and that chapter's biome, which is what the atlas
   * stands the party on. `null` before anybody has set out.
   */
  whereabouts: { chapterId: string; biome: string } | null;
}

export interface StateResponse {
  seq: number;
  /** Present when the client's gap was small enough to replay. */
  events?: ServerMessage[];
  /** Present when a full resync was cheaper. */
  state?: RunState;
}
