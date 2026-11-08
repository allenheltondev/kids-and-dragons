/**
 * The adventure book while its kid is seated at a live game (docs/camp.md §7;
 * owner 2026-11-08): what of her hero's kit and look the book may change, and
 * how it hands her back to the table.
 *
 * The table reads a seated hero's kit and look afresh as each downtime moment
 * begins (server camp-edit.ts `syncCampDowntime`), and keeps its own copy
 * through the moment. So:
 *
 *   - **In a scene, a check or a fight** nothing at the table can change her,
 *     and the book saves her picks as ever: she wears them from the next rest
 *     (`BookTableNote` says so).
 *   - **In downtime** (the lobby, a rest, the chapter's end) the table's Camp
 *     panel is her editor, so the two never hold different copies: the book
 *     hands off, a tap opening the game's Camp at that hero's part
 *     (`handOffToCamp`), and the note offers the same.
 *
 * A hero of hers not seated at this table, or a book read with no game, is
 * the book's as it always was.
 */

import type { ReactElement } from "react";
import { campMomentKind } from "@kad/shared";
import { useGameStore } from "../store";
import { navigate } from "../router";
import { openCampPanel, type CampFocus } from "./camp-panel";
import { Icon } from "./icons";

/** Where a hero stands at the live game this phone is seated at. */
export interface BookTable {
  /** The room, to go back to. */
  code: string;
  /** The table is in downtime: its Camp panel is her editor now. */
  downtime: boolean;
}

/**
 * The live game `heroId` is seated at on this phone, as her own kid's hero, or
 * null. Selected as a string, so the store hands back the same value until it
 * changes (a new object every read would re-render for ever).
 */
export function useBookTable(heroId: string | null | undefined): BookTable | null {
  const where = useGameStore((store) => {
    const { state, session } = store;
    if (!heroId || !state || !session?.playerId || state.roomCode !== session.roomCode) return "";
    if ((state.removed ?? []).includes(session.playerId)) return "";
    if (!state.party.some((m) => m.playerId === session.playerId && m.character.id === heroId)) return "";
    return `${campMomentKind(state) === null ? "play" : "camp"}:${session.roomCode}`;
  });
  if (!where) return null;
  const at = where.indexOf(":");
  return { code: where.slice(at + 1), downtime: where.slice(0, at) === "camp" };
}

/** Back to the game, with its Camp panel open at `focus`. */
export function handOffToCamp(table: BookTable, focus: CampFocus): void {
  openCampPanel(focus);
  navigate({ name: "player", code: table.code });
}

/** What the book says above a seated hero's shelves: when her picks show, or the way to the table's Camp. */
export function BookTableNote({ table, focus }: { table: BookTable; focus: CampFocus }): ReactElement {
  if (!table.downtime) {
    return (
      <p className="book-camp__table" role="status" data-testid="book-table-note">
        <Icon name="waiting" />
        <span>Pick away! You'll wear it at your next rest.</span>
      </p>
    );
  }
  return (
    <div className="book-camp__table book-camp__table--camp" data-testid="book-table-note">
      <Icon name="rest" />
      <span>Your game is at camp right now. Change it there!</span>
      <button type="button" className="book-camp__table-go kad-tap kad-focusable" onClick={() => handOffToCamp(table, focus)} data-testid="book-table-go">
        Change it at camp
      </button>
    </div>
  );
}
