/**
 * Nothing sits under the controls pinned over the screen, or is cut off (#257).
 * The screens: the start screen, the guide, a host's lobby and Rest scene,
 * the room controls, a returning kid's catch-up line, and the adventure book.
 *
 * The corner row (help, display settings, read-aloud, sound) is fixed over
 * every screen. A phone in a room leaves it a strip of its own (at the top, or
 * at the bottom one-handed), so the identity strip, a host's arrival notices,
 * the Rest stop offer, the room controls and the catch-up line all keep their
 * whole width; the start screen and the guide leave it the same strip. On the
 * shared screen, Room, About this screen and Tap for sound sit in the corner
 * row, and what Room opens drops below it with who just joined, so none of them
 * covers a heading or a choice; that is checked at 1280x720 and at a tablet's
 * 1024x600. This walks a real room to each of those screens and then looks
 * at them at 360px and 390px, at normal and the largest text (#262), with
 * one-handed play off, right and left (PHONE and SHARED below say which), and asserts on each:
 *
 * - no word, button or picture overlaps a corner control;
 * - no text is clipped: nothing is wider than its box where the box hides the
 *   rest, nothing runs off the screen, and the page never scrolls sideways;
 * - no single word is broken across lines (that is how a hero's name ended
 *   up as "Sp / ark / leh / oof"), measured on the rendered text, so a
 *   different font cannot fool it;
 * - and all of that holds before the row's controls have loaded (they are lazy,
 *   #324), with nothing moving when they arrive.
 *
 * Class tokens (#314) are checked on the screens that draw them: the phone's own
 * view and a friend's sheet in the room, the earning kid's rank-up card, the
 * TV lineup, and the TV's story with its rank-up moment. A rank landing needs
 * a fight, so the rank-up is put on the page's state (`withRankUp`), in
 * exactly the shape the engine leaves it.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createCharacter } from "./characters";
import { openPlayerTask } from "./player-navigation";
import { roomState } from "./room-state";

const TAP = { timeout: 20_000 } as const;
const API = "http://localhost:8787";

type Text = "normal" | "largest";
type Hand = "off" | "right" | "left";
interface Case { width: number; height: number; text: Text; hand: Hand }

/*
 * The combinations that each catch something the others do not, so the spec fits CI's end-to-end
 * job: the phone as reported (390px), the narrowest phone, the largest text there, and one-handed
 * play on each side, which moves the row to the bottom. A full cross of widths, text sizes and
 * hands found nothing these miss, at four times the cost.
 */
const PHONE: Case[] = [
  { width: 390, height: 800, text: "normal", hand: "off" },
  { width: 360, height: 800, text: "normal", hand: "off" },
  { width: 360, height: 800, text: "largest", hand: "off" },
  { width: 360, height: 800, text: "largest", hand: "left" },
  { width: 390, height: 800, text: "largest", hand: "right" },
];
/* A television, and a tablet showing the game (#274) at the largest text: the row is widest there. */
const SHARED: Case[] = [
  { width: 1280, height: 720, text: "normal", hand: "off" },
  { width: 1024, height: 600, text: "largest", hand: "off" },
];

interface Member {
  connected: boolean;
  character: { name: string };
}

async function sessionOf(page: Page, code: string): Promise<{ playerId: string; sessionToken: string }> {
  return page.evaluate((room) => {
    const saved = localStorage.getItem(`kad.session.${room}`);
    return saved ? (JSON.parse(saved) as { playerId: string; sessionToken: string }) : { playerId: "", sessionToken: "" };
  }, code);
}

/** The dev playtest jump (playtest.ts), as stop-resume.spec uses it. */
async function jumpTo(page: Page, code: string, sceneId: string): Promise<void> {
  const session = await sessionOf(page, code);
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await roomState<{ runId: string; seq: number }>(page, code);
    const response = await fetch(`${API}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.sessionToken}` },
      body: JSON.stringify({
        runId: state.runId,
        playerId: session.playerId,
        seq: state.seq,
        intent: { type: "PLAYTEST_GOTO", sceneId },
      }),
    });
    if (((await response.json()) as { ok?: boolean }).ok) return;
  }
  throw new Error("the playtest jump kept losing the seq race");
}

/**
 * A rank that has just landed, on the scene the page is showing, put on the
 * page's own store: a Duskrunner's, so the crow's line, the longest a rank-up
 * says, is the one that has to fit. The dev server serves the store by its
 * module URL, which is the instance the app is using.
 */
async function withRankUp(page: Page, name: string): Promise<void> {
  await page.evaluate(async (hero) => {
    const path = "/src/store/index.ts";
    const { useGameStore } = (await import(/* @vite-ignore */ path)) as {
      useGameStore: { getState(): { state: { sceneId: string; party: { character: { id: string; name: string } }[] } | null }; setState(next: object): void };
    };
    const state = useGameStore.getState().state!;
    const id = state.party.find((m) => m.character.name === hero)!.character.id;
    useGameStore.setState({
      state: {
        ...state,
        rankUps: {
          sceneId: state.sceneId,
          ups: [{
            characterId: id,
            class: "duskrunner",
            rank: "apprentice",
            line: `${hero} is a Duskrunner Apprentice now! New move: Vanish.`,
            crow: "A crow hops past, very busy. \"Good work. Remember who taught you. Don't mess with us.\"",
          }],
        },
      },
    });
  }, name);
}

/** Apply display settings the way a11y/prefs.ts does: attributes on <html>. */
async function settings(page: Page, text: Text, hand: Hand): Promise<void> {
  await page.evaluate(
    ([t, h]) => {
      const root = document.documentElement;
      if (t === "normal") root.removeAttribute("data-text");
      else root.setAttribute("data-text", t);
      if (h === "off") root.removeAttribute("data-hand");
      else root.setAttribute("data-hand", h);
    },
    [text, hand] as const,
  );
}

/** Everything wrong with the screen as it is drawn now, in words. */
async function misfits(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    if (doc.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${doc.scrollWidth} > ${vw})`);

    /** The part of an element a person can see: inside the screen and every box that scrolls or clips it. */
    const seen = (el: Element): DOMRect | null => {
      const box = el.getBoundingClientRect();
      let left = Math.max(box.left, 0);
      let top = Math.max(box.top, 0);
      let right = box.right;
      let bottom = Math.min(box.bottom, innerHeight);
      // The browser's own answer covers display, visibility, opacity and a closed <details>.
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null;
      for (let at: Element | null = el; at; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (at !== el && at !== document.documentElement && at !== document.body && style.overflow !== "visible") {
          const clip = at.getBoundingClientRect();
          left = Math.max(left, clip.left);
          top = Math.max(top, clip.top);
          right = Math.min(right, clip.right);
          bottom = Math.min(bottom, clip.bottom);
        }
      }
      return right - left > 0 && bottom - top > 0 ? new DOMRect(left, top, right - left, bottom - top) : null;
    };
    const shown = (el: Element): boolean => seen(el) !== null;
    const ownText = (el: Element): string =>
      [...el.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
    const label = (el: Element): string =>
      `<${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? ` class="${el.className}"` : ""}> "${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 40)}"`;

    // What a person reads or taps: text, controls, pictures with words.
    const things = [...document.body.querySelectorAll("*")].filter(
      (el) =>
        !el.closest(".kad-corner, .kad-display-stack, .kad-tap-for-sound, .playtest, [aria-hidden='true']") &&
        (ownText(el) !== "" ||
          el.matches("button, input, select, textarea, a[href]") ||
          (el.matches("img") && (el.getAttribute("alt") ?? "") !== "")) &&
        shown(el),
    );

    // 1. Nothing under a control pinned over the screen: the corner row, and the shared
    //    screen's Room button (#263), About this screen and Tap for sound (#264), and the sound
    //    hint, which hangs under the row (#330).
    const corner = [...document.querySelectorAll(".kad-corner > *, .kad-about__open, .kad-host__room, .kad-tap-for-sound .kad-button, .kad-audio-control__hint")]
      .filter(shown)
      .map((el) => ({ el, box: el.getBoundingClientRect() }));
    for (const el of things) {
      const box = seen(el)!;
      for (const control of corner) {
        const x = Math.min(box.right, control.box.right) - Math.max(box.left, control.box.left);
        const y = Math.min(box.bottom, control.box.bottom) - Math.max(box.top, control.box.top);
        if (x > 1 && y > 1) out.push(`${label(el)} is under the pinned ${label(control.el)}`);
      }
    }

    // 2. Nothing clipped, and 3. no word broken across lines.
    for (const el of things) {
      const box = el.getBoundingClientRect();
      // Cut off by a box that hides the rest and cannot scroll to it.
      for (let at = el.parentElement; at && at !== document.body; at = at.parentElement) {
        const style = getComputedStyle(at);
        // A box that scrolls lets a person reach the rest; past it, nothing outside matters.
        if (/auto|scroll/.test(style.overflowY) || /auto|scroll/.test(style.overflowX)) break;
        if (style.overflowY !== "hidden" && style.overflowY !== "clip" && style.overflowX !== "hidden" && style.overflowX !== "clip") continue;
        const clip = at.getBoundingClientRect();
        if (box.bottom > clip.bottom + 1 && box.top < clip.bottom - 1 && clip.bottom < innerHeight - 1) {
          out.push(`${label(el)} is cut off at the bottom by ${label(at).slice(0, 60)}`);
          break;
        }
        if (box.top < clip.top - 1 && box.bottom > clip.top + 1 && clip.top > 1) {
          out.push(`${label(el)} is cut off at the top by ${label(at).slice(0, 60)}`);
          break;
        }
      }
      if (box.right > vw + 1 || box.left < -1) out.push(`${label(el)} runs off the screen (x ${Math.round(box.left)} to ${Math.round(box.right)}, y ${Math.round(box.top)}, of ${vw})`);
      const style = getComputedStyle(el);
      const hides = style.overflowX !== "visible" || style.textOverflow === "ellipsis";
      if (hides && el.scrollWidth > el.clientWidth + 1 && !el.matches("input, textarea, select")) {
        out.push(`${label(el)} is clipped (${el.scrollWidth} > ${el.clientWidth})`);
      }
      // A word broken across lines, as the rendered text has it: font-independent.
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const value = node.textContent ?? "";
        // A hyphen is a fair place to break ("grown-up"), so the parts count as words.
        for (const match of value.matchAll(/[^\s\-\u2010]+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (lines.size > 1) out.push(`${label(el)}: "${match[0]}" is broken across lines`);
        }
      }
    }
    return [...new Set(out)];
  });
}

/**
 * The corner row's controls load after first paint (#324: sound, help, settings and
 * read-aloud are all lazy), so the screen is drawn once without them. Hide them as they are
 * before they load, and nothing else on the screen may move, or fit any worse, when they arrive.
 */
async function shiftsWhenTheRowLoads(page: Page): Promise<string[]> {
  const where = (): Promise<Record<string, string>> =>
    page.evaluate(() => {
      const out: Record<string, string> = {};
      const things = [...document.querySelectorAll("h1, h2, h3, p, button, input, img[alt]:not([alt=''])")].filter(
        (el) => !el.closest(".kad-corner") && el.checkVisibility(),
      );
      things.slice(0, 40).forEach((el, i) => {
        const box = el.getBoundingClientRect();
        out[`${i} ${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}"`] =
          `${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`;
      });
      return out;
    });
  const loaded = await where();
  const style = await page.addStyleTag({ content: ".kad-corner > * { display: none !important; }" });
  const frames = (): Promise<unknown> =>
    page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await frames();
  const before = await where();
  const problems = (await misfits(page)).map((problem) => `before the row loads: ${problem}`);
  await style.evaluate((el) => el.remove());
  await frames();
  const after = await where();
  for (const [thing, box] of Object.entries(after)) {
    // Only a move the row causes: the screen stood still across the check, row and all.
    if (loaded[thing] === box && before[thing] !== undefined && before[thing] !== box) {
      problems.push(`${thing} moves when the corner row loads (${before[thing]} -> ${box})`);
    }
  }
  return problems;
}

/** Each case, on one page as it stands. */
async function expectFits(page: Page, screen: string, cases: Case[] = PHONE): Promise<void> {
  const found: string[] = [];
  // Pictures and fonts in first, so nothing still arriving reads as a misfit.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  for (const { width, height, text, hand } of cases) {
    await page.setViewportSize({ width, height });
    await settings(page, text, hand);
    // Two frames: the attributes restyle, then layout settles.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const problems = [...(await misfits(page)), ...(await shiftsWhenTheRowLoads(page))];
    for (const problem of problems) found.push(`${screen} @${width}px, ${text} text, hand ${hand}: ${problem}`);
    if (problems.length > 0 && process.env.KAD_FIT_DEBUG) {
      await page.screenshot({ path: `${process.env.KAD_FIT_DEBUG}/${screen.replace(/\W+/g, "-")}-${width}-${text}-${hand}.png` });
    }
  }
  await settings(page, "normal", "off");
  // Soft, so one run reports every screen rather than stopping at the first.
  expect.soft(found, found.join("\n")).toEqual([]);
}

test.describe("nothing sits under the controls pinned over the screen, or is cut off", () => {
  const open: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function phone(browser: Browser): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
    open.push(context);
    const page = await context.newPage();
    // The dev drawer is a developer's tool that production does not have.
    await page.addInitScript(() => {
      addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = ".playtest { display: none !important; }";
        document.head.append(style);
      });
    });
    return page;
  }

  test("the header, a host's notices and stop offer, the room controls and the catch-up line", async ({ browser }) => {
    test.setTimeout(300_000);

    // --- The start screen ---
    const host = await phone(browser);
    await host.goto("/");
    await expect(host.getByRole("button", { name: /host a game/i })).toBeVisible(TAP);
    await expectFits(host, "start screen");

    // --- The grown-up's guide, whose words scroll under nothing ---
    await host.goto("/guide");
    await expect(host.getByRole("heading", { level: 1 })).toBeVisible(TAP);
    await expectFits(host, "the guide");
    await host.locator(".guide").evaluate((el) => el.scrollTo(0, 1200));
    await expectFits(host, "the guide, scrolled");
    await host.goto("/");

    // --- A Phone Mode room, a host and a guest, each with a hero ---
    await host.getByRole("button", { name: /host a game/i }).click();
    await host.getByText("Phone Mode").click();
    await host.getByLabel("Your adventurer name").fill("Grown-up");
    await host.getByRole("button", { name: /^start a game$/i }).click();
    await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);
    const code = new URL(host.url()).pathname.split("/").pop() ?? "";
    await createCharacter(host, "unicorn", "Sparklehoof");

    const guest = await phone(browser);
    await guest.goto("/");
    await guest.getByLabel(/room code/i).fill(code);
    await guest.getByRole("button", { name: /join a game/i }).click();
    await expect(guest).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    await createCharacter(guest, "griffin", "Rosie");

    // The host's phone says who joined, and keeps saying it until dismissed.
    await expect(host.locator(".kad-arrivals--inline .kad-arrival").first()).toBeVisible(TAP);
    await expectFits(host, "host's lobby with an arrival notice");

    // --- A Rest scene: the stop offer beside the arrival notice ---
    await host.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect.poll(async () => (await roomState<{ phase: string }>(host, code)).phase, TAP).toBe("scene");
    await jumpTo(host, code, "rest_mossbank");
    await expect(host.getByText(/cozy place to stop for today/i)).toBeVisible(TAP);
    await expect(host.locator(".kad-arrivals--inline .kad-arrival").first()).toBeVisible();
    await expectFits(host, "host at a Rest, with the stop offer and an arrival notice");

    // --- The room controls, open ---
    await host.getByText("Running this room").click();
    await expect(host.getByRole("button", { name: "Lock the room" })).toBeVisible(TAP);
    await expectFits(host, "host's room controls");

    // --- The guest steps away and comes back to the catch-up line ---
    const member = async (): Promise<Member | undefined> =>
      (await roomState<{ party: Member[] }>(host, code)).party.find((m) => m.character.name === "Rosie");
    await guest.goto("about:blank");
    await expect.poll(async () => (await member())?.connected, TAP).toBe(false);
    await guest.goto(`/p/${code}`);
    await expect(guest.getByTestId("catch-up")).toContainText("Welcome back, Rosie!", TAP);
    await expectFits(guest, "guest's catch-up line");

    // --- Class tokens (#314): her own view, a friend's sheet, and a rank landing ---
    await guest.getByRole("button", { name: "You", exact: true }).click(TAP);
    await expect(guest.getByText(/^Your (thorn bracer|dusk hood|star circlet|song bell)$/)).toBeVisible(TAP);
    await expectFits(guest, "guest's own view, with her worn token");
    await guest.getByRole("button", { name: "Sparklehoof's character sheet" }).click(TAP);
    await expect(guest.getByText(/^Sparklehoof's (thorn bracer|dusk hood|star circlet|song bell)$/)).toBeVisible(TAP);
    await expectFits(guest, "a friend's sheet, with their token");
    await guest.goto(`/p/${code}`);
    await expect(guest.getByRole("button", { name: "You", exact: true })).toBeVisible(TAP);
    await openPlayerTask(guest);
    await withRankUp(guest, "Rosie");
    await expect(guest.getByTestId("player-rank-up")).toContainText("Don't mess with us.", TAP);
    await expectFits(guest, "the earning kid's rank-up card");

    // --- Between games: the adventure book, which shares the phone's shell ---
    await guest.goto("/");
    await guest.getByRole("button", { name: /open your book/i }).click(TAP);
    await expect(guest.getByRole("region", { name: "Rosie's character sheet" })).toBeVisible(TAP);
    await expectFits(guest, "the adventure book");
  });

  test("the shared screen: its corner row (Room, About this screen, Tap for sound) keeps off the lobby and the story", async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    open.push(context);
    // A TV that holds sound back until a tap, as most do (display-hardware.spec), so the
    // "Tap for sound" ask is up the whole time and has to keep clear too.
    await context.addInitScript(() => {
      class BlockedContext {
        currentTime = 0;
        sampleRate = 48_000;
        destination = {};
        state = "suspended";
        addEventListener(): void {}
        removeEventListener(): void {}
        createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {} }; }
        createBufferSource() { return { connect() {}, start() {}, stop() {}, loop: false, buffer: null }; }
        createOscillator() { return { type: "sine", frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
        createBuffer() { return { getChannelData: () => new Float32Array(1) }; }
        decodeAudioData() { return Promise.reject(new Error("no decoder")); }
        resume(): Promise<void> { return Promise.resolve(); }
        close(): Promise<void> { return Promise.resolve(); }
      }
      Object.defineProperty(window, "AudioContext", { value: BlockedContext, configurable: true });
    });
    const tv = await context.newPage();
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/, TAP);
    const code = new URL(tv.url()).pathname.split("/").pop() ?? "";
    await expect(tv.getByRole("button", { name: "About this screen" })).toBeVisible(TAP);
    await expect(tv.getByRole("button", { name: "Tap for sound" })).toBeVisible(TAP);

    const kid = await phone(browser);
    await kid.goto("/");
    await kid.getByLabel(/room code/i).fill(code);
    await kid.getByRole("button", { name: /join a game/i }).click();
    await expect(kid).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    await createCharacter(kid, "unicorn", "Sparklehoof");
    await expect(tv.getByText("Sparklehoof").first()).toBeVisible(TAP);

    // A television, and a tablet showing the game (#274).
    await expectFits(tv, "the shared screen's lobby", SHARED);

    await kid.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect.poll(async () => (await roomState<{ phase: string }>(kid, code)).phase, TAP).toBe("scene");
    await expect(tv.locator(".narration__body").first()).toBeVisible(TAP);
    await expectFits(tv, "the shared screen's story", SHARED);

    // A rank lands (#314): the line with its token under the story, and the moment over
    // the stage, which lets every tap through and is gone by itself in a few seconds.
    await withRankUp(tv, "Sparklehoof");
    const moment = tv.getByTestId("rank-up-moment");
    await expect(moment).toBeVisible(TAP);
    const shown = Date.now();
    expect(await moment.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    await expect(moment).toHaveCount(0, { timeout: 8_000 });
    expect(Date.now() - shown, "the moment does not hold the table up").toBeLessThan(6_000);
    // The words of record stay under the story, token and all, and fit where they are
    // tightest: the tablet at the largest text.
    await expect(tv.getByTestId("rank-up")).toContainText("Duskrunner Apprentice", TAP);
    await expectFits(tv, "the shared screen's story, with a rank-up", SHARED.filter((c) => c.text === "largest"));
  });

  test("the shared screen's corner row holds still while sound loads, asks, and unlocks", async ({ browser }) => {
    // The sound engine held back, as lazy-audio.spec does (#330): the TV's own controls (Room,
    // About this screen) and the device's (read-aloud, display settings) keep their place when the
    // engine lands, when Tap for sound appears with it, and when the first tap unlocks sound.
    const ENGINE = /\/(?:src\/audio\/(?:engine|AudioControl)\.tsx?|bundle\/audio-[^/]*\.js)(?:\?|$)/;
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    open.push(context);
    // Sound held back until a tap, as on most TVs (display-hardware.spec), so Tap for sound is asked.
    await context.addInitScript(() => {
      const listeners = new Set<() => void>();
      let allowed = false;
      class BlockedContext {
        currentTime = 0;
        sampleRate = 48_000;
        destination = {};
        state: "suspended" | "running" = "suspended";
        addEventListener(_: string, fn: () => void): void { listeners.add(fn); }
        removeEventListener(_: string, fn: () => void): void { listeners.delete(fn); }
        createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {} }; }
        createBufferSource() { return { connect() {}, start() {}, stop() {}, loop: false, buffer: null }; }
        createOscillator() { return { type: "sine", frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
        createBuffer() { return { getChannelData: () => new Float32Array(1) }; }
        decodeAudioData() { return Promise.reject(new Error("no decoder")); }
        resume(): Promise<void> {
          if (allowed) { this.state = "running"; for (const fn of listeners) fn(); }
          return Promise.resolve();
        }
        close(): Promise<void> { return Promise.resolve(); }
      }
      Object.defineProperty(window, "AudioContext", { value: BlockedContext, configurable: true });
      (window as unknown as { allowSound(): void }).allowSound = () => { allowed = true; };
    });
    const tv = await context.newPage();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await tv.route(ENGINE, async (route) => {
      await held;
      await route.continue();
    });

    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/, TAP);

    const controls = {
      room: tv.getByRole("button", { name: "Room" }),
      about: tv.getByRole("button", { name: "About this screen" }),
      readAloud: tv.getByRole("button", { name: /turn read-aloud on/i }),
      settings: tv.getByRole("button", { name: "Display settings" }).first(),
    };
    for (const control of Object.values(controls)) await expect(control).toBeVisible(TAP);
    const where = async (): Promise<Record<string, number | undefined>> => {
      const out: Record<string, number | undefined> = {};
      for (const [name, control] of Object.entries(controls)) out[name] = (await control.boundingBox())?.x;
      return out;
    };
    const before = await where();

    release();
    await expect(tv.getByRole("button", { name: /^Turn sound/ })).toBeVisible(TAP);
    await expect(tv.getByRole("button", { name: "Tap for sound" })).toBeVisible(TAP);
    expect(await where(), "nothing moves when the engine lands and Tap for sound appears").toEqual(before);

    // The first tap anywhere unlocks sound and takes the ask away: still nothing moves.
    await tv.evaluate(() => (window as unknown as { allowSound(): void }).allowSound());
    await tv.mouse.move(640, 400);
    await tv.mouse.down();
    await tv.mouse.up();
    await expect(tv.getByRole("button", { name: "Tap for sound" })).toHaveCount(0, TAP);
    expect(await where(), "nothing moves when sound unlocks").toEqual(before);

    // And a tap on About after all that opens it.
    await controls.about.click();
    await expect(tv.getByRole("region", { name: "About this screen" })).toBeVisible(TAP);
  });
});
