/**
 * Nothing sits under the controls pinned over the screen, or is cut off (#257).
 * The screens: the start screen, the guide, a host's lobby and Rest scene,
 * the room controls, a returning kid's catch-up line, the adventure book, and
 * what a screen that could not load says instead (#329).
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

import { readdirSync, readFileSync } from "node:fs";
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

/* The sizes #331 holds: a television and a tablet, each at normal and at the largest text. */
const TV_SIZES: Case[] = [
  { width: 1280, height: 720, text: "normal", hand: "off" },
  { width: 1280, height: 720, text: "largest", hand: "off" },
  { width: 1024, height: 600, text: "normal", hand: "off" },
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
  await sendAs(page, code, { type: "PLAYTEST_GOTO", sceneId });
}

/** One intent from this page's seat, retried past a lost seq race. */
async function sendAs(page: Page, code: string, intent: Record<string, unknown>): Promise<void> {
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
        intent,
      }),
    });
    const answer = (await response.json()) as { ok?: boolean; error?: { code: string; message: string } };
    if (answer.ok) return;
    if (answer.error?.code !== "STALE_SEQ") throw new Error(`${String(intent.type)}: ${JSON.stringify(answer.error)}`);
  }
  throw new Error(`${String(intent.type)} kept losing the seq race`);
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


interface Passage { name: string; narration: string; options: { id: string; label: string; icon: string }[] }

/**
 * The scenes of shipped content that ask the most of the TV's story plate (#331), read from
 * content/chapters so they follow the writing: the longest story passage, the scene with the
 * most choices a party always sees (none gated on a species, flag or item), and the longest
 * story among the scenes that offer three or more. Choices a party has to earn are left out,
 * as the engine leaves them out of the prompt.
 */
function hardestPassages(): Passage[] {
  const dir = "content/chapters";
  const all: (Passage & { gated: number })[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const chapter = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as {
      scenes: Record<string, { type: string; narration?: string; choices?: { id: string; label: string; icon: string }[] }>;
    };
    for (const [id, scene] of Object.entries(chapter.scenes)) {
      if (scene.type === "combat" || !scene.narration || !scene.choices?.length) continue;
      const open = scene.choices.filter((c) => !Object.keys(c).some((k) => /^(requires|when|hidden)/.test(k)));
      if (open.length === 0) continue;
      all.push({
        name: `${file.replace(".json", "")}/${id}`,
        narration: scene.narration,
        options: open.map(({ id, label, icon }) => ({ id, label, icon })),
        gated: scene.choices.length - open.length,
      });
    }
  }
  const labels = (p: Passage): number => p.options.reduce((n, o) => n + o.label.length, 0);
  const by = (score: (p: Passage) => number, of: Passage[] = all): Passage => of.reduce((a, b) => (score(b) > score(a) ? b : a));
  const picks = [
    by((p) => p.narration.length),
    by((p) => p.options.length * 1000 + labels(p)),
    by((p) => p.narration.length, all.filter((p) => p.options.length >= 3)),
    by((p) => p.narration.length, all.filter((p) => p.options.length >= 4)),
  ];
  return [...new Map(picks.map((p) => [p.name, p])).values()];
}

/** What the page's store says the scene is, to put back after trying others on it. */
interface Shown { narration: string; prompt: unknown }

/** A scene put on the page's own store, in the shape the engine leaves it (see withRankUp). */
async function show(page: Page, scene: Shown | Passage | null): Promise<Shown> {
  return page.evaluate(async (next) => {
    const path = "/src/store/index.ts";
    const { useGameStore } = (await import(/* @vite-ignore */ path)) as {
      useGameStore: { getState(): { state: { sceneId: string; narration: string; prompt: unknown } | null }; setState(next: object): void };
    };
    const state = useGameStore.getState().state!;
    const before = { narration: state.narration, prompt: state.prompt };
    if (next !== null) {
      const prompt = "options" in next
        ? { kind: "choice", sceneId: state.sceneId, options: next.options, forPlayerIds: [], vote: false }
        : next.prompt;
      useGameStore.setState({ state: { ...state, narration: next.narration, prompt } });
    }
    return before;
  }, scene);
}

/**
 * What the TV's plate shows now: every choice whole inside the plate and the screen, with nobody
 * to scroll for it, and how much of the story is in view.
 */
async function plateFit(page: Page): Promise<{ problems: string[]; size: number; lines: number; shown: number }> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const plate = document.querySelector(".narration__plate")!.getBoundingClientRect();
    document.querySelectorAll<HTMLElement>(".narration__choice").forEach((el, n) => {
      const box = el.getBoundingClientRect();
      if (box.top < plate.top - 1 || box.bottom > plate.bottom + 1 || box.bottom > innerHeight + 1) {
        problems.push(`choice ${n + 1} is off the plate or the screen (y ${Math.round(box.top)} to ${Math.round(box.bottom)}, plate ${Math.round(plate.top)} to ${Math.round(plate.bottom)}, screen ${innerHeight})`);
      }
    });
    const body = document.querySelector(".narration__body")!;
    const story = document.querySelector(".narration__story")!;
    const style = getComputedStyle(body);
    const line = parseFloat(style.lineHeight);
    return {
      problems,
      size: parseFloat(style.fontSize),
      lines: Math.round(body.getBoundingClientRect().height / line),
      // Lines of the story in view: all of them unless it is the story that scrolls.
      shown: story.scrollHeight > story.clientHeight + 1 ? Math.floor(story.clientHeight / line) : Math.round(body.getBoundingClientRect().height / line),
    };
  });
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
      // Words for a screen reader alone are clipped to a pixel on purpose (.kad-sr-only).
      if (el.closest(".kad-sr-only")) return null;
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
      // The one cut on purpose: a phone's goal folded to its line ends in "…" and opens to the
      // whole sentence on a tap (ChapterGoal, from the playtest's "too much vertical space").
      if (hides && el.scrollWidth > el.clientWidth + 1 && !el.matches("input, textarea, select, .goal--closed .goal__sentence")) {
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

  // A chunk that could not load (#329): the whole-page message, and the card over the grown-ups' page.
  test("what a screen that could not load says, and the sign-in that could not open", async ({ browser }) => {
    const page = await phone(browser);
    await page.route(/\/src\/screens\/(?:JournalScreen|SignInFlow)\.tsx(?:\?|$)/, (route) => route.abort());
    await page.goto("/journal");
    await expect(page.getByRole("alert")).toContainText("Your adventure book couldn’t open.", TAP);
    await expectFits(page, "a book that could not open");

    await page.goto("/account");
    await page.getByRole("button", { name: "Sign in or create an account" }).click(TAP);
    await expect(page.getByRole("alert")).toContainText("Sign-in couldn’t open.", TAP);
    await expectFits(page, "a sign-in that could not open");
    await page.getByRole("alert").getByRole("button", { name: "Not now" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

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

  test("the Exchange's fitting stall (#312): every class to try, and the \"are you sure?\"", async ({ browser }) => {
    test.setTimeout(180_000);
    // A new hero in Gemfall, which opens at the Exchange. The launch campaign
    // is the Hollow Crown, so the room is opened for Gemfall instead, and the
    // dev jump goes straight to the scene the stall stands in.
    const kid = await phone(browser);
    // In the page rather than on the wire (no request interception): the
    // client's own create-room call names Gemfall.
    await kid.addInitScript(() => {
      const send = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/room" && init?.method === "POST" && typeof init.body === "string") {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          if (body.campaignId) return send(input, { ...init, body: JSON.stringify({ ...body, campaignId: "gemfall" }) });
        }
        return send(input, init);
      };
    });
    await kid.goto("/");
    await kid.getByRole("button", { name: /host a game/i }).click(TAP);
    await kid.getByText("Phone Mode").click();
    await kid.getByLabel("Your adventurer name").fill("Grown-up");
    await kid.getByRole("button", { name: /^start a game$/i }).click();
    await expect(kid).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);
    const code = new URL(kid.url()).pathname.split("/").pop() ?? "";
    await createCharacter(kid, "unicorn", "Sparklehoof");
    await kid.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect.poll(async () => (await roomState<{ phase: string }>(kid, code)).phase, TAP).toBe("scene");
    await jumpTo(kid, code, "scene_prologue_city");

    // The stall opens for a new hero: every other class, and "Stay".
    await expect(kid.getByText("Try on a new class?")).toBeVisible(TAP);
    await expect(kid.getByRole("button", { name: /^Be a / })).toHaveCount(3);
    await expectFits(kid, "the fitting stall, four answers");

    // Keep first: the way on is free, and the stall stays open to a change of mind.
    await kid.getByRole("button", { name: /^Stay a / }).click(TAP);
    await kid.getByRole("button", { name: "Yes, keep it" }).click(TAP);
    await expect(kid.getByText(/^You are a \w+\.$/)).toBeVisible(TAP);

    // Then swap: the "are you sure?" with both tokens, and the one free swap said plainly.
    await kid.getByRole("button", { name: "Be a Starweaver" }).click(TAP);
    const sure = kid.getByRole("alertdialog");
    await expect(sure).toContainText("This is your one free swap.", TAP);
    await expect(sure.getByRole("img", { name: /^star circlet/ })).toBeVisible();
    await expect(sure.getByRole("img", { name: /^your / })).toBeVisible();
    await expectFits(kid, "the fitting stall's are-you-sure");

    await kid.getByRole("button", { name: "Yes, switch!" }).click(TAP);
    await expect(kid.getByText("You are a Starweaver now!")).toBeVisible(TAP);
    // One swap: nothing more to try on.
    await expect(kid.getByRole("button", { name: /^Be a / })).toHaveCount(0);
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

    // The choices are on the TV whole, at both sizes and both text sizes (#331): for the scene the
    // room is on, and for the hardest stories shipped, each with its own choices. The story steps
    // its type down to fit them (fit-plate.ts), and never under the app's body size.
    const unfit: string[] = [];
    const real = await show(tv, null);
    for (const passage of [null, ...hardestPassages()]) {
      if (passage !== null) await show(tv, passage);
      for (const { width, height, text } of TV_SIZES) {
        await tv.setViewportSize({ width, height });
        await settings(tv, text, "off");
        await tv.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        const { problems, size, lines, shown } = await plateFit(tv);
        const where = `${passage?.name ?? "this scene"} @${width}x${height}, ${text} text`;
        for (const problem of problems) unfit.push(`${where}: ${problem}`);
        if (size < 19) unfit.push(`${where}: the story is ${Math.round(size)}px, too small to read from a couch`);
        if (shown < Math.min(lines, text === "normal" ? lines : 2)) unfit.push(`${where}: only ${shown} of the story's ${lines} lines are in view`);
        if (problems.length > 0 && process.env.KAD_FIT_DEBUG) {
          await tv.screenshot({ path: `${process.env.KAD_FIT_DEBUG}/plate-${(passage?.name ?? "scene").replace(/\W+/g, "-")}-${width}-${text}.png` });
        }
      }
    }
    // And after the first fit, with the same words and choices: a label that wraps further (a late
    // font) and a line added under the story (a class place's roll) must refit, not hide a choice.
    {
      const four = hardestPassages().find((p) => p.options.length >= 4)!;
      await tv.setViewportSize({ width: 1280, height: 720 });
      await settings(tv, "normal", "off");
      await show(tv, four);
      await tv.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await tv.evaluate(() => {
        const label = document.querySelector(".narration__choice > span")!;
        label.textContent += " and then a good deal more, so that this one label runs across two lines of the plate";
        const extra = document.createElement("p");
        extra.textContent = "Somebody rolled for the stone, and the stone rolled back, which is a long way to go for a joke.";
        document.querySelector(".narration__story")!.append(extra);
      });
      await tv.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
      const after = await plateFit(tv);
      expect.soft(after.problems, `choices after the plate's content grew under it: ${after.problems.join("; ")}`).toEqual([]);
    }
    await show(tv, real);
    await settings(tv, "normal", "off");
    await tv.setViewportSize({ width: 1280, height: 720 });
    expect.soft(unfit, unfit.join("\n")).toEqual([]);

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
