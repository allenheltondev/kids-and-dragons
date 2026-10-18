/** How a bound tablet is named on the organizer panel (#273): "iPad, last used Tuesday". */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A friendly name from the browser's user agent, since that is all a tablet gives. */
export function tabletName(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone|iPod/i.test(ua)) return "iPhone";
  if (/Silk|KFAPWI|Kindle/i.test(ua)) return "Fire tablet";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows computer";
  return "Tablet";
}

/** "today", "yesterday", a weekday within the last week, else the date. */
export function lastUsed(lastSeen: string, now: number): string {
  const seen = new Date(lastSeen);
  if (Number.isNaN(seen.getTime())) return "a while ago";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const seenDay = new Date(seen);
  seenDay.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - seenDay.getTime()) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return WEEKDAYS[seen.getDay()] ?? "this week";
  return seen.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
