import { openPlayerTask } from "./player-navigation";
import { roomState } from "./room-state";
/**
 * The names under the figures — the thing that tells two players apart when
 * they picked the same species (`packages/client/src/world/nameplate.ts`).
 *
 * This spec exists because the feature shipped with two real defects and
 * neither was catchable by anything in the repo. Nameplates are drawn into a
 * canvas, so no DOM query can see them; both were found by a person looking at
 * a screenshot, and nothing would have caught either one a second time:
 *
 *   1. A name was cropped to its last few letters by the teammate standing in
 *      front of it — `...lehoof` where `Sparklehoof` should be — because the
 *      labels were in the figure depth sort.
 *   2. Two names on adjacent tiles ran together into `SparklehoofSkyclaw`,
 *      because the width cap was wider than the pitch between two tiles.
 *
 * Both happen in the *opening frame of every encounter*, which is when the
 * question the name answers is actually being asked. So the party here is
 * three of the same species on purpose: any test that gives everyone a
 * different creature is testing the case that never needed a nameplate.
 *
 * **This spec guards (2), not (1).** Geometry is what it can see: a name
 * cropped by the figure in front of it reports exactly the same box as one
 * drawn in the clear, so occlusion is invisible here. That one is held by
 * structure instead — the labels live in their own layer above every figure
 * (`nameLayer` in world/board.ts) — and putting them back in the depth sort
 * would pass this spec. Said plainly because a test header that overclaims is
 * how the untested half stays untested.
 *
 * The assertions go through `__kadScene()` — a dev-build-only handle
 * (world/PixiStage.tsx) onto the live scene, whose `nameplateBoxes()` reports
 * what is drawn, where, and on which stage. Geometry rather than pixels, so it
 * survives a re-tuned font; and every assertion names the stage it wants,
 * because the first version of this spec did not and quietly checked the
 * lineup twice.
 */

import { test, expect, type Browser, type Page } from "@playwright/test";
import { nameplatesCollide } from "../packages/client/src/world/nameplate";

const TAP = { timeout: 20_000 } as const;
/*
 * Sixteen characters each — `NAME_MAX_LENGTH`, the longest creation allows.
 *
 * Not decoration. The width cap only *binds* on a long name: at eleven
 * characters "Sparklehoof" fits under even a badly-set cap and two of them sit
 * a comfortable gap apart, so a party of ordinary names passes whether the cap
 * is right or wrong — which was checked, by reintroducing the real bug and
 * watching this spec go green. Worst case is the only case that tests the
 * thing.
 */
const HEROES = ["Moonlightbramble", "Emberwingfeather", "Skyclawthunderer"] as const;

interface Box {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Read the drawn nameplates off the live scene, *with the stage they came
 * from*. Every assertion below names the space it expects, because the first
 * version of this spec did not: it polled for "three names are present", was
 * satisfied by the story lineup that had been on screen all along, and
 * asserted board geometry against lineup boxes — passing twice in a row with
 * the real board bug deliberately reintroduced underneath it.
 */
async function read(page: Page): Promise<{ space: string; boxes: Box[] }> {
  return page.evaluate(() => {
    const get = (globalThis as Record<string, unknown>).__kadScene as
      | (() => { nameplateBoxes(): { space: string; boxes: Box[] } } | null)
      | undefined;
    return get?.()?.nameplateBoxes() ?? { space: "none", boxes: [] };
  });
}

/** The names drawn on a named stage, sorted — the poll key for "we are there". */
async function namesOn(page: Page, space: string): Promise<string> {
  const reading = await read(page);
  if (reading.space !== space) return `<${reading.space}>`;
  return reading.boxes.map((b) => b.text).sort().join(",");
}

/*
 * The rule is imported, not restated. A copy here would have to be kept in
 * step with the real one, and the whole point of asserting it is that nothing
 * else can see these labels — a drifted copy would report a board that reads
 * fine while the shipped one does not.
 */
const collide = nameplatesCollide;

async function serverState(page: Page, code: string): Promise<{ sceneId: string | null; encounter?: unknown }> {
  return roomState(page, code);
}

async function chooseUntil(
  table: Page | readonly Page[],
  label: RegExp,
  done: () => Promise<boolean>,
): Promise<void> {
  // A story choice is one player's turn (spec §6.1), so given the whole table
  // it taps on whichever phone is showing the button — the turn holder's.
  const pages = Array.isArray(table) ? table : [table as Page];
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await done()) return;
    for (const page of pages) {
      await openPlayerTask(page);
      const option = page.locator(".prompt button").filter({ hasText: label }).first();
      if (pages.length > 1 && !(await option.isVisible().catch(() => false))) continue;
      await option.click({ timeout: 5_000 }).catch(() => {});
      await page
        .getByRole("button", { name: /do it!/i })
        .click({ timeout: 5_000 })
        .catch(() => {});
    }
    await pages[0]!.waitForTimeout(700);
  }
  expect(await done(), `the tap on ${String(label)} never took`).toBe(true);
}

async function createCharacter(page: Page, species: string, name: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(species, "i") }).first().click(TAP);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  await page
    .locator(".creation-choice, .creation-card, button")
    .filter({ hasText: /thornguard|duskrunner|starweaver|songkeeper/i })
    .first()
    .click(TAP);
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  for (let i = 0; i < 12; i++) {
    const adds = page.getByRole("button", { name: /add a point to/i });
    if ((await adds.count()) === 0) break;
    await adds.first().click(TAP);
    await page.waitForTimeout(150);
  }
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  await page.getByPlaceholder("Tap to type").fill(name, TAP);
  await page.getByRole("button", { name: /that's me/i }).click(TAP);
  await page.getByRole("button", { name: /^Ready to play$/i }).click(TAP);
}

test.describe("nameplates", () => {
  const open: { close(): Promise<void> }[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  /** Contexts are closed in afterEach: each open client holds an SSE stream to
      the dev server, and leaked ones lose races against socket limits. */
  async function client(browser: Browser, width: number, height: number): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height } });
    open.push(context);
    return context.newPage();
  }

  test("phone guest pages keep heroes and names readable at 390px", async ({ browser }, info) => {
    const guests = [
      { figure: "cast/lady_olivia", name: "Lady Olivia" },
      { figure: "cast/seren_wisp", name: "Seren Wisp" },
      { figure: "cast/pip_thistledown", name: "Pip Thistledown" },
    ];
    const phones = [await client(browser, 390, 844), await client(browser, 390, 844), await client(browser, 390, 844)];
    for (const phone of phones) await phone.context().route("**/content/chapters/*.json", async (route) => {
      const response = await route.fetch();
      const chapter = await response.json();
      chapter.scenes[chapter.entry].cast = guests;
      await route.fulfill({ response, json: chapter });
    });
    const host = phones[0]!;
    await host.goto("/");
    await host.getByRole("button", { name: /host a game/i }).click();
    await host.getByText("Phone Mode").click();
    await host.fill('input[placeholder="Type your name"]', "Allen");
    await host.getByRole("button", { name: /start a game/i }).click();
    await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/);
    const code = new URL(host.url()).pathname.split("/").pop()!;
    for (const page of phones.slice(1)) {
      await page.goto("/");
      await page.getByLabel(/room code/i).fill(code);
      await page.getByRole("button", { name: /join a game/i }).click();
      await expect(page).toHaveURL(new RegExp(`/p/${code}$`));
    }
    for (const [i, page] of phones.entries()) await createCharacter(page, ["unicorn", "kitsune", "bigfoot"][i]!, HEROES[i]!);
    await host.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    const watcher = phones[1]!;
    await watcher.getByRole("button", { name: /^world$/i }).click(TAP);
    for (const [index, guest] of guests.entries()) {
      await expect.poll(() => namesOn(watcher, "story"), { timeout: 30_000 })
        .toBe([...HEROES, guest.name].sort().join(","));
      const reading = () => watcher.evaluate(() => {
        const get = (globalThis as Record<string, unknown>).__kadScene as
          | (() => { storyFigureBoxes?(): Box[]; storyNameplateBoxes?(): (Box & { fontPixels: number })[] } | null) | undefined;
        return { figures: get?.()?.storyFigureBoxes?.(), labels: get?.()?.storyNameplateBoxes?.() };
      });
      await expect.poll(async () => {
        const { figures, labels } = await reading();
        // True proportion (#362): a kitsune hero is half a unicorn, so it is the
        // tallest figure that has to stay big enough to read, and the rest
        // stay clear of the speck the stage's floor prevents.
        const tallest = Math.max(...(figures ?? []).map((b) => b.height));
        return figures?.length === 4 && tallest >= 110 &&
          figures.every((b) => b.height >= 45 && b.x >= 0 && b.x + b.width <= 390) &&
          labels?.length === 4 && labels.every((b) => b.fontPixels >= 10 && b.x - b.width / 2 >= 0 && b.x + b.width / 2 <= 390);
      }, { timeout: 30_000 }).toBe(true);
      const labels = (await reading()).labels!;
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
        expect(collide(labels[i]!, labels[j]!), `${labels[i]!.text} overlaps ${labels[j]!.text}`).toBe(false);
      }
      await watcher.screenshot({ path: info.outputPath(`guest-${index + 1}-phone.png`) });
      if (index < guests.length - 1) await watcher.getByRole("button", { name: "Next guest" }).click();
    }
    await watcher.getByRole("button", { name: "Previous guest" }).click();
    await expect.poll(() => namesOn(watcher, "story"), { timeout: 30_000 })
      .toBe([...HEROES, guests[1]!.name].sort().join(","));
    await watcher.setViewportSize({ width: 960, height: 844 });
    await expect.poll(() => namesOn(watcher, "story"), { timeout: 30_000 })
      .toBe([...HEROES, ...guests.map((guest) => guest.name)].sort().join(","));
    await expect(watcher.getByRole("navigation", { name: "Scene guests" })).toHaveCount(0);
    await watcher.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => namesOn(watcher, "story"), { timeout: 30_000 })
      .toBe([...HEROES, guests[1]!.name].sort().join(","));
  });

  test("three of the same species are told apart, on the lineup and on the board", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const phones = [
      await client(browser, 390, 844),
      await client(browser, 390, 844),
      await client(browser, 390, 844),
    ];
    const host = phones[0]!;

    // The TV opens the room — a pure display client, which is the surface the
    // nameplates are for. It is the lobby, not a seat (spec §2.1).
    const tv = await client(browser, 1280, 720);
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/);
    const code = new URL(tv.url()).pathname.split("/").pop()!;

    for (const [i, page] of phones.entries()) {
      await page.goto("/");
      await page.getByLabel(/room code/i).fill(code);
      await page.getByRole("button", { name: /join a game/i }).click();
      await expect(page).toHaveURL(new RegExp(`/p/${code}$`));
    }

    // Every one a unicorn: the collision the whole feature is for.
    for (const [i, page] of phones.entries()) {
      await createCharacter(page, "unicorn", HEROES[i]!);
    }

    // --- Lobby: no nameplates, because the card row already names everyone ---
    await expect
      .poll(async () => (await read(tv)).boxes.length, { timeout: 30_000 })
      .toBe(0);

    // "Ready to play" at the end of creation already said ready.
    for (const page of phones) {
      await expect(page.getByRole("button", { name: /wait, not yet/i })).toBeVisible();
    }
    await host.getByRole("button", { name: /begin the adventure/i }).click(TAP);

    // --- Story lineup: one name per figure, all three legible and apart ---
    await expect
      .poll(() => namesOn(tv, "story"), { timeout: 30_000 })
      .toBe([...HEROES].sort().join(","));

    const lineup = (await read(tv)).boxes;
    for (let i = 0; i < lineup.length; i++) {
      for (let j = i + 1; j < lineup.length; j++) {
        expect(
          collide(lineup[i]!, lineup[j]!),
          `"${lineup[i]!.text}" and "${lineup[j]!.text}" overlap on the lineup`,
        ).toBe(false);
      }
    }

    // --- The board: the case both real defects appeared in ---
    const at = (sceneId: string) => async () => (await serverState(host, code)).sceneId === sceneId;
    const heroOf = (page: Page): string => HEROES[phones.indexOf(page)]!;

    await chooseUntil(phones, /walk right through the thorns/i, at("scene_first_clearing"));
    await chooseUntil(phones, /head deeper into the wood/i, at("choice_point_path"));
    for (const page of phones) {
      await chooseUntil(page, /follow the singing stream/i, async () => {
        const state = await serverState(host, code);
        if (state.sceneId !== "choice_point_path") return true;
        return await page
          .locator(".prompt button")
          .filter({ hasText: /follow the singing stream/i })
          .getByText(heroOf(page))
          .isVisible()
          .catch(() => false);
      });
    }
    await expect
      .poll(async () => (await serverState(host, code)).sceneId, { timeout: 30_000 })
      .toBe("scene_singing_stream");
    await chooseUntil(phones, /chase them off/i, at("encounter_bramblewisps"));

    const encounterUp = async () => Boolean((await serverState(host, code)).encounter);
    for (const page of phones) {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (await encounterUp()) break;
        const flipped = await page
          .getByRole("button", { name: /wait, not yet/i })
          .isVisible()
          .catch(() => false);
        if (flipped) break;
        await openPlayerTask(page);
        await page.getByRole("button", { name: /i'm ready/i }).click({ timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }
    await expect.poll(encounterUp, { timeout: 30_000 }).toBe(true);

    // The party spawns clustered on adjacent tiles, which is precisely the
    // arrangement that produced "...lehoof" and "SparklehoofSkyclaw".
    // Waits for the *board* specifically. The lineup is never an acceptable
    // answer here, whatever names it happens to be showing.
    await expect
      .poll(() => namesOn(tv, "board"), { timeout: 60_000 })
      .toBe([...HEROES].sort().join(","));

    const board = (await read(tv)).boxes;
    for (const box of board) {
      // A label scaled to nothing is a label nobody can read, and it would
      // satisfy a name-only assertion perfectly.
      expect(box.width, `"${box.text}" is drawn at ${box.width}px wide`).toBeGreaterThan(20);
    }
    for (let i = 0; i < board.length; i++) {
      for (let j = i + 1; j < board.length; j++) {
        expect(
          collide(board[i]!, board[j]!),
          `"${board[i]!.text}" and "${board[j]!.text}" overlap on the board`,
        ).toBe(false);
      }
    }
  });
});
