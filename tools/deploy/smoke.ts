/**
 * The post-deploy smoke test: is the site that was just deployed able to run a game?
 *
 *   npm run deploy:smoke -- --site https://kd.readysetcloud.io
 *
 * The deploy used to end with one `curl` of the home page. That proves CloudFront serves an
 * HTML file, and nothing about the API behind it, the content it loaded, the table, the
 * bundle the page asks for, or the art. This asks the deployed site for each of those, the way
 * a phone opening the game would, and reads nothing private and writes nothing:
 *
 *   - the page, and the script bundle it names;
 *   - `/api/health?deep=1` (packages/server/src/handlers/health.ts): the API booted, holds
 *     chapters, and can read its table;
 *   - `/api/config`: what the client needs before it can sign in or subscribe;
 *   - a routed request refused in the API's own error shape, so a handler really ran;
 *   - `/content/rules.json` on the site, at the same version the API loaded;
 *   - `/assets/manifest.json`, the art's index.
 *
 * It prints a line per check and exits 1 if any fails. By then the deploy has already
 * happened: a failure here does not roll anything back, it makes the run red so the break is
 * found by the deploy and not by a family.
 *
 * Built-ins only (fetch), so it runs on the deploy job without node_modules.
 */

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export interface SiteSmokeOptions {
  /** The site's address, e.g. https://kd.readysetcloud.io. */
  site: string;
  log?: (line: string) => void;
  /** How many times a request that failed to answer, or answered 502/503/504, is tried. */
  tries?: number;
  /** Milliseconds between tries: a cold start or a CloudFront invalidation needs a moment. */
  wait?: number;
}

export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

interface Answer {
  status: number;
  type: string;
  text: string;
  json: unknown;
}

const RETRYABLE = new Set([502, 503, 504]);

/** GET, tried again when there was no answer or a gateway's "not yet". Never throws. */
async function get(url: string, tries: number, wait: number): Promise<Answer | { status: 0; error: string }> {
  let last: Answer | { status: 0; error: string } = { status: 0, error: "no attempt made" };
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0 && wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      last = { status: res.status, type: res.headers.get("content-type") ?? "", text, json };
      if (!RETRYABLE.has(res.status)) return last;
    } catch (error) {
      last = { status: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return last;
}

const said = (answer: Answer | { status: 0; error: string }): string =>
  answer.status === 0 ? `no answer (${(answer as { error: string }).error})` : `HTTP ${answer.status}`;

const field = (value: unknown, ...keys: string[]): unknown => {
  let at = value;
  for (const key of keys) at = at && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined;
  return at;
};

export async function runSiteSmoke(options: SiteSmokeOptions): Promise<SmokeCheck[]> {
  const log = options.log ?? (() => {});
  const tries = options.tries ?? 4;
  const wait = options.wait ?? 5000;
  const site = options.site.replace(/\/+$/, "");
  const checks: SmokeCheck[] = [];
  const check = (name: string, ok: boolean, detail: string): boolean => {
    checks.push({ name, ok, detail });
    log(`  ${ok ? "pass" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
    return ok;
  };
  const ask = (path: string) => get(`${site}${path}`, tries, wait);

  // The page, and the script it asks for. A deploy that pruned a bundle the page still names
  // serves a page that never starts.
  const page = await ask("/");
  const html = page.status === 200 ? (page as Answer).text : "";
  check("the site serves the page", page.status === 200 && /<html/i.test(html), said(page));
  const script = /(?:src|href)="\/?(bundle\/[^"]+\.js)"/.exec(html)?.[1];
  if (check("the page names a script bundle", script !== undefined, script ?? "no bundle/*.js in the page")) {
    const bundle = await ask(`/${script}`);
    const size = bundle.status === 200 ? (bundle as Answer).text.length : 0;
    check("the site serves that bundle", bundle.status === 200 && size > 0, `${said(bundle)}, ${size} bytes`);
  }

  // The API: booted, holding content, reading its table.
  const health = await ask("/api/health?deep=1");
  const report = health.status === 0 ? undefined : (health as Answer).json;
  check("the API is healthy", health.status === 200 && field(report, "ok") === true, `${said(health)}${field(report, "failed") ? `, failed: ${String(field(report, "failed"))}` : ""}`);
  const chapters = Number(field(report, "content", "chapters") ?? 0);
  check("the API loaded its chapters", chapters > 0, `${chapters} chapter(s), ${Number(field(report, "content", "campaigns") ?? 0)} campaign(s)`);
  check("the API can read its table", field(report, "store") === "ok", `store: ${String(field(report, "store") ?? "not reported")}`);

  const config = await ask("/api/config");
  const needs = [["realtime", "httpDomain"], ["realtime", "realtimeDomain"], ["auth", "userPoolId"], ["auth", "clientId"]];
  const missing = needs.filter((keys) => typeof field(config.status === 0 ? undefined : (config as Answer).json, ...keys) !== "string").map((keys) => keys.join("."));
  check("the API hands the client its configuration", config.status === 200 && missing.length === 0, missing.length ? `${said(config)}, missing ${missing.join(", ")}` : said(config));

  // A request that reaches a handler and is turned down by it: no room, no token, nothing written.
  const refused = await ask("/api/state");
  const refusal = refused.status === 0 ? undefined : (refused as Answer).json;
  check(
    "a routed request is refused in the API's own shape",
    refused.status === 400 && field(refusal, "ok") === false && typeof field(refusal, "error", "code") === "string",
    `${said(refused)}${field(refusal, "error", "code") ? ` ${String(field(refusal, "error", "code"))}` : ""}`,
  );

  // The static content the client reads, at the version the API loaded. The two ship in one
  // deploy but by different routes (the Lambda's package, the site bucket), so they can part.
  const rules = await ask("/content/rules.json");
  const siteVersion = field(rules.status === 0 ? undefined : (rules as Answer).json, "version");
  const apiVersion = field(report, "content", "rulesVersion");
  check("the site serves the content", rules.status === 200 && typeof siteVersion === "number", said(rules));
  check("the site's content is the version the API loaded", typeof siteVersion === "number" && siteVersion === apiVersion, `site ${String(siteVersion)}, API ${String(apiVersion)}`);

  const manifest = await ask("/assets/manifest.json");
  check("the site serves the art's index", manifest.status === 200 && typeof (manifest as Answer).json === "object" && (manifest as Answer).json !== null, said(manifest));

  return checks;
}

// Run directly, not imported. Compared as URLs, so it is true on Windows too.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { site: { type: "string" }, tries: { type: "string" }, wait: { type: "string" } } });
  if (!values.site || !/^https?:\/\//.test(values.site)) {
    console.error("usage: npm run deploy:smoke -- --site https://<the site> [--tries 4] [--wait 5000]");
    process.exit(2);
  }
  console.log(`deploy:smoke against ${values.site}`);
  runSiteSmoke({
    site: values.site,
    log: (line) => console.log(line),
    ...(values.tries ? { tries: Number(values.tries) } : {}),
    ...(values.wait ? { wait: Number(values.wait) } : {}),
  }).then(
    (checks) => {
      const failed = checks.filter((c) => !c.ok);
      console.log(failed.length ? `\n${failed.length} of ${checks.length} checks failed.` : `\nAll ${checks.length} checks passed.`);
      // exitCode, not exit(): on Windows, exiting while fetch still holds a socket open
      // aborts the process with a crash code in place of the one meant.
      process.exitCode = failed.length ? 1 : 0;
    },
    (error: unknown) => {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
