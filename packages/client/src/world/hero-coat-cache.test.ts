/**
 * The tinter's cache and queue (docs/hero-looks.md §5.3, §12): one pass per
 * painting and colour, shared; the latest choice wins (a stale pass thrown
 * away, a queued one cancelled); a bound by real memory, least recently used
 * out; what a surface shows never evicted, and let go of once it is; and a
 * pass that fails draws her as painted.
 *
 * The "throttled phone" is the real sliced tinter on a painting served from
 * memory, made to wait between slices (the main-thread path a phone without
 * an OffscreenCanvas takes, and the slowest one).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { coatPaintKey } from "@kad/shared";
import type { CoatPaint } from "@kad/shared";
import type { HeroCoatRequest } from "./hero-art";
import { COAT_CACHE_BUDGET, CoatCache, type CoatEntry } from "./hero-coat-cache";
import { slicedTintRunner, type TintImage, type TintJob, type TintRunner } from "./hero-coat-pass";
import { fakeUrls, pixelIO, servePainting } from "../testing/coat-fixture";
import type { Pixels } from "./hero-coat-pass";
import { maskPathBeside } from "./art-paths";

afterEach(() => {
  vi.useRealTimers();
});

const COLORS = ["#FBF8F2", "#F8DF8A", "#FD98BE", "#58BCFD", "#A57FD8", "#20134E", "#77E2C5", "#BB1D30", "#F4CF4A", "#3E6ADF"];

/** Her main colour alone (the accent as painted), as the resolver asks for it. */
function request(painting: string, color: string): HeroCoatRequest {
  const paint: CoatPaint = { kind: "parts", main: color, accent: null };
  return { painting, mask: maskPathBeside(painting), paint, key: `${painting}|${coatPaintKey(paint)}` };
}

/** The main colour a job paints, for a test's count. */
const mainOf = (job: TintJob): string | null => (job.paint.kind === "parts" ? job.paint.main : null);

/** A runner that makes `side`×`side` images after `ms`, counting passes and what was cancelled. */
function timedRunner(ms: number, side = 1024): TintRunner & { started: TintJob[]; aborted: TintJob[]; closed: number } {
  const runner = ((job: TintJob, signal: AbortSignal) => {
    runner.started.push(job);
    return new Promise<TintImage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const source = { close: () => (runner.closed += 1) };
        resolve({ width: side, height: side, source, blob: new Blob(["x"]) });
      }, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        runner.aborted.push(job);
        reject(new DOMException("cancelled", "AbortError"));
      });
    });
  }) as TintRunner & { started: TintJob[]; aborted: TintJob[]; closed: number };
  runner.started = [];
  runner.aborted = [];
  runner.closed = 0;
  return runner;
}

const MIB = 1024 * 1024;

describe("one pass, shared (§5.3)", () => {
  it("gives two surfaces asking at once one pass and one entry", async () => {
    vi.useFakeTimers();
    const runner = timedRunner(50);
    const cache = new CoatCache({ runner, urls: fakeUrls() });
    const seen: (CoatEntry | null)[][] = [[], []];
    const a = cache.slot((e) => seen[0]!.push(e));
    const b = cache.slot((e) => seen[1]!.push(e));
    a.want(request("/assets/u.png", "#58BCFD"));
    b.want(request("/assets/u.png", "#58BCFD"));
    await vi.advanceTimersByTimeAsync(60);
    expect(runner.started).toHaveLength(1);
    expect(seen[0]![0]).toBe(seen[1]![0]);
    expect(seen[0]![0]!.url()).toBe(seen[1]![0]!.url());
    // A third, later, takes the ready entry at once, with no pass.
    const c: (CoatEntry | null)[] = [];
    cache.slot((e) => c.push(e)).want(request("/assets/u.png", "#58BCFD"));
    expect(c[0]).toBe(seen[0]![0]);
    expect(runner.started).toHaveLength(1);
  });

  it("counts an entry's real size: a 1024 canvas 4 MiB, a 1254 gear portrait 6 MiB", async () => {
    vi.useFakeTimers();
    for (const [side, mib] of [[1024, 4], [1254, 6]] as const) {
      const cache = new CoatCache({ runner: timedRunner(1, side), urls: fakeUrls() });
      cache.slot(() => undefined).want(request("/assets/a.png", "#58BCFD"));
      await vi.advanceTimersByTimeAsync(5);
      expect(cache.stats().total / MIB).toBeCloseTo(mib, 0);
    }
    expect(COAT_CACHE_BUDGET).toBe(48 * MIB);
  });
});

describe("the latest choice wins (§5.3)", () => {
  it("cancels a queued pass and throws a running one away when she picks again", async () => {
    vi.useFakeTimers();
    const runner = timedRunner(100);
    const cache = new CoatCache({ runner, urls: fakeUrls() });
    const shown: string[] = [];
    const other = cache.slot(() => undefined);
    other.want(request("/assets/x.png", "#F4CF4A")); // keeps the runner busy
    const slot = cache.slot((e) => shown.push(e?.key ?? "painted"));
    slot.want(request("/assets/u.png", "#58BCFD")); // queued behind it
    slot.want(request("/assets/u.png", "#20134E")); // supersedes it: cancelled before it starts
    await vi.advanceTimersByTimeAsync(250);
    expect(runner.started.map((j) => mainOf(j))).toEqual(["#F4CF4A", "#20134E"]);
    slot.want(request("/assets/u.png", "#FD98BE")); // starts at once
    await vi.advanceTimersByTimeAsync(10);
    slot.want(request("/assets/u.png", "#77E2C5")); // the running one is stopped
    await vi.advanceTimersByTimeAsync(300);
    expect(runner.aborted.map((j) => mainOf(j))).toContain("#FD98BE");
    expect(shown).toEqual(["/assets/u.png|parts:#20134E:-", "/assets/u.png|parts:#77E2C5:-"]);
  });

  it("ten quick colour switches on a throttled phone: the last shows, none after it, the bound kept, pins released", async () => {
    vi.useFakeTimers();
    const files = new Map<string, Pixels>();
    servePainting(files, "/assets/characters/unicorn/fledgling/assembled.png", "#E2CDEC", 64);
    // A slice of 512 pixels, then 8ms: a 64×64 pass takes about 60ms, longer than a tap.
    const io = pixelIO(files, { delayMs: 8 });
    const runner = slicedTintRunner(io, 512);
    const passes: string[] = [];
    const counting: TintRunner = (job, signal) => {
      passes.push(mainOf(job)!);
      return runner(job, signal);
    };
    const bytes = 64 * 64 * 4;
    const budget = bytes * 3; // room for three
    const urls = fakeUrls();
    const cache = new CoatCache({ runner: counting, budget, urls });
    const shown: string[] = [];
    const hero = "/assets/characters/unicorn/fledgling/assembled.png";
    const slot = cache.slot((e) => shown.push(e ? e.key : "painted"));
    let worst = 0;
    for (const color of COLORS) {
      slot.want(request(hero, color));
      await vi.advanceTimersByTimeAsync(20); // a quick tap
      worst = Math.max(worst, cache.stats().unpinned);
    }
    await vi.advanceTimersByTimeAsync(1000);
    worst = Math.max(worst, cache.stats().unpinned);
    const last = `${hero}|parts:${COLORS.at(-1)!}:-`;
    expect(shown.at(-1)).toBe(last);
    // Nothing older shows after the last one did, and nothing at all after the last pick.
    expect(shown.indexOf(last)).toBe(shown.length - 1);
    // Each tap came faster than a pass: every earlier one was stopped part way, so only the last ever showed.
    expect(passes).toEqual(COLORS);
    expect(shown).toEqual([last]);
    expect(worst).toBeLessThanOrEqual(budget);
    expect(slot.shown?.key).toBe(last);
    expect(cache.stats().pinned).toBe(bytes);

    // Let go of: the bound settles, and an evicted entry's URL is revoked.
    slot.close();
    expect(cache.stats().total).toBeLessThanOrEqual(budget);
    expect(urls.live.size).toBeLessThanOrEqual(urls.made);
  });
});

describe("ten switches slower than a pass", () => {
  it("shows each in the order picked, never an older after a newer, within the bound", async () => {
    vi.useFakeTimers();
    const files = new Map<string, Pixels>();
    const hero = "/assets/characters/bigfoot/fledgling/assembled.png";
    servePainting(files, hero, "#4C3F32", 64);
    const bytes = 64 * 64 * 4;
    const urls = fakeUrls();
    const cache = new CoatCache({ runner: slicedTintRunner(pixelIO(files, { delayMs: 8 }), 512), budget: bytes * 3, urls });
    const shown: string[] = [];
    const slot = cache.slot((e) => shown.push(e ? e.key : "painted"));
    let worst = 0;
    for (const color of COLORS) {
      slot.want(request(hero, color));
      await vi.advanceTimersByTimeAsync(150);
      worst = Math.max(worst, cache.stats().unpinned);
    }
    expect(shown).toEqual(COLORS.map((c) => `${hero}|parts:${c}:-`));
    expect(worst).toBeLessThanOrEqual(bytes * 3);
    // Evicted entries' URLs were revoked: at most the bound's worth plus the one shown are live.
    expect(cache.stats().entries).toBeLessThanOrEqual(4);
    slot.close();
    expect(cache.stats().total).toBeLessThanOrEqual(bytes * 3);
  });
});

describe("a bound by memory (§5.3)", () => {
  it("evicts the least recently used entry nothing shows, revoking its URL and destroying its texture", async () => {
    vi.useFakeTimers();
    const runner = timedRunner(1, 1024);
    const urls = fakeUrls();
    const cache = new CoatCache({ runner, budget: 12 * MIB, urls });
    const destroyed: string[] = [];
    const entries: CoatEntry[] = [];
    const made: string[] = [];
    for (const color of COLORS.slice(0, 3)) {
      const slot = cache.slot((e) => e && entries.push(e));
      slot.want(request("/assets/u.png", color));
      await vi.advanceTimersByTimeAsync(5);
      made.push(entries.at(-1)!.url());
      entries.at(-1)!.texture((s) => ({ s, color }), (t) => destroyed.push(t.color));
      slot.close();
    }
    expect(cache.stats()).toMatchObject({ entries: 3, unpinned: 12 * MIB });
    // A fourth: over the bound, so the oldest goes.
    cache.slot(() => undefined).want(request("/assets/u.png", COLORS[3]!));
    await vi.advanceTimersByTimeAsync(5);
    expect(destroyed).toEqual([COLORS[0]]);
    expect(urls.live.has(made[0]!)).toBe(false);
    expect(urls.live.has(made[1]!)).toBe(true);
    // An evicted entry never makes a URL again (nothing would revoke it).
    entries[0]!.url();
    expect(urls.made).toBe(3);
    expect(cache.peek(entries[0]!.key)).toBeNull();
    expect(runner.closed).toBe(1);
  });

  it("never evicts what a surface shows: over the bound while held, settled once let go", async () => {
    vi.useFakeTimers();
    const cache = new CoatCache({ runner: timedRunner(1, 1024), budget: 8 * MIB, urls: fakeUrls() });
    const slots = COLORS.slice(0, 4).map((color, i) => {
      const slot = cache.slot(() => undefined);
      slot.want(request(`/assets/h${String(i)}.png`, color));
      return slot;
    });
    await vi.advanceTimersByTimeAsync(20);
    // Four heroes on screen, 16 MiB, twice the bound: all kept.
    expect(cache.stats()).toMatchObject({ entries: 4, pinned: 16 * MIB, unpinned: 0 });
    for (const slot of slots) expect(slot.shown).not.toBeNull();
    slots[0]!.close();
    slots[1]!.close();
    expect(cache.stats().total).toBeLessThanOrEqual(8 * MIB);
    expect(slots[2]!.shown).not.toBeNull();
  });
});

describe("a pass that fails", () => {
  it("draws her as painted and is not asked again", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const cache = new CoatCache({ runner: () => (calls++, Promise.reject(new Error("404"))), urls: fakeUrls() });
    const shown: (CoatEntry | null)[] = [];
    const slot = cache.slot((e) => shown.push(e));
    slot.want(request("/assets/u.png", "#58BCFD"));
    await vi.advanceTimersByTimeAsync(5);
    slot.want(request("/assets/u.png", "#58BCFD"));
    await vi.advanceTimersByTimeAsync(5);
    expect(calls).toBe(1);
    expect(slot.shown).toBeNull();
  });
});
