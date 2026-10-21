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

    const focused = (): Promise<{ name: string; ring: boolean; inCorner: boolean } | null> =>
      tv.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return {
          name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(),
          ring: el.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0,
          inCorner: el.closest(".kad-corner") !== null,
        };
      });

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
});
