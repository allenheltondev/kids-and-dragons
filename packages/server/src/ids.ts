/**
 * Entity ids.
 *
 * Short, prefixed, and readable in a log line — the ids in architecture §3 look
 * like `h_4k2`, `p_1`, `c_9x1`, `r_88c`, and keeping that shape means a
 * DynamoDB item you print during a play session is legible without a decoder.
 * Prefixes are also what make a mis-wired id obvious at a glance.
 */

import { randomUUID } from "node:crypto";

export type IdPrefix = "h" | "p" | "d" | "c" | "r";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}
