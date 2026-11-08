/**
 * The phone's camp (docs/camp.md §3, §4.5, §5.3, §6.1, §12.5, §12.6; #620):
 *
 *   - `CampButton`: "Camp", beside Ready in the lobby, at a rest scene and at
 *     the chapter's end. It opens the panel; nothing waits on it.
 *   - `CampPanel`: a picture of the whole camp across (StillCamp `fit="width"`:
 *     every tent and spot in view, sky and foreground cropped instead of the
 *     sides), a chip under it for each spot, and beside it a named, keyboard-reachable
 *     control for everything the picture does: this kid's own kit (tent,
 *     bedroll and pack, color, decorations; no limit), and the crew's shared
 *     spots (one change a stop, Undo free, new things free at the chapter's
 *     end), with the limit said before the first change. Begin, Go on and back
 *     to the lobby close it: it lives only while the table is in downtime.
 *   - `KitWelcome`: the first-session choice (§5.3), once per hero on a phone,
 *     one tap, skippable, never in the way of Ready.
 *   - The crew's friends (§4.4, §8.5; #624): each kid's buddy, picked in her
 *     kit, and a "Call over" button for every friend out, which makes it
 *     react on the TV and walk over to her hero. Friends who are not out are
 *     listed all the same: they take turns, and nobody ever leaves.
 *
 * Every write is the server's (CAMP_PLACE, CAMP_UNDO, KIT_EDIT; handlers
 * camp-edit.ts); this only offers what the rules allow (shared camp-edit.ts).
 */

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useGameStore } from "../store";
import { castArtUrl } from "../world/art-paths";
import type { ReactElement } from "react";
import {
  KIT_COLORS,
  campMomentKind,
  freshPieces,
  isPickable,
  kitAccent,
  kitDecorationChoices,
  kitTentChoices,
  kitUnchosen,
  placeRefusalText,
  sharedEditsLeft,
  undoableChange,
  FRIEND_TAP_COOLDOWN_MS,
  SHARED_EDITS_PER_MOMENT,
} from "@kad/shared";
import type { CampFriendCard, ClientIntent, HeroKitView, PartyMember, RunState } from "@kad/shared";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import { StillCamp, TentStandIn } from "../world/StillCamp";
import { CampBedroll, CampTent } from "../world/CampBedroll";
import { CAMP_KIT_STYLES, campKitStyle, type CampKitStyle } from "../world/camp-kit-art";
import { campFamilyFor, campLayoutFor, campStage } from "../world/lobby-camp";
import { packedKits } from "../world/packed-camp";
import { useChapter } from "../store";
import {
  KIT_RULES,
  campBeside,
  campSpots,
  crewName,
  hotspotName,
  kitName,
  layoutHotspots,
  pieceName,
  spotOptions,
  tentArt,
  waitingPieces,
} from "../world/camp-scene";
import { campPanelOpen, closeCampPanel, finishKitWelcome, kitWelcomeDone, onCampPanel, openCampPanel } from "./camp-panel";
import { LookEditor } from "./LookEditor";
import "./CampPanel.css";

type Dispatch = (intent: ClientIntent) => void;

export const COLOR_NAMES: Record<string, string> = {
  orchid: "Gold",
  meadow: "Blue",
  tide: "Orange",
  bark: "Sky",
  ember: "Green",
  rose: "Mint",
};

/** The Camp button. Only while the table is in downtime: a scene, a check or a fight has no camp (§3). */
export function CampButton({ state, block = false }: { state: RunState; block?: boolean }): ReactElement | null {
  if (campMomentKind(state) === null) return null;
  return (
    <Button
      variant="secondary"
      size="md"
      block={block}
      className="camp-button"
      icon={<Icon name="rest" />}
      onClick={openCampPanel}
      aria-haspopup="dialog"
      data-testid="camp-button"
    >
      Camp
    </Button>
  );
}

/** The first-session choice (§5.3): one tap picks a style (in a color), and it can be skipped. */
export function KitWelcome({ state, me, held, dispatch }: { state: RunState; me: PartyMember; held: boolean; dispatch: Dispatch }): ReactElement | null {
  const heroId = me.character.id;
  const kit = state.kits?.[heroId];
  useSyncExternalStore(onCampPanel, () => kitWelcomeDone(heroId), () => true);
  const [color, setColor] = useState<string | null>(null);
  const headingId = useId();
  if (campMomentKind(state) === null || !state.camp || !kitUnchosen(kit) || kitWelcomeDone(heroId) || !kit) return null;
  const accent = kitAccent(color, me.character.appearance.accent);
  // Outdoors at stage 2 and up, a seat shows its tent (§4.5); an indoor rest packs the camp down to bedrolls (§3.2).
  const tents = campStage(state) >= 2 && state.campMoment?.outdoor !== false;
  const pick =(style: string): void => {
    finishKitWelcome(heroId);
    /*
     * The style and color only, never a tent. An unpicked tent already draws as
     * the style's own (`tentArt`), so this shows exactly what the card showed.
     * And the table reads her kit as the moment begins, so this card can still
     * show while a tent she picked in the book since (a milestone tent, say)
     * is stored: a tent sent here would be applied over it, the latest edit
     * winning (server camp-edit.ts `behindEdit`), and her pick would be lost.
     */
    dispatch({ type: "KIT_EDIT", characterId: heroId, revision: kit.revision, style, ...(color ? { color } : {}) });
  };
  return (
    <section className="kit-welcome" aria-labelledby={headingId} data-testid="kit-welcome">
      <h3 className="kit-welcome__title" id={headingId}>
        <Icon name="rest" />
        <span>Pick your camp style!</span>
      </h3>
      <p className="kit-welcome__sub kad-muted">{`Tap one for ${me.character.name}'s tent and bedroll. Change it any time with Camp.`}</p>
      <div className="kit-welcome__colors" role="radiogroup" aria-label="Color">
        {[null, ...KIT_COLORS].map((c) => (
          <button
            key={c ?? "own"}
            type="button"
            role="radio"
            aria-checked={color === c}
            className="camp-swatch kad-focusable"
            style={{ ["--swatch" as string]: kitAccent(c, me.character.appearance.accent) }}
            onClick={() => setColor(c)}
          >
            <span className="camp-swatch__dot" aria-hidden="true" />
            <span className="camp-swatch__name">{c === null ? "My color" : COLOR_NAMES[c] ?? c}</span>
          </button>
        ))}
      </div>
      <div className="kit-welcome__styles">
        {KIT_RULES.styles.map((s) => (
          <button key={s.id} type="button" className="kit-welcome__style kad-tap kad-focusable" disabled={held} onClick={() => pick(s.id)} data-style={s.id}>
            <span className="kit-welcome__art" aria-hidden="true">
              {/* What the camp shows of a style: its tent once the camp has tents (§4.5), its bedroll and pack before. */}
              {tents ? <CampTent tent={tentArt(null, s.id)?.id ?? s.id} accent={accent} fallback={<TentStandIn accent={accent} decorations={0} />} />
                : Object.hasOwn(CAMP_KIT_STYLES, s.id) ? <CampBedroll style={s.id as CampKitStyle} accent={accent} /> : null}
            </span>
            <span>{kitName(s.id, "style")}</span>
          </button>
        ))}
      </div>
      <Button variant="ghost" size="md" onClick={() => finishKitWelcome(heroId)} data-testid="kit-welcome-skip">
        Skip for now
      </Button>
    </section>
  );
}

/** A friend's picture, its figure's own art (#624). */
export function FriendArt({ card }: { card: CampFriendCard }): ReactElement | null {
  const url = castArtUrl(card.figure);
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return <img src={url} alt="" onError={() => setFailed(true)} />;
}

/**
 * Her buddy (§4.4; #624): one of the crew's friends, always out while she is
 * seated, or none, when every seat rotates. Kept on her kit, for this crew.
 */
function BuddyPicker({ kit, friends, held, edit, hero }: { kit: HeroKitView; friends: readonly CampFriendCard[]; held: boolean; edit: (change: { buddy: string | null }) => void; hero: string }): ReactElement | null {
  if (friends.length === 0) return null;
  const buddy = kit.buddy ?? null;
  return (
    <fieldset className="camp-panel__group" data-testid="buddy-picker">
      <legend>Buddy</legend>
      <p className="camp-panel__note kad-muted">{`Your buddy is always out at camp while ${hero} is here.`}</p>
      <div className="camp-panel__options">
        <button type="button" className="camp-option kad-focusable" aria-pressed={buddy === null} disabled={held} onClick={() => edit({ buddy: null })} data-buddy="">
          <span className="camp-option__label">No buddy</span>
        </button>
        {friends.map((card) => (
          <button key={card.id} type="button" className="camp-option kad-focusable" aria-pressed={buddy === card.id} disabled={held} onClick={() => edit({ buddy: card.id })} data-buddy={card.id}>
            <span className="camp-option__art camp-option__art--friend" aria-hidden="true">
              <FriendArt card={card} />
            </span>
            <span className="camp-option__label">{card.name}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The crew's friends (§4.4, §8.5; #624): a named button for every friend out,
 * which calls it over to this kid's hero on the TV, a moment apart
 * (`FRIEND_TAP_COOLDOWN_MS`, so a hammered button sends a tap now and then,
 * never a flood); and every friend the crew has, out or not.
 */
function CampFriends({ state }: { state: RunState }): ReactElement | null {
  const friends = state.campMoment?.friends;
  const tapFriend = useGameStore((store) => store.tapFriend);
  const [resting, setResting] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const base = useId();
  useEffect(() => {
    if (resting === null) return;
    const timer = setTimeout(() => setResting(null), FRIEND_TAP_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [resting]);
  if (!friends || friends.cards.length === 0) return null;
  const out = friends.out.map((id) => friends.cards.find((c) => c.id === id)).filter((c): c is CampFriendCard => c !== undefined);
  // Indoors the camp is packed down and nobody walks (§3.2): a tapped friend
  // says hello where it sits, so the phone says that, not that it is coming.
  const indoors = state.campMoment?.outdoor === false;
  const call = (card: CampFriendCard): void => {
    if (resting !== null) return;
    setResting(card.id);
    setSaid(indoors ? `${card.name} says hi! Look at the TV.` : `${card.name} is on the way!`);
    void tapFriend(card.id);
  };
  return (
    <section className="camp-panel__section" aria-labelledby={`${base}-friends`} data-testid="camp-friends">
      <h3 className="camp-panel__heading" id={`${base}-friends`}>
        <Icon name="heart" />
        <span>Friends</span>
      </h3>
      <div className="camp-panel__options">
        {out.map((card) => (
          <button
            key={card.id}
            type="button"
            className="camp-option camp-option--friend kad-focusable"
            disabled={resting !== null}
            onClick={() => call(card)}
            data-friend={card.id}
          >
            <span className="camp-option__art camp-option__art--friend" aria-hidden="true">
              <FriendArt card={card} />
            </span>
            <span className="camp-option__label">{indoors ? `Say hi to ${card.name}` : `Call ${card.name} over`}</span>
          </button>
        ))}
      </div>
      <p className="camp-panel__note" role="status" aria-live="polite" data-testid="friend-called">
        {said ?? ""}
      </p>
      {friends.cards.length > out.length ? (
        <p className="camp-panel__note kad-muted" data-testid="friend-collection">
          {`Your crew's friends take turns at camp: ${friends.cards.map((c) => c.name).join(", ")}.`}
        </p>
      ) : null}
    </section>
  );
}

/** One hero's kit, changed by her own player (§4.5): no limit, indoors or out. */
export function KitEditor({ member, kit, held, dispatch, friends = [] }: { member: PartyMember; kit: HeroKitView; held: boolean; dispatch: Dispatch; friends?: readonly CampFriendCard[] }): ReactElement {
  const hero = member.character;
  const style = campKitStyle(hero.id, kit.style);
  const accent = kitAccent(kit.color, hero.appearance.accent);
  const tent = tentArt(kit.tent, style)?.id ?? null;
  const edit = (change: Omit<Extract<ClientIntent, { type: "KIT_EDIT" }>, "type" | "characterId" | "revision">): void =>
    dispatch({ type: "KIT_EDIT", characterId: hero.id, revision: kit.revision, ...change });
  const slots = kit.slots.length > 0 ? kit.slots : [null, null];
  const decorations = kitDecorationChoices(KIT_RULES, kit.unlocked);
  const base = useId();
  return (
    <section className="camp-panel__section" aria-labelledby={`${base}-kit`} data-testid="kit-editor">
      <h3 className="camp-panel__heading" id={`${base}-kit`}>
        <Icon name="bag" />
        <span>{`${hero.name}'s kit`}</span>
      </h3>
      <p className="camp-panel__note kad-muted">Only you change your own kit, as often as you like.</p>

      <fieldset className="camp-panel__group">
        <legend>Tent</legend>
        <div className="camp-panel__options">
          {kitTentChoices(KIT_RULES, kit.unlocked).map((id) => (
            <button key={id} type="button" className="camp-option kad-focusable" aria-pressed={tent === id} disabled={held} onClick={() => edit({ tent: id })} data-tent={id}>
              <span className="camp-option__art" aria-hidden="true">
                <CampTent tent={id} accent={accent} fallback={<TentStandIn accent={accent} decorations={0} />} />
              </span>
              <span className="camp-option__label">{kitName(id, "tent")}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="camp-panel__group">
        <legend>Bedroll and pack</legend>
        <div className="camp-panel__options">
          {KIT_RULES.styles.map(({ id }) => (
            <button key={id} type="button" className="camp-option kad-focusable" aria-pressed={style === id} disabled={held} onClick={() => edit({ style: id })} data-style={id}>
              <span className="camp-option__art" aria-hidden="true">
                {Object.hasOwn(CAMP_KIT_STYLES, id) ? <CampBedroll style={id as CampKitStyle} accent={accent} /> : null}
              </span>
              <span className="camp-option__label">{kitName(id, "style")}</span>
            </button>
          ))}
        </div>
        {kit.style === null ? <p className="camp-panel__note kad-muted">Picked for you until you choose.</p> : null}
      </fieldset>

      <fieldset className="camp-panel__group">
        <legend>Color</legend>
        <div className="camp-panel__options camp-panel__options--swatches">
          {[null, ...KIT_COLORS].map((c) => (
            <button
              key={c ?? "own"}
              type="button"
              className="camp-swatch kad-focusable"
              aria-pressed={kit.color === c}
              disabled={held}
              style={{ ["--swatch" as string]: kitAccent(c, hero.appearance.accent) }}
              onClick={() => edit({ color: c })}
            >
              <span className="camp-swatch__dot" aria-hidden="true" />
              <span className="camp-swatch__name">{c === null ? "My color" : COLOR_NAMES[c] ?? c}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="camp-panel__group">
        <legend>Decorations on your tent</legend>
        <div className="camp-panel__slots">
          {slots.map((slot, i) => (
            <label key={i} className="camp-panel__slot">
              <span>{`Spot ${String(i + 1)}`}</span>
              <select
                className="kad-focusable"
                value={slot ?? ""}
                disabled={held}
                onChange={(event) => {
                  const next = [...slots];
                  next[i] = event.target.value === "" ? null : event.target.value;
                  // One decoration hangs in one spot: picking it here takes it from the other.
                  for (let j = 0; j < next.length; j++) if (j !== i && next[j] === next[i]) next[j] = null;
                  edit({ slots: next });
                }}
              >
                <option value="">Nothing</option>
                {decorations.map((id) => (
                  <option key={id} value={id}>
                    {kitName(id, "decoration")}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>
      <BuddyPicker kit={kit} friends={friends} held={held} edit={edit} hero={hero.name} />
      {hero.souvenirs.length > 0 ? (
        <p className="camp-panel__note">
          <Icon name="charm" />
          <span>{`${String(hero.souvenirs.length)} souvenir${hero.souvenirs.length === 1 ? "" : "s"} hang beside your tent.`}</span>
        </p>
      ) : null}
    </section>
  );
}

/** The crew's shared spots (§6.1, §12.5): any seated player, one change a stop, Undo free. */
function SharedSpots({
  state,
  me,
  held,
  dispatch,
  active,
  setActive,
}: {
  state: RunState;
  me: PartyMember;
  held: boolean;
  dispatch: Dispatch;
  active: string | null;
  setActive: (id: string | null) => void;
}): ReactElement | null {
  const moment = state.campMoment;
  const camp = state.camp;
  const base = useId();
  const groups = useRef(new Map<string, HTMLFieldSetElement | null>());
  useEffect(() => {
    if (active) groups.current.get(active)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [active]);
  if (!moment || !camp) return null;
  const layout = campLayoutFor(campStage(state));
  const heading = (
    <h3 className="camp-panel__heading" id={`${base}-shared`}>
      <Icon name="crew" />
      <span>Camp spots</span>
    </h3>
  );
  if (!moment.outdoor) {
    return (
      <section className="camp-panel__section" aria-labelledby={`${base}-shared`}>
        {heading}
        <p className="camp-panel__note kad-muted" data-testid="camp-indoors">The camp spots wait for the full camp. You can still change your own kit.</p>
      </section>
    );
  }
  const spots = layout ? campSpots(layout, camp, { crewName: crewName(state) }).filter(isPickable) : [];
  const waiting = layout ? waitingPieces(layout, camp) : [];
  const beside = layout ? campBeside(state, layout) : [];
  const fresh = freshPieces(state);
  const left = sharedEditsLeft(moment, me.playerId);
  const undo = undoableChange(moment, me.playerId, camp.placed);
  const hotspots = layout ? layoutHotspots(layout) : [];
  const place = (hotspot: string, piece: string | null): void => dispatch({ type: "CAMP_PLACE", moment: moment.id, hotspot, piece });
  return (
    <section className="camp-panel__section" aria-labelledby={`${base}-shared`} data-testid="camp-shared">
      {heading}
      {spots.length === 0 ? (
        <p className="camp-panel__note kad-muted">Your camp has no spots for pieces yet. It grows when your crew finishes a whole adventure.</p>
      ) : (
        <>
          {/* The limit, said before anyone changes anything (§12.5). */}
          <p className="camp-panel__rule" data-testid="camp-limit-rule">
            <Icon name="hand" />
            <span>
              {SHARED_EDITS_PER_MOMENT === 1
                ? "Everyone can change one camp spot at each stop. Undo is free, and new things from this chapter go up free."
                : `Everyone can change ${String(SHARED_EDITS_PER_MOMENT)} camp spots at each stop. Undo is free, and new things from this chapter go up free.`}
            </span>
          </p>
          {left <= 0 ? (
            <p className="camp-panel__limit" role="status" data-testid="camp-limit-used">
              <Icon name="check" />
              <span>{placeRefusalText("limit")}</span>
            </p>
          ) : null}
          {undo ? (
            <Button variant="secondary" size="md" icon={<Icon name="back" />} disabled={held} onClick={() => dispatch({ type: "CAMP_UNDO", moment: moment.id })} data-testid="camp-undo">
              {`Undo my change to the ${hotspotName(hotspots.find((h) => h.id === undo.hotspot)?.kind ?? undo.hotspot).toLowerCase()}`}
            </Button>
          ) : null}
          {spots.map((spot) => {
            const rule = hotspots.find((h) => h.id === spot.id);
            const options = spotOptions(spot, layout!, camp);
            const choices: (string | null)[] = rule?.default ? options : [null, ...options];
            const lit = beside.some((b) => b.hotspotId === spot.id);
            return (
              <fieldset
                key={spot.id}
                ref={(el) => {
                  groups.current.set(spot.id, el);
                }}
                className={`camp-panel__group camp-panel__spot${active === spot.id ? " is-active" : ""}${lit ? " is-lit" : ""}`}
                data-spot={spot.id}
                onFocus={() => setActive(spot.id)}
              >
                <legend>{`${hotspotName(spot.kind)}: ${spot.pieceId ? pieceName(spot.pieceId) : "nothing yet"}`}</legend>
                {lit ? <p className="camp-panel__note">Something new from this chapter goes here, free.</p> : null}
                <div className="camp-panel__options">
                  {choices.map((piece) => {
                    const current = (spot.pieceId ?? null) === (piece ?? rule?.default ?? null);
                    const free = piece !== null && fresh.includes(piece);
                    return (
                      <button
                        key={piece ?? "none"}
                        type="button"
                        className="camp-option camp-option--piece kad-focusable"
                        aria-pressed={current}
                        disabled={held || current || (left <= 0 && !free)}
                        onClick={() => place(spot.id, piece)}
                        data-piece={piece ?? ""}
                      >
                        <span className="camp-option__label">{piece === null ? "Nothing" : pieceName(piece)}</span>
                        {free ? <span className="camp-option__badge">New, free</span> : null}
                      </button>
                    );
                  })}
                </div>
                {options.length === 0 ? <p className="camp-panel__note kad-muted">Your crew has nothing for this spot yet.</p> : null}
              </fieldset>
            );
          })}
        </>
      )}
      {waiting.length > 0 ? (
        <div className="camp-panel__waiting">
          <h4>Saved for later</h4>
          <ul>
            {waiting.map((w) => (
              <li key={w.pieceId}>
                <Icon name="star" />
                <span>{`${w.label}: goes up when your camp grows${w.stage ? ` (camp ${String(w.stage)})` : ""}.`}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The camp packed down, as a phone shows it at an indoor rest (§3.2): each
 * seated hero's bedroll and pack in her color, with her name, in a row. The
 * friends out (#624) sit at its ends on the shared screen (packed-camp.ts
 * `packedFriends`); here they are in the Friends section below, to call over.
 */
function PackedCamp({ state }: { state: RunState }): ReactElement {
  const names = new Map(state.party.map((m) => [m.character.id, m.character.name]));
  return (
    <ul className="camp-panel__packed" aria-label="Packed camp" data-testid="camp-packed">
      {packedKits(state).map((kit) => (
        <li key={kit.id} className="camp-panel__packed-kit">
          <span className="camp-panel__packed-art" aria-hidden="true">
            <CampBedroll style={kit.style} accent={kit.accent} />
          </span>
          <span className="camp-panel__packed-name">{names.get(kit.id) ?? ""}</span>
        </li>
      ))}
    </ul>
  );
}

/** The panel itself: a picture and its named controls. Open only in downtime. */
export function CampPanel({ state, me, held, dispatch }: { state: RunState; me: PartyMember; held: boolean; dispatch: Dispatch }): ReactElement | null {
  const open = useSyncExternalStore(onCampPanel, campPanelOpen, campPanelOpen);
  const chapter = useChapter();
  const kind = campMomentKind(state);
  const [active, setActive] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const titleId = useId();
  // Begin, Go on, back to the lobby: the panel goes with the downtime (§3, §12.6).
  useEffect(() => {
    if (kind === null) closeCampPanel();
  }, [kind]);
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeCampPanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open || kind === null) return null;
  // Indoors the camp is packed down to bedrolls and packs (§3.2): no campsite
  // painting, no tents and no campfire, only each hero's own kit, set down.
  const indoors = state.campMoment?.outdoor === false;
  const layout = indoors ? null : campLayoutFor(campStage(state), campFamilyFor(state, chapter));
  const mine = state.party.filter((m) => m.playerId === me.playerId);
  return (
    <div className="camp-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="camp-panel">
      <header className="camp-panel__head">
        <h2 className="camp-panel__title" id={titleId} tabIndex={-1} ref={headingRef}>
          <Icon name="rest" />
          <span>{`${crewName(state)}'s camp`}</span>
        </h2>
        <Button variant="primary" size="md" icon={<Icon name="check" />} onClick={closeCampPanel} data-testid="camp-done">
          Done
        </Button>
      </header>
      <div className="camp-panel__body">
        {/* The first-session choice (§5.3), wherever the Camp button was found first. */}
        <KitWelcome state={state} me={me} held={held} dispatch={dispatch} />
        {layout ? (
          <div className="camp-panel__picture" aria-hidden="true">
            <StillCamp layout={layout} state={state} fit="width" activeSpot={active} {...(state.campMoment?.outdoor ? { onSpot: setActive } : {})} />
          </div>
        ) : null}
        {indoors ? <PackedCamp state={state} /> : null}
        {mine.map((member) => {
          const kit = state.kits?.[member.character.id];
          return (
            <div key={member.character.id} style={{ display: "contents" }}>
              {kit ? <KitEditor member={member} kit={kit} held={held} dispatch={dispatch} friends={state.campMoment?.friends?.cards ?? []} /> : null}
              {/* Her look (docs/hero-looks.md §8.2; #664): the lobby and rests. */}
              {kind === "lobby" || kind === "rest" ? <LookEditor member={member} held={held} dispatch={dispatch} /> : null}
            </div>
          );
        })}
        <CampFriends state={state} />
        <SharedSpots state={state} me={me} held={held} dispatch={dispatch} active={active} setActive={setActive} />
      </div>
    </div>
  );
}
