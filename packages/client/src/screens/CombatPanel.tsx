/**
 * CombatControls — PlayerView's half of a fight (spec §7.2, §11).
 *
 * The Pixi board on the WorldView is the spectacle; this is the *input*. A DOM
 * grid of buttons is the right tool for that: 44px-ish targets, accessible
 * names, and — the rule that shapes everything here — only legal taps exist.
 * Reachable tiles come from `legalMoves`, action cards from `legalActions`,
 * both the exact functions the server re-runs to validate (encounter.ts);
 * everything else is an inert cell or simply absent. Nothing is ever disabled:
 * a greyed-out button is a question an eight-year-old has to ask somebody.
 *
 * Every commit is select-then-confirm (spec §11): tap a tile, a card, a
 * target — nothing happens until "Do it!". The one seeming exception, End
 * Turn, confirms too, because it is the only tap that hands control to
 * somebody else and an accidental skipped turn is the most upsetting misfire
 * available.
 *
 * Renders inside PlayerPanel's prompt slot whenever `state.encounter` exists;
 * on somebody else's turn it says whose, and always shows the party's HP —
 * the fight's one piece of shared state a controller must carry (a Party Mode
 * phone has no other view of the board).
 */

import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { ClientIntent, EncounterState, ItemDef, LegalAction, Position } from "@kad/shared";
import {
  combatantById,
  currentActor,
  legalActions,
  legalItemTargets,
  legalMoves,
  samePosition,
} from "@kad/shared";
import { useAbilities, useItems, useMe, useParty, useRules, useRunState, useSend } from "../store";
import { combatContext } from "../store/combat";
import { Button } from "../ui/Button";
import { CharacterPortrait } from "./CharacterPortrait";
import { Icon } from "./icons";
import { combatantIcon, combatantLabel, gridCells, turnKey } from "./combat-grid";
import "./shared.css";
import "./CombatPanel.css";

/**
 * What has been tapped so far this turn. One machine rather than scattered
 * booleans, because the legal *next* taps depend entirely on where in the
 * select→(aim→)confirm walk we are.
 */
type Selection =
  | { step: "idle" }
  | { step: "move"; to: Position }
  /** An ability that needs figures picked — one, or up to `maxTargets`. */
  | { step: "target"; action: LegalAction; picked: readonly string[] }
  /** An ability that needs tiles picked — one, or exactly `tileCount`. */
  | { step: "tile"; action: LegalAction; picked: readonly Position[] }
  /** Pounce and friends: tile picked, now the figure reachable from it. */
  | { step: "tile-target"; action: LegalAction; tile: Position }
  /** Everything chosen; the confirm bar is up. */
  | { step: "act"; action: LegalAction; targetIds?: readonly string[]; tiles?: readonly Position[] }
  /** A thrown consumable, waiting on a monster to land on. */
  | { step: "item-target"; itemId: string }
  /** An item chosen; the confirm bar is up. */
  | { step: "item-act"; itemId: string; targetId?: string }
  | { step: "end" };

const IDLE: Selection = { step: "idle" };

export function CombatControls(): ReactElement | null {
  const state = useRunState();
  const me = useMe();
  const party = useParty();
  const rules = useRules();
  const abilities = useAbilities();
  const items = useItems();
  const send = useSend();

  const [selection, setSelection] = useState<Selection>(IDLE);
  const [busy, setBusy] = useState(false);

  const encounter = state?.encounter ?? null;
  // A new question always starts from a clean slate — a selection made against
  // last turn's board must never be confirmable against this one.
  const key = turnKey(encounter);
  useEffect(() => {
    setSelection(IDLE);
    setBusy(false);
  }, [key]);

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

  if (!encounter || !me) return null;

  const active = currentActor(encounter);
  const myTurn = active !== null && active.side === "party" && active.id === me.character.id;

  // The rules boundary, verbatim (see the header). The catalog rides the same
  // content fetch as the rules; until both land the cards simply wait.
  const actions =
    myTurn && rules && abilities ? legalActions(encounter, combatContext(rules, abilities)) : [];
  const moves = myTurn ? legalMoves(encounter) : [];

  // What the grid offers this render: move destinations, or the still-unpicked
  // tiles of the ability being aimed. Never both — one question at a time.
  const tappable: readonly Position[] =
    selection.step === "tile"
      ? selection.action.tiles.filter(
          (tile) => !selection.picked.some((p) => samePosition(p, tile)),
        )
      : selection.step === "idle" || selection.step === "move"
        ? moves
        : [];
  const selectedTiles: readonly Position[] =
    selection.step === "move"
      ? [selection.to]
      : selection.step === "tile"
        ? selection.picked
        : selection.step === "tile-target"
          ? [selection.tile]
          : selection.step === "act" && selection.tiles
            ? selection.tiles
            : [];

  const cells = myTurn ? gridCells(encounter, party, tappable, selectedTiles) : [];

  // The consumables this turn could spend the action on (§7.2's fourth
  // universal action). Hidden, never disabled: gone once the action is spent,
  // and a card whose use the server would refuse — a thrown item with no
  // monster in range, a heal at full health, a bonus no better than the one
  // in place — never appears at all (useItemInCombat's exact refusals).
  const throwTargets = myTurn && me ? legalItemTargets(encounter, me.character.id) : [];
  const myCombatant = me ? combatantById(encounter, me.character.id) : null;
  const usableItems =
    !myTurn || encounter.actionTaken || !myCombatant
      ? []
      : me.character.inventory
          .map((entry, index) => ({ entry, index, def: items?.[entry.itemId] }))
          .filter((x): x is { entry: (typeof x)["entry"]; index: number; def: ItemDef } => {
            const effect = x.def?.effect;
            if (x.entry.kind !== "consumable" || !effect) return false;
            if (effect.type === "damage") return throwTargets.length > 0;
            if (effect.type === "heal") return myCombatant.hp < myCombatant.maxHp;
            return effect.amount > myCombatant.rollBonus;
          });

  function tapTile(at: Position): void {
    if (selection.step === "tile") {
      const action = selection.action;
      // Pounce pairs the tile with a follow-up figure; the pairing is the
      // server's list, never recombined here (encounter.ts tileTargets).
      if (action.tileTargets) {
        setSelection({ step: "tile-target", action, tile: at });
        return;
      }
      // Bramble Wall wants two tiles: keep collecting until the card's count
      // is met, then raise the confirm bar.
      const picked = [...selection.picked, at];
      if (picked.length >= (action.tileCount ?? 1)) {
        setSelection({ step: "act", action, tiles: picked });
      } else {
        setSelection({ step: "tile", action, picked });
      }
      return;
    }
    setSelection({ step: "move", to: at });
  }

  function tapAction(action: LegalAction): void {
    if (action.tiles.length > 0) {
      setSelection({ step: "tile", action, picked: [] });
      return;
    }
    if (action.needsTarget) {
      setSelection({ step: "target", action, picked: [] });
      return;
    }
    setSelection({ step: "act", action });
  }

  function tapItem(itemId: string, def: ItemDef): void {
    if (def.effect?.type === "damage") {
      setSelection({ step: "item-target", itemId });
      return;
    }
    setSelection({ step: "item-act", itemId });
  }

  function tapTarget(targetId: string): void {
    if (selection.step === "target") {
      // Storm of Blades picks up to `maxTargets` different figures; everything
      // else confirms on the first. "Up to": the server accepts fewer, and
      // running out of pickable figures counts as done.
      const action = selection.action;
      const picked = [...selection.picked, targetId];
      const need = Math.min(action.maxTargets ?? 1, action.targets.length);
      if (picked.length >= need) {
        setSelection({ step: "act", action, targetIds: picked });
      } else {
        setSelection({ step: "target", action, picked });
      }
      return;
    }
    if (selection.step === "tile-target") {
      setSelection({
        step: "act",
        action: selection.action,
        targetIds: [targetId],
        tiles: [selection.tile],
      });
      return;
    }
    if (selection.step === "item-target") {
      setSelection({ step: "item-act", itemId: selection.itemId, targetId });
    }
  }

  /** The figures pickable right now, already filtered by the server's list. */
  const targetIds: readonly string[] =
    selection.step === "target"
      ? selection.action.targets.filter((id) => !selection.picked.includes(id))
      : selection.step === "tile-target"
        ? (selection.action.tileTargets?.find((o) => samePosition(o.tile, selection.tile))
            ?.targets ?? [])
        : selection.step === "item-target"
          ? throwTargets
          : [];

  /** What the who-step is aiming — an ability, or a thrown item. */
  const aimingWho =
    selection.step === "target" || selection.step === "tile-target"
      ? { icon: selection.action.icon, name: selection.action.name }
      : selection.step === "item-target"
        ? {
            icon: items?.[selection.itemId]?.icon ?? "consumable",
            name: items?.[selection.itemId]?.name ?? "the item",
          }
        : null;

  const partyCombatants = encounter.combatants.filter((c) => c.side === "party");

  return (
    <div className="prompt combat">
      {myTurn ? (
        <h3 className="prompt__title">
          <Icon name="swords" />
          <span>Your turn, {me.character.name}!</span>
        </h3>
      ) : (
        <p className="player__waiting" role="status">
          <Icon name="waiting" />
          <span>
            {active
              ? active.side === "party"
                ? `It's ${combatantLabel(active)}'s turn.`
                : `${combatantLabel(active)} is taking its turn…`
              : "The dust is settling…"}
          </span>
        </p>
      )}

      {/*
       * The party at a glance — number first, bar never (spec §11). Faces
       * here, glyphs on the grid below: this row is *who*, the grid is a map,
       * and a map marker has to stay a shape you can read at a tile's size.
       */}
      <ul className="combat__party" aria-label="The party">
        {partyCombatants.map((c) => {
          const member = party.find((m) => m.character.id === c.id);
          return (
          <li className={`kad-chip${c.down ? " kad-chip--bad" : ""}`} key={c.id}>
            {member === undefined ? (
              <Icon name={combatantIcon(c, party)} />
            ) : (
              <CharacterPortrait
                species={member.character.species}
                tier={member.character.tier}
                className="combat__face"
              />
            )}
            <span>{c.name}</span>
            <span className="combat__hp">
              <Icon name="heart" />
              {c.hp}/{c.maxHp}
            </span>
            {c.down ? <Icon name="down" label="Knocked down" /> : null}
          </li>
          );
        })}
      </ul>

      {myTurn && active ? (
        <>
          <div className="combat__meters">
            <span className="kad-chip">
              <Icon name="steps" />
              <span>{encounter.stepsLeft} steps left</span>
            </span>
            <span className={`kad-chip${encounter.actionTaken ? "" : " kad-chip--ok"}`}>
              <Icon name={encounter.actionTaken ? "check" : "star"} />
              <span>{encounter.actionTaken ? "Action spent" : "1 action"}</span>
            </span>
          </div>

          {/*
            The input board. Tappable cells are real <button>s; everything else
            is an inert <span> — hidden-not-disabled, per §7.2. Cells are the
            one deliberate exception to the .kad-tap minimum: ten columns of a
            phone pane cannot give 3em each, and the confirm bar below is what
            makes an imprecise tap recoverable (spec §11, undo on
            non-committal taps).
          */}
          <div
            className="combat__grid"
            role="grid"
            aria-label="The battle grid"
            style={{ gridTemplateColumns: `repeat(${encounter.board.width}, 1fr)` }}
          >
            {cells.map((cell) => {
              const key = `${cell.x},${cell.y}`;
              const marks = [
                cell.blocked ? " combat__cell--blocked" : "",
                cell.selected ? " combat__cell--selected" : "",
                cell.occupant?.active ? " combat__cell--active" : "",
                cell.occupant ? ` combat__cell--${cell.occupant.side}` : "",
              ].join("");
              if (cell.tappable) {
                const aiming = selection.step === "tile";
                return (
                  <button
                    key={key}
                    type="button"
                    data-move-tile={aiming ? undefined : true}
                    data-aim-tile={aiming ? true : undefined}
                    data-x={cell.x}
                    data-y={cell.y}
                    className={`combat__cell combat__cell--tap kad-focusable${marks}`}
                    aria-label={`${aiming ? "Aim at" : "Move to"} column ${cell.x + 1}, row ${cell.y + 1}`}
                    onClick={() => tapTile({ x: cell.x, y: cell.y })}
                  >
                    <Icon name={aiming ? "spark" : "steps"} size="0.9em" />
                  </button>
                );
              }
              return (
                <span key={key} className={`combat__cell${marks}`} aria-hidden="true">
                  {cell.occupant ? <Icon name={cell.occupant.down ? "down" : cell.occupant.icon} /> : null}
                </span>
              );
            })}
          </div>

          {/* ------------- what to do: cards, or the aim step ------------- */}
          {selection.step === "idle" || selection.step === "move" ? (
            <ul className="prompt__options">
              {actions.map((action) => (
                <li key={action.abilityId}>
                  <button
                    type="button"
                    className="choice kad-tap kad-focusable"
                    onClick={() => tapAction(action)}
                  >
                    <span className="choice__icon">
                      <Icon name={action.icon} size="1.8em" />
                    </span>
                    <span className="choice__label">{action.name}</span>
                  </button>
                </li>
              ))}
              {/* §7.2's fourth row — a consumable spends the same one action. */}
              {usableItems.map(({ entry, index, def }) => (
                <li key={`item-${entry.itemId}-${index}`}>
                  <button
                    type="button"
                    className="choice kad-tap kad-focusable"
                    onClick={() => tapItem(entry.itemId, def)}
                  >
                    <span className="choice__icon">
                      <Icon name={def.icon} size="1.8em" />
                    </span>
                    <span className="choice__label">Use {def.name}</span>
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="choice kad-tap kad-focusable"
                  onClick={() => setSelection({ step: "end" })}
                >
                  <span className="choice__icon">
                    <Icon name="forward" size="1.8em" />
                  </span>
                  <span className="choice__label">End turn</span>
                </button>
              </li>
            </ul>
          ) : null}

          {selection.step === "tile" ? (
            <div className="combat__aim">
              <p className="prompt__sub kad-muted">
                <Icon name={selection.action.icon} />
                <span>
                  {selection.action.name} — tap a glowing tile.
                  {(selection.action.tileCount ?? 1) > 1
                    ? ` (${selection.picked.length + 1} of ${selection.action.tileCount})`
                    : ""}
                </span>
              </p>
              <Button
                variant="ghost"
                size="md"
                icon={<Icon name="back" />}
                onClick={() => setSelection(IDLE)}
              >
                Change
              </Button>
            </div>
          ) : null}

          {aimingWho !== null ? (
            <div className="combat__aim">
              <p className="prompt__sub kad-muted">
                <Icon name={aimingWho.icon} />
                <span>
                  {aimingWho.name} — who?
                  {selection.step === "target" && (selection.action.maxTargets ?? 1) > 1
                    ? ` (${selection.picked.length + 1} of ${Math.min(
                        selection.action.maxTargets ?? 1,
                        selection.action.targets.length,
                      )})`
                    : ""}
                </span>
              </p>
              <ul className="prompt__options combat__targets">
                {targetIds.map((targetId) => {
                  const target = combatantById(encounter, targetId);
                  if (!target) return null;
                  return (
                    <li key={targetId}>
                      <button
                        type="button"
                        className="choice kad-tap kad-focusable"
                        onClick={() => tapTarget(targetId)}
                      >
                        <span className="choice__icon">
                          <Icon name={combatantIcon(target, party)} size="1.8em" />
                        </span>
                        <span className="choice__label">{combatantLabel(target)}</span>
                        <span className="combat__hp">
                          <Icon name="heart" />
                          {target.hp}/{target.maxHp}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Button
                variant="ghost"
                size="md"
                icon={<Icon name="back" />}
                onClick={() => setSelection(IDLE)}
              >
                Change
              </Button>
            </div>
          ) : null}

          {/* ------------- the confirm bar (spec §11) ------------- */}
          {selection.step === "move" ? (
            <ConfirmBar
              icon="steps"
              label={`Move to column ${selection.to.x + 1}, row ${selection.to.y + 1}`}
              busy={busy}
              onBack={() => setSelection(IDLE)}
              onGo={() => void dispatch({ type: "MOVE", to: selection.to })}
            />
          ) : null}

          {selection.step === "act" ? (
            <ConfirmBar
              icon={selection.action.icon}
              label={confirmLabel(encounter, selection)}
              busy={busy}
              onBack={() => setSelection(IDLE)}
              onGo={() => {
                // One chosen thing rides the singular field, several ride the
                // plural — the two wire shapes the engine reads in that order.
                const targetIds = selection.targetIds ?? [];
                const tiles = selection.tiles ?? [];
                void dispatch({
                  type: "COMBAT_ACTION",
                  abilityId: selection.action.abilityId,
                  ...(targetIds.length === 1 ? { targetId: targetIds[0] as string } : {}),
                  ...(targetIds.length > 1 ? { targetIds: [...targetIds] } : {}),
                  ...(tiles.length === 1 ? { targetTile: tiles[0] as Position } : {}),
                  ...(tiles.length > 1 ? { targetTiles: [...tiles] } : {}),
                });
              }}
            />
          ) : null}

          {selection.step === "item-act" ? (
            <ConfirmBar
              icon={items?.[selection.itemId]?.icon ?? "consumable"}
              label={itemLabel(encounter, items?.[selection.itemId], selection)}
              busy={busy}
              onBack={() => setSelection(IDLE)}
              onGo={() =>
                void dispatch({
                  type: "USE_ITEM",
                  itemId: selection.itemId,
                  ...(selection.targetId ? { targetId: selection.targetId } : {}),
                })
              }
            />
          ) : null}

          {selection.step === "end" ? (
            <ConfirmBar
              icon="forward"
              label="End the turn"
              busy={busy}
              onBack={() => setSelection(IDLE)}
              onGo={() => void dispatch({ type: "END_TURN" })}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function confirmLabel(
  encounter: EncounterState,
  selection: Extract<Selection, { step: "act" }>,
): string {
  const names = (selection.targetIds ?? [])
    .map((id) => combatantById(encounter, id))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map(combatantLabel);
  if (names.length > 0) return `${selection.action.name} — ${names.join(" and ")}`;
  const tiles = selection.tiles ?? [];
  if (tiles.length > 0) {
    const spots = tiles.map((t) => `column ${t.x + 1}, row ${t.y + 1}`).join(" and ");
    return `${selection.action.name} — ${spots}`;
  }
  return selection.action.name;
}

function itemLabel(
  encounter: EncounterState,
  def: ItemDef | undefined,
  selection: Extract<Selection, { step: "item-act" }>,
): string {
  const name = def?.name ?? selection.itemId;
  const target = selection.targetId ? combatantById(encounter, selection.targetId) : null;
  return target ? `Use ${name} — ${combatantLabel(target)}` : `Use ${name}`;
}

function ConfirmBar({
  icon,
  label,
  busy,
  onBack,
  onGo,
}: {
  icon: string;
  label: string;
  busy: boolean;
  onBack: () => void;
  onGo: () => void;
}): ReactElement {
  return (
    <div className="confirm">
      <p className="confirm__what">
        <Icon name={icon} />
        <span>{label}</span>
      </p>
      <div className="confirm__actions">
        <Button variant="ghost" size="md" icon={<Icon name="back" />} onClick={onBack}>
          Change
        </Button>
        <Button variant="primary" size="lg" icon={<Icon name="check" />} disabled={busy} onClick={onGo}>
          {busy ? "Sending…" : "Do it!"}
        </Button>
      </div>
    </div>
  );
}
