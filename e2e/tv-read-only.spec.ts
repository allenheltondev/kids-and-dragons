/**
 * The shared screen is read, not driven: a remote is a clumsy mouse, so the TV has next to
 * nothing to click, and what it says goes away by itself (docs/tv-read-only-audit.md).
 *
 * Against the real stack, on a TV that hosts its room, at a television's 1280x720 and a
 * tablet's 1024x600:
 *
 * - somebody joins mid-story, and the TV says so in one line that never lies on the chapter's
 *   goal or the story plate (#389 found three host cards across the goal at 1024x600), then goes
 *   with nobody touching anything;
 * - the story view has nothing to click but the keep list: the corner row's own controls;
 * - a remote's arrows reach those controls with a visible ring, and OK (Enter) works them.
 *
 * `KAD_TV_SHOTS=<dir>` also saves the screenshots for review.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createCharacter } from "./characters";
import { roomState } from "./room-state";

const TAP = { timeout: 20_000 } as const;
const SHOTS = process.env.KAD_TV_SHOTS;

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
] as const;

/**
 * Everything on the TV's story view that may take a click or focus, by its name: the corner
 * row's device controls (display settings, read-aloud, sound), the shared screen's own (About
 * this screen, Tap for sound while a TV holds sound back) and the host's Room button. Nothing
 * else, and all of it in the corner row.
 */
const KEEP = [/^Display settings$/, /^Turn read-aloud (on|off)$/, /^Turn sound (on|off)$/, /^About this screen$/, /^Tap for sound$/, /^Room( \(locked\))?$/];

/** What on screen takes a click or focus, with its name and whether it is in the corner row. */
async function clickables(page: Page): Promise<{ name: string; inCorner: boolean }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex='-1']), [role='button'], [onclick]")]
      .filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && el.closest("[inert]") === null)
      .map((el) => ({
        name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(),
        inCorner: el.closest(".kad-corner") !== null,
      })),
  );
}

async function onlyTheKeepList(page: Page, where: string): Promise<void> {
  const found = await clickables(page);
  const extra = found.filter((c) => !c.inCorner || !KEEP.some((keep) => keep.test(c.name)));
  expect(extra, `${where}: the TV has something to click beyond the keep list: ${JSON.stringify(extra)}`).toEqual([]);
}

/**
 * Watch the TV for the next join notice, from inside the page so a slow screen cannot blur the
 * timing: every frame it is up, where it is against the goal header and the story plate, and when
 * it came and went.
 */
async function watchNotice(page: Page): Promise<void> {
  await page.evaluate(() => {
    const record = { shownAt: 0, goneAt: 0, frames: 0, overlaps: [] as string[] };
    (window as unknown as { kadNotice: typeof record }).kadNotice = record;
    const rect = (selector: string): DOMRect | null => {
      const el = document.querySelector(selector);
      return el && el.checkVisibility() ? el.getBoundingClientRect() : null;
    };
    const over = (a: DOMRect, b: DOMRect): boolean =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const frame = (): void => {
      const notice = rect(".kad-arrival");
      if (notice) {
        if (!record.shownAt) record.shownAt = performance.now();
        record.frames++;
        for (const [name, selector] of [["goal header", "[data-testid='chapter-goal']"], ["story plate", ".narration__plate"]] as const) {
          const other = rect(selector);
          if (!other) record.overlaps.push(`no ${name} on screen`);
          else if (over(notice, other)) record.overlaps.push(`on the ${name}: notice ${Math.round(notice.top)}-${Math.round(notice.bottom)}, ${name} ${Math.round(other.top)}-${Math.round(other.bottom)}`);
        }
      } else if (record.shownAt) {
        record.goneAt = performance.now();
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function noticeRecord(page: Page): Promise<{ shownAt: number; goneAt: number; frames: number; overlaps: string[] }> {
  return page.evaluate(() => (window as unknown as { kadNotice: { shownAt: number; goneAt: number; frames: number; overlaps: string[] } }).kadNotice);
}

interface Focused { name: string; ring: boolean; inCorner: boolean; className: string }

/** What has focus on the page, by its name, and whether it shows the ring. */
async function focusedOn(page: Page): Promise<Focused | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    return {
      name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(),
      ring: el.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0,
      inCorner: el.closest(".kad-corner") !== null,
      className: typeof el.className === "string" ? el.className : "",
    };
  });
}

/** Host a Party Mode room on a TV, by mouse: the remote's part starts once the lobby is up. */
async function hostTv(browser: Browser, open: BrowserContext[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  open.push(context);
  const tv = await context.newPage();
  await tv.goto("/");
  await tv.getByRole("button", { name: /host a game/i }).click();
  await tv.getByText("Party Mode").click();
  await tv.getByRole("button", { name: /open the lobby here/i }).click();
  await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/, TAP);
  await expect(tv.getByRole("button", { name: "Room", exact: true })).toBeVisible(TAP);
  await expect(tv.getByRole("button", { name: "About this screen" })).toBeVisible(TAP);
  await tv.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  return tv;
}

/** The dev playtest jump (playtest.ts), from a seated phone, as layout-fit.spec and stop-resume.spec use it. */
async function jumpTo(page: Page, code: string, sceneId: string): Promise<void> {
  const session = await page.evaluate((room) => {
    const saved = localStorage.getItem(`kad.session.${room}`);
    return saved ? (JSON.parse(saved) as { playerId: string; sessionToken: string }) : { playerId: "", sessionToken: "" };
  }, code);
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await roomState<{ runId: string; seq: number }>(page, code);
    const response = await fetch("http://localhost:8787/api/action", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.sessionToken}` },
      body: JSON.stringify({ runId: state.runId, playerId: session.playerId, seq: state.seq, intent: { type: "PLAYTEST_GOTO", sceneId } }),
    });
    const answer = (await response.json()) as { ok?: boolean; error?: { code: string } };
    if (answer.ok) return;
    if (answer.error?.code !== "STALE_SEQ") throw new Error(`PLAYTEST_GOTO: ${JSON.stringify(answer.error)}`);
  }
  throw new Error("PLAYTEST_GOTO kept losing the seq race");
}

/** When the stop offer next comes and goes, timed from inside the page. */
async function watchOffer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const record = { shownAt: 0, goneAt: 0 };
    (window as unknown as { kadOffer: typeof record }).kadOffer = record;
    const frame = (): void => {
      const up = document.querySelector(".kad-host__offer") !== null;
      if (up && !record.shownAt) record.shownAt = performance.now();
      if (!up && record.shownAt) {
        record.goneAt = performance.now();
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

test.describe("the shared screen is read, not driven", () => {
  const open: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function phone(browser: Browser): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
    open.push(context);
    return context.newPage();
  }

  async function join(browser: Browser, code: string): Promise<Page> {
    const kid = await phone(browser);
    await kid.goto("/");
    await kid.getByLabel(/room code/i).fill(code);
    await kid.getByRole("button", { name: /join a game/i }).click();
    await expect(kid).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    return kid;
  }

  test("a join notice goes by itself, never on the goal or the story, and the story view has nothing else to click", async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    open.push(context);
    const tv = await context.newPage();
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/, TAP);
    const code = new URL(tv.url()).pathname.split("/").pop() ?? "";
    await expect(tv.getByRole("button", { name: "Room" })).toBeVisible(TAP);

    // --- The lobby: who joined is one line, with nothing on it to click, and it goes ---
    const notice = tv.locator(".kad-arrival");
    let kid: Page | null = null;
    for (const size of SIZES) {
      await tv.setViewportSize(size);
      const joined = await join(browser, code);
      kid ??= joined;
      await expect(notice).toBeVisible(TAP);
      if (SHOTS) await tv.screenshot({ path: `${SHOTS}/lobby-${size.width}x${size.height}.png` });
      await expect(notice.getByRole("button")).toHaveCount(0);
      await onlyTheKeepList(tv, `the lobby with a join notice @${size.width}x${size.height}`);
      await expect(notice).toHaveCount(0, { timeout: 10_000 });
    }
    await tv.setViewportSize(SIZES[0]);

    await createCharacter(kid!, "unicorn", "Sparklehoof");
    await kid!.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect.poll(async () => (await roomState<{ phase: string }>(kid!, code)).phase, TAP).toBe("scene");
    await expect(tv.getByTestId("chapter-goal")).toBeVisible(TAP);
    await expect(tv.locator(".narration__plate")).toBeVisible(TAP);

    // --- The story: nothing to click but the corner row's keep list ---
    await expect(notice).toHaveCount(0, { timeout: 8_000 });
    await onlyTheKeepList(tv, "the story");

    // --- Somebody joins mid-story, at each size: the notice is clear of the goal and the plate,
    //     and goes without input ---
    for (const size of SIZES) {
      await tv.setViewportSize(size);
      await tv.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await watchNotice(tv);
      await join(browser, code);
      await expect(notice).toBeVisible(TAP);
      if (SHOTS) await tv.screenshot({ path: `${SHOTS}/story-join-${size.width}x${size.height}.png` });
      await onlyTheKeepList(tv, `the story with a join notice @${size.width}x${size.height}`);
      // Nobody touches the TV.
      await expect(notice).toHaveCount(0, { timeout: 10_000 });
      const seen = await noticeRecord(tv);
      const where = `@${size.width}x${size.height}`;
      expect(seen.frames, `${where}: the notice was drawn`).toBeGreaterThan(0);
      expect([...new Set(seen.overlaps)], `${where}: the notice lay on something`).toEqual([]);
      // noticeMs: four seconds for "Somebody joined", never past six; a frame or two of slack.
      const up = seen.goneAt - seen.shownAt;
      expect(up, `${where}: up for ${Math.round(up)}ms`).toBeGreaterThan(3_500);
      expect(up, `${where}: up for ${Math.round(up)}ms`).toBeLessThan(6_500);
      if (SHOTS) await tv.screenshot({ path: `${SHOTS}/story-${size.width}x${size.height}.png` });
    }
  });

  test("a remote reaches what the TV keeps: arrows move a visible ring, OK presses", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    open.push(context);
    const tv = await context.newPage();
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/, TAP);
    const room = tv.getByRole("button", { name: "Room", exact: true });
    await expect(room).toBeVisible(TAP);
    await expect(tv.getByRole("button", { name: "About this screen" })).toBeVisible(TAP);
    // The lazy row is in, and the page has nothing focused.
    await tv.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    const focused = (): Promise<Focused | null> => focusedOn(tv);

    // From nothing, an arrow lands on a control the TV keeps, ringed.
    await tv.keyboard.press("ArrowRight");
    const first = await focused();
    expect(first?.inCorner, `focus went to ${JSON.stringify(first)}`).toBe(true);
    expect(first?.ring, "the focused control shows its ring").toBe(true);

    // Along the row to Room, whichever side of it the ring is on.
    const toRoom = async (): Promise<void> => {
      for (let i = 0; i < 8 && (await focused())?.name !== "Room"; i++) {
        const ring = await tv.evaluate(() => document.activeElement!.getBoundingClientRect().x);
        await tv.keyboard.press((await room.boundingBox())!.x < ring ? "ArrowLeft" : "ArrowRight");
      }
      expect((await focused())?.name).toBe("Room");
    };
    await toRoom();
    // OK opens its panel, and the arrows go down into it and back up to the row.
    await tv.keyboard.press("Enter");
    await expect(tv.getByRole("button", { name: "Lock the room" })).toBeVisible(TAP);
    await tv.keyboard.press("ArrowDown");
    const inPanel = await focused();
    expect(inPanel?.inCorner, `down from Room went to ${JSON.stringify(inPanel)}`).toBe(false);
    expect(inPanel?.ring).toBe(true);
    for (let i = 0; i < 12 && !(await focused())?.inCorner; i++) await tv.keyboard.press("ArrowUp");
    await toRoom();
    await tv.keyboard.press("Enter");
    await expect(tv.getByRole("button", { name: "Lock the room" })).toHaveCount(0, TAP);
  });

  test("a remote reaches the visitor sign-in's fields: Room, Let visitors join, the email, the code", async ({ browser }) => {
    // Review of #392: the arrows reached "Let visitors join" but not the fields it opens.
    const tv = await hostTv(browser, open);
    const visitors = tv.getByRole("button", { name: "Let visitors join" });
    const press = async (key: string): Promise<Focused | null> => {
      await tv.keyboard.press(key);
      return focusedOn(tv);
    };
    /** Arrow `key` until `name` has focus, a step at a time, as a remote would. */
    const arrowTo = async (key: string, matches: (f: Focused | null) => boolean, what: string): Promise<void> => {
      let now = await focusedOn(tv);
      for (let i = 0; i < 16 && !matches(now); i++) now = await press(key);
      expect(matches(now), `${key} never reached ${what}; focus is on ${JSON.stringify(now)}`).toBe(true);
    };

    // Up onto the row, along it to Room, and OK.
    await tv.keyboard.press("ArrowRight");
    for (let i = 0; i < 8 && (await focusedOn(tv))?.name !== "Room"; i++) {
      const ring = await tv.evaluate(() => document.activeElement!.getBoundingClientRect().x);
      const room = (await tv.getByRole("button", { name: "Room", exact: true }).boundingBox())!;
      await tv.keyboard.press(room.x < ring ? "ArrowLeft" : "ArrowRight");
    }
    expect((await focusedOn(tv))?.name).toBe("Room");
    await tv.keyboard.press("Enter");
    // The switch waits for the sign-in to be available on this deployment.
    await expect(visitors).toBeEnabled(TAP);

    // Down the panel to Let visitors join, and OK: the sign-in opens on its email field.
    await arrowTo("ArrowDown", (f) => f?.name === "Let visitors join", "Let visitors join");
    await tv.keyboard.press("Enter");
    const email = tv.locator(".keepsake__input");
    await expect(email).toBeFocused(TAP);

    // Left and Right are the field's own; Down leaves it for Send the code, and Up comes back.
    await tv.keyboard.type("grown-up@example.com");
    expect((await press("ArrowLeft"))?.className).toContain("keepsake__input");
    await arrowTo("ArrowDown", (f) => /send the code/i.test(f?.name ?? ""), "Send the code");
    await arrowTo("ArrowUp", (f) => (f?.className ?? "").includes("keepsake__input"), "the email field");
    // And Escape, then an arrow, leaves it too (here Down, where Send the code is).
    await tv.keyboard.press("Escape");
    expect((await press("ArrowDown"))?.name ?? "").toMatch(/send the code/i);
    await arrowTo("ArrowUp", (f) => (f?.className ?? "").includes("keepsake__input"), "the email field, again");

    // Down to Send the code, and OK: the code field takes focus, and the code goes in from the keys.
    await arrowTo("ArrowDown", (f) => /send the code/i.test(f?.name ?? ""), "Send the code");
    await tv.keyboard.press("Enter");
    const codeField = tv.locator(".keepsake__code-input");
    await expect(codeField).toBeFocused(TAP);
    // Out of the code field and back, by the arrows alone.
    await arrowTo("ArrowDown", (f) => !(f?.className ?? "").includes("keepsake__code-input"), "out of the code field");
    await arrowTo("ArrowUp", (f) => (f?.className ?? "").includes("keepsake__code-input"), "the code field");
    // The code goes in from the keys, and the sign-in sends it: the dev sign-in takes any eight
    // digits (visitors.spec). Whether the room then opens is the server's call on who signed in
    // (visitors.spec covers that); here the remote only has to get the code there.
    await tv.keyboard.type("12345678");
    await expect(codeField).toHaveValue("12345678");
    await expect(tv.locator(".keepsake [role='alert']").or(tv.locator(".kad-host__code"))).not.toBeEmpty(TAP);
  });

  test("the Rest stop offer keeps playing by itself after 15s, still takes OK first, and keeps its clock under reduced motion", async ({ browser }) => {
    test.setTimeout(240_000);
    const tv = await hostTv(browser, open);
    const code = new URL(tv.url()).pathname.split("/").pop() ?? "";
    const kid = await join(browser, code);
    await createCharacter(kid, "unicorn", "Sparklehoof");
    await kid.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect.poll(async () => (await roomState<{ phase: string }>(kid, code)).phase, TAP).toBe("scene");
    const offer = tv.locator(".kad-host__offer");
    const keep = offer.getByRole("button", { name: "Keep playing" });

    // --- A Rest, under reduced motion: the bar stands still, nobody answers, and it keeps playing ---
    await tv.evaluate(() => document.documentElement.setAttribute("data-motion", "reduced"));
    await watchOffer(tv);
    await jumpTo(kid, code, "rest_mossbank");
    await expect(offer).toBeVisible(TAP);
    await expect(offer.getByTestId("stop-offer-clock")).toContainText("Keeping going");
    expect(await offer.locator(".kad-host__offer-bar > span").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await expect(offer).toHaveCount(0, { timeout: 25_000 });
    const timed = await tv.evaluate(() => (window as unknown as { kadOffer: { shownAt: number; goneAt: number } }).kadOffer);
    const up = timed.goneAt - timed.shownAt;
    expect(up, `the offer was up for ${Math.round(up)}ms`).toBeGreaterThan(14_000);
    expect(up, `the offer was up for ${Math.round(up)}ms`).toBeLessThan(17_000);
    // Kept playing: the room is still at the Rest, not stopped, and the offer does not come back.
    const after = await roomState<{ sceneId: string; stopped?: boolean }>(kid, code);
    expect(after.sceneId).toBe("rest_mossbank");
    expect(after.stopped ?? false).toBe(false);
    await tv.waitForTimeout(2_000);
    await expect(offer).toHaveCount(0);
    // Stop for today is still in the Room panel.
    await tv.getByRole("button", { name: "Room", exact: true }).click();
    await expect(tv.getByRole("button", { name: "Stop for today" })).toBeVisible(TAP);
    await tv.getByRole("button", { name: "Room", exact: true }).click();

    // --- The same Rest on a reloaded TV, which offers again: the bar runs, and OK on Keep playing
    //     still answers it before the clock ---
    await tv.reload();
    await expect(offer).toBeVisible(TAP);
    expect(await offer.locator(".kad-host__offer-bar > span").evaluate((el) => getComputedStyle(el).animationName)).toBe("kad-host-offer-run");
    await keep.focus();
    await tv.keyboard.press("Enter");
    await expect(offer).toHaveCount(0, TAP);
    expect((await roomState<{ stopped?: boolean }>(kid, code)).stopped ?? false).toBe(false);
  });
});
