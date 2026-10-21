/**
 * The chapter's goal (#356), end to end: always on the TV and the phones, ticking by itself.
 *
 * The owner's requirement is the whole test: nobody taps or clicks to see the goal or to see
 * it change. So nothing here clicks on the TV beyond turning read-aloud on, and the phone is
 * only used to make the hero, begin and ready up for the fight. The story is moved with the dev playtest jump (PLAYTEST_GOTO), which runs
 * the scene's real `onEnter`, so a step ticks because the engine set its flag and the
 * patch reached every screen, exactly as at the table.
 *
 * Read-aloud is recorded rather than heard (read-aloud.spec): the goal is said after the
 * first scene's story, and a step ticking is never read out (the owner's call: too much).
 *
 * `KAD_GOAL_SHOTS=<dir>` saves the screens for review (the PR's pictures).
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createCharacter } from "./characters";
import { openPlayerTask } from "./player-navigation";
import { roomState } from "./room-state";

const TAP = { timeout: 20_000 } as const;
const API = "http://localhost:8787";
const SHOTS = process.env.KAD_GOAL_SHOTS;

/** Bramblewood's goal, as authored in content/chapters/bramblewood-01.json. */
const GOAL = "Follow the humming in the wood all the way to where it comes from.";
const STEPS = ["Get past the wall of thorns", "Find a way through the wood", "Open the door the humming is behind"];

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

async function sessionOf(page: Page, code: string): Promise<{ playerId: string; sessionToken: string }> {
  return page.evaluate((room) => {
    const saved = localStorage.getItem(`kad.session.${room}`);
    return saved ? (JSON.parse(saved) as { playerId: string; sessionToken: string }) : { playerId: "", sessionToken: "" };
  }, code);
}

/** The dev playtest jump, from the phone's seat, retried past a lost seq race. */
async function jumpTo(page: Page, code: string, sceneId: string): Promise<void> {
  const session = await sessionOf(page, code);
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await roomState<{ runId: string; seq: number }>(page, code);
    const response = await fetch(`${API}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.sessionToken}` },
      body: JSON.stringify({ runId: state.runId, playerId: session.playerId, seq: state.seq, intent: { type: "PLAYTEST_GOTO", sceneId } }),
    });
    const answer = (await response.json()) as { ok?: boolean; error?: { code: string } };
    if (answer.ok) return;
    if (answer.error?.code !== "STALE_SEQ") throw new Error(`PLAYTEST_GOTO ${sceneId}: ${JSON.stringify(answer.error)}`);
  }
  throw new Error("PLAYTEST_GOTO kept losing the seq race");
}

/** Which steps a goal card shows ticked, in order. */
async function ticks(goal: ReturnType<Page["locator"]>): Promise<boolean[]> {
  return goal.locator(".goal__step").evaluateAll((steps) => steps.map((s) => s.getAttribute("data-done") === "true"));
}

/**
 * Records, per goal card, the animations running on a step the moment it is marked fresh,
 * so a moment that lasts two seconds is seen however the test is paced.
 */
function watchMoments(): void {
  const seen: Record<string, string[]> = {};
  (window as unknown as { __moments: typeof seen }).__moments = seen;
  new MutationObserver(() => {
    for (const step of document.querySelectorAll(".goal__step--fresh")) {
      const card = [...(step.closest(".goal")?.classList ?? [])].find((c) => c === "goal--world" || c === "goal--phone") ?? "?";
      requestAnimationFrame(() => {
        const names = step.getAnimations({ subtree: true }).filter((a) => a instanceof CSSAnimation).map((a) => (a as CSSAnimation).animationName);
        seen[card] = [...new Set([...(seen[card] ?? []), ...names])];
      });
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });
}

const moments = (page: Page, card: string): Promise<string[]> =>
  page.evaluate((c) => (window as unknown as { __moments: Record<string, string[]> }).__moments[c] ?? [], card);

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test.describe("the chapter's goal (#356)", () => {
  const open: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function context(browser: Browser, options: Parameters<Browser["newContext"]>[0]): Promise<Page> {
    const made = await browser.newContext(options);
    open.push(made);
    await made.addInitScript(RECORDER);
    return made.newPage();
  }

  test("is on the TV and the phone with nothing tapped, ticks by itself, and celebrates the tick", async ({ browser }) => {
    test.setTimeout(240_000);
    const tv = await context(browser, { viewport: { width: 1280, height: 720 } });
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/, TAP);
    const code = new URL(tv.url()).pathname.split("/").pop() ?? "";
    // Read-aloud on, as a family that wants the story read would have it.
    await tv.getByRole("button", { name: "Turn read-aloud on" }).click();

    // The phone's settings ask for reduced motion: its tick keeps the gold and drops the pop.
    const kid = await context(browser, { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
    await kid.goto("/");
    await kid.getByLabel(/room code/i).fill(code);
    await kid.getByRole("button", { name: /join a game/i }).click();
    await expect(kid).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    await createCharacter(kid, "unicorn", "Sparklehoof");
    await kid.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect.poll(async () => (await roomState<{ phase: string }>(kid, code)).phase, TAP).toBe("scene");

    // Scene 1: the goal is up on both screens, all of it, and nothing is ticked.
    const tvGoal = tv.getByTestId("chapter-goal");
    const kidGoal = kid.locator(".goal--phone");
    for (const goal of [tvGoal, kidGoal]) {
      await expect(goal).toBeVisible(TAP);
      await expect(goal).toContainText(GOAL);
      for (const step of STEPS) await expect(goal).toContainText(step);
      expect(await ticks(goal)).toEqual([false, false, false]);
    }
    // Said after the first scene's story, once.
    await expect.poll(async () => (await said(tv)).filter((line) => line === `Your goal: ${GOAL}`).length, TAP).toBe(1);
    const story = (await said(tv)).findIndex((line) => line.includes("wall of thorns"));
    expect(story).toBeGreaterThanOrEqual(0);
    expect((await said(tv)).indexOf(`Your goal: ${GOAL}`)).toBeGreaterThan(story);
    await shot(tv, "tv-scene-1");
    await shot(kid, "phone-scene-1");

    // Past the hedge: the step ticks on both screens on its own, with its moment. The moment is
    // recorded as it happens (it lasts a couple of seconds), so the test cannot miss it.
    for (const page of [tv, kid]) await page.evaluate(watchMoments);
    await jumpTo(kid, code, "scene_first_clearing");
    await expect.poll(() => ticks(tvGoal), TAP).toEqual([true, false, false]);
    await expect.poll(() => ticks(kidGoal), TAP).toEqual([true, false, false]);
    await shot(tv, "tv-tick");
    // The TV pops the box, throws the sparks and washes the words gold.
    await expect.poll(() => moments(tv, "goal--world"), TAP).toEqual(expect.arrayContaining(["goal-pop", "goal-spark", "goal-glow"]));
    // Reduced motion on the phone: the gold wash, without the pop or the sparks.
    await expect.poll(() => moments(kid, "goal--phone"), TAP).toEqual(["goal-glow"]);
    // Seen and chimed, never read out: once the new scene's story has been said, nothing follows it.
    await expect.poll(async () => (await said(tv)).some((line) => line.includes("lantern moths")), TAP).toBe(true);
    await tv.waitForTimeout(500);
    expect((await said(tv)).filter((line) => /^Done\b/.test(line))).toEqual([]);
    // And the moment passes, leaving the tick.
    await expect(tvGoal.locator(".goal__step--fresh")).toHaveCount(0, { timeout: 5_000 });
    expect(await ticks(tvGoal)).toEqual([true, false, false]);

    // A screen that loads mid-chapter shows what is done, and celebrates nothing.
    await tv.reload();
    await expect(tvGoal).toBeVisible(TAP);
    expect(await ticks(tvGoal)).toEqual([true, false, false]);
    await expect(tvGoal.locator(".goal__step--fresh")).toHaveCount(0);

    // In a fight it folds to the goal and its pips, in the top corner, on both screens.
    await jumpTo(kid, code, "encounter_bramblewisps");
    // The kid readies up on the phone, as before any fight; the TV is still only watched.
    await openPlayerTask(kid);
    await kid.getByRole("button", { name: /i'm ready to fight/i }).click(TAP);
    await expect.poll(async () => Boolean((await roomState<{ encounter?: unknown }>(kid, code)).encounter), TAP).toBe(true);
    await expect(tv.locator(".world__goal .goal--folded")).toBeVisible(TAP);
    await expect(tv.locator(".world__goal .goal__pips")).toHaveAttribute("aria-label", "1 of 3 done");
    await expect(kid.locator(".goal--phone.goal--folded")).toBeVisible(TAP);
    await shot(tv, "tv-fight");

    // The rest of the way: through the wood, and the door opens whichever way the roll goes.
    await jumpTo(kid, code, "scene_shrine_hollow");
    await expect.poll(() => ticks(tvGoal), TAP).toEqual([true, true, false]);
    await jumpTo(kid, code, "rest_lanternfall");
    // An ending reached by a jump skips the door's roll, so the last box stays as it was;
    // what matters here is that the goal is still on screen at the end.
    await expect.poll(async () => (await roomState<{ phase: string }>(kid, code)).phase, TAP).toBe("chapter_complete");
    await expect(tv.getByTestId("chapter-goal")).toBeVisible(TAP);
    await shot(tv, "tv-complete");
  });

  test("keeps off the story plate and the corner row at TV and tablet sizes, at normal and largest text", async ({ browser }) => {
    test.setTimeout(180_000);
    const tv = await context(browser, { viewport: { width: 1280, height: 720 } });
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/, TAP);
    const code = new URL(tv.url()).pathname.split("/").pop() ?? "";
    const kid = await context(browser, { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    await kid.goto("/");
    await kid.getByLabel(/room code/i).fill(code);
    await kid.getByRole("button", { name: /join a game/i }).click();
    await createCharacter(kid, "unicorn", "Sparklehoof");
    await kid.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect(tv.getByTestId("chapter-goal")).toBeVisible(TAP);

    const problems: string[] = [];
    for (const [width, height] of [[1280, 720], [1024, 600]] as const) {
      for (const text of ["normal", "largest"] as const) {
        await tv.setViewportSize({ width, height });
        await tv.evaluate((t) => {
          if (t === "normal") document.documentElement.removeAttribute("data-text");
          else document.documentElement.setAttribute("data-text", t);
        }, text);
        await tv.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        const found = await tv.evaluate(() => {
          const out: string[] = [];
          const goal = document.querySelector("[data-testid='chapter-goal']")!.getBoundingClientRect();
          const plate = document.querySelector(".narration__plate")!.getBoundingClientRect();
          if (goal.bottom > plate.top) out.push(`the goal (to y ${Math.round(goal.bottom)}) runs onto the plate (from y ${Math.round(plate.top)})`);
          if (goal.right > innerWidth || goal.left < 0) out.push("the goal runs off the screen");
          for (const control of document.querySelectorAll(".kad-corner > *, .kad-about__open, .kad-host__room, .kad-tap-for-sound .kad-button")) {
            const box = control.getBoundingClientRect();
            if (box.width === 0) continue;
            const x = Math.min(goal.right, box.right) - Math.max(goal.left, box.left);
            const y = Math.min(goal.bottom, box.bottom) - Math.max(goal.top, box.top);
            if (x > 1 && y > 1) out.push(`the goal is under ${control.className}`);
          }
          // Whatever the size, the goal and the next thing to do are on screen.
          const next = document.querySelector("[data-testid='chapter-goal'] .goal__step[data-next]");
          if (!next || !next.checkVisibility()) out.push("the next step is not shown");
          return out;
        });
        problems.push(...found.map((p) => `${width}x${height}, ${text} text: ${p}`));
        await shot(tv, `tv-fit-${width}-${text}`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
