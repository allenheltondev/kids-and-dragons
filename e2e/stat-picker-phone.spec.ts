/**
 * A hero with a stat point to spend can reach every stat and the Grow! button
 * on a short phone.
 *
 * The playtest report: at a Rest stop the stat picker would not scroll on a
 * phone, so the last stat and the button under it could not be tapped. The
 * picker sits above a Rest scene's own choices, under the identity strip, the
 * chapter goal (which now steps aside while a point is waiting) and, for the
 * host, the room bar, so a short pane and larger text are the cases that
 * squeeze it. This opens a real Rest scene (the playtest jump), gives the
 * page's own store the points the engine would have banked, and asks
 * Playwright for a trial click: it scrolls the control into view and checks
 * nothing covers it, and it fails if the control sits in a box that cannot
 * scroll to it. Nothing is sent to the server.
 *
 * Points are put on the page's state because earning one takes a whole
 * chapter (the same reason layout-fit.spec puts a rank-up there). The dev
 * server serves the store by its module URL, which is the instance the app
 * uses.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { onAir, phoneStorage, seedTable } from "./seed";

const TAP = { timeout: 20_000 } as const;

interface Size {
  width: number;
  height: number;
  text: "normal" | "largest";
}

/**
 * Short panes, from the pane a Travel Mode phone gives the controls to a
 * phone held upright with the browser's bars up; the largest text on each of
 * the narrow ones, where the strip wraps and takes the most room.
 */
const SIZES: Size[] = [
  { width: 360, height: 480, text: "normal" },
  { width: 360, height: 480, text: "largest" },
  { width: 390, height: 568, text: "largest" },
  { width: 320, height: 520, text: "largest" },
];

/** Gives the seated hero `points` to spend and all four stats to spend them on. */
async function bank(page: Page, code: string, points: number): Promise<void> {
  await page.evaluate(
    async ([room, count]) => {
      const saved = JSON.parse(localStorage.getItem(`kad.session.${room}`) ?? "{}") as { playerId?: string };
      const path = "/src/store/index.ts";
      const { useGameStore } = (await import(/* @vite-ignore */ path)) as {
        useGameStore: {
          getState(): { state: { party: { playerId: string; character: Record<string, unknown> }[] } | null };
          setState(next: object): void;
        };
      };
      const state = useGameStore.getState().state!;
      useGameStore.setState({
        state: {
          ...state,
          party: state.party.map((member) =>
            member.playerId === saved.playerId
              ? { ...member, character: { ...member.character, unspentPoints: count, spendableStats: ["might", "quick", "clever", "heart"] } }
              : member,
          ),
        },
      });
    },
    [code, points] as const,
  );
}

test.describe("the stat picker on a short phone", () => {
  test.setTimeout(240_000);
  const open: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  for (const size of SIZES) {
    test(`reaches the last stat and Grow! at ${String(size.width)}x${String(size.height)}, ${size.text} text`, async ({ browser }) => {
      // The phone that opened the room is its host, so the room bar is up above the controls.
      const table = await seedTable({
        mode: "travel",
        heroes: [{ name: "Rosie", species: "griffin", player: "Grown-up" }],
        begin: true,
        sceneId: "rest_mossbank",
      });
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        hasTouch: true,
        isMobile: true,
        storageState: phoneStorage(table.phones[0]!),
      });
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
      await page.goto(`/p/${table.code}`);
      await onAir(page);
      if (size.text !== "normal") await page.evaluate((text) => document.documentElement.setAttribute("data-text", text), size.text);

      await bank(page, table.code, 2);
      // The rest stop's question is this phone's, so it opened on its turn page (#588), where the
      // picker stands above the way on; "Spend your stat points" is only the way in from the bag.
      await expect(page.getByRole("button", { name: /^Spend your stat points?$/ })).toBeHidden();
      const heading = page.getByRole("heading", { name: /You have 2 points to spend!/ });
      await expect(heading).toBeVisible(TAP);

      // Tapping the button lands on the picker: its heading is on screen without a scroll.
      // (It used to sit a long way below the fold, under the strip, the room bar and the notices.)
      await expect
        .poll(async () => {
          const box = await heading.boundingBox();
          return box !== null && box.y >= 0 && box.y + box.height <= size.height;
        }, TAP)
        .toBe(true);

      // Every stat on offer can be scrolled to and tapped, the last one most of all.
      const stats = page.locator(".grow .prompt__options button");
      await expect(stats).toHaveCount(4);
      for (let i = 0; i < 4; i++) await stats.nth(i).click({ trial: true });
      await stats.nth(3).click();

      // And so can the button that spends the point.
      const grow = page.getByRole("button", { name: "Grow!" });
      await expect(grow).toBeVisible(TAP);
      await grow.click({ trial: true });
    });
  }
});
