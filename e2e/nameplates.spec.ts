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

async function serverState(code: string): Promise<{ sceneId: string | null; encounter?: unknown }> {
  const response = await fetch(`http://localhost:8787/api/state?code=${code}`);
  return ((await response.json()) as { state: { sceneId: string | null; encounter?: unknown } })
    .state;
}

async function chooseUntil(page: Page, label: RegExp, done: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await done()) return;
    await page
      .locator(".prompt button")
      .filter({ hasText: label })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => {});
    await page
      .getByRole("button", { name: /do it!/i })
      .click({ timeout: 5_000 })
      .catch(() => {});
    await page.waitForTimeout(700);
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
  // Straight past the appearance step without touching a swatch. That is the
  // assertion: colour and accent are optional (CreationFlow `stepDone`), so
  // "Next" has to be live on arrival. first-playable.spec.ts covers the other
  // path, where somebody does pick.
  await expect(page.getByRole("button", { name: /^next$/i })).toBeEnabled();
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  await page.getByPlaceholder("Tap to type").fill(name, TAP);
  await page.getByRole("button", { name: /that's me/i }).click(TAP);
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

    await host.goto("/");
    await host.fill('input[placeholder="Type your name"]', "Allen");
    await host.getByText("Party Mode").click();
    await host.getByRole("button", { name: /start a game/i }).click();
    await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/);
    const code = new URL(host.url()).pathname.split("/").pop()!;

    // The TV — a pure display client, which is the surface the nameplates are
    // for. It attaches on the room code alone (spec §2.1).
    const tv = await client(browser, 1280, 720);
    await tv.goto(`/tv/${code}`);

    for (const [i, page] of phones.slice(1).entries()) {
      await page.goto("/");
      await page.fill('input[placeholder="Type your name"]', ["Sam", "Rosie"][i]!);
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

    for (const page of phones) {
      await page.getByRole("button", { name: /i'm ready/i }).click(TAP);
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
    const at = (sceneId: string) => async () => (await serverState(code)).sceneId === sceneId;
    const heroOf = (page: Page): string => HEROES[phones.indexOf(page)]!;

    await chooseUntil(host, /walk right through the thorns/i, at("scene_first_clearing"));
    await chooseUntil(host, /head deeper into the wood/i, at("choice_point_path"));
    for (const page of phones) {
      await chooseUntil(page, /follow the singing stream/i, async () => {
        const state = await serverState(code);
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
      .poll(async () => (await serverState(code)).sceneId, { timeout: 30_000 })
      .toBe("scene_singing_stream");
    await chooseUntil(host, /chase them off/i, at("encounter_bramblewisps"));

    const encounterUp = async () => Boolean((await serverState(code)).encounter);
    for (const page of phones) {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (await encounterUp()) break;
        const flipped = await page
          .getByRole("button", { name: /wait, not yet/i })
          .isVisible()
          .catch(() => false);
        if (flipped) break;
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
