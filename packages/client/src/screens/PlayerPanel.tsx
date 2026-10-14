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

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { DEFAULT_HELP_DIE, INVENTORY_SLOTS, STAT_IDS, lobbyCampaign } from "@kad/shared";
import { checkTarget } from "./DiceOverlay";
import type {
  ClientIntent,
  InventoryEntry,
  ItemCatalog,
  ItemDef,
  PartyMember,
  Prompt,
  RulesContent,
  StatId,
} from "@kad/shared";
import {
  useCampaign,
  useChapter,
  useIsMyCombatTurn,
  useIsMyPrompt,
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
import { CharacterPortrait } from "./CharacterPortrait";
import { CharacterSheet } from "./CharacterSheet";
import { Icon } from "./icons";
import {
  beginLabel,
  campaignEndHeading,
  campaignEndLine,
  campaignOptionLine,
  nextChapterLine,
} from "./campaign-copy";
import { KeepsakeOffer } from "./SignInFlow";
import { CombatControls } from "./CombatPanel";
import { useEnsureChapter, useEnsureContent } from "./content";
import "./shared.css";
import "./PlayerPanel.css";
import { EntryScene, lobbySceneFor } from "./EntryScene";
import { FieldGuide } from "./FieldGuide";

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
      const waiting = party.filter((m) => !m.ready).map((m) => m.character.name);
      return waiting.length === 0 ? "Everyone is ready." : `Waiting for ${waiting.join(" and ")}.`;
    }
  }
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

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

function IdentityStrip({ me }: { me: PartyMember }): ReactElement {
  const { character } = me;
  const hpPct = character.maxHp === 0 ? 0 : Math.max(0, Math.min(1, me.hp / character.maxHp));
  return (
    <header className="sheet">
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
        <span className="sheet__name">{character.name}</span>
        <span className="sheet__meta kad-muted">
          <Icon name={character.class} />
          <span>Level {character.level}</span>
          <span aria-hidden="true">·</span>
          <span className="sheet__tier">{character.tier}</span>
        </span>
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
  items,
  selectedIndex,
  onSelect,
}: {
  entries: InventoryEntry[];
  questItems: string[];
  items: ItemCatalog | null;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}): ReactElement {
  const slots = Array.from({ length: INVENTORY_SLOTS }, (_, i) => entries[i] ?? null);
  return (
    <div className="inv">
      <h3 className="inv__heading">
        <Icon name="bag" />
        <span>Your things</span>
      </h3>
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
              >
                <Icon name={def?.icon ?? entry.kind} size="1.7em" />
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

      {questItems.length === 0 ? null : (
        <div className="inv__quest">
          <h4 className="inv__quest-heading">
            <Icon name="quest" />
            <span>Story things (they never take a slot)</span>
          </h4>
          <ul className="inv__quest-list">
            {questItems.map((itemId) => (
              <li className="kad-chip" key={itemId}>
                <Icon name={items?.[itemId]?.icon ?? "quest"} />
                <span>{items?.[itemId]?.name ?? itemId}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
  // otherwise let one person start the chapter alone.
  const everyoneReady = party.length > 0 && party.every((member) => member.ready);
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
  const hasTask = myPrompt !== null || canHelp || state?.encounter != null || inLobby || state?.phase === "chapter_complete" ||
    (state?.phase === "scene" && state.sceneType === "rest" && (me?.character.unspentPoints ?? 0) > 0) ||
    (state?.trades ?? []).some((offer) => offer.toPlayerId === me?.playerId);
  useEffect(() => {
    if (!hasTask && section === "turn") setPlayerSection("bag");
  }, [hasTask, section]);

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
   * Nothing is spoken from here on purpose. Narration, choice labels and roll
   * prompts all go through `speak()` in NarrationPanel — the shared surface,
   * which every player has exactly one of in either mode. Speaking them here as
   * well would make a Travel Mode phone (both surfaces, one device) say every
   * line twice. spec §11's requirement is that the text *flows through the
   * seam*, not that every component calls it.
   */

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
  const banked = me.character.unspentPoints;
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
   */
  const canReceive =
    selectedEntry === null
      ? []
      : party.filter(
          (member) =>
            member.playerId !== me.playerId &&
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
        <CharacterSheet
          member={openSheetFor}
          isMe={openSheetFor.playerId === me.playerId}
          items={items}
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

      {me.down ? (
        <p className="player__down" role="status">
          <Icon name="down" />
          <span>Knocked down. A friend can help you up.</span>
        </p>
      ) : null}

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

                {aimedStat === null ? null : (
                  <div className="confirm">
                    <p className="confirm__what">
                      <Icon name={aimedStat} />
                      <span className="grow__label">
                        {aimedStat} {me.character.stats[aimedStat]} → {me.character.stats[aimedStat] + 1}
                      </span>
                    </p>
                    <div className="confirm__actions">
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
                        size="lg"
                        icon={<Icon name="check" />}
                        disabled={busy}
                        onClick={() => {
                          setPendingStat(null);
                          void dispatch({ type: "SPEND_STAT_POINT", stat: aimedStat });
                        }}
                      >
                        {busy ? "Growing…" : "Grow!"}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {/* ---------------- somebody is handing you something (spec §9.4) ----------------
            Not guarded on `atRest`: the engine clears every offer on scene
            entry, so an offer being here at all is the server saying the party
            is resting. Guarding it again would be a second copy of a rule that
            already has one home.

            The two-tap rule (spec §11) is spread across two phones here rather
            than two taps on one. Their offer is the selection — nothing has
            left their bag — and this is the confirm. */}
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
                          size="lg"
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

        {/* ---------------- choice / vote (spec §6.1) ---------------- */}
        {myPrompt !== null && myPrompt.kind === "choice" ? (
          <div className="prompt">
            <h3 className="prompt__title">
              <Icon name={myPrompt.vote ? "vote" : "hand"} />
              <span>
                {myPrompt.vote
                  ? "Everyone votes"
                  : myPrompt.forPlayerIds.includes(me.playerId)
                    ? "Your turn! What do you do?"
                    : "What do you do?"}
              </span>
            </h3>

            <ul className="prompt__options">
              {myPrompt.options.map((option) => {
                const voters =
                  myPrompt.votes === undefined
                    ? []
                    : Object.entries(myPrompt.votes)
                        .filter(([, choiceId]) => choiceId === option.id)
                        .map(([playerId]) => nameOfPlayer(party, playerId));
                const selected = pendingChoice === option.id || myVote === option.id;
                return (
                  <li key={option.id}>
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
                        {/* The seat is always here; only the check comes and
                            goes, so somebody else voting cannot rewrap the
                            label you are reading. */}
                        <span className="choice__mark">
                          {myVote === option.id ? <Icon name="check" label="Your vote" /> : null}
                        </span>
                        {voters.length === 0 ? null : (
                          <span className="choice__votes">
                            <Icon name="vote" />
                            <span>{voters.join(", ")}</span>
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Nothing is final until this bar is tapped (spec §11). */}
            {chosenOption === null ? null : (
              <div className="confirm">
                <p className="confirm__what">
                  <Icon name={chosenOption.icon} />
                  <span>{chosenOption.label}</span>
                </p>
                <div className="confirm__actions">
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
                    size="lg"
                    icon={<Icon name="check" />}
                    disabled={busy}
                    onClick={() => void dispatch({ type: "CHOOSE", choiceId: chosenOption.id })}
                  >
                    {busy ? "Sending…" : "Do it!"}
                  </Button>
                </div>
              </div>
            )}
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
            {helperLine(myPrompt, party, me?.character.id) === null ? null : (
              <p className="prompt__sub" role="status">
                <Icon name="players" />
                <span>{helperLine(myPrompt, party, me?.character.id)}</span>
              </p>
            )}
            <Button
              variant="primary"
              size="lg"
              icon={<Icon name="d20" />}
              disabled={busy}
              onClick={() => void dispatch({ type: "ROLL" })}
            >
              {busy ? "Rolling…" : "Roll!"}
            </Button>
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

            {pendingDrop === undefined ? null : (
              <div className="confirm">
                <p className="confirm__what">
                  <Icon name={pendingDrop === null ? "close" : "bag"} />
                  <span>
                    {pendingDrop === null
                      ? "Leave it behind"
                      : `Drop ${items?.[pendingDrop]?.name ?? pendingDrop}`}
                  </span>
                </p>
                <div className="confirm__actions">
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
                    size="lg"
                    icon={<Icon name="check" />}
                    disabled={busy}
                    onClick={() =>
                      void dispatch({ type: "RESOLVE_ITEM_SWAP", dropItemId: pendingDrop })
                    }
                  >
                    {busy ? "Sending…" : "Yes, do that"}
                  </Button>
                </div>
              </div>
            )}
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
                  ? me.ready ? "You're ready to play" : "Ready to play?"
                  : me.ready ? "You're ready to fight" : "A fight is starting!"}
              </span>
            </h3>
            <p className="prompt__sub kad-muted">
              {inLobby
                ? "Tap when you're ready. The adventure starts when everyone is."
                : "Tap when you're ready. The fight starts when everyone is."}
            </p>
            <Button
              variant={me.ready ? "secondary" : "primary"}
              size="lg"
              icon={<Icon name={me.ready ? "back" : "ready"} />}
              disabled={busy}
              onClick={() => void dispatch({ type: "READY", ready: !me.ready })}
            >
              {me.ready ? "Wait, not yet" : inLobby ? "I'm ready!" : "I'm ready to fight!"}
            </Button>
            <ul className="prompt__party">
              {party.map((member) => (
                <li className={`kad-chip${member.ready ? " kad-chip--ok" : ""}`} key={member.playerId}>
                  <Icon name={member.ready ? "check" : "waiting"} />
                  <span>{member.character.name}</span>
                </li>
              ))}
            </ul>

            {/* Somebody has to say go. It appears only once the whole party is
                ready, so it can't be tapped out from under anyone, and the
                chapter it starts is the campaign's next one, which the server
                works out from where this household got to. */}
            {/* Which adventure — only when there is more than one to pick
                from. A household with one campaign on the go never sees
                this: the only option is picked for it. */}
            {inLobby && campaignChoice?.contested ? (
              <div className="player__campaigns">
                <h4 className="prompt__title">
                  <Icon name="vote" />
                  <span>Which adventure?</span>
                </h4>
                <ul className="prompt__options">
                  {(state.campaignOptions ?? []).map((option) => {
                    const myCampaignVote = state.campaignVotes?.[me.playerId];
                    const voters = party
                      .filter((member) => state.campaignVotes?.[member.playerId] === option.id)
                      .map((member) => member.character.name);
                    const selected = myCampaignVote === option.id;
                    return (
                      <li key={option.id}>
                        <button
                          type="button"
                          className={`choice kad-tap kad-focusable${selected ? " choice--on" : ""}`}
                          aria-pressed={selected}
                          disabled={busy}
                          onClick={() => void dispatch({ type: "VOTE_CAMPAIGN", campaignId: option.id })}
                        >
                          <span className="choice__icon">
                            <Icon name="map" size="1.8em" />
                          </span>
                          <span className="choice__label">
                            <b>{option.title}</b>
                            <br />
                            <small>{campaignOptionLine(option)}</small>
                          </span>
                          <span className="choice__trail">
                            <span className="choice__mark">
                              {selected ? <Icon name="check" label="Your vote" /> : null}
                            </span>
                            {voters.length === 0 ? null : (
                              <span className="choice__votes">
                                <Icon name="vote" />
                                <span>{voters.join(", ")}</span>
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {inLobby && nextChapterLine(state.campaign) !== null ? (
              <p className="player__next-chapter">
                <Icon name="map" />
                <span>
                  {campaignChoice?.contested ? `${state.campaign?.title ?? ""}: ` : ""}
                  {nextChapterLine(state.campaign)}
                </span>
              </p>
            ) : null}
            {inLobby && everyoneReady && waitingOnVotes.length > 0 ? (
              <p className="player__next-chapter">
                <Icon name="waiting" />
                <span>
                  Waiting for {waitingOnVotes.map((member) => member.character.name).join(", ")} to
                  pick an adventure
                </span>
              </p>
            ) : null}
            {inLobby && everyoneReady && waitingOnVotes.length === 0 && campaignId !== null ? (
              <Button
                variant="primary"
                size="lg"
                icon={<Icon name="forward" />}
                disabled={busy}
                onClick={() => void dispatch({ type: "CONTINUE_CAMPAIGN", campaignId })}
              >
                {beginLabel(state.campaign)}
              </Button>
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
            <Button
              variant="primary"
              size="lg"
              icon={<Icon name="forward" />}
              disabled={busy}
              onClick={() => void dispatch({ type: "ADVANCE" })}
            >
              Back to the lobby
            </Button>
          </div>
        ) : null}

        {/* ---------------- someone else's turn ---------------- */}
        {myPrompt === null && !isMyPrompt && globalPrompt !== null ? (
          <p className="player__waiting" role="status">
            <Icon name="waiting" />
            <span>{waitingLine(globalPrompt, party)}</span>
          </p>
        ) : null}

        {/* ---------------- help a friend's check ---------------- */}
        {myPrompt === null && !isMyPrompt && globalPrompt !== null && globalPrompt.kind === "roll" && !globalPrompt.group && me && !me.down ? (
          <div className="prompt">
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
        {hasTask ? (
          <Button variant="primary" size="lg" block className="player__task-entry"
            icon={<Icon name="hand" />} onClick={() => setPlayerSection("turn")}>
            {offersToMe.length > 0 ? "A gift for you" : inLobby ? "Ready to play" : state.phase === "chapter_complete" ? "Chapter rewards" : atRest && banked > 0 ? banked === 1 ? "Spend your stat point" : "Spend your stat points" : myPrompt !== null || isMyCombatTurn ? "Your turn" : "View the fight"}
          </Button>
        ) : null}
        {!hasTask ? (
          <p className="player__waiting" role="status"><Icon name="waiting" />
            <span>{globalPrompt !== null ? waitingLine(globalPrompt, party) : "Listen to the story…"}</span>
          </p>
        ) : null}
        <StatRow me={me} />

        {/*
          spec §6.1 lists "look at each other's characters" as one of the four
          things a Rest scene is for, beside healing, spending a level-up and
          trading. Not gated to a Rest scene though: reading a sheet sends
          nothing and decides nothing, so there is no rule to enforce, and
          "what is her Guard?" is a question a fight raises more often than a
          camp does.
        */}
        <div className="party-strip">
          <h3 className="party-strip__heading">
            <Icon name="party" />
            <span>Everyone</span>
          </h3>
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
        </div>

        <InventoryGrid
          entries={inventory}
          questItems={me.character.questItems}
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
                  size="lg"
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
          <details className="player__room-settings">
            <summary className="kad-focusable">Room settings</summary>
            {roomControls}
          </details>
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
