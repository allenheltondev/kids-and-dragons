/**
 * `GET /api/health`: whether this API can actually run a game, not merely answer.
 *
 * It used to return `{ ok: true }` from a function that loaded nothing, so a
 * deploy whose content would not load, or whose stack had lost a variable,
 * still reported healthy; the first family to tap found out instead. The
 * answer now comes from booting what a real request boots:
 *
 *   - the handler dependencies (configuration, the engine, the content), and
 *   - the content actually holding chapters.
 *
 * `?deep=1` adds one read of the table, for the post-deploy smoke test
 * (`tools/deploy/smoke.ts`). The plain form still never touches the table:
 * it must answer when the table cannot, and say what does work.
 *
 * Both transports call this (`lambda/http.ts`, `dev-server.ts`), so the answer
 * has one shape.
 *
 * The body says which part failed and nothing more. The endpoint is public,
 * and the detail (paths, variable names, SDK messages) goes to the log.
 */

import type { HandlerDeps } from "./deps.ts";
import { iso } from "./deps.ts";

/**
 * A room code no room can have: codes are four letters (`room.ts`), so this
 * key is never written, and reading it costs one empty lookup.
 */
export const HEALTH_PROBE_ROOM = "HEALTH-PROBE";

export type HealthFailure = "boot" | "content" | "store";

export interface HealthReport {
  ok: boolean;
  service: string;
  time: string;
  /** What the content loader holds. Absent when the API could not boot. */
  content?: { chapters: number; campaigns: number; rulesVersion: number };
  /** Only with `?deep=1`: whether one read of the table came back. */
  store?: "ok" | "unreachable";
  /** Which part is broken. Absent when `ok`. */
  failed?: HealthFailure;
}

export interface HealthOptions {
  service: string;
  /** Also read the table once. */
  deep?: boolean;
  now?: number;
  /** Where the detail goes; the body never carries it. */
  log?: (message: string, error?: unknown) => void;
}

export interface HealthResult {
  status: 200 | 503;
  body: HealthReport;
}

/** `?deep=1`, `?deep=true` or a bare `?deep`. */
export function wantsDeep(query: Record<string, unknown>): boolean {
  const value = query.deep;
  return value === "" || value === "1" || value === "true";
}

export async function checkHealth(boot: () => Promise<HandlerDeps>, options: HealthOptions): Promise<HealthResult> {
  const log = options.log ?? ((message, error) => console.error(message, error));
  const base = { service: options.service, time: iso(options.now ?? Date.now()) };
  const broken = (failed: HealthFailure, extra: Partial<HealthReport> = {}): HealthResult => ({
    status: 503,
    body: { ok: false, ...base, ...extra, failed },
  });

  let deps: HandlerDeps;
  try {
    deps = await boot();
  } catch (error) {
    log("[health] the API cannot boot", error);
    return broken("boot");
  }

  let content: NonNullable<HealthReport["content"]>;
  try {
    content = {
      chapters: deps.content.chapterIds().length,
      campaigns: deps.content.campaignIds().length,
      rulesVersion: deps.content.rules().version,
    };
  } catch (error) {
    log("[health] the content cannot be read", error);
    return broken("content");
  }
  // The loader throws on a malformed file, but a deploy that shipped no chapters at all has
  // nothing malformed in it. Campaigns are reported and not required: a chapter can be played
  // outside one.
  if (content.chapters === 0) {
    log(`[health] the content is empty: ${content.chapters} chapter(s), ${content.campaigns} campaign(s)`);
    return broken("content", { content });
  }

  if (!options.deep) return { status: 200, body: { ok: true, ...base, content } };

  try {
    await deps.repo.getRoom(HEALTH_PROBE_ROOM);
  } catch (error) {
    log("[health] the table cannot be read", error);
    return broken("store", { content, store: "unreachable" });
  }
  return { status: 200, body: { ok: true, ...base, content, store: "ok" } };
}
