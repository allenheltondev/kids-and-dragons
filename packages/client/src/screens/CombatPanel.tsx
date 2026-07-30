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
import type { ClientIntent, EncounterState, LegalAction, Position } from "@kad/shared";
import {
  combatantById,
  currentActor,
  legalActions,
  legalMoves,
  samePosition,
} from "@kad/shared";
import { useAbilities, useMe, useParty, useRules, useRunState, useSend } from "../store";
import { combatContext } from "../store/combat";
import { Button } from "../ui/Button";
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
  /** An ability that needs a figure picked. */
  | { step: "target"; action: LegalAction }
  /** An ability that needs a tile picked. */
  | { step: "tile"; action: LegalAction }
  /** Pounce and friends: tile picked, now the figure reachable from it. */
  | { step: "tile-target"; action: LegalAction; tile: Position }
  /** Everything chosen; the confirm bar is up. */
  | { step: "act"; action: LegalAction; targetId?: string; tile?: Position }
  | { step: "end" };

const IDLE: Selection = { step: "idle" };

export function CombatControls(): ReactElement | null {
  const state = useRunState();
  const me = useMe();
  const party = useParty();
  const rules = useRules();
  const abilities = useAbilities();
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

  // What the grid offers this render: move destinations, or the tile set of
  // the ability being aimed. Never both — one question at a time.
  const tappable: readonly Position[] =
    selection.step === "tile"
      ? selection.action.tiles
      : selection.step === "idle" || selection.step === "move"
        ? moves
        : [];
  const selectedTile =
    selection.step === "move"
      ? selection.to
      : selection.step === "tile-target"
        ? selection.tile
        : selection.step === "act" && selection.tile
          ? selection.tile
          : null;

  const cells = myTurn ? gridCells(encounter, party, tappable, selectedTile) : [];

  function tapTile(at: Position): void {
    if (selection.step === "tile") {
      const action = selection.action;
      // Pounce pairs the tile with a follow-up figure; the pairing is the
      // server's list, never recombined here (encounter.ts tileTargets).
      if (action.tileTargets) {
        setSelection({ step: "tile-target", action, tile: at });
      } else {
        setSelection({ step: "act", action, tile: at });
      }
      return;
    }
    setSelection({ step: "move", to: at });
  }

  function tapAction(action: LegalAction): void {
    if (action.tiles.length > 0) {
      setSelection({ step: "tile", action });
      return;
    }
    if (action.needsTarget) {
      setSelection({ step: "target", action });
      return;
    }
    setSelection({ step: "act", action });
  }

  /** The figures pickable right now, already filtered by the server's list. */
  const targetIds: readonly string[] =
    selection.step === "target"
      ? selection.action.targets
      : selection.step === "tile-target"
        ? (selection.action.tileTargets?.find((o) => samePosition(o.tile, selection.tile))
            ?.targets ?? [])
        : [];

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

      {/* The party at a glance — number first, bar never (spec §11). */}
      <ul className="combat__party" aria-label="The party">
        {partyCombatants.map((c) => (
          <li className={`kad-chip${c.down ? " kad-chip--bad" : ""}`} key={c.id}>
            <Icon name={combatantIcon(c, party)} />
            <span>{c.name}</span>
            <span className="combat__hp">
              <Icon name="heart" />
              {c.hp}/{c.maxHp}
            </span>
            {c.down ? <Icon name="down" label="Knocked down" /> : null}
          </li>
        ))}
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
                <span>{selection.action.name} — tap a glowing tile.</span>
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

          {selection.step === "target" || selection.step === "tile-target" ? (
            <div className="combat__aim">
              <p className="prompt__sub kad-muted">
                <Icon name={selection.action.icon} />
                <span>{selection.action.name} — who?</span>
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
                        onClick={() =>
                          setSelection({
                            step: "act",
                            action: selection.action,
                            targetId,
                            ...(selection.step === "tile-target" ? { tile: selection.tile } : {}),
                          })
                        }
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
              onGo={() =>
                void dispatch({
                  type: "COMBAT_ACTION",
                  abilityId: selection.action.abilityId,
                  ...(selection.targetId ? { targetId: selection.targetId } : {}),
                  ...(selection.tile ? { targetTile: selection.tile } : {}),
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
  const target = selection.targetId ? combatantById(encounter, selection.targetId) : null;
  if (target) return `${selection.action.name} — ${combatantLabel(target)}`;
  if (selection.tile) {
    return `${selection.action.name} — column ${selection.tile.x + 1}, row ${selection.tile.y + 1}`;
  }
  return selection.action.name;
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
