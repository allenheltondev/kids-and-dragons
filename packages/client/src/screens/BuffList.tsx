/**
 * BuffList — the party's temporary buffs (#200), small.
 *
 * One line per buff: its glyph, its name, what it does as a signed number in
 * words ("+1 Guard"), and how long it has left. A burden — the cost side of a
 * rift's tradeoff — also says "Cost" in a chip, so it is never told apart by
 * colour alone (spec §11). Drawn by the journey panel between chapters and by
 * the combat panel in a fight; both hand it plain rows, so it knows nothing
 * of where they came from.
 */

import type { ReactElement } from "react";
import type { BuffKind, CombatBuff, JourneyBuffView } from "@kad/shared";
import { buffAmountText, buffIcon, buffRemainingText, buffTargetText, buffTurnsText, isBurden } from "./buff-copy";
import { Icon } from "./icons";
import "./shared.css";
import "./BuffList.css";

export interface BuffRow {
  key: string;
  label: string;
  kind: BuffKind;
  amount: number;
  /** How long it has left, and on whom, in words. */
  detail: string;
}

export function BuffList({ rows, title }: { rows: readonly BuffRow[]; title: string }): ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <ul className="buffs" aria-label={title}>
      {rows.map((row) => (
        <li className="buffs__row" key={row.key}>
          <Icon name={buffIcon(row.kind)} />
          <span className="buffs__text">
            <b>{row.label}</b>: {buffAmountText(row.kind, row.amount)}
            <span className="buffs__detail"> · {row.detail}</span>
          </span>
          {isBurden(row.amount) ? (
            <span className="kad-chip kad-chip--warn">
              <Icon name="close" />
              <span>Cost</span>
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Rows for the journey panel: what the party holds between fights. */
export function journeyBuffRows(buffs: readonly JourneyBuffView[] | undefined): BuffRow[] {
  return (buffs ?? []).map((buff) => ({
    key: buff.id,
    label: buff.stacks > 1 ? `${buff.label} ×${buff.stacks}` : buff.label,
    kind: buff.kind,
    amount: buff.amount,
    detail: `${buffTargetText(buff.target)}, ${buffRemainingText(buff.remaining)}`,
  }));
}

/** Rows for the combat panel: what is on this hero in this fight. */
export function combatBuffRows(buffs: readonly CombatBuff[] | undefined, heroId: string | null): BuffRow[] {
  if (heroId === null) return [];
  return (buffs ?? [])
    .filter((buff) => buff.heroId === heroId)
    .map((buff) => ({
      key: buff.id,
      label: buff.label,
      kind: buff.kind,
      amount: buff.amount,
      detail: buffTurnsText(buff.turnsLeft),
    }));
}
