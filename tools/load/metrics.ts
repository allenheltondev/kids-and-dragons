/**
 * What the load run measured, and how it is reported.
 *
 * Every request the simulated phones make goes through one `Recorder`. It keeps
 * the raw latencies per route (a soak is a few hundred thousand numbers, which
 * is nothing) so the percentiles are exact, and a count per wall-clock second
 * (by when it was sent) so the report can say what the busiest second asked of
 * API Gateway's 50 rps.
 *
 * Two answers are counted that are not HTTP failures:
 *  - 429, which is API Gateway (or the code guard) saying slow down;
 *  - `STALE_SEQ`, which `/api/action` returns with a 200 (architecture §4.2):
 *    the phone acted on a seq that had moved. It is the protocol working, and
 *    its rate is the cost of all of a room's actions sharing one run's seq.
 */

export interface Sample {
  route: string;
  /** HTTP status; 0 when nothing came back (a timeout or a refused connection). */
  status: number;
  ms: number;
  /** `error.code` of an `/api/action` answer that was refused, for example `STALE_SEQ`. */
  code?: string | undefined;
  /**
   * When the request was sent, ms since epoch. Not when it finished: under
   * saturation answers queue and arrive in clumps, and the busiest second is
   * compared with API Gateway's limit on requests *arriving*.
   */
  at: number;
}

export interface RouteReport {
  route: string;
  count: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  tooMany: number;
  staleSeq: number;
  /** Everything else that was not a success: 4xx other than 429, 5xx, and no answer. */
  errors: number;
}

export interface Report {
  seconds: number;
  total: number;
  rps: number;
  /** Requests in the busiest single wall-clock second. */
  peakRps: number;
  tooMany: number;
  staleSeq: number;
  errors: number;
  routes: RouteReport[];
}

/** Nearest-rank percentile of an ascending list; 0 for an empty one. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

/**
 * A refused action that is part of normal play is not an error: `STALE_SEQ`
 * is counted on its own. `ILLEGAL` is the script's mistake (it sent something
 * the engine would not take), and that is an error.
 */
function isError(s: Sample): boolean {
  if (s.status === 429) return false;
  if (s.code === "STALE_SEQ") return false;
  return s.status === 0 || s.status >= 400 || s.code !== undefined;
}

export class Recorder {
  private readonly samples: Sample[] = [];
  private readonly perSecond = new Map<number, number>();

  record(sample: Sample): void {
    this.samples.push(sample);
    const second = Math.floor(sample.at / 1000);
    this.perSecond.set(second, (this.perSecond.get(second) ?? 0) + 1);
  }

  get size(): number {
    return this.samples.length;
  }

  report(seconds: number): Report {
    const span = Math.max(seconds, 1e-9);
    const byRoute = new Map<string, Sample[]>();
    for (const s of this.samples) {
      const list = byRoute.get(s.route);
      if (list) list.push(s);
      else byRoute.set(s.route, [s]);
    }
    const routes: RouteReport[] = [...byRoute.entries()]
      .map(([route, list]) => {
        const sorted = list.map((s) => s.ms).sort((a, b) => a - b);
        return {
          route,
          count: list.length,
          rps: list.length / span,
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
          p99: percentile(sorted, 99),
          max: sorted[sorted.length - 1] ?? 0,
          tooMany: list.filter((s) => s.status === 429).length,
          staleSeq: list.filter((s) => s.code === "STALE_SEQ").length,
          errors: list.filter(isError).length,
        };
      })
      .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route));
    const sum = (pick: (r: RouteReport) => number) => routes.reduce((n, r) => n + pick(r), 0);
    return {
      seconds,
      total: this.samples.length,
      rps: this.samples.length / span,
      peakRps: Math.max(0, ...this.perSecond.values()),
      tooMany: sum((r) => r.tooMany),
      staleSeq: sum((r) => r.staleSeq),
      errors: sum((r) => r.errors),
      routes,
    };
  }
}

/** What ends a ramp: the first stage past any of these is the limit. */
export interface Limits {
  /** Share of requests that were errors (not 429, not STALE_SEQ), 0 to 1. */
  errorRate: number;
  /** Share of requests that were answered 429, 0 to 1. */
  tooManyRate: number;
  /** p95 of `POST /api/action`, ms. */
  actionP95Ms: number;
}

export const DEFAULT_LIMITS: Limits = { errorRate: 0.01, tooManyRate: 0.01, actionP95Ms: 2000 };

/** Why a stage is past the limit; empty when it is not. */
export function limitsHit(report: Report, limits: Limits): string[] {
  const hit: string[] = [];
  const share = (n: number) => (report.total === 0 ? 0 : n / report.total);
  if (share(report.errors) > limits.errorRate) hit.push(`errors ${pct(report.errors, report.total)} of requests (limit ${limits.errorRate * 100}%)`);
  if (share(report.tooMany) > limits.tooManyRate) hit.push(`429 on ${pct(report.tooMany, report.total)} of requests (limit ${limits.tooManyRate * 100}%)`);
  const action = report.routes.find((r) => r.route === "POST /api/action");
  if (action && action.p95 > limits.actionP95Ms) hit.push(`POST /api/action p95 ${ms(action.p95)}ms (limit ${limits.actionP95Ms}ms)`);
  return hit;
}

const pct = (part: number, whole: number): string =>
  whole === 0 ? "0%" : `${((part / whole) * 100).toFixed(part / whole < 0.1 ? 2 : 1)}%`;

const ms = (n: number): string => (n >= 100 ? n.toFixed(0) : n.toFixed(1));

/** The report as a Markdown table, ready to paste into `docs/review/load-<date>.md`. */
export function renderMarkdown(report: Report): string {
  const lines = [
    `Requests: ${report.total} in ${report.seconds.toFixed(0)}s = ${report.rps.toFixed(1)}/s average, ${report.peakRps}/s in the busiest second.`,
    `429: ${report.tooMany} (${pct(report.tooMany, report.total)}). STALE_SEQ: ${report.staleSeq} (${pct(report.staleSeq, report.total)}). Errors: ${report.errors} (${pct(report.errors, report.total)}).`,
    "",
    "| Route | Count | /s | p50 ms | p95 ms | p99 ms | max ms | 429 | STALE_SEQ | Errors |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...report.routes.map(
      (r) =>
        `| ${r.route} | ${r.count} | ${r.rps.toFixed(2)} | ${ms(r.p50)} | ${ms(r.p95)} | ${ms(r.p99)} | ${ms(r.max)} | ${r.tooMany} | ${r.staleSeq} | ${r.errors} |`,
    ),
  ];
  return lines.join("\n");
}
