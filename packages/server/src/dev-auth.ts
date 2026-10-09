/**
 * Local stand-in for the Cognito id-token verifier — the dev-server twin of
 * `verifyAccountToken` in `lambda/runtime.ts`.
 *
 * There is no user pool on a laptop, but the sign-in path (claim, restore,
 * adopt) should still be walkable end to end, and the dev table now survives a
 * restart, so an account made here is one you can come back to. A dev token is
 * `dev.<base64url({"email":…})>`: **unsigned**, like `DevIdentity`. It proves
 * nothing, which is fine for a server that only ever runs on a developer's
 * machine and is never constructed by the Lambda entry point.
 *
 * The account's sub is derived from the email, so the same address always
 * lands on the same household.
 */

import { createHash } from "node:crypto";
import type { VerifiedAccount } from "./lambda/runtime.ts";

const PREFIX = "dev.";

export function devAccountSub(email: string): string {
  return `dev-${createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24)}`;
}

/** `null` for anything that is not a well-formed dev token. Never throws. */
export function verifyDevToken(token: string): VerifiedAccount | null {
  if (!token.startsWith(PREFIX)) return null;
  try {
    const claims = JSON.parse(Buffer.from(token.slice(PREFIX.length), "base64url").toString("utf8")) as {
      email?: unknown;
    };
    if (typeof claims.email !== "string" || !claims.email.includes("@")) return null;
    const email = claims.email.trim().toLowerCase();
    return { cognitoSub: devAccountSub(email), email };
  } catch {
    return null;
  }
}
