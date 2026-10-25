/**
 * The Web Share Target (`share_target` in the install manifest, #461): a
 * family shares a join link, or the four letters off the TV, to the installed
 * app, and the app opens on that room. Pure: the router runs it on `/share`'s
 * query and navigates to what it returns.
 */

import { formatRoute, isRoomCode } from "../router";

export interface SharedContent {
  title?: string | null;
  text?: string | null;
  url?: string | null;
}

/** A join link's room path: `/p/ABCD` or `/tv/ABCD` (or a visitor code's six). */
const ROOM_PATH = /\/(?:p|tv)\/([A-Za-z0-9]{4,6})(?![A-Za-z0-9])/;

/** Four (or six) capitals standing alone in the words: "code is ABCD". */
const BARE_CODE = /(?<![A-Za-z0-9_-])([A-Z0-9]{4}|[A-Z0-9]{6})(?![A-Za-z0-9_-])/;

/** The room code in what was shared, uppercase, or `null`. A join URL wins over a bare code. */
export function roomCodeFromShare(shared: SharedContent): string | null {
  const parts = [shared.url, shared.text, shared.title].filter((part): part is string => typeof part === "string" && part !== "");
  for (const part of parts) {
    const code = ROOM_PATH.exec(part)?.[1]?.toUpperCase();
    if (code !== undefined && isRoomCode(code)) return code;
  }
  for (const part of parts) {
    const code = BARE_CODE.exec(part)?.[1];
    if (code !== undefined && isRoomCode(code)) return code;
  }
  return null;
}

/** Where `/share?title=&text=&url=` goes: the player route of the room it names, or home. */
export function shareDestination(search: string): string {
  const params = new URLSearchParams(search);
  const code = roomCodeFromShare({ title: params.get("title"), text: params.get("text"), url: params.get("url") });
  return code === null ? formatRoute({ name: "home" }) : formatRoute({ name: "player", code });
}
