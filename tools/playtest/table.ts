/**
 * A table at any chapter and any scene, for looking at the game rather than testing it.
 *
 * Investigating one scene used to mean hand-trimming a copy of a campaign so its graph would
 * start where you wanted, restarting the dev server on it, and clicking heroes into being on
 * three browsers. This opens the same table in one call:
 *
 *   const table = await openTable({ chapterId: "riftlight-stuttering-flats", sceneId: "sling" });
 *   await table.snap("before");            // TV and every phone, side by side, one PNG
 *   await table.phone(1).getByRole("button", { name: "We’re ready" }).click();
 *   await table.goto("loosen_mud");        // another scene of the same chapter
 *   await table.close();
 *
 * How it gets there is the dev server's own seed route (`POST /api/dev/seed`,
 * packages/server/src/dev-seed.ts): real handlers, real engine, a TV that opened the room and
 * phones seated in it. `chapterId` is a playtest start, so any chapter of any campaign starts,
 * out of order and unlocked, with the route flags and world facts you give it, and settles
 * nothing into a real household (it is a throwaway guest household anyway). It needs the dev
 * server's playtest switch, which only the dev server has: there is no way to point this at a
 * deployed stack.
 *
 * The CLI over this is tools/playtest/jump.ts (`npm run play:jump`).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { ClassId, ClientIntent, FactValue, RunState, SpeciesId } from "../../packages/shared/src/index.ts";
import type { SeedResponse, SeededPhone } from "../../packages/server/src/dev-seed.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

export interface TableHero { name: string; species: SpeciesId; class: ClassId }

/** A varied four, so species gates and class places can be seen. */
export const DEFAULT_HEROES: TableHero[] = [
  { name: "Aster", species: "unicorn", class: "songkeeper" },
  { name: "Fern", species: "griffin", class: "duskrunner" },
  { name: "Pip", species: "dragonling", class: "thornguard" },
  { name: "Moss", species: "bigfoot", class: "starweaver" },
];

export interface TableOptions {
  chapterId: string;
  /** A scene of that chapter; its entry when absent. */
  sceneId?: string;
  /** One to four phones. Default 2. */
  players?: number;
  heroes?: TableHero[];
  mode?: "party" | "travel";
  flags?: Record<string, boolean>;
  facts?: Record<string, FactValue>;
  /** The app, as a browser opens it. Default http://localhost:5173. */
  base?: string;
  /** The dev server's API, past Vite. Default http://localhost:8787. */
  api?: string;
  /** Show the browsers (for a person at the keyboard). Default headless. */
  headed?: boolean;
  /** Start `npm run dev` when nothing answers at `base`, and stop it on close. Default true. */
  startServer?: boolean;
  /** Pass the prefer-reduced-motion setting to every device. */
  reducedMotion?: boolean;
  /** Called with progress lines; default silent. */
  log?: (line: string) => void;
}

export interface Table {
  code: string;
  runId: string;
  tv: Page;
  phones: Page[];
  /** Phone n, 0-based. */
  phone(n: number): Page;
  /** The phone whose hero the current prompt names first (the one to drive). */
  lead(): Promise<Page>;
  /** The room's state, as a seated phone reads it. */
  state(): Promise<RunState>;
  /** Send an intent as phone n (the leader by default), retrying a lost seq race. */
  act(intent: ClientIntent, n?: number): Promise<void>;
  /** Jump the run to another scene of the chapter (the playtest cheat). */
  goto(sceneId: string): Promise<void>;
  /** Load the next d20 the run rolls, or null to roll normally again. */
  die(value: number | null): Promise<void>;
  /** Tap each phone's way into its turn ("Your turn", "Got it"), as a player would. */
  settle(): Promise<void>;
  /** TV and every phone, side by side in one labelled PNG. Returns its path. */
  snap(label: string, dir?: string): Promise<string>;
  /** Every painted frame of every device while `during` runs, as a strip of composites. */
  record(label: string, during: () => Promise<void>, options?: { dir?: string; everyMs?: number }): Promise<string[]>;
  close(): Promise<void>;
}

async function healthy(url: string): Promise<boolean> {
  try { return (await fetch(new URL("/api/health", url), { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

async function startDevServer(base: string, api: string, log: (line: string) => void): Promise<ChildProcess> {
  log(`starting the dev server (npm run dev) at ${base}…`);
  // The same environment the e2e suite gives its own server (playwright.config.ts), minus the
  // campaign pin: a playtest start names its chapter, so the lobby's campaign does not matter.
  // Its ports follow the URLs asked for, so a table can run beside a server already up.
  const env = {
    ...process.env,
    KAD_STREAM_PRESENCE: "off",
    PORT: new URL(api).port || "8787",
    KAD_CLIENT_PORT: new URL(base).port || "5173",
    KAD_DEV_API_TARGET: new URL(api).origin,
  };
  const child = spawn("npm", ["run", "dev"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  child.stdout?.on("data", (chunk) => { output += String(chunk); });
  child.stderr?.on("data", (chunk) => { output += String(chunk); });
  for (let i = 0; i < 120; i++) {
    if (await healthy(base)) return child;
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  try { process.kill(-child.pid!, "SIGTERM"); } catch { /* Already gone. */ }
  throw new Error(`the dev server did not come up at ${base}:\n${output.split("\n").filter((l) => /fail|error|•/i.test(l)).slice(0, 12).join("\n")}`);
}

function chromiumPath(): string | undefined {
  if (process.env.KAD_CHROMIUM) return process.env.KAD_CHROMIUM;
  return fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
}

function storage(base: string, entries: Record<string, unknown>) {
  return { cookies: [], origins: [{ origin: new URL(base).origin, localStorage: Object.entries(entries).map(([name, value]) => ({ name, value: JSON.stringify(value) })) }] };
}

/** Open a table seated at a chapter and scene. Throws with the server's reason when it cannot. */
export async function openTable(options: TableOptions): Promise<Table> {
  const base = options.base ?? process.env.KAD_E2E_BASE_URL ?? "http://localhost:5173";
  const api = options.api ?? process.env.KAD_E2E_API ?? "http://localhost:8787";
  const log = options.log ?? (() => undefined);
  const players = Math.max(1, Math.min(4, options.players ?? 2));
  const heroes = (options.heroes ?? DEFAULT_HEROES).slice(0, players);
  if (heroes.length < players) throw new Error(`asked for ${players} players but named ${heroes.length} heroes`);

  let server: ChildProcess | null = null;
  if (!(await healthy(base))) {
    if (options.startServer === false) throw new Error(`nothing answers at ${base}; start it with npm run dev`);
    server = await startDevServer(base, api, log);
  }

  const seed = await fetch(new URL("/api/dev/seed", api), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: options.mode ?? "party",
      tv: (options.mode ?? "party") === "party",
      heroes: heroes.map((hero) => ({ name: hero.name, species: hero.species, class: hero.class, stats: { might: 1, quick: 1, clever: 1, heart: 0 } })),
      chapterId: options.chapterId,
      ...(options.sceneId ? { sceneId: options.sceneId } : {}),
      ...(options.flags ? { flags: options.flags } : {}),
      ...(options.facts ? { facts: options.facts } : {}),
    }),
  });
  const seeded = (await seed.json()) as SeedResponse & { error?: { code: string; message: string } };
  if (!seed.ok) {
    if (server) try { process.kill(-server.pid!, "SIGTERM"); } catch { /* Already gone. */ }
    throw new Error(`the dev server refused the table: ${seeded.error?.message ?? seed.status}`);
  }
  log(`room ${seeded.code}: ${options.chapterId}${options.sceneId ? ` at ${options.sceneId}` : ""}, ${players} player${players === 1 ? "" : "s"}`);

  const executablePath = chromiumPath();
  const browser: Browser = await chromium.launch({ headless: !options.headed, ...(executablePath ? { executablePath } : {}) });
  const motion = options.reducedMotion ? { reducedMotion: "reduce" as const } : {};
  const contexts: BrowserContext[] = [];
  let tv: Page;
  if (seeded.tv) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...motion, storageState: storage(base, {
      "kad.device": { householdId: seeded.tv.householdId, playerId: seeded.tv.playerId, displayName: "", deviceToken: seeded.tv.deviceToken, screenOnly: true },
    }) });
    contexts.push(context);
    tv = await context.newPage();
    await tv.goto(new URL(`/tv/${seeded.code}`, base).href);
  } else {
    // Travel Mode has no TV: the first phone's world pane is the shared view.
    tv = null as unknown as Page;
  }
  const phones: Page[] = [];
  for (const phone of seeded.phones) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...motion, storageState: storage(base, {
      "kad.device": { householdId: phone.householdId, playerId: phone.playerId, displayName: phone.displayName, deviceToken: phone.deviceToken },
      [`kad.session.${phone.session.roomCode}`]: { ...phone.session, savedAt: Date.now() },
    }) });
    contexts.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(new URL(`/p/${phone.session.roomCode}`, base).href);
    phones.push(page);
  }
  if (!seeded.tv) tv = phones[0]!;

  const byPlayer = new Map(seeded.phones.map((phone, i) => [phone.playerId, i]));
  const sessionOf = (n: number): SeededPhone => seeded.phones[n] ?? seeded.phones[0]!;
  const state = async (): Promise<RunState> => {
    const response = await fetch(new URL(`/api/state?code=${seeded.code}`, api), { headers: { authorization: `Bearer ${sessionOf(0).session.sessionToken}` } });
    return ((await response.json()) as { state: RunState }).state;
  };
  const act = async (intent: ClientIntent, n = 0): Promise<void> => {
    const phone = sessionOf(n);
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await state();
      const response = await fetch(new URL("/api/action", api), {
        method: "POST",
        headers: { authorization: `Bearer ${phone.session.sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ runId: current.runId, seq: current.seq, playerId: phone.playerId, intent }),
      });
      const result = (await response.json()) as { ok: boolean; error?: { code: string; message: string } };
      if (result.ok) return;
      if (result.error?.code !== "STALE_SEQ") throw new Error(`${intent.type}: ${result.error?.message ?? response.status}`);
    }
    throw new Error(`${intent.type} kept losing the seq race`);
  };
  const settle = async (): Promise<void> => {
    await tv.waitForTimeout(400);
    for (const page of phones) {
      for (const name of [/^Got it$/i, /^(Your turn|Ready to play|View the fight)$/i]) {
        const button = page.getByRole("button", { name }).and(page.locator("button:not(.choice)")).first();
        if (await button.isVisible().catch(() => false)) await button.click().catch(() => undefined);
      }
    }
    await tv.waitForTimeout(300);
  };
  const outDir = (dir?: string) => {
    const resolved = path.resolve(dir ?? process.env.KAD_PLAYTEST_OUT ?? path.join(ROOT, "test-results", "playtest"));
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
  };
  /** Lays the device images out in a page and screenshots it: no image library needed. */
  const composite = async (images: Buffer[], label: string, file: string): Promise<string> => {
    const page = await browser.newPage({ viewport: { width: 1280 + phones.length * 420, height: 900 } });
    const names = seeded.tv ? ["TV", ...seeded.phones.map((p) => p.name)] : seeded.phones.map((p) => p.name);
    const cells = images.map((image, i) => `<figure><figcaption>${names[i] ?? ""}</figcaption><img src="data:image/png;base64,${image.toString("base64")}" class="${seeded.tv && i === 0 ? "tv" : "phone"}"></figure>`).join("");
    await page.setContent(`<style>body{margin:0;background:#111;color:#ff0;font:14px sans-serif}h1{font-size:15px;margin:6px 10px}main{display:flex;gap:12px;padding:0 10px 10px;align-items:flex-start}figure{margin:0}figcaption{margin-bottom:4px}img.tv{width:1280px}img.phone{width:390px}</style><h1>${label.replace(/[<&]/g, "")}</h1><main>${cells}</main>`);
    await page.locator("main").screenshot({ path: file });
    await page.close();
    return file;
  };
  const shoot = async () => Promise.all([...(seeded.tv ? [tv] : []), ...phones].map((page) => page.screenshot()));
  const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "snap";

  return {
    code: seeded.code,
    runId: seeded.runId,
    tv,
    phones,
    phone: (n) => phones[n] ?? phones[0]!,
    async lead() {
      const current = await state();
      const prompt = current.prompt as { actorId?: string; forPlayerIds?: string[] } | null;
      const id = prompt?.actorId ?? prompt?.forPlayerIds?.[0];
      return phones[id ? byPlayer.get(id) ?? 0 : 0] ?? phones[0]!;
    },
    state,
    act,
    async goto(sceneId) { await act({ type: "PLAYTEST_GOTO", sceneId }); await settle(); },
    async die(value) { await act({ type: "PLAYTEST_SET_DIE", die: value }); },
    settle,
    async snap(label, dir) {
      const file = path.join(outDir(dir), `${slug(label)}.png`);
      return composite(await shoot(), label, file);
    },
    async record(label, during, recordOptions = {}) {
      // Each device streams every frame it paints (the DevTools screencast), so nothing is missed
      // while a frame is being composed; the composites are built afterwards, one per `everyMs`,
      // each showing what every screen last painted by then.
      const every = recordOptions.everyMs ?? 200;
      if (!Number.isFinite(every) || every <= 0) throw new Error(`record: everyMs must be a positive number of milliseconds, not ${every}`);
      const dir = outDir(recordOptions.dir);
      const devices = [...(seeded.tv ? [tv] : []), ...phones];
      const streams = await Promise.all(devices.map(async (page) => {
        const frames: { t: number; data: Buffer }[] = [];
        const cdp = await page.context().newCDPSession(page);
        cdp.on("Page.screencastFrame", ({ data, sessionId }: { data: string; sessionId: number }) => {
          frames.push({ t: Date.now(), data: Buffer.from(data, "base64") });
          void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
        });
        await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
        return { cdp, frames, page };
      }));
      // A screen that does not repaint sends nothing; its still stands in until it does.
      const stills = await Promise.all(devices.map((page) => page.screenshot()));
      const t0 = Date.now();
      try { await during(); } finally { await Promise.all(streams.map(({ cdp }) => cdp.send("Page.stopScreencast").catch(() => undefined))); }
      const end = Date.now();
      const files: string[] = [];
      for (let t = t0, n = 0; t <= end; t += every, n++) {
        const images = streams.map(({ frames }, i) => frames.filter((frame) => frame.t <= t).at(-1)?.data ?? stills[i]!);
        files.push(await composite(images, `${label} +${t - t0}ms`, path.join(dir, `${slug(label)}-${String(n).padStart(3, "0")}.png`)));
      }
      return files;
    },
    async close() {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
      await browser.close().catch(() => undefined);
      if (server) try { process.kill(-server.pid!, "SIGTERM"); } catch { /* Already gone. */ }
    },
  };
}
