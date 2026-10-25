/**
 * The words around a chapter (#357), against the real stack, at a TV's 1280x720 and a small
 * tablet's 1024x600.
 *
 * - **Chapter start.** Before the first scene the TV shows "Last time…" (the reference campaign
 *   carries no roads, so its opener) ending with the goal, and reads it aloud in this order: the
 *   preface, "Your goal: …", the first scene's story. The goal is said once. The chapter's file
 *   is slowed to 1.5s, inside the wait, and the order holds; slower than the wait, the story is
 *   read alone and the goal after it, once (#356's order).
 * - **Late join.** A kid who sits down partway gets the TV's "Where you left off" too.
 * - **Drop-in.** A kid's phone steps away partway through and comes back: the TV shows "Where you
 *   left off", the goal, the steps ticked so far and a line from each of the last scenes. It goes
 *   when the story moves on, with nothing tapped. A TV that reloads mid-chapter shows it too.
 * - **Resume.** A Phone Mode game stopped partway is picked up in a new room with Keep going, and
 *   its World view (the story, a tab in Phone Mode) shows where they left off.
 *
 * Every time, the card sits on screen, under the corner row and above the story plate, with
 * nothing clipped. Nothing here taps the card: it is never in the way.
 *
 * The tables are seeded (seed.ts): a TV's room with a kid's hero made and ready, so each test
 * starts at the lobby's Begin. Making a hero is the creation flow's spec, not this one.
 *
 * `KAD_PREFACE_SHOTS=<dir>` saves the screens for review (the PR's pictures).
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { roomState } from "./room-state";
import { API } from "./api";
import { phoneStorage, seedTable, toTheLobby, tvStorage } from "./seed";

const TAP = { timeout: 20_000 } as const;
const SHOTS = process.env.KAD_PREFACE_SHOTS;

/** The reference campaign's opener and its chapter's goal, as authored. */
const OPENER = "A brand new adventure starts tonight, deep in Bramblewood";
const GOAL = "Follow the humming in the wood all the way to where it comes from.";

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
] as const;

const RECORDER = `
  window.__said = [];
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speak: (u) => window.__said.push(u.text),
    cancel: () => {},
    getVoices: () => [],
  } });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
`;

const said = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __said: string[] }).__said);

interface Member {
  playerId: string;
  connected: boolean;
  character: { name: string };
}

async function sessionOf(page: Page, code: string): Promise<{ playerId: string; sessionToken: string }> {
  return page.evaluate((room) => {
    const saved = localStorage.getItem(`kad.session.${room}`);
    return saved ? (JSON.parse(saved) as { playerId: string; sessionToken: string }) : { playerId: "", sessionToken: "" };
  }, code);
}

/** The dev playtest jump, with a token saved earlier, retried past a lost seq race. */
async function jumpTo(token: { playerId: string; sessionToken: string }, page: Page, code: string, sceneId: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await roomState<{ runId: string; seq: number }>(page, code);
    const response = await fetch(`${API}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token.sessionToken}` },
      body: JSON.stringify({ runId: state.runId, playerId: token.playerId, seq: state.seq, intent: { type: "PLAYTEST_GOTO", sceneId } }),
    });
    const answer = (await response.json()) as { ok?: boolean; error?: { code: string } };
    if (answer.ok) return;
    if (answer.error?.code !== "STALE_SEQ") throw new Error(`PLAYTEST_GOTO ${sceneId}: ${JSON.stringify(answer.error)}`);
  }
  throw new Error("PLAYTEST_GOTO kept losing the seq race");
}

/** The room as the server has it, read with a token saved earlier (the page may be gone). */
async function party(code: string, token: string): Promise<Member[]> {
  const response = await fetch(`${API}/api/state?code=${code}`, { headers: { authorization: `Bearer ${token}` } });
  return ((await response.json()) as { state: { party: Member[] } }).state.party;
}

/** Where the card is in trouble: off the screen, on the plate, under a corner control, or clipped. */
async function fitProblems(page: Page): Promise<string[]> {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  return page.evaluate(() => {
    const out: string[] = [];
    const card = document.querySelector<HTMLElement>("[data-testid='chapter-preface']");
    if (!card) return ["no card"];
    const box = card.getBoundingClientRect();
    if (box.left < 0 || box.top < 0 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) out.push("the card runs off the screen");
    const plate = document.querySelector(".narration__plate")?.getBoundingClientRect();
    if (plate && box.bottom > plate.top + 1) out.push(`the card (to y ${Math.round(box.bottom)}) runs onto the plate (from y ${Math.round(plate.top)})`);
    for (const control of document.querySelectorAll(".kad-corner > *, .kad-about__open, .kad-host__room, .kad-tap-for-sound .kad-button")) {
      const c = control.getBoundingClientRect();
      if (c.width === 0) continue;
      const x = Math.min(box.right, c.right) - Math.max(box.left, c.left);
      const y = Math.min(box.bottom, c.bottom) - Math.max(box.top, c.top);
      if (x > 1 && y > 1) out.push(`the card is under ${control.className}`);
    }
    if (card.hasAttribute("data-clipped") || card.scrollHeight > card.clientHeight + 1) out.push("the card's words are clipped");
    return out;
  });
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test.describe("the words around a chapter (#357)", () => {
  const open: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function device(browser: Browser, options: Parameters<Browser["newContext"]>[0]): Promise<Page> {
    const made = await browser.newContext(options);
    open.push(made);
    await made.addInitScript(RECORDER);
    return made.newPage();
  }

  for (const size of SIZES) {
    const at = `${size.width}x${size.height}`;

    test(`chapter start and drop-in on the TV at ${at}`, async ({ browser }) => {
      test.setTimeout(300_000);
      const table = await seedTable({ mode: "party", tv: true, heroes: [{ name: "Sparklehoof", species: "unicorn" }] });
      const code = table.code;
      // Workers off, so every chapter file comes over the wire this test can slow down.
      const tv = await device(browser, { viewport: size, serviceWorkers: "block", storageState: tvStorage(table) });
      // The chapter's file is slow, but inside PREFACE_WAIT_MS: the preface still comes first.
      await tv.route("**/content/chapters/**", async (route) => {
        await new Promise((done) => setTimeout(done, 1500));
        await route.continue();
      });
      await tv.goto(`/tv/${code}`);
      await tv.getByRole("button", { name: "Turn read-aloud on" }).click();

      const kid = await device(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: phoneStorage(table.phones[0]!) });
      await kid.goto(`/p/${code}`);
      await toTheLobby(kid);
      const token = await sessionOf(kid, code);
      await kid.getByRole("button", { name: /begin the adventure/i }).click(TAP);

      // --- Chapter start: the opener, then the goal, on the TV before the story is read ---
      const card = tv.getByTestId("chapter-preface");
      await expect(card).toBeVisible(TAP);
      await expect(card).toHaveAttribute("data-kind", "start");
      await expect(card).toContainText("Here we go!");
      await expect(card).toContainText(OPENER);
      await expect(card.locator(".preface__goal")).toHaveText(`Your goal: ${GOAL}`);
      expect(await fitProblems(tv)).toEqual([]);
      await shot(tv, `start-${at}`);

      // Read in order: the preface, the goal, then the first scene's story; the goal once.
      await expect.poll(async () => (await said(tv)).findIndex((line) => line.includes("wall of thorns")), TAP).toBeGreaterThan(1);
      const lines = await said(tv);
      const preface = lines.findIndex((line) => line.startsWith("Here we go!") && line.includes(OPENER));
      const goal = lines.indexOf(`Your goal: ${GOAL}`);
      const story = lines.findIndex((line) => line.includes("wall of thorns"));
      expect(preface, lines.join("\n")).toBeGreaterThanOrEqual(0);
      expect(goal).toBe(preface + 1);
      expect(story).toBe(goal + 1);
      await tv.waitForTimeout(500);
      expect((await said(tv)).filter((line) => line.startsWith("Your goal:"))).toHaveLength(1);

      // The story moving on puts it away, with nothing tapped.
      await jumpTo(token, kid, code, "scene_first_clearing");
      await expect(card).toHaveCount(0, TAP);
      await jumpTo(token, kid, code, "scene_pib");
      await jumpTo(token, kid, code, "choice_point_path");
      await expect.poll(async () => (await roomState<{ sceneId: string }>(kid, code)).sceneId, TAP).toBe("choice_point_path");

      // --- Drop-in: the kid's phone steps away and comes back; the TV says where they are ---
      await kid.goto("about:blank");
      await expect.poll(async () => (await party(code, token.sessionToken))[0]?.connected, TAP).toBe(false);
      // The TV has seen the seat go away (drop-in.spec waits the same way): a comeback is away, then back.
      await expect(tv.getByTestId("stepped-away")).toContainText("Sparklehoof stepped away.", TAP);
      await expect(card).toHaveCount(0);
      await kid.goto(`/p/${code}`);
      await expect.poll(async () => (await party(code, token.sessionToken))[0]?.connected, TAP).toBe(true);
      await expect(card).toBeVisible(TAP);
      await expect(card).toHaveAttribute("data-kind", "back");
      await expect(card).toContainText("Where you left off");
      await expect(card).toContainText(GOAL);
      // The first step is ticked (past the hedge), the others not yet.
      await expect
        .poll(() => card.locator(".goal__step").evaluateAll((steps) => steps.map((s) => s.getAttribute("data-done"))), TAP)
        .toEqual(["true", "false", "false"]);
      const trail = card.locator(".preface__lines--trail li");
      await expect(trail).toHaveCount(3);
      await expect(trail.nth(0)).toContainText("wall of thorns");
      await expect(trail.nth(1)).toContainText("lantern moths");
      // Shown, never read out over the story.
      expect((await said(tv)).some((line) => line.includes("Where you left off"))).toBe(false);
      expect(await fitProblems(tv)).toEqual([]);
      await shot(tv, `drop-in-${at}`);

      // Play moving on puts it away, with nothing tapped.
      await jumpTo(token, kid, code, "scene_mossy_stair");
      await expect(card).toHaveCount(0, TAP);

      // --- A TV that reloads partway is a screen coming back too ---
      await tv.reload();
      await expect(card).toBeVisible(TAP);
      await expect(card).toHaveAttribute("data-kind", "back");
      expect(await fitProblems(tv)).toEqual([]);
      await shot(tv, `reload-${at}`);

      // --- A late joiner sits down partway: the TV says where the party is ---
      await jumpTo(token, kid, code, "scene_scouted");
      await expect(card).toHaveCount(0, TAP);
      // Seated with a hero made mid-chapter, as the creation flow leaves a late joiner (no ready-up).
      const [pip] = (await seedTable({ mode: "party", code, heroes: [{ name: "Pip", species: "bigfoot" }], ready: false })).phones;
      const late = await device(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: phoneStorage(pip!) });
      await late.goto(`/p/${code}`);
      await expect.poll(async () => (await party(code, token.sessionToken)).some((m) => m.character.name === "Pip" && m.connected), TAP).toBe(true);
      await expect(card).toBeVisible(TAP);
      await expect(card).toHaveAttribute("data-kind", "back");
      await expect(card).toContainText(GOAL);
      expect(await fitProblems(tv)).toEqual([]);
      await shot(tv, `late-join-${at}`);
    });

    test(`a stopped game resumed with Keep going shows where they left off, at ${at}`, async ({ browser }) => {
      test.setTimeout(300_000);
      // Phone Mode on a tablet: the one screen is the table's.
      const table = await seedTable({ mode: "travel", heroes: [{ name: "Pip", species: "unicorn", player: "Allen" }] });
      const first = table.code;
      const host = await device(browser, { viewport: size, storageState: phoneStorage(table.phones[0]!) });
      await host.goto(`/p/${first}`);
      await toTheLobby(host);
      const token = await sessionOf(host, first);
      await host.getByRole("button", { name: /begin the adventure/i }).click(TAP);
      await expect.poll(async () => (await roomState<{ phase: string }>(host, first)).phase, TAP).toBe("scene");

      // Partway: past the hedge and through the clearing, then a rest to stop at.
      await jumpTo(token, host, first, "scene_first_clearing");
      await jumpTo(token, host, first, "scene_pib");
      await jumpTo(token, host, first, "rest_mossbank");
      await expect.poll(async () => (await roomState<{ sceneId: string }>(host, first)).sceneId, TAP).toBe("rest_mossbank");

      await host.getByText("Running this room").click();
      await host.getByRole("button", { name: "Stop for today" }).click(TAP);
      await host.getByRole("button", { name: "Save and stop" }).click(TAP);
      await expect(host.getByText(/your game is saved/i)).toBeVisible(TAP);
      await host.getByRole("button", { name: /back to the start/i }).click(TAP);

      // Night two: a new room, the same household, Keep going.
      await host.goto("/");
      await host.getByRole("button", { name: /host a game/i }).click();
      await host.getByText("Phone Mode").click();
      await host.getByLabel(/adventurer name/i).fill("Allen");
      await host.getByRole("button", { name: /^start a game$/i }).click();
      await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);
      const second = new URL(host.url()).pathname.split("/").pop() ?? "";
      await expect(host.getByText(/welcome back/i)).toBeVisible({ timeout: 15_000 });
      await host.getByRole("button", { name: /\bPip\b/ }).first().click(TAP);
      await host.getByRole("button", { name: /play as Pip/i }).click(TAP);
      await host.getByRole("button", { name: /^Ready to play$/i }).click(TAP);
      await host.getByRole("button", { name: /keep going/i }).click(TAP);
      await expect.poll(async () => (await roomState<{ sceneId: string }>(host, second)).sceneId, TAP).toBe("rest_mossbank");

      // In Phone Mode the story is the World view, a tab beside the hero's own: looking at it is
      // how a kid reads the story at all, not a tap on the card.
      await host.getByRole("navigation", { name: "What to look at" }).getByRole("button", { name: "World" }).click(TAP);
      const card = host.getByTestId("chapter-preface");
      await expect(card).toBeVisible(TAP);
      await expect(card).toHaveAttribute("data-kind", "back");
      await expect(card).toContainText(GOAL);
      await expect
        .poll(() => card.locator(".goal__step").evaluateAll((steps) => steps.map((s) => s.getAttribute("data-done"))), TAP)
        .toEqual(["true", "false", "false"]);
      await expect(card.locator(".preface__lines--trail li").last()).toContainText("Pib");
      expect(await fitProblems(host)).toEqual([]);
      await shot(host, `resume-${at}`);

      // Play moves on and it goes, with nothing tapped.
      await jumpTo(await sessionOf(host, second), host, second, "scene_crown_door");
      await expect(card).toHaveCount(0, TAP);
    });
  }

  test("chapter files slower than the wait: the story is read alone, then the goal, once, and no recap is shown", async ({ browser }) => {
    test.setTimeout(240_000);
    const table = await seedTable({ mode: "party", tv: true, heroes: [{ name: "Sparklehoof", species: "unicorn" }] });
    const code = table.code;
    const tv = await device(browser, { viewport: { width: 1280, height: 720 }, serviceWorkers: "block", storageState: tvStorage(table) });
    await tv.goto(`/tv/${code}`);
    await tv.getByRole("button", { name: "Turn read-aloud on" }).click();
    // Slower than PREFACE_WAIT_MS (2.5s): the table is never kept waiting for a recap.
    await tv.route("**/content/chapters/**", async (route) => {
      await new Promise((done) => setTimeout(done, 5000));
      await route.continue();
    });

    const kid = await device(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: phoneStorage(table.phones[0]!) });
    await kid.goto(`/p/${code}`);
    await toTheLobby(kid);
    await kid.getByRole("button", { name: /begin the adventure/i }).click(TAP);

    // #356's order: the story, then the goal once the chapter file lands, and nothing twice.
    await expect.poll(async () => (await said(tv)).filter((line) => line === `Your goal: ${GOAL}`).length, TAP).toBe(1);
    const lines = await said(tv);
    const story = lines.findIndex((line) => line.includes("wall of thorns"));
    expect(story, lines.join("\n")).toBeGreaterThanOrEqual(0);
    expect(lines.indexOf(`Your goal: ${GOAL}`)).toBeGreaterThan(story);
    expect(lines.some((line) => line.startsWith("Here we go!"))).toBe(false);
    // Nor is it shown once the file lands: a recap after the story would be out of order.
    await expect(tv.getByTestId("chapter-goal")).toBeVisible(TAP);
    await expect(tv.getByTestId("chapter-preface")).toHaveCount(0);
    await tv.waitForTimeout(500);
    expect((await said(tv)).filter((line) => line.startsWith("Your goal:"))).toHaveLength(1);
  });
});
