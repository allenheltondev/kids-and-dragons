/**
 * Stop anytime, pick up where you left off (#259), against the real stack.
 *
 * Night one: two phones, a chapter under way, and the host stops at a Rest
 * scene. Every screen says the game is saved, and the code is gone.
 *
 * Night two, on the other phone: a new room for the same household offers
 * "Keep going" with a line about where they were. One tap puts the chapter
 * back, scene and words and party and all, and the game plays on from there.
 * A phone that stopped being the host last time is the host this time, and the
 * device that hosted joins late: a seat belongs to a player, not a device.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createCharacter } from "./characters";
import { guidePicture } from "./guide-pictures";
import { openPlayerTask } from "./player-navigation";
import { roomState } from "./room-state";

const TAP = { timeout: 20_000 } as const;
const API = "http://localhost:8787";
const REST_SCENE = "rest_mossbank";

interface Member {
  playerId: string;
  connected: boolean;
  character: { name: string };
}
interface State {
  runId: string;
  seq: number;
  phase: string;
  sceneId: string | null;
  sceneType: string | null;
  narration: string;
  closed?: boolean;
  stopped?: boolean;
  saved?: { recap: string; chapter: { title: string }; heroes: string[] };
  chapterInfo: { index: number; title: string } | null;
  party: Member[];
}

async function sessionOf(page: Page, code: string): Promise<{ playerId: string; sessionToken: string }> {
  return page.evaluate((room) => {
    const saved = localStorage.getItem(`kad.session.${room}`);
    return saved ? (JSON.parse(saved) as { playerId: string; sessionToken: string }) : { playerId: "", sessionToken: "" };
  }, code);
}

/** The dev playtest jump, as this phone, for the one scene the spec is not about reaching. */
async function jumpTo(page: Page, code: string, sceneId: string): Promise<void> {
  const session = await sessionOf(page, code);
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await roomState<State>(page, code);
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

test.describe("stop anytime, pick up where you left off", () => {
  const openContexts: BrowserContext[] = [];

  async function phone(browser: Browser): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    openContexts.push(context);
    return context.newPage();
  }

  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  /** A returning phone, in its household, picking its hero up for this room. */
  async function bringHero(page: Page, hero: string): Promise<void> {
    await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: new RegExp(`\\b${hero}\\b`) }).first().click(TAP);
    await page.getByRole("button", { name: new RegExp(`play as ${hero}`, "i") }).click(TAP);
    await page.getByRole("button", { name: /^Ready to play$/i }).click(TAP);
  }

  /** Night one: Allen opens a Phone Mode room, Sam joins, both make heroes and begin. */
  async function nightOne(browser: Browser) {
    const allen = await phone(browser);
    await allen.goto("/");
    await allen.getByRole("button", { name: /want to host/i }).click();
    await allen.getByText("Phone Mode").click();
    await allen.getByLabel(/adventurer name/i).fill("Allen");
    await allen.getByRole("button", { name: /^start a game$/i }).click();
    await expect(allen).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);
    const first = new URL(allen.url()).pathname.split("/").pop() ?? "";
    await createCharacter(allen, "unicorn", "Pip");

    const sam = await phone(browser);
    await sam.goto("/");
    await sam.getByLabel(/room code/i).fill(first);
    await sam.getByRole("button", { name: /join a game/i }).click();
    await expect(sam).toHaveURL(new RegExp(`/p/${first}$`), TAP);
    await createCharacter(sam, "griffin", "Bo");

    await allen.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect.poll(async () => (await roomState<State>(allen, first)).phase, TAP).toBe("scene");
    return { allen, sam, first };
  }

  test("a chapter stopped at a Rest scene resumes in a new room, on the other phone", async ({ browser }) => {
    test.setTimeout(420_000);

    const { allen, sam, first } = await nightOne(browser);

    // --- A Rest scene: the host is offered a place to stop, and may say no ---
    await jumpTo(allen, first, REST_SCENE);
    await expect(allen.getByText(/cozy place to stop for today/i)).toBeVisible(TAP);
    await guidePicture(allen, "stop-offer");
    // Nobody else is offered it.
    await expect(sam.getByText(/cozy place to stop for today/i)).toHaveCount(0);
    await allen.getByRole("button", { name: "Keep playing" }).click(TAP);
    await expect(allen.getByText(/cozy place to stop for today/i)).toHaveCount(0);

    const before = await roomState<State>(allen, first);
    expect(before.sceneId).toBe(REST_SCENE);
    expect(before.sceneType).toBe("rest");

    // --- Stop for today, after one "are you sure?" ---
    await allen.getByText("Running this room").click();
    await allen.getByRole("button", { name: "Stop for today" }).click(TAP);
    await expect(allen.getByText(/tap Keep going and you will be right back/i)).toBeVisible(TAP);
    await allen.getByRole("button", { name: "Save and stop" }).click(TAP);
    await expect(allen.getByText(/your game is saved/i)).toBeVisible(TAP);
    await expect(sam.getByText(/your game is saved/i)).toBeVisible(TAP);
    await allen.getByRole("button", { name: /back to the start/i }).click(TAP);
    await sam.getByRole("button", { name: /back to the start/i }).click(TAP);

    // --- Night two: Sam, on the other phone, opens a new room ---
    await sam.goto("/");
    await sam.getByRole("button", { name: /want to host/i }).click();
    await sam.getByText("Phone Mode").click();
    await sam.getByLabel(/adventurer name/i).fill("Sam");
    await sam.getByRole("button", { name: /^start a game$/i }).click();
    await expect(sam).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);
    const second = new URL(sam.url()).pathname.split("/").pop() ?? "";
    expect(second).not.toBe(first);
    await bringHero(sam, "Bo");

    // The room says where they stopped, in a line a kid can follow.
    await expect(sam.getByText(/you stopped partway through/i).locator("visible=true").first()).toBeVisible(TAP);
    await expect(sam.getByRole("button", { name: /keep going/i })).toBeVisible(TAP);
    await guidePicture(sam, "keep-going");
    const lobby = await roomState<State>(sam, second);
    expect(["lobby", "creation"]).toContain(lobby.phase);
    expect(lobby.saved?.heroes).toEqual(["Pip", "Bo"]);
    expect(lobby.saved?.chapter.title).toBe(before.chapterInfo?.title);

    // Allen joins late, on the phone that hosted last time.
    await allen.goto("/");
    await allen.getByLabel(/room code/i).fill(second);
    await allen.getByRole("button", { name: /join a game/i }).click();
    await expect(allen).toHaveURL(new RegExp(`/p/${second}$`), TAP);
    await bringHero(allen, "Pip");

    // --- One tap, and the chapter is back ---
    await sam.getByRole("button", { name: /keep going/i }).click(TAP);
    await expect.poll(async () => (await roomState<State>(sam, second)).sceneId, TAP).toBe(REST_SCENE);
    const after = await roomState<State>(sam, second);
    expect(after.phase).toBe("scene");
    expect(after.narration).toBe(before.narration);
    expect(after.chapterInfo).toEqual(before.chapterInfo);
    expect(after.saved).toBeUndefined();
    expect(after.closed).toBeUndefined();
    expect(after.party.map((m) => m.character.name)).toEqual(["Pip", "Bo"]);
    await expect.poll(async () => (await roomState<State>(sam, second)).party.every((m) => m.connected), TAP).toBe(true);
    await expect(sam.getByRole("button", { name: /keep going/i })).toHaveCount(0);

    // --- And the game goes on from there ---
    for (let attempt = 0; attempt < 8; attempt++) {
      if ((await roomState<State>(sam, second)).sceneId !== REST_SCENE) break;
      for (const page of [sam, allen]) {
        await openPlayerTask(page);
        await page.locator(".prompt .choice").first().click({ timeout: 5_000 }).catch(() => undefined);
        await page.getByRole("button", { name: /do it!/i }).click({ timeout: 5_000 }).catch(() => undefined);
      }
      await sam.waitForTimeout(700);
    }
    expect((await roomState<State>(sam, second)).sceneId).not.toBe(REST_SCENE);
  });

  test("the host who stopped it lets a hero go, and the resumed game leaves her out", async ({ browser }) => {
    test.setTimeout(420_000);
    const { allen, sam, first } = await nightOne(browser);
    await allen.getByText("Running this room").click();
    await allen.getByRole("button", { name: "Stop for today" }).click(TAP);
    await allen.getByRole("button", { name: "Save and stop" }).click(TAP);
    await expect(allen.getByText(/your game is saved/i)).toBeVisible(TAP);

    // Only the screen that stopped the game is offered the release.
    await expect(sam.getByText(/your game is saved/i)).toBeVisible(TAP);
    await expect(sam.getByText("Let a hero go")).toHaveCount(0);
    await allen.getByText("Let a hero go").click();
    await allen.getByRole("button", { name: "Let Bo go" }).click(TAP);
    await expect(allen.getByText(/gained in this adventure goes away/i)).toBeVisible(TAP);
    await allen.getByRole("button", { name: "Yes, let Bo go" }).click(TAP);
    await expect(allen.getByText("Bo is free.")).toBeVisible(TAP);
    await allen.getByRole("button", { name: /back to the start/i }).click(TAP);
    await sam.getByRole("button", { name: /back to the start/i }).click(TAP);

    // Night two: Allen's own screen says Pip is saved, and Bo's does not.
    await allen.goto("/");
    await allen.getByRole("button", { name: /want to host/i }).click();
    await allen.getByText("Phone Mode").click();
    await allen.getByLabel(/adventurer name/i).fill("Allen");
    await allen.getByRole("button", { name: /^start a game$/i }).click();
    await expect(allen).toHaveURL(/\/p\/[A-Z]{4}$/, TAP);
    const second = new URL(allen.url()).pathname.split("/").pop() ?? "";
    await expect(allen.getByText("Pip is saved in a game.")).toBeVisible({ timeout: 15_000 });
    await bringHero(allen, "Pip");

    await sam.goto("/");
    await sam.getByLabel(/room code/i).fill(second);
    await sam.getByRole("button", { name: /join a game/i }).click();
    await expect(sam.getByText(/welcome back/i)).toBeVisible({ timeout: 15_000 });
    await expect(sam.getByText(/is saved in a game/i)).toHaveCount(0);

    // Keep going: the game comes back without Bo, who sits down as she is now.
    await allen.getByRole("button", { name: /keep going/i }).click(TAP);
    await expect.poll(async () => (await roomState<State>(allen, second)).phase, TAP).toBe("scene");
    expect((await roomState<State>(allen, second)).party.map((m) => m.character.name)).toEqual(["Pip"]);
  });
});
