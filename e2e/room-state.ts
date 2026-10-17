/**
 * The server's state for a room, read the way a seated phone reads it.
 *
 * `GET /api/state` answers only somebody in the room: a session or viewer
 * token for it (#267). So a test reads with the session token a phone in the
 * room saved when it joined, the same token the phone itself would send.
 */

import type { Page } from "@playwright/test";

export async function roomState<T>(page: Page, code: string): Promise<T> {
  const token = await page.evaluate((room) => {
    const saved = localStorage.getItem(`kad.session.${room.toUpperCase()}`);
    return saved ? (JSON.parse(saved) as { sessionToken?: string }).sessionToken ?? "" : "";
  }, code);
  const response = await fetch(`http://localhost:8787/api/state?code=${code}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`state for ${code}: ${response.status} (is this page in the room?)`);
  return ((await response.json()) as { state: T }).state;
}
