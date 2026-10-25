/**
 * Sharing the room invite (#462): the host's phone or tablet hands the join
 * link to a messaging app with Web Share, else copies it, else shows it to
 * select by hand. The choice and the words are pure so they test without a
 * browser; the one impure helper, `shareInvite`, only calls what the choice
 * names. The TV never offers this.
 */

export const INVITE_TITLE = "Kids & Dragons";

/** Where a scanning or tapping phone lands (architecture §4.6 routes). The QR uses this too. */
export function joinUrl(code: string, origin?: string): string {
  const base = origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  return `${base}/p/${code}`;
}

export function inviteText(url: string): string {
  return `Join our Kids & Dragons game: ${url}`;
}

export interface ShareData {
  title: string;
  text: string;
  url: string;
}

export function inviteData(url: string): ShareData {
  return { title: INVITE_TITLE, text: inviteText(url), url };
}

export type ShareMethod = "share" | "copy" | "show";

/** The slice of `navigator` the decision reads, so tests pass plain objects. */
export interface ShareEnv {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText?: (text: string) => Promise<void> };
}

/** Share if the browser can; else copy; else show the link. */
export function chooseShareMethod(env: ShareEnv, data: ShareData): ShareMethod {
  if (typeof env.share === "function" && (typeof env.canShare !== "function" || env.canShare(data))) {
    return "share";
  }
  if (typeof env.clipboard?.writeText === "function") return "copy";
  return "show";
}

export type ShareOutcome = "shared" | "copied" | "shown" | "cancelled";

/**
 * Runs the chosen method. A closed share sheet is "cancelled" (nothing to
 * say); a share or copy that throws for any other reason falls to the next
 * way, ending at "shown".
 */
export async function shareInvite(env: ShareEnv, data: ShareData): Promise<ShareOutcome> {
  const method = chooseShareMethod(env, data);
  if (method === "share") {
    try {
      await env.share?.(data);
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
      if (typeof env.clipboard?.writeText !== "function") return "shown";
    }
  }
  if (method !== "show") {
    try {
      await env.clipboard?.writeText?.(data.url);
      return "copied";
    } catch {
      return "shown";
    }
  }
  return "shown";
}
