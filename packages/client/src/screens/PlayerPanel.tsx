import { setPlayerSection, usePlayerNavigation } from "../store/player-navigation";
/**
 * PlayerPanel — PlayerView for everything that is not character creation.
 *
 * This is the private controller (spec §2): your sheet, your six slots, and
 * the one decision the game is waiting on from you. It is the screen an
 * 8-year-old touches most, so:
 *
 *   - Only legal actions are ever rendered. The server has already filtered
 *     species-gated choices out of the prompt (architecture §5), so a choice
 *     that reaches here is legal by definition — we never re-check it and we
 *     never draw a disabled one (spec §7.2).
 *   - Selecting is not committing. Tap to choose, tap again to confirm
 *     (spec §11). "Change" is always available until then.
 *   - There is no timer anywhere in this file, and there never will be.
 *
 * Laid out for a phone first (roadmap, "Travel layout first"): the identity
 * strip is pinned, and while the game is asking you something the question
 * owns the pane — the scene's picture behind it (`SceneBackdrop`), the words
 * at the top, the answers at the bottom under the thumb. Otherwise the sheet
 * and the inventory scroll under the strip.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChunkBoundary, lazyChunk } from "../ui/ChunkBoundary";
import type { ReactElement, ReactNode } from "react";
import {
  DEFAULT_HELP_DIE,
  INVENTORY_SLOTS,
  STAT_IDS,
  classPlaceWaitingOn,
  isNewcomer,
  isPracticeCampaign,
  lobbyCampaign,
  readyWithoutAway,
  riftPartyOf,
  sameHome,
  swapOwnerAway,
  voteWaitsOnlyOnAway,
  type RankUp,
} from "@kad/shared";
import { checkTarget } from "./DiceOverlay";
import { checkBuffLine } from "./buff-copy";
import type {
  ClientIntent,
  InventoryEntry,
  JourneyExitView,
  ItemCatalog,
  ItemDef,
  PartyMember,
  Prompt,
  ResolvedCharacter,
  RulesContent,
  StatId,
} from "@kad/shared";
import {
  useCampaign,
  useChapter,
  useGameStore,
  useIsMyCombatTurn,
  useWaitingOnMe,
  useIsMyPrompt,
  useMyTurnKey,
  useItems,
  useMe,
  useParty,
  usePrompt,
  useRules,
  useRunState,
  useSend,
  useSharePreview,
} from "../store";
// Path helpers only — `screens/` never drags the renderer in (art-paths.ts).
import { biomeBackdropUrl, sceneArtFor, sceneBackdropUrl } from "../world/art-paths";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Collapsible } from "../ui/Collapsible";
import { hear, useReadAloudOn } from "../speech/read-aloud";
import { speak } from "@kad/shared";
import { CampaignArt } from "./CampaignArt";
import { CharacterPortrait } from "./CharacterPortrait";
import { CharacterSheet } from "./CharacterSheet";
import { ClassToken, SpareTokens, TokenCard, TokenGlyph, tokenName } from "./ClassToken";
import { Icon } from "./icons";
import { ChapterGoalCard } from "./ChapterGoal";
import { savedHeading, savedHeroes } from "./save-copy";
import { VoteTicks } from "./VoteTicks";
import { ClassPlaceChoice } from "./ClassPlace";
import {
  beginLabel,
  campaignEndHeading,
  campaignEndLine,
  campaignOptionLine,
  lockedLine,
  nextChapterLine,
  practiceOfferLine,
  skipPracticeLabel,
} from "./campaign-copy";
import { KeepsakeOffer } from "./SignInFlow";
import { CombatControls } from "./CombatPanel";
import { useEnsureChapter, useEnsureContent } from "./content";
import "./shared.css";
import "./PlayerPanel.css";
import { EntryScene, lobbySceneFor } from "./EntryScene";
import { FieldGuide } from "./FieldGuide";
import { JourneyPanel } from "./JourneyPanel";
import { HelpClaim } from "../help/focus";
import { helpAttrs } from "../help/longpress";

/** The rank-up card (#314), fetched the first time a rank lands; the plain line stands in until then. */
const RankUpCard = lazyChunk(() => import("./RankUpMoment"), (module) => module.RankUpCard);

function RankUpLine({ up }: { up: RankUp }): ReactElement {
  return (
    <p className="player__hint" data-testid="player-rank-up">
      <ClassToken classId={up.class} rank={up.rank} size="sm" holdable={false} />
      <span>{up.crow ? `${up.line} ${up.crow}` : up.line}</span>
    </p>
  );
}

/** Stable-ish identity for a prompt, so a new one clears any pending choice. */
function promptKey(prompt: Prompt | null): string {
  if (prompt === null) return "none";
  switch (prompt.kind) {
    case "choice":
      return `choice:${prompt.sceneId}:${prompt.options.map((o) => o.id).join(",")}`;
    case "roll":
      return `roll:${prompt.sceneId}:${prompt.characterId}`;
    case "item_swap":
      return `swap:${prompt.characterId}:${prompt.incomingItemId}`;
    case "ready":
      return `ready:${prompt.forPlayerIds.join(",")}`;
  }
}

/**
 * Whether the bag's "Use it" button applies to this item *here*, outside a
 * fight. Only a heal works out of combat — a roll bonus or a thrown item has
 * nothing to land on — and only on somebody actually hurt, because the server
 * refuses a use that would change nothing rather than consuming the item for
 * it (engine.ts doUseItem, the same rule useItemInCombat enforces). During an
 * encounter the bag goes quiet entirely: using an item is the turn's one
 * action (§7.2), so it lives with the other action cards in CombatControls.
 */
export function canUseInventoryItem(
  entry: InventoryEntry,
  encounterActive: boolean,
  def?: ItemDef,
  atFullHealth?: boolean,
): boolean {
  return (
    entry.kind === "consumable" &&
    !encounterActive &&
    def?.effect?.type === "heal" &&
    atFullHealth !== true
  );
}

function nameOfCharacter(party: PartyMember[], characterId: string): string {
  return party.find((m) => m.character.id === characterId)?.character.name ?? "Someone";
}

function nameOfPlayer(party: PartyMember[], playerId: string): string {
  return party.find((m) => m.playerId === playerId)?.character.name ?? "Someone";
}

/** What the table is waiting on, when it is not waiting on you. */
function waitingLine(prompt: Prompt, party: PartyMember[]): string {
  switch (prompt.kind) {
    case "roll":
      if (prompt.group) {
        const names = prompt.group.pending.map((id) => nameOfCharacter(party, id));
        return `Everyone rolls! Waiting for ${names.join(" and ")}.`;
      }
      return `${nameOfCharacter(party, prompt.characterId)} is rolling.`;
    case "choice": {
      if (prompt.forPlayerIds.length === 0) return "The party is deciding.";
      if (!prompt.vote && prompt.forPlayerIds.length === 1) {
        return `It's ${nameOfPlayer(party, prompt.forPlayerIds[0] as string)}'s turn to choose.`;
      }
      const names = prompt.forPlayerIds.map((id) => nameOfPlayer(party, id));
      return `Waiting for ${names.join(" and ")}.`;
    }
    case "item_swap":
      return `${nameOfCharacter(party, prompt.characterId)} found something.`;
    case "ready": {
      const waiting = party.filter((m) => !m.ready && m.connected).map((m) => m.character.name);
      return waiting.length === 0 ? "Everyone is ready." : `Waiting for ${waiting.join(" and ")}.`;
    }
  }
}

/**
 * The friends who stepped away (#258) that a "Start without …" or "Decide
 * without …" tap goes on without, by name. The caller shows the tap only
 * once everybody it would wait on is away.
 */
function awayNames(waitingOn: readonly PartyMember[]): string {
  return waitingOn.map((m) => m.character.name).join(" and ");
}

/** The die this player would add as a helper (content/rules.json `helpDie`). */
function helpSides(rules: RulesContent | null, me: PartyMember): number {
  return (rules?.helpDie ?? DEFAULT_HELP_DIE)[me.character.tier];
}

/** "Windstep is helping: +d6", for whoever can see the check. */
function helperLine(prompt: Prompt & { kind: "roll" }, party: PartyMember[], meId: string | undefined): string | null {
  if (!prompt.helper) return null;
  const who = prompt.helper.characterId === meId ? "You are" : `${nameOfCharacter(party, prompt.helper.characterId)} is`;
  return `${who} helping: +d${String(prompt.helper.sides)}`;
}

/**
 * The confirm row (spec §11), drawn whether or not anything is picked yet.
 *
 * The answers sit at the bottom of the pane, so a bar that arrived with the
 * pick pushed the option just tapped up a row — straight out from under the
 * thumb on its way to "Do it!" — and "Change" dropped it back again. Empty, it
 * keeps its seat but is invisible and inert, which also takes it out of the
 * accessibility tree: there is exactly one "Do it!" to find, and only once
 * there is something to do.
 */
function ConfirmBar({
  open,
  icon,
  what,
  children,
}: {
  open: boolean;
  icon: string;
  what: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={`confirm${open ? "" : " confirm--empty"}`}
      aria-hidden={open ? undefined : true}
      inert={!open}
    >
      <p className="confirm__what">
        <Icon name={icon} />
        <span>{open ? what : "\u00a0"}</span>
      </p>
      <div className="confirm__actions">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

function IdentityStrip({ me }: { me: PartyMember }): ReactElement {
  const { character } = me;
  const hpPct = character.maxHp === 0 ? 0 : Math.max(0, Math.min(1, me.hp / character.maxHp));
  /*
   * Whenever the game is waiting on you (a fight turn, a roll, a choice, a
   * vote not yet cast), the whole strip turns gold. That is the "your turn"
   * signal everywhere, rather than words: a playtest found "Your turn, Name!"
   * rows cost room and read as one more line of text. The strip is pinned
   * and already says who you are.
   */
  const myTurn = useWaitingOnMe();
  return (
    <header className={`sheet${myTurn ? " sheet--turn" : ""}`}>
      {/* Your own face on your own sheet, at whatever tier you have grown to —
          the identity strip is pinned, so this is the one picture that is on
          screen for the whole session. */}
      <span className="sheet__portrait" aria-hidden="true">
        <CharacterPortrait
          backdrop
          species={character.species}
          accent={character.appearance.accent}
          tier={character.tier}
          characterClass={character.class}
          className="sheet__art"
        />
      </span>
      <span className="sheet__id">
        <span className="sheet__name">
          {character.name}
          {myTurn ? <span className="kad-sr-only" role="status">: your turn!</span> : null}
        </span>
        {/* Knocked down (spec §7.3) takes the level line's place rather than
            a banner of its own: a banner pushed the question down a row the
            moment an enemy landed a hit, under a thumb already on its way. */}
        {me.down ? (
          <span className="sheet__meta sheet__down" role="status">
            <Icon name="down" />
            <span className="sheet__down-text">Knocked down. A friend can help you up.</span>
          </span>
        ) : (
          <span className="sheet__meta kad-muted">
            <Icon name={character.class} />
            <span>Level {character.level}</span>
            <span aria-hidden="true">·</span>
            <span className="sheet__tier">{character.tier}</span>
          </span>
        )}
        {/*
         * The waiting point (spec §8.1). Pinned here rather than beside the
         * stat row because a point is earned at the end of a chapter and spent
         * at the *next* Rest scene, which can be a whole sitting later — so the
         * reminder has to live on the one strip that is never scrolled away.
         * It says where to spend it, because "1 point" alone tells an
         * eight-year-old nothing about what to do next — and "rest stop" with
         * the moon, because a bare "at rest" read as a state rather than a
         * place. The moon is the same one the chapter map draws on a Rest.
         */}
        {character.unspentPoints > 0 ? (
          <span className="sheet__points">
            <Icon name="levelup" />
            <span>
              {character.unspentPoints === 1
                ? "1 point to spend at the next rest stop"
                : `${String(character.unspentPoints)} points to spend at the next rest stop`}
            </span>
            <Icon name="rest" />
          </span>
        ) : null}
      </span>
      <span className="sheet__hp">
        <span className="sheet__hp-label">
          <Icon name="heart" />
          <span>
            {me.hp}/{character.maxHp}
          </span>
        </span>
        <span className="sheet__hp-track" aria-hidden="true">
          <span className="sheet__hp-fill" style={{ inlineSize: `${String(hpPct * 100)}%` }} />
        </span>
      </span>
    </header>
  );
}

function StatRow({ me }: { me: PartyMember }): ReactElement {
  const { character } = me;
  return (
    <ul className="stat-row">
      {STAT_IDS.map((stat) => (
        <li className="stat-row__item" key={stat}>
          <Icon name={stat} />
          <span className="stat-row__name">{stat}</span>
          <b className="stat-row__value">{character.stats[stat]}</b>
        </li>
      ))}
      <li className="stat-row__item">
        <Icon name="guard" />
        <span className="stat-row__name">guard</span>
        <b className="stat-row__value">{character.guard}</b>
      </li>
      <li className="stat-row__item">
        <Icon name="steps" />
        <span className="stat-row__name">steps</span>
        <b className="stat-row__value">{character.steps}</b>
      </li>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Inventory — spec §9.1: six slots, icon grid, quest items outside the budget
// ---------------------------------------------------------------------------

function InventoryGrid({
  entries,
  questItems,
  spares,
  coins,
  items,
  selectedIndex,
  onSelect,
}: {
  entries: InventoryEntry[];
  questItems: string[];
  /** The tokens of classes taken off (#314): in the pack, outside the six slots. */
  spares: ResolvedCharacter["spares"];
  /** The party's shared purse — the same number on every phone. */
  coins: number;
  items: ItemCatalog | null;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}): ReactElement {
  const slots = Array.from({ length: INVENTORY_SLOTS }, (_, i) => entries[i] ?? null);
  return (
    <Collapsible
      id="bag"
      className="inv"
      title={<><Icon name="bag" /><span>Your things</span></>}
      trail={
        <span className="inv__purse kad-chip" aria-label={`The party's purse: ${String(coins)} ${coins === 1 ? "coin" : "coins"}`}>
          <Icon name="coin" />
          <span aria-hidden="true">{coins}</span>
        </span>
      }
    >
      <ul className="inv__grid">
        {slots.map((entry, index) => {
          const def = entry === null ? undefined : items?.[entry.itemId];
          const selected = selectedIndex === index;
          if (entry === null) {
            return (
              <li className="inv__slot inv__slot--empty" key={`empty-${String(index)}`}>
                <span className="inv__empty-mark" aria-hidden="true" />
                <span className="inv__slot-name kad-muted">Empty</span>
              </li>
            );
          }
          return (
            <li className="inv__slot" key={`${entry.itemId}-${String(index)}`}>
              <button
                type="button"
                className={`inv__button kad-tap kad-focusable${selected ? " inv__button--on" : ""}`}
                aria-pressed={selected}
                onClick={() => onSelect(selected ? null : index)}
                {...helpAttrs({ kind: "item", name: def?.name ?? entry.itemId, ...(def?.icon ? { icon: def.icon } : {}), ...(def?.text ? { text: def.text } : {}) })}
              >
                <Icon name={def?.icon ?? entry.kind} size="2.2em" />
                <span className="inv__slot-name">{def?.name ?? entry.itemId}</span>
                {/* Kind is a glyph as well as a word — never colour (spec §11). */}
                <span className="inv__kind kad-label">
                  <Icon name={entry.kind} />
                  <span>{entry.kind}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Folded at first: the list only grows, and its count on the heading says it is there. */}
      {questItems.length === 0 ? null : (
        <Collapsible
          id="story-things"
          level={4}
          defaultOpen={false}
          className="inv__quest"
          title={<><Icon name="quest" /><span>Story things</span></>}
          trail={<span className="kad-chip">{questItems.length}</span>}
        >
          <ul className="inv__quest-list">
            {questItems.map((itemId) => (
              <li className="kad-chip" key={itemId}>
                <Icon name={items?.[itemId]?.icon ?? "quest"} />
                <span>{items?.[itemId]?.name ?? itemId}</span>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
      <SpareTokens spares={spares} isMe />
    </Collapsible>
  );
}

/**
 * The scene, behind your controls.
 *
 * Travel Mode shows one surface at a time, so without this the picture of the
 * place lives on the far side of a toggle from the question about it — and
 * the pane the question is asked in is mostly black. The same art the stage
 * draws (world/scene.ts picks the URL the same way), dimmed under the text
 * and the choices so both stay readable. In Party Mode it is a quiet echo of
 * the television, exactly like the narration line above the choices.
 *
 * Decoration: aria-hidden, no layout of its own, and the pane reads the same
 * with the image missing — `onError` just takes it away.
 */
function SceneBackdrop({ src }: { src: string }): ReactElement | null {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return null;
  return (
    <div className="player__scene" aria-hidden="true" data-testid="player-scene">
      <img
        className="player__scene-art"
        key={src}
        src={src}
        alt=""
        decoding="async"
        onError={() => setFailed(src)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function PlayerPanel({ roomControls }: { roomControls?: ReactNode } = {}): ReactElement {
  useEnsureContent();
  const state = useRunState();
  const me = useMe();
  const party = useParty();
  const myPrompt = usePrompt();
  const isMyPrompt = useIsMyPrompt();
  const items = useItems();
  const rules = useRules();
  const campaign = useCampaign();
  const send = useSend();

  // Nobody starts until everybody is in and ready — an empty party would
  // otherwise let one person start the chapter alone. A friend who stepped
  // away is not waited on (#258), the same rule the server holds Begin to.
  const everyoneReady = readyWithoutAway(party);
  const inLobby = state?.phase === "lobby" || state?.phase === "creation";
  // The chapter in play, for its art — fetched by id, idempotent, quiet on
  // failure (the pane just has no picture, which is what it had before).
  useEnsureChapter();
  const chapter = useChapter();
  // Which chapter comes next is the server's answer, not ours: where the party
  // got to and which road it took live on the household's campaign attempt.
  // Which *campaign* is the lobby's: the only one on offer, or the vote's pick
  // (lobbyCampaign — the same function the server holds the Begin tap to).
  const campaignChoice = state ? lobbyCampaign(state) : null;
  const campaignId = campaignChoice?.leader?.id ?? campaign?.id ?? null;
  const waitingOnVotes = campaignChoice?.contested ? campaignChoice.waitingOn : [];
  // Set when the household has not unlocked that campaign (#221): there is no
  // Begin for it, only the reason. The server refuses the start regardless.
  const campaignLocked = lockedLine(campaignChoice?.leader);
  // Present only for a graph campaign (#195); an ordered one never has it, and
  // every screen below takes its existing path when it is undefined.
  const graphJourney = campaignChoice?.leader?.journey;
  // The practice (#255): offered while anybody seated is new to the game, and
  // played by the whole table. Begin stays, as the skip.
  const newcomers = inLobby ? party.filter((member) => isNewcomer(member.character)) : [];
  // In the practice a banked point waits for a real rest (the server refuses it).
  const practicing = isPracticeCampaign(state?.campaignId);

  const [pendingChoice, setPendingChoice] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<string | null | undefined>(undefined);
  /**
   * The selected *item*, with the slot it was tapped in only to tell duplicates
   * apart. A bare index is not enough: the server rewrites the inventory under
   * us (a swap, a used potion, a granted item), and an index that survived that
   * would quietly point "Use it" at whatever slid into the slot.
   */
  const [selected, setSelected] = useState<{ itemId: string; index: number } | null>(null);
  /** The stat a banked point is aimed at, before the confirm bar (spec §11). */
  const [pendingStat, setPendingStat] = useState<StatId | null>(null);
  /**
   * What goes down to make room for an offer, when six slots are full — kept
   * *per offer* and separate from `pendingDrop`.
   *
   * Not the same state as the item-swap prompt's answer, though both name an
   * item to drop, because both can be open at once: a grant can fill the last
   * slot and raise the swap prompt while a friend's offer is still on screen.
   * One variable would let an answer to one question be confirmed against the
   * other. Keyed by trade id for the same reason at a smaller scale — two
   * offers arriving together would otherwise share one highlighted choice.
   */
  const [tradeDrop, setTradeDrop] = useState<{ tradeId: string; itemId: string } | null>(null);
  /**
   * Whose sheet is open, by character id — spec §6.1 lists "look at each
   * other's characters" beside healing and trading as a thing a Rest scene is
   * for, and it is not an intent at all: nothing is sent, nothing is decided,
   * so it is legal to read one whenever there is a phone to read it on.
   */
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const navigationRevision = usePlayerNavigation((navigation) => navigation.revision);
  const section = usePlayerNavigation((navigation) => navigation.section);
  useEffect(() => { setSheetFor(null); }, [navigationRevision]);
  const [busy, setBusy] = useState(false);
  /**
   * "Ready to play" was tapped and the READY is on its way. Held locally so
   * the ready page never flashes a second "I'm ready!" between the tap and
   * the server's answer — the first tap is the whole decision.
   */
  const [readyRequested, setReadyRequested] = useState(false);
  useEffect(() => {
    if (me?.ready) setReadyRequested(false);
  }, [me?.ready]);
  const isMyCombatTurn = useIsMyCombatTurn();
  // Someone else's check is a task too while you still have help to give.
  const canHelp =
    myPrompt === null &&
    state?.prompt?.kind === "roll" &&
    !state.prompt.group &&
    me !== null &&
    !me.down &&
    !state.prompt.helper &&
    !(state.helpSpent ?? []).includes(me.character.id);
  // A friend's find waiting on a phone that is gone (#258): anybody may leave it.
  const awaySwap =
    myPrompt === null && state?.prompt?.kind === "item_swap" && swapOwnerAway(party, state.prompt)
      ? nameOfCharacter(party, state.prompt.characterId)
      : null;
  // Who that help would go to, so the way in can say so.
  const helping = canHelp && state.prompt?.kind === "roll" ? nameOfCharacter(party, state.prompt.characterId) : null;
  // A class place (#311) asks every kid there, whoever holds the story turn.
  const atClassPlace = state?.phase === "scene" && state.classPlace !== undefined;
  // Until everyone there has answered, the way on waits, so its choices do too.
  const classPlaceWaiting = state ? classPlaceWaitingOn(state).length > 0 : false;
  const hasTask = myPrompt !== null || canHelp || awaySwap !== null || state?.encounter != null || inLobby || state?.phase === "chapter_complete" ||
    atClassPlace ||
    (state?.phase === "scene" && state.sceneType === "rest" && !practicing && (me?.character.unspentPoints ?? 0) > 0) ||
    (state?.trades ?? []).some((offer) => offer.toPlayerId === me?.playerId);
  useEffect(() => {
    if (!hasTask && section === "turn") setPlayerSection("bag");
  }, [hasTask, section]);

  /*
   * A new question opens the turn page by itself. The layout shells already
   * bring this pane forward on the same key; stopping on the bag with a
   * "Your turn" button to tap first was one tap too many on a phone, every
   * single turn. Keyed on the question, not a boolean, so back-to-back turns
   * each land here, and a vote ticking over on the current one does not drag
   * her off the bag she went back to on purpose. "creation" is no question.
   */
  const turnKey = useMyTurnKey();
  const previousTurnKey = useRef<string | null>(null);
  useEffect(() => {
    if (turnKey !== null && turnKey !== "creation" && turnKey !== previousTurnKey.current) {
      setPlayerSection("turn");
      setSheetFor(null);
    }
    previousTurnKey.current = turnKey;
  }, [turnKey]);

  const globalPrompt = state?.prompt ?? null;
  const key = promptKey(myPrompt ?? globalPrompt);

  // A new question always starts from a clean slate — no stale selection can
  // ever be confirmed against the wrong prompt.
  useEffect(() => {
    setPendingChoice(null);
    setPendingDrop(undefined);
    setPendingStat(null);
    setTradeDrop(null);
    setBusy(false);
  }, [key]);

  /*
   * Narration and roll prompts are spoken in NarrationPanel, the shared surface
   * (one voice per player in either mode). What is spoken here is only what
   * belongs to this phone: its own choices. A TV does not read them out, so in
   * Party Mode each phone with read-aloud on says its own player's options
   * without talking over the room's narration; a Travel Mode phone renders the
   * narration pane first, so its choices queue up behind the story.
   *
   * Said once per question (not per vote landing), and never interrupting.
   */
  const readAloud = useReadAloudOn();
  const choiceLine =
    myPrompt !== null && myPrompt.kind === "choice"
      ? myPrompt.options.map((option) => option.label).join(". ")
      : "";
  const spokenChoices = useRef<string | null>(null);
  useEffect(() => {
    if (!readAloud || choiceLine === "") {
      if (choiceLine === "") spokenChoices.current = null;
      return;
    }
    if (spokenChoices.current === choiceLine) return;
    spokenChoices.current = choiceLine;
    speak(choiceLine, { source: "choice" });
  }, [readAloud, choiceLine]);

  const dispatch = useCallback(
    async (intent: ClientIntent) => {
      setBusy(true);
      try {
        await send(intent);
      } finally {
        setBusy(false);
      }
    },
    [send],
  );

  // Pick the household's stopped chapter back up (#259). The room's own patch
  // carries the party and the scene in; a refusal shows in the toast.
  const resumeGame = useGameStore((store) => store.resumeGame);
  const keepGoing = useCallback(async () => {
    setBusy(true);
    try {
      await resumeGame();
    } finally {
      setBusy(false);
    }
  }, [resumeGame]);

  /*
   * A graph campaign's party takes a way on (#195): CHOOSE_EXIT, then - for a
   * way that leads somewhere to play - CONTINUE_CAMPAIGN, so one tap on "Down
   * to the orchard" is the whole of going there. Two idempotent intents rather
   * than a flag on one: each is already safe to repeat, and if the second is
   * refused (a "pass" arrival has nothing to play, or the connection dropped)
   * the party is simply standing at its next stop with the panel's own "Go to"
   * button, exactly where a returning session would find them.
   */
  const chooseExit = useCallback(
    async (exit: JourneyExitView, visit: number, campaignId: string) => {
      setBusy(true);
      try {
        const moved = await send({ type: "CHOOSE_EXIT", edgeId: exit.edge, visit, campaignId });
        if (moved && exit.arrival !== "pass") await send({ type: "CONTINUE_CAMPAIGN", campaignId });
      } finally {
        setBusy(false);
      }
    },
    [send],
  );

  const chosenOption = useMemo(() => {
    if (myPrompt === null || myPrompt.kind !== "choice" || pendingChoice === null) return null;
    return myPrompt.options.find((o) => o.id === pendingChoice) ?? null;
  }, [myPrompt, pendingChoice]);

  // The shared screen lights up the option this phone is hovering over, so the
  // table sees it coming before "Do it!". A vote already cast is not a
  // preview — it is on the record — so only a pick that differs from it shows.
  const unconfirmedChoice =
    chosenOption !== null &&
    !(myPrompt?.kind === "choice" && me !== null && myPrompt.votes?.[me.playerId] === chosenOption.id)
      ? chosenOption.id
      : null;
  useSharePreview(unconfirmedChoice === null ? null : { kind: "choice", choiceId: unconfirmedChoice });

  if (state === null || me === null) {
    return (
      <div className="player player--loading" role="status">
        <Spinner />
        <span>Finding your character…</span>
      </div>
    );
  }

  const myVote =
    myPrompt !== null && myPrompt.kind === "choice" ? myPrompt.votes?.[me.playerId] ?? null : null;

  /*
   * `encounter` is optional on RunState and genuinely arrives three ways: absent
   * on a run that has never had a fight (`createRunState` does not set it),
   * `null` once one has ended, and an object during one. `!== null` reads the
   * first of those as "a fight is happening", which hid "Use it" on every item
   * from the lobby until the party's first fight was over. Everywhere else in
   * the client already coalesces (`?? null`, `!state.encounter`); this is the
   * one place that did not, so it is derived once here.
   */
  const inEncounter = state.encounter != null;
  // Playing a chapter: the goal is up (#356). Not in the lobby, and not once it has ended.
  const inChapter = state.phase === "scene" || state.phase === "check" || state.phase === "encounter";

  /*
   * Where a banked point may be spent — the same two facts the server checks
   * before it will take the intent (`prepareStatPointSpend`), read off the
   * mirrored state rather than guessed at. A Rest scene is the *only* place:
   * spending mid-fight would change the numbers under an open turn order, and
   * spending mid-story would put a stat sheet in front of a question.
   */
  const atRest = state.phase === "scene" && state.sceneType === "rest";
  // The turn subpage gets the decision layout; the bag remains the You home.
  const deciding =
    !atRest &&
    (myPrompt !== null ||
      atClassPlace ||
      inEncounter ||
      inLobby ||
      state.phase === "chapter_complete");
  const showSheet = section === "bag" || !hasTask;
  /*
   * Which picture to stand the controls in: the scene's own illustration when
   * it has one, else the chapter's biome — the same choice the stage makes.
   * None in the lobby (EntryScene owns that), none before the chapter is
   * known. In a fight it stays, dimmed harder (`player--fighting`): the grid
   * carries its own dark panel for contrast, and the half-pane above it was
   * black otherwise.
   */
  const sceneArt = sceneArtFor(chapter, state);
  const backdrop =
    inLobby || chapter === null || chapter.id !== state.chapterId
      ? null
      : (sceneArt ? sceneBackdropUrl(sceneArt) : null) ?? biomeBackdropUrl(chapter.biome);
  const banked = practicing ? 0 : me.character.unspentPoints;
  /*
   * A party snapshot persisted before `spendableStats` existed has no list at
   * all — `getState` returns the stored JSON verbatim and a member is only
   * re-resolved when something touches it — so a run in flight across a deploy
   * arrives here shaped like the old code.
   *
   * Absent means *unknown*, not *none*, and the two have opposite consequences:
   * falling back to an empty list would tell a player who is owed a point that
   * every stat is maxed and quietly eat the spend, while falling back to all
   * four defers to the server, which validates the ceiling anyway and refuses
   * with a message. The only case the fallback can get wrong is a stat already
   * at +9, and it closes the moment anything re-resolves the member.
   */
  const spendable: readonly StatId[] = me.character.spendableStats ?? STAT_IDS;
  // A selection that no longer resolves is dropped rather than confirmed
  // against a stat the server would now refuse — the same rule the bag's
  // selection follows.
  const aimedStat = pendingStat !== null && spendable.includes(pendingStat) ? pendingStat : null;

  // Resolve the selection against the inventory as it is *now*. Same item in
  // the same slot: fine. Item shifted (something before it was removed): follow
  // it. Item gone: the selection quietly clears rather than adopting a stranger.
  const inventory = me.character.inventory;
  const selectedIndex = (() => {
    if (selected === null) return null;
    if (inventory[selected.index]?.itemId === selected.itemId) return selected.index;
    const moved = inventory.findIndex((entry) => entry.itemId === selected.itemId);
    return moved === -1 ? null : moved;
  })();
  const selectedEntry = selectedIndex === null ? null : inventory[selectedIndex] ?? null;
  const selectedDef = selectedEntry === null ? undefined : items?.[selectedEntry.itemId];

  /*
   * Trading, spec §9.4. `trades` is optional on RunState — a run persisted
   * before this existed comes back without the key — so it is coalesced once
   * here and every reader below works off an array.
   */
  const trades = state.trades ?? [];
  const offersToMe = trades.filter((offer) => offer.toPlayerId === me.playerId);
  const offersFromMe = trades.filter((offer) => offer.fromPlayerId === me.playerId);

  /** The lobby's one tap: say ready, and show who else is. */
  const readyToPlay = (): void => {
    setPlayerSection("turn");
    if (me.ready || offersToMe.length > 0) return;
    setReadyRequested(true);
    setBusy(true);
    void send({ type: "READY", ready: true })
      .then((accepted) => {
        if (!accepted) setReadyRequested(false);
      }, () => setReadyRequested(false))
      .finally(() => setBusy(false));
  };
  /*
   * Who this item can go to. A full bag is deliberately *not* a reason to
   * leave somebody out: §9.1 already has an answer for six full slots — "keep
   * it and drop one, or leave it" — and the receiver gives it on the accept,
   * in the same shape she already knows from finding something. Hiding the
   * name instead would teach a second, worse answer for a situation the game
   * has taught her once already.
   *
   * Somebody already holding this exact offer does drop out, because a second
   * identical offer is a duplicate the server refuses rather than a decision
   * anybody can make.
   *
   * Quest items need no exclusion here and cannot get one: they are slot-free
   * (§9.2), so they are never `InventoryEntry`s and never selectable in the
   * bag. The engine refuses them anyway, for the client that does not go
   * through this grid.
   *
   * Nor is a hero from another household (#249): a visitor's things go home
   * with them, so items only pass between heroes of one household, and the
   * server refuses the rest.
   */
  const homeFriends = party.filter((member) => member.playerId !== me.playerId && sameHome(member, me));
  const canReceive =
    selectedEntry === null
      ? []
      : homeFriends.filter(
          (member) =>
            !trades.some(
              (offer) =>
                offer.fromPlayerId === me.playerId &&
                offer.toPlayerId === member.playerId &&
                offer.itemId === selectedEntry.itemId,
            ),
        );
  /** Six full slots at the moment of the tap — §9.1's question, on the accept. */
  const myBagIsFull = inventory.length >= INVENTORY_SLOTS;

  /*
   * An open sheet takes the whole pane rather than sitting under the prompt.
   * It is reference material, not a decision — putting it beside the question
   * on a 40%-of-a-phone pane would push the answer off the bottom, which is the
   * layout mistake the shell's own header records having made once already.
   *
   * Nothing is dispatched from it, so nothing is lost by covering the prompt:
   * closing it puts the question back exactly as it was.
   */
  const openSheetFor =
    sheetFor === null ? null : party.find((m) => m.character.id === sheetFor) ?? null;
  if (openSheetFor !== null) {
    return (
      <section className="player player--sheet kad-scroll">
        <HelpClaim surface="sheet" />
        <CharacterSheet
          member={openSheetFor}
          isMe={openSheetFor.playerId === me.playerId}
          items={items}
          partySize={party.length}
        />
      </section>
    );
  }

  // Opened from the tray's Guide tab (layout/GuideTab.tsx) or the toast.
  const guideOpen = section === "guide";

  return (
    <>
    {guideOpen ? <FieldGuide /> : null}
    {/* `hidden`, not unmounted, while the guide is open: a half-made aim in a
        fight survives a look at the guide, like the bag. */}
    <section
      hidden={guideOpen}
      className={`player${deciding ? " player--deciding" : ""}${inLobby ? " entry-scene-host" : ""}${backdrop ? " player--scene" : ""}${backdrop && inEncounter ? " player--fighting" : ""}`}
    >
      {inLobby ? <EntryScene scene={lobbySceneFor(party)} /> : null}
      {backdrop ? <SceneBackdrop src={backdrop} /> : null}
      <IdentityStrip me={me} />
      {/* The chapter's goal (#356), on every phone with nothing to tap. Not in a fight: a playtest
          wanted the room for the cards, and the fight is the goal's step for now. */}
      {inChapter && !inEncounter ? <ChapterGoalCard place="phone" /> : null}

      {/*
        What the world is asking, echoed here.

        In Travel Mode the phone shows one surface at a time, so the question
        ("a wall of thorns twice your height…") and its answers would otherwise
        live on opposite sides of a toggle — and an 8-year-old would be flipping
        back and forth to work out what she is choosing between. In Party Mode
        it is a quiet reminder of the line the TV just read out.

        Note what this is *not*: it does not know the room mode. It shows the
        scene either way, and the shell decides whether that is a duplicate or
        the only copy on screen.
      */}
      {/* `hidden`, not unmounted: an aim half-made in a fight survives a look
          at the bag. */}
      <div className="player__prompt" hidden={showSheet}>
        {/* Inside the prompt's scroll box rather than above it, so that while
            deciding the words sit at the top and the answers sink to the
            bottom — read down, tap at the thumb — with the scene showing
            between them, and a long scene scrolls with its choices. */}
        {/* A check scene with no narration of its own is narrated by its
            prompt, and the roll card below already says it; twice is noise. */}
        {state.narration &&
        myPrompt !== null &&
        !(myPrompt.kind === "roll" && myPrompt.prompt === state.narration) ? (
          <p className="player__echo" aria-hidden="true">
            {state.narration}
          </p>
        ) : null}
        {/* A rank that just landed for this hero (#310), on the scene it
            landed on: the line, as a card with the token glowing on it (#314),
            in the line's own place so nothing moves under a thumb. */}
        {state.rankUps?.sceneId === state.sceneId
          ? state.rankUps.ups
              .filter((up) => up.characterId === me.character.id)
              .map((up) => (
                // The plain line while the card loads, and instead of it if it cannot (#329).
                <ChunkBoundary key={up.rank} quiet fallback={<RankUpLine up={up} />}>
                  <Suspense fallback={<RankUpLine up={up} />}>
                    <RankUpCard up={up} />
                  </Suspense>
                </ChunkBoundary>
              ))
          : null}
        {/* The practice's hint (#255), where the tapping happens, with its own
            "read it to me" button: the shared screen says it once, and a kid
            who missed it should not need a grown-up to say it again. */}
        {state.hint ? (
          <p className="player__hint" data-testid="player-hint">
            <Icon name="star" />
            <span>{state.hint}</span>
            <button
              type="button"
              className="choice__hear kad-tap kad-focusable"
              aria-label="Hear the hint"
              onClick={() => hear(state.hint ?? "", { source: "ui" })}
            >
              <Icon name="sound" size="1.5em" />
            </button>
          </p>
        ) : null}

        {/* ---------------- combat (spec §7.2) ----------------
            Renders itself only while `state.encounter` exists, and owns the
            slot when it does: there is never an open Prompt during a fight
            (the pre-fight ready-up runs before the board goes up), so nothing
            below competes with it. */}
        <CombatControls />

        {/* ---------------- growing up (spec §8.1) ----------------
            Above the Rest scene's own choices on purpose: tapping one of those
            leaves the scene, and the point would then wait until the next Rest
            — which may be a different evening. The reward beat goes first. */}
        {atRest && banked > 0 ? (
          <div className="prompt grow">
            <h3 className="prompt__title">
              <Icon name="levelup" />
              <span>
                {banked === 1 ? "You have a point to spend!" : `You have ${String(banked)} points to spend!`}
              </span>
            </h3>

            {spendable.length === 0 ? (
              /* Points in hand and nowhere to put them — a real state at the
                 top of the ladder, and one that has to say so rather than
                 render four buttons the server would refuse. */
              <p className="prompt__sub kad-muted">
                <Icon name="star" />
                <span>Every one of your stats is as strong as it can get. Nothing left to grow!</span>
              </p>
            ) : (
              <>
                <p className="prompt__sub kad-muted">
                  <Icon name="rest" />
                  <span>Resting is when you grow. What gets stronger?</span>
                </p>

                <ul className="prompt__options">
                  {spendable.map((stat) => {
                    const isAimed = aimedStat === stat;
                    return (
                      <li key={stat}>
                        <button
                          type="button"
                          className={`choice kad-tap kad-focusable${isAimed ? " choice--on" : ""}`}
                          aria-pressed={isAimed}
                          onClick={() => setPendingStat(stat)}
                        >
                          <span className="choice__icon">
                            <Icon name={stat} size="1.8em" />
                          </span>
                          <span className="choice__label grow__label">{stat}</span>
                          {/* The arithmetic, spelled out. She is eight: "3 → 4"
                              is the whole reason to pick this one. */}
                          <span className="choice__trail grow__math">
                            <b>{me.character.stats[stat]}</b>
                            <Icon name="forward" />
                            <b className="grow__after">{me.character.stats[stat] + 1}</b>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <ConfirmBar
                  open={aimedStat !== null}
                  icon={aimedStat ?? "levelup"}
                  what={
                    aimedStat === null ? null : (
                      <span className="grow__label">
                        {aimedStat} {me.character.stats[aimedStat]} → {me.character.stats[aimedStat] + 1}
                      </span>
                    )
                  }
                >
                  <Button
                    variant="ghost"
                    size="md"
                    icon={<Icon name="back" />}
                    onClick={() => setPendingStat(null)}
                  >
                    Change
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    icon={<Icon name="check" />}
                    disabled={busy}
                    onClick={() => {
                      if (aimedStat === null) return;
                      setPendingStat(null);
                      void dispatch({ type: "SPEND_STAT_POINT", stat: aimedStat });
                    }}
                  >
                    {busy ? "Growing…" : "Grow!"}
                  </Button>
                </ConfirmBar>
              </>
            )}
          </div>
        ) : null}

        {/* ---------------- a class place (#311) ----------------
            Each kid's own answer, above the way on, which waits for it. */}
        <ClassPlaceChoice />

        {/* ---------------- choice / vote (spec §6.1) ---------------- */}
        {myPrompt !== null && myPrompt.kind === "choice" && !classPlaceWaiting ? (
          <div className="prompt">
            <h3 className="prompt__title">
              <Icon name={myPrompt.vote ? "vote" : "hand"} />
              <span>
                {myPrompt.vote
                  ? "Everyone votes"
                  : "What do you do?"}
              </span>
            </h3>

            <ul className="prompt__options">
              {myPrompt.options.map((option) => {
                // Everyone with a say, so every option draws the same seats.
                const voterIds =
                  myPrompt.forPlayerIds.length > 0 ? myPrompt.forPlayerIds : party.map((m) => m.playerId);
                const votedIds = Object.entries(myPrompt.votes ?? {})
                  .filter(([, choiceId]) => choiceId === option.id)
                  .map(([playerId]) => playerId);
                const selected = pendingChoice === option.id || myVote === option.id;
                return (
                  <li key={option.id} className={readAloud ? "prompt__option--hear" : undefined}>
                    <button
                      type="button"
                      className={`choice kad-tap kad-focusable${selected ? " choice--on" : ""}`}
                      aria-pressed={selected}
                      onClick={() => setPendingChoice(option.id)}
                    >
                      <span className="choice__icon">
                        <Icon name={option.icon} size="1.8em" />
                      </span>
                      <span className="choice__label">{option.label}</span>
                      <span className="choice__trail">
                        {/* The seats are always here; only the check and the
                            ticks come and go, so somebody else voting cannot
                            rewrap the label you are reading. */}
                        <span className="choice__mark">
                          {myVote === option.id ? <Icon name="check" label="Your vote" /> : null}
                        </span>
                        {myPrompt.vote ? (
                          <VoteTicks voterIds={voterIds} votedIds={votedIds} party={party} />
                        ) : null}
                      </span>
                    </button>
                    {/* Hear it before picking it: a separate target, so tapping the
                        card still only chooses (spec §11: icon, big target). */}
                    {readAloud ? (
                      <button
                        type="button"
                        className="choice__hear kad-tap kad-focusable"
                        aria-label={`Hear: ${option.label}`}
                        onClick={() => hear(option.label, { source: "choice" })}
                      >
                        <Icon name="sound" size="1.5em" />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {/* Everyone who has not voted stepped away (#258). A vote only
                counts when one lands, so this phone's own vote, sent again,
                closes it. Only for a phone that has voted: its pick stands. */}
            {myPrompt.vote && myVote !== null && voteWaitsOnlyOnAway(party, myPrompt) ? (
              <Button
                variant="secondary"
                size="md"
                block
                icon={<Icon name="forward" />}
                disabled={busy}
                onClick={() => void dispatch({ type: "CHOOSE", choiceId: myVote })}
              >
                {`Decide without ${awayNames(
                  party.filter(
                    (m) =>
                      myPrompt.votes?.[m.playerId] === undefined &&
                      (myPrompt.forPlayerIds.length === 0 || myPrompt.forPlayerIds.includes(m.playerId)),
                  ),
                )}`}
              </Button>
            ) : null}

            {/* Nothing is final until this bar is tapped (spec §11). */}
            <ConfirmBar
              open={chosenOption !== null}
              icon={chosenOption?.icon ?? "check"}
              what={chosenOption?.label}
            >
              <Button
                variant="ghost"
                size="md"
                icon={<Icon name="back" />}
                onClick={() => setPendingChoice(null)}
              >
                Change
              </Button>
              <Button
                variant="primary"
                size="md"
                icon={<Icon name="check" />}
                disabled={busy}
                onClick={() => {
                  if (chosenOption !== null) void dispatch({ type: "CHOOSE", choiceId: chosenOption.id });
                }}
              >
                {busy ? "Sending…" : "Do it!"}
              </Button>
            </ConfirmBar>
          </div>
        ) : null}

        {/* ---------------- roll (spec §4.1) ---------------- */}
        {myPrompt !== null && myPrompt.kind === "roll" ? (
          <div className="prompt">
            <h3 className="prompt__title">
              <Icon name="d20" />
              <span>{myPrompt.prompt}</span>
            </h3>
            <p className="prompt__sub kad-muted">
              <Icon name={myPrompt.stat} />
              <span className="prompt__stat">{myPrompt.stat}</span>
              <span aria-hidden="true">·</span>
              <span>{checkTarget(myPrompt.tn)}</span>
            </p>
            {myPrompt.group ? (
              <p className="prompt__sub" role="status">
                <Icon name="players" />
                <span>{`Everyone rolls! Half or more need to make it. ${String(myPrompt.group.rolls.length)} rolled so far.`}</span>
              </p>
            ) : null}
            {/* A friend can chip in while you are reading this (spec §4.1),
                so the line has its seat from the start: arriving, it would
                lift the whole bottom-anchored card, Roll! and all. A group
                check takes no help, and nor does a party of one, so neither
                gets a seat. */}
            {myPrompt.group || party.length < 2 ? null : (
              <p
                className={`prompt__sub prompt__helper${myPrompt.helper ? "" : " prompt__helper--empty"}`}
                role="status"
              >
                <Icon name="players" />
                <span>{helperLine(myPrompt, party, me.character.id) ?? "\u00a0"}</span>
              </p>
            )}
            {/* The party's story-check buff (#222). Spent anyway, it is just
                said; offered, the roller decides: spend it on this roll, or
                save it for a harder one. Either way the die goes with the tap. */}
            {myPrompt.buff ? (
              <p className="prompt__sub prompt__buff" role="status">
                <Icon name="star" />
                <span>{checkBuffLine(myPrompt.buff)}</span>
              </p>
            ) : null}
            {myPrompt.buff?.spend === "choose" ? (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  icon={<Icon name="star" />}
                  disabled={busy}
                  onClick={() => void dispatch({ type: "ROLL", spendBuff: myPrompt.buff?.id })}
                >
                  {busy ? "Rolling…" : "Use it and roll!"}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  icon={<Icon name="d20" />}
                  disabled={busy}
                  onClick={() => void dispatch({ type: "ROLL" })}
                >
                  {busy ? "Rolling…" : "Save it and roll"}
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                size="lg"
                icon={<Icon name="d20" />}
                disabled={busy}
                onClick={() => void dispatch({ type: "ROLL" })}
              >
                {busy ? "Rolling…" : "Roll!"}
              </Button>
            )}
          </div>
        ) : null}

        {/* ---------------- item swap (spec §9.1) ---------------- */}
        {myPrompt !== null && myPrompt.kind === "item_swap" ? (
          <div className="prompt">
            <h3 className="prompt__title">
              <Icon name={items?.[myPrompt.incomingItemId]?.icon ?? "bag"} />
              <span>You found {items?.[myPrompt.incomingItemId]?.name ?? "something"}!</span>
            </h3>
            <p className="prompt__sub kad-muted">
              {items?.[myPrompt.incomingItemId]?.text ?? "Your bag is full. Keep it, or leave it?"}
            </p>

            <ul className="prompt__options">
              {me.character.inventory.map((entry) => {
                const def = items?.[entry.itemId];
                const selected = pendingDrop === entry.itemId;
                return (
                  <li key={entry.itemId}>
                    <button
                      type="button"
                      className={`choice kad-tap kad-focusable${selected ? " choice--on" : ""}`}
                      aria-pressed={selected}
                      onClick={() => setPendingDrop(entry.itemId)}
                    >
                      <span className="choice__icon">
                        <Icon name={def?.icon ?? entry.kind} size="1.8em" />
                      </span>
                      <span className="choice__label">Drop {def?.name ?? entry.itemId}</span>
                    </button>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  className={`choice kad-tap kad-focusable${pendingDrop === null ? " choice--on" : ""}`}
                  aria-pressed={pendingDrop === null}
                  onClick={() => setPendingDrop(null)}
                >
                  <span className="choice__icon">
                    <Icon name="close" size="1.8em" />
                  </span>
                  <span className="choice__label">Leave it behind</span>
                </button>
              </li>
            </ul>

            {/* `undefined` is "not decided yet"; `null` is a real answer. */}
            <ConfirmBar
              open={pendingDrop !== undefined}
              icon={pendingDrop === null ? "close" : "bag"}
              what={
                pendingDrop === null
                  ? "Leave it behind"
                  : pendingDrop === undefined
                    ? null
                    : `Drop ${items?.[pendingDrop]?.name ?? pendingDrop}`
              }
            >
              <Button
                variant="ghost"
                size="md"
                icon={<Icon name="back" />}
                onClick={() => setPendingDrop(undefined)}
              >
                Change
              </Button>
              <Button
                variant="primary"
                size="md"
                icon={<Icon name="check" />}
                disabled={busy}
                onClick={() => {
                  if (pendingDrop !== undefined) {
                    void dispatch({ type: "RESOLVE_ITEM_SWAP", dropItemId: pendingDrop });
                  }
                }}
              >
                {busy ? "Sending…" : "Yes, do that"}
              </Button>
            </ConfirmBar>
          </div>
        ) : null}

        {/* ---------------- somebody is handing you something (spec §9.4) ----------------
            Not guarded on `atRest`: the engine clears every offer on scene
            entry, so an offer being here at all is the server saying the party
            is resting. Guarding it again would be a second copy of a rule that
            already has one home.

            The two-tap rule (spec §11) is spread across two phones here rather
            than two taps on one. Their offer is the selection — nothing has
            left their bag — and this is the confirm.

            Below the scene's own question, not above it: a friend's offer
            lands whenever they tap, and above the choices it pushed the
            answers you were reading down the pane. */}
        {offersToMe.length > 0 ? (
          <div className="prompt">
            <h3 className="prompt__title">
              <Icon name="bag" />
              <span>{offersToMe.length === 1 ? "A present!" : "Presents!"}</span>
            </h3>
            <ul className="prompt__options">
              {offersToMe.map((offer) => {
                const def = items?.[offer.itemId];
                const giver = nameOfPlayer(party, offer.fromPlayerId);
                /*
                 * Resolved against the bag as it is *now*, the same rule the
                 * bag's own selection follows: the server rewrites inventories
                 * underneath an open card, and a drop choice that outlived the
                 * item it named would send the server an id she is no longer
                 * carrying.
                 *
                 * `myBagIsFull` is part of the test for the same reason: she
                 * can pick what to put down and *then* free a slot by drinking
                 * something. A drop sent once there is room would destroy that
                 * item for nothing — the server refuses it, and the panel
                 * should never have offered it.
                 */
                const chosenDrop =
                  myBagIsFull &&
                  tradeDrop?.tradeId === offer.id &&
                  inventory.some((entry) => entry.itemId === tradeDrop.itemId)
                    ? tradeDrop.itemId
                    : null;
                return (
                  <li className="trade" key={offer.id}>
                    <p className="trade__what">
                      <Icon name={def?.icon ?? "bag"} size="1.8em" />
                      <span>
                        <b>{giver}</b> wants to give you {def?.name ?? offer.itemId}
                      </span>
                    </p>
                    {def?.text ? <p className="trade__text kad-muted">{def.text}</p> : null}

                    {/*
                      Six full slots is §9.1's question — "keep it and drop one,
                      or leave it" — and it is answered here rather than by a
                      separate swap prompt, so the whole hand-off stays one
                      event and the item is never in limbo between two taps.

                      Deliberately the same shape as the item_swap prompt above:
                      pick what goes down, then confirm. She has met this screen
                      before, when her bag was full and she found something.
                    */}
                    {myBagIsFull ? (
                      <>
                        <p className="trade__text kad-muted">
                          Your bag is full. What should you put down?
                        </p>
                        <ul className="prompt__options">
                          {inventory.map((entry, index) => {
                            const held = items?.[entry.itemId];
                            const chosen = chosenDrop === entry.itemId;
                            return (
                              <li key={`${entry.itemId}-${String(index)}`}>
                                <button
                                  type="button"
                                  className={`choice kad-tap kad-focusable${chosen ? " choice--on" : ""}`}
                                  aria-pressed={chosen}
                                  onClick={() =>
                                    setTradeDrop({ tradeId: offer.id, itemId: entry.itemId })
                                  }
                                >
                                  <span className="choice__icon">
                                    <Icon name={held?.icon ?? entry.kind} size="1.8em" />
                                  </span>
                                  <span className="choice__label">
                                    Put down {held?.name ?? entry.itemId}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    ) : null}

                    <div className="confirm__actions">
                      <Button
                        variant="ghost"
                        size="md"
                        icon={<Icon name="close" />}
                        disabled={busy}
                        onClick={() =>
                          void dispatch({ type: "RESOLVE_TRADE", tradeId: offer.id, accept: false })
                        }
                      >
                        No thanks
                      </Button>
                      {/* Hidden until she has said what goes down, rather than
                          shown and refused — the panel's rule everywhere else. */}
                      {myBagIsFull && chosenDrop === null ? null : (
                        <Button
                          variant="primary"
                          size="md"
                          icon={<Icon name="check" />}
                          disabled={busy}
                          onClick={() => {
                            setTradeDrop(null);
                            void dispatch({
                              type: "RESOLVE_TRADE",
                              tradeId: offer.id,
                              accept: true,
                              ...(chosenDrop === null ? {} : { dropItemId: chosenDrop }),
                            });
                          }}
                        >
                          Yes please!
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* ---------------- ready (lobby, rest, chapter end) ---------------- */}
        {/* "creation" is a run-level phase the engine sets on the first
            CREATE_CHARACTER and never clears — being made is a fact about a
            player, not about the room. Anyone who already has a character is
            waiting in the lobby, whatever the run calls the phase. */}
        {(myPrompt !== null && myPrompt.kind === "ready") || inLobby ? (
          <div className="prompt">
            {/* Outside the lobby the only ready-up is the pause before a
                fight (engine.ts), so it says so: a bare "Ready when you are"
                read as one more mystery button. */}
            <h3 className="prompt__title">
              <Icon name={inLobby ? "ready" : "swords"} />
              <span>
                {inLobby
                  ? me.ready || readyRequested ? "You're ready to play" : "Ready to play?"
                  : me.ready ? "You're ready to fight" : "A fight is starting!"}
              </span>
            </h3>
            <p className="prompt__sub kad-muted">
              {inLobby
                ? "The adventure starts when everyone is ready."
                : "Tap when you're ready. The fight starts when everyone is."}
            </p>
            {/* In the lobby, "Ready to play" on the bag page already said yes,
                so this page only offers the way back out — standing there,
                disabled, while that first tap is still on its way, rather than
                arriving with the server's answer. Before a fight the button is
                still the whole answer. Both are the big size, so the swap
                happens in one seat and the chips below stay put. */}
            {me.ready || (inLobby && readyRequested) ? (
              <Button
                variant="secondary"
                size="lg"
                icon={<Icon name="back" />}
                disabled={busy || !me.ready}
                onClick={() => {
                  void dispatch({ type: "READY", ready: false });
                  if (inLobby) setPlayerSection("bag");
                }}
              >
                Wait, not yet
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                icon={<Icon name="ready" />}
                disabled={busy}
                onClick={() => void dispatch({ type: "READY", ready: true })}
              >
                {inLobby ? "I'm ready!" : "I'm ready to fight!"}
              </Button>
            )}
            <ul className="prompt__party">
              {party.map((member) => {
                // Stepped away (#258): not waited on, so not "waiting" either.
                const gone = !member.ready && !member.connected;
                return (
                  <li
                    className={`kad-chip${member.ready ? " kad-chip--ok" : gone ? " kad-chip--warn" : ""}`}
                    key={member.playerId}
                  >
                    <Icon name={member.ready ? "check" : gone ? "close" : "waiting"} />
                    <span>{gone ? `${member.character.name} stepped away` : member.character.name}</span>
                  </li>
                );
              })}
            </ul>

            {/* The fight waits on everyone here, and only somebody's READY
                counts it (engine.ts doReady). A friend who drops after the
                rest said yes leaves nobody to tap, so a ready phone says it
                again for the table (#258). */}
            {!inLobby && me.ready && readyWithoutAway(party) && party.some((m) => !m.ready) ? (
              <Button
                variant="primary"
                size="lg"
                icon={<Icon name="swords" />}
                disabled={busy}
                onClick={() => void dispatch({ type: "READY", ready: true })}
              >
                {`Start without ${awayNames(party.filter((m) => !m.ready))}`}
              </Button>
            ) : null}

            {/* Somebody has to say go. It appears only once the whole party is
                ready, so it can't be tapped out from under anyone, and the
                chapter it starts is the campaign's next one, which the server
                works out from where this household got to. */}
            {/* Which adventure — a card each, with its painting, when there is
                more than one on offer. A locked sequel is shown asleep with its
                reason, never tappable; only two or more that could start make
                a vote, and with one the card just marks what Begin plays. */}
            {inLobby && (state.campaignOptions?.length ?? 0) > 1 ? (
              <div className="player__campaigns">
                <h4 className="prompt__title">
                  <Icon name="vote" />
                  <span>Which adventure?</span>
                </h4>
                <ul className="prompt__options">
                  {(state.campaignOptions ?? []).map((option) => {
                    const myCampaignVote = state.campaignVotes?.[me.playerId];
                    const votedIds = party
                      .filter((member) => state.campaignVotes?.[member.playerId] === option.id)
                      .map((member) => member.playerId);
                    const locked = option.locked !== undefined;
                    const selected = campaignChoice?.contested
                      ? myCampaignVote === option.id
                      : !locked && option.id === campaignChoice?.leader?.id;
                    return (
                      <li key={option.id}>
                        <button
                          type="button"
                          className={`choice choice--campaign kad-tap kad-focusable${selected ? " choice--on" : ""}`}
                          data-locked={locked}
                          aria-pressed={selected}
                          disabled={busy || locked}
                          onClick={() => void dispatch({ type: "VOTE_CAMPAIGN", campaignId: option.id })}
                        >
                          <span className="choice__art">
                            <CampaignArt campaignId={option.id} />
                          </span>
                          <span className="choice__label">
                            {locked ? <><Icon name="close" label="Locked" />{" "}</> : null}
                            <b>{option.title}</b>
                            <br />
                            <small>{campaignOptionLine(option)}</small>
                            {option.blurb ? <small className="choice__blurb">{option.blurb}</small> : null}
                          </span>
                          <span className="choice__trail">
                            <span className="choice__mark">
                              {myCampaignVote === option.id ? <Icon name="check" label="Your vote" /> : null}
                            </span>
                            {campaignChoice?.contested && !locked ? (
                              <VoteTicks
                                voterIds={party.map((member) => member.playerId)}
                                votedIds={votedIds}
                                party={party}
                              />
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {inLobby && !graphJourney && !campaignLocked && nextChapterLine(state.campaign) !== null ? (
              <p className="player__next-chapter">
                <Icon name="map" />
                <span>
                  {campaignChoice?.contested ? `${state.campaign?.title ?? ""}: ` : ""}
                  {nextChapterLine(state.campaign)}
                </span>
              </p>
            ) : null}
            {/* A chapter this household stopped partway (#259): anyone may take
                it back up, and it needs nobody to be ready first. Begin below
                still starts the next chapter fresh. */}
            {inLobby && state.saved ? (
              <div className="player__saved">
                <p className="player__next-chapter">
                  <Icon name="scroll" />
                  <span>
                    {savedHeading(state.saved)} {state.saved.recap}
                  </span>
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  icon={<Icon name="forward" />}
                  disabled={busy}
                  aria-label={`Keep going with ${savedHeroes(state.saved)}`}
                  onClick={() => void keepGoing()}
                >
                  Keep going
                </Button>
              </div>
            ) : null}
            {/* One seat, held from the start, for whatever "go" looks like
                right now: nothing, who the vote is waiting on, or Begin. They
                change as other people tap, and appended they pushed the whole
                card up under whoever was about to vote. */}
            {inLobby && everyoneReady && newcomers.length > 0 ? (
              <div className="player__practice">
                <p className="player__next-chapter">
                  <Icon name="star" />
                  <span>{practiceOfferLine(newcomers.map((member) => member.character.name))}</span>
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  icon={<Icon name="star" />}
                  disabled={busy}
                  onClick={() => void dispatch({ type: "START_PRACTICE" })}
                >
                  Play the practice
                </Button>
              </div>
            ) : null}
            {inLobby ? (
              <div className="player__start">
                {everyoneReady && waitingOnVotes.length > 0 ? (
                  <p className="player__next-chapter player__start-wait">
                    <Icon name="waiting" />
                    <span>
                      Waiting for {waitingOnVotes.map((member) => member.character.name).join(", ")} to
                      pick an adventure
                    </span>
                  </p>
                ) : campaignLocked ? (
                  <p className="player__next-chapter player__start-wait">
                    <Icon name="close" />
                    <span>
                      {campaignChoice?.leader?.title}: {campaignLocked}
                    </span>
                  </p>
                ) : everyoneReady && campaignId !== null && graphJourney ? (
                  /* A graph campaign has a map, not a next chapter: the party
                     picks where to go (JourneyPanel, #195). An ordered one
                     takes the Begin button below, exactly as before. */
                  <JourneyPanel
                    journey={graphJourney}
                    ended={campaignChoice?.leader?.ended}
                    busy={busy}
                    onChoose={(exit) => chooseExit(exit, graphJourney.visit, campaignId)}
                    onContinue={() => dispatch({ type: "CONTINUE_CAMPAIGN", campaignId })}
                    // A rift action (#197) is one idempotent intent; the
                    // party stays put and the panel redraws from the patch.
                    onAction={(action) =>
                      dispatch({
                        type: "RIFT_ACTION",
                        action: action.action,
                        edgeId: action.edge,
                        visit: graphJourney.visit,
                        campaignId,
                        ...(action.to !== undefined ? { to: action.to } : {}),
                        ...(action.way !== undefined ? { way: action.way } : {}),
                      })
                    }
                    // Whose ways the table can take (#199): the heroes seated
                    // now, judged as the server judges them.
                    party={riftPartyOf(state.party.map((member) => member.character))}
                    itemName={(id) => items?.[id]?.name}
                  />
                ) : everyoneReady && campaignId !== null ? (
                  <Button
                    variant={newcomers.length > 0 ? "secondary" : "primary"}
                    size="lg"
                    icon={<Icon name="forward" />}
                    disabled={busy}
                    onClick={() => void dispatch({ type: "CONTINUE_CAMPAIGN", campaignId })}
                  >
                    {newcomers.length > 0 ? skipPracticeLabel(state.campaign) : beginLabel(state.campaign)}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ---------------- chapter finished ---------------- */}
        {state.phase === "chapter_complete" && myPrompt === null ? (
          <div className="prompt">
            {/* The same ending the WorldView is showing (spec §8.2). Absent
                means success, matching the engine's own default — a run
                persisted before the field existed must not read as a setback
                on the strength of a missing key. */}
            <h3 className="prompt__title">
              <Icon
                name={
                  state.campaign?.ended === "complete"
                    ? "crown"
                    : state.chapterOutcome === "setback" || state.campaign?.ended === "failed"
                      ? "scroll"
                      : "trophy"
                }
              />
              <span>
                {campaignEndHeading(state.campaign) ??
                  (state.chapterOutcome === "setback" ? "The story took a turn" : "Chapter finished!")}
              </span>
            </h3>
            {campaignEndLine(state.campaign) !== null ? (
              <p className="player__campaign-end">{campaignEndLine(state.campaign)}</p>
            ) : null}
            {/*
             * The one moment the keepsake offer earns its place (roadmap open
             * item 5): the characters they just played are on screen, the
             * sitting is over, and nobody is mid-decision. Offering it at the
             * start would undo the point of anonymous play.
             *
             * It sits *above* "Back to the lobby" but is not in the way of it —
             * the lobby button is still the primary action and still one tap.
             */}
            <KeepsakeOffer />
            {/*
             * A vote, like the ready-up before a fight: one phone's tap used
             * to take every phone off this screen, mid-read. The table goes
             * back together once everyone has said they're done (engine.ts
             * doReady), and anyone who tapped early can take it back.
             */}
            {me.ready ? (
              <Button
                variant="secondary"
                size="lg"
                icon={<Icon name="back" />}
                disabled={busy}
                onClick={() => void dispatch({ type: "READY", ready: false })}
              >
                Wait, I'm still looking
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                icon={<Icon name="forward" />}
                disabled={busy}
                onClick={() => void dispatch({ type: "READY", ready: true })}
              >
                Back to the lobby
              </Button>
            )}
            {party.length > 1 ? (
              <>
                <p className="prompt__sub kad-muted">
                  {me.ready
                    ? "Everyone goes back when everyone's done."
                    : "Take your time. Everyone goes back together."}
                </p>
                <ul className="prompt__party">
                  {party.map((member) => (
                    <li className={`kad-chip${member.ready ? " kad-chip--ok" : ""}`} key={member.playerId}>
                      <Icon name={member.ready ? "check" : "waiting"} />
                      <span>{member.character.name}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}

        {/* ---------------- someone else's turn ---------------- */}
        {myPrompt === null && !isMyPrompt && globalPrompt !== null ? (
          <p className="player__waiting" role="status">
            <Icon name="waiting" />
            <span>{waitingLine(globalPrompt, party)}</span>
          </p>
        ) : null}

        {/* A friend's full bag found something, and their phone is gone
            (#258). The story waits behind the question, so anybody here may
            leave it; nobody empties a friend's bag for them. */}
        {myPrompt === null && globalPrompt !== null && globalPrompt.kind === "item_swap" && swapOwnerAway(party, globalPrompt) ? (
          <div className="prompt prompt--help">
            <p className="prompt__sub kad-muted">
              <Icon name="bag" />
              <span>{`${nameOfCharacter(party, globalPrompt.characterId)} stepped away, and their bag is full.`}</span>
            </p>
            <Button
              variant="secondary"
              size="lg"
              icon={<Icon name="forward" />}
              disabled={busy}
              onClick={() => void dispatch({ type: "RESOLVE_ITEM_SWAP", dropItemId: null })}
            >
              Leave it and go on
            </Button>
          </div>
        ) : null}

        {/* ---------------- help a friend's check ----------------
            Held at the big button's height whichever line is showing, so
            helping — yours or somebody quicker's — does not shrink the card. */}
        {myPrompt === null && !isMyPrompt && globalPrompt !== null && globalPrompt.kind === "roll" && !globalPrompt.group && me && !me.down ? (
          <div className="prompt prompt--help">
            {globalPrompt.helper ? (
              <p className="prompt__sub" role="status">
                <Icon name="players" />
                <span>{helperLine(globalPrompt, party, me.character.id)}</span>
              </p>
            ) : (state.helpSpent ?? []).includes(me.character.id) ? (
              <p className="prompt__sub kad-muted">
                <Icon name="players" />
                <span>You have helped once already. Rest to help again.</span>
              </p>
            ) : (
              <Button
                variant="secondary"
                size="lg"
                icon={<Icon name="players" />}
                disabled={busy}
                onClick={() => void dispatch({ type: "HELP" })}
              >
                {`Help ${nameOfCharacter(party, globalPrompt.characterId)}: +d${String(helpSides(rules, me))}`}
              </Button>
            )}
          </div>
        ) : null}

        {myPrompt === null && globalPrompt === null && !state.encounter && state.phase !== "lobby" && state.phase !== "chapter_complete" ? (
          <p className="player__waiting" role="status">
            <Icon name="waiting" />
            <span>Listen to the story…</span>
          </p>
        ) : null}
      </div>

      <div className="player__scroll kad-scroll" hidden={!showSheet}>
        {/* One seat at the top of the bag, the big button's height, for
            either the way into your task or what the table is waiting on.
            Both change as other people act; sharing a fixed seat, neither
            moves the bag under a finger that is in the middle of it. */}
        {inLobby ? null : (
          <div className="player__task-slot">
            {hasTask ? (
              <Button variant="primary" size="lg" block className="player__task-entry"
                icon={<Icon name="hand" />} onClick={() => setPlayerSection("turn")}>
                {offersToMe.length > 0 ? "A gift for you" : state.phase === "chapter_complete" ? "Chapter rewards" : atRest && banked > 0 ? banked === 1 ? "Spend your stat point" : "Spend your stat points" : myPrompt !== null || isMyCombatTurn ? "Your turn" : helping !== null ? `Help ${helping}` : awaySwap !== null ? `Help ${awaySwap}'s bag` : "View the fight"}
              </Button>
            ) : (
              <p className="player__waiting" role="status"><Icon name="waiting" />
                <span>{globalPrompt !== null ? waitingLine(globalPrompt, party) : "Listen to the story…"}</span>
              </p>
            )}
          </div>
        )}
        {/*
          Every section below folds under its heading (ui/Collapsible), and
          each phone remembers how its kid left them: the page had grown long
          enough that the bag was a scroll away (playtest). The stats, the
          party and the bag start open; the token card, the longest thing a kid
          rarely needs mid-scene, starts folded to its name.
        */}
        <Collapsible id="stats" className="player__stats" title={<><Icon name="levelup" /><span>Your stats</span></>}>
          <StatRow me={me} />
        </Collapsible>
        {/* The worn token, its notches and the deed toward the next (#314). */}
        <Collapsible
          id="token"
          defaultOpen={false}
          className="player__token"
          title={<><TokenGlyph classId={me.character.class} /><span>Your {tokenName(me.character.class)}</span></>}
        >
          <TokenCard character={me.character} isMe rules={rules} partySize={party.length} named={false} />
        </Collapsible>

        {/*
          spec §6.1 lists "look at each other's characters" as one of the four
          things a Rest scene is for, beside healing, spending a level-up and
          trading. Not gated to a Rest scene though: reading a sheet sends
          nothing and decides nothing, so there is no rule to enforce, and
          "what is her Guard?" is a question a fight raises more often than a
          camp does.
        */}
        <Collapsible id="party" className="party-strip" title={<><Icon name="party" /><span>Everyone</span></>}>
          <ul className="party-strip__list">
            {party.map((member) => (
              <li key={member.playerId}>
                <button
                  type="button"
                  className="party-strip__button kad-tap kad-focusable"
                  aria-label={`${member.character.name}'s character sheet`}
                  onClick={() => setSheetFor(member.character.id)}
                >
                  <span className="party-strip__portrait" aria-hidden="true">
                    <CharacterPortrait
                      backdrop
                      species={member.character.species}
                      accent={member.character.appearance.accent}
                      characterClass={member.character.class}
                      tier={member.character.tier}
                      className="party-strip__art"
                    />
                  </span>
                  <span className="party-strip__name">
                    {member.playerId === me.playerId ? "You" : member.character.name}
                  </span>
                  {/* A souvenir is permanent and worth advertising (spec §8.3);
                      the count is the hook that makes anybody open the sheet. */}
                  {member.character.souvenirs.length > 0 ? (
                    <span className="party-strip__mark kad-chip">
                      <Icon name="ribbon" />
                      <span>{member.character.souvenirs.length}</span>
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </Collapsible>

        <InventoryGrid
          entries={inventory}
          questItems={me.character.questItems}
          spares={me.character.spares}
          coins={state.coins ?? 0}
          items={items}
          selectedIndex={selectedIndex}
          onSelect={(index) => {
            const entry = index === null ? null : inventory[index] ?? null;
            setSelected(entry === null || index === null ? null : { itemId: entry.itemId, index });
          }}
        />

        {/* Using an item is a decision like any other: select, then confirm. */}
        {selectedEntry === null ? null : (
          <div className="item-detail">
            <p className="item-detail__title">
              <Icon name={selectedDef?.icon ?? selectedEntry.kind} />
              <span>{selectedDef?.name ?? selectedEntry.itemId}</span>
            </p>
            <p className="item-detail__text kad-muted">
              {selectedDef?.text ?? "You are not sure what this does yet."}
            </p>
            <div className="confirm__actions">
              <Button
                variant="ghost"
                size="md"
                icon={<Icon name="close" />}
                onClick={() => setSelected(null)}
              >
                Close
              </Button>
              {canUseInventoryItem(
                selectedEntry,
                inEncounter,
                selectedDef,
                me.hp >= me.character.maxHp,
              ) ? (
                <Button
                  variant="primary"
                  size="md"
                  icon={<Icon name="consumable" />}
                  disabled={busy}
                  onClick={() => {
                    const itemId = selectedEntry.itemId;
                    setSelected(null);
                    void dispatch({ type: "USE_ITEM", itemId });
                  }}
                >
                  Use it
                </Button>
              ) : selectedEntry.kind === "consumable" ? (
                <p className="item-detail__passive kad-chip">
                  <Icon name="waiting" />
                  <span>
                    {inEncounter
                      ? "Use it from your turn in the fight"
                      : selectedDef?.effect?.type === "heal"
                        ? "You're at full health. Save it for later"
                        : "Save it for a fight"}
                  </span>
                </p>
              ) : (
                <p className="item-detail__passive kad-chip">
                  <Icon name="trinket" />
                  <span>Always on</span>
                </p>
              )}
            </div>

            {/*
              Passing it on (spec §9.4). One tap per name, because on this side
              nothing moves — the offer is the selection and their phone holds
              the confirm. It is also the closest a tap gets to the "drag on
              your phone" the spec asks for, and a drag is not something to ask
              of an eight-year-old's thumb on a 40%-of-a-phone pane.

              Only at a Rest scene, which is the rule the server enforces on
              both trade intents.
            */}
            {atRest ? (
              <div className="give">
                <h4 className="give__heading">
                  <Icon name="hand" />
                  <span>Give it to a friend</span>
                </h4>
                {canReceive.length === 0 ? (
                  <p className="give__none kad-muted">
                    <Icon name="waiting" />
                    <span>
                      {party.length < 2
                        ? "Nobody else is here to give it to."
                        : homeFriends.length === 0
                          ? "Visitors keep their own things, so nobody here can take it."
                          : "Everyone is already being offered this one."}
                    </span>
                  </p>
                ) : (
                  <ul className="give__list">
                    {canReceive.map((member) => (
                      <li key={member.playerId}>
                        <button
                          type="button"
                          className="choice kad-tap kad-focusable"
                          disabled={busy}
                          onClick={() =>
                            void dispatch({
                              type: "OFFER_ITEM",
                              itemId: selectedEntry.itemId,
                              toPlayerId: member.playerId,
                            })
                          }
                        >
                          <span className="choice__icon">
                            <Icon name={member.character.species} size="1.8em" />
                          </span>
                          {/* "Give to Thistle", not "Thistle": a bare name beside
                              an item is not obviously a button that does
                              something, and the party strip below has a button
                              with that name already. */}
                          <span className="choice__label">
                            Give to {member.character.name}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Offers of yours still in the air, with the way out of each. An offer
            nobody answers would otherwise sit on a friend's phone all evening
            with no way to take it back. */}
        {offersFromMe.length > 0 ? (
          <div className="give give--waiting">
            <h4 className="give__heading">
              <Icon name="waiting" />
              <span>Waiting for an answer</span>
            </h4>
            <ul className="give__list">
              {offersFromMe.map((offer) => (
                <li className="give__pending" key={offer.id}>
                  <Icon name={items?.[offer.itemId]?.icon ?? "bag"} />
                  <span className="give__pending-label">
                    {items?.[offer.itemId]?.name ?? offer.itemId} →{" "}
                    {nameOfPlayer(party, offer.toPlayerId)}
                  </span>
                  <Button
                    variant="ghost"
                    size="md"
                    icon={<Icon name="back" />}
                    disabled={busy}
                    onClick={() =>
                      void dispatch({ type: "RESOLVE_TRADE", tradeId: offer.id, accept: false })
                    }
                  >
                    Take it back
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {roomControls ? (
          <Collapsible id="room" level={4} defaultOpen={false} className="player__room-settings" title={<span>Room settings</span>}>
            {roomControls}
            {/* Text size, contrast and one-handed play (#262), reachable from the bottom of the phone. */}
            <Button variant="secondary" size="md" block
              onClick={() => { void import("../a11y").then((module) => { module.openA11ySettings(); }); }}>
              Display settings
            </Button>
          </Collapsible>
        ) : null}

        {/* In the lobby the one thing left to do comes last, at the foot of
            the page, after the sheet you have just been looking over — and
            it is the whole answer: the tap says you are ready. */}
        {inLobby ? (
          <Button variant="primary" size="lg" block className="player__task-entry player__task-entry--foot"
            icon={<Icon name="hand" />} disabled={readyRequested && busy} onClick={readyToPlay}>
            {offersToMe.length > 0 ? "A gift for you" : "Ready to play"}
          </Button>
        ) : null}
      </div>
        {!showSheet ? (
          <Button
            className="player__inventory-back"
            variant="secondary"
            size="md"
            block
            icon={<Icon name="back" />}
            onClick={() => setPlayerSection("bag")}
          >
            Back to your bag
          </Button>
        ) : null}
    </section>
    </>
  );
}
