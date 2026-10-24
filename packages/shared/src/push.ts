/**
 * "It's your turn" while the app is in the background (#466): the words and
 * the wire shapes the server's push, the service worker and the Account
 * screen's switch share.
 *
 * The notification never says more than `PUSH_BODY` (#320): not the kid's
 * name, not the hero's, not the room's, not what the question is. A lock
 * screen is read by whoever picks the phone up. The room's path rides in the
 * encrypted payload as data, so a tap opens the right table, and is never
 * shown.
 */

/** The notification's title. */
export const PUSH_TITLE = "Kids & Dragons";

/** The notification's only words, exactly (#320). */
export const PUSH_BODY = "It's your turn in Kids & Dragons";

/** One tag for every turn, so a second push replaces the first rather than stacking. */
export const PUSH_TAG = "kad-turn";

/** What the server sends, encrypted, to the service worker. */
export interface TurnPushPayload {
  title: typeof PUSH_TITLE;
  body: typeof PUSH_BODY;
  /** The room's player path on this origin, `/p/ABCD`. Opened on a tap; never shown. */
  url: string;
}

/** `GET /api/push/key`: whether this server sends pushes, and the key to subscribe with. */
export type PushKeyResponse = { enabled: false } | { enabled: true; publicKey: string };

/** `POST /api/push/subscribe`'s body: `PushSubscription.toJSON()`, as the browser gives it. */
export interface PushSubscribeRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** The payload a push carries for a room, by its code. */
export function turnPushPayload(roomCode: string): TurnPushPayload {
  return { title: PUSH_TITLE, body: PUSH_BODY, url: `/p/${encodeURIComponent(roomCode.toUpperCase())}` };
}
