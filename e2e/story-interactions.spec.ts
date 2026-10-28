import { test, expect, type Page } from "@playwright/test";
import type { ClientIntent, RunState } from "../packages/shared/src/index";
import { roomState } from "./room-state";
import { openPlayerTask } from "./player-navigation";
import { API } from "./api";

// Three live rendered surfaces are expensive to trace on a local Windows host.
// Keep CI failure traces so refresh and multi-phone failures can be diagnosed.
test.use({ trace: process.env.CI ? "retain-on-failure" : "off" });

async function action(page: Page, code: string, intent: ClientIntent) {
  const session = await page.evaluate((room) => JSON.parse(localStorage.getItem(`kad.session.${room}`) ?? "null") as { playerId: string; sessionToken: string }, code);
  for (let retry = 0; retry < 5; retry++) {
    const state = await roomState<RunState>(page, code);
    const response = await page.request.post(`${API}/api/action`, {
      headers: { authorization: `Bearer ${session.sessionToken}` },
      data: { runId: state.runId, seq: state.seq, playerId: session.playerId, intent },
    });
    const result = await response.json() as { ok: boolean; error?: { code: string } };
    if (result.ok) return;
    if (result.error?.code !== "STALE_SEQ") throw Error(JSON.stringify(result));
  }
  throw Error("Interaction test lost the sequence race repeatedly");
}

test("reusable interactions run through real phones, TV, refresh, and authored branches", async ({ browser }) => {
  test.setTimeout(420_000);
  const first = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const second = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const display = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const tv = await display.newPage();
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/);
    const code = new URL(tv.url()).pathname.split("/").pop()!;
    const one = await first.newPage();
    await one.goto("/");
    await one.getByLabel(/room code/i).fill(code);
    await one.getByRole("button", { name: /join a game/i }).click();
    await expect(one).toHaveURL(new RegExp(`/p/${code}$`));
    await one.getByRole("button", { name: "You", exact: true }).click();
    await action(one, code, { type: "CREATE_CHARACTER", name: "Aster", species: "unicorn", class: "songkeeper", stats: { might: 0, quick: 0, clever: 0, heart: 3 }, appearance: { palette: "meadow", accent: "#7FD4C1" } });
    await action(one, code, { type: "READY", ready: true });
    const two = await second.newPage();
    await two.goto("/");
    await two.getByLabel(/room code/i).fill(code);
    await two.getByRole("button", { name: /join a game/i }).click();
    await expect(two).toHaveURL(new RegExp(`/p/${code}$`));
    await two.getByRole("button", { name: "You", exact: true }).click();
    await action(two, code, { type: "CREATE_CHARACTER", name: "Fern", species: "griffin", class: "duskrunner", stats: { might: 0, quick: 3, clever: 0, heart: 0 }, appearance: { palette: "meadow", accent: "#7FD4C1" } });
    await action(two, code, { type: "READY", ready: true });
    await action(one, code, { type: "START_PRACTICE" });
    await action(one, code, { type: "PLAYTEST_GOTO", sceneId: "interaction_bell" });
    const controls = (page: Page) => page.getByRole("region", { name: "Interaction controls" });
    // Relaxed play lives under the "Stuck? Get help" fold with the helping hand, so a phone opens it first.
    const relaxed = async (page: Page) => {
      await controls(page).locator("summary.game__help-summary").click();
      await controls(page).getByLabel("Relaxed play").check();
    };
    const world = tv.getByRole("region", { name: "Story interaction" });
    await expect(world).toContainText("seed reaches the gold");
    await controls(one).getByRole("button", { name: "We’re ready" }).click();
    await controls(one).getByRole("button", { name: "Toss the seed!" }).click();
    await expect(controls(two).getByRole("button", { name: "See what happens next" })).toBeVisible();
    await two.reload();
    await two.getByRole("button", { name: "Got it", exact: true }).click();
    await expect(two.getByRole("button", { name: "Your turn", exact: true })).toBeVisible();
    await openPlayerTask(two);
    await expect(controls(two).getByRole("button", { name: "See what happens next" })).toBeVisible();
    await controls(two).getByRole("button", { name: "See what happens next" }).click();
    await expect(world).toContainText("Hold the branch");
    await expect(tv.locator(".interaction-art__main").first()).toHaveAttribute("src", "/assets/story-props/rope-loop.webp");
    await expect(one.locator(".interaction-art__main").first()).toHaveAttribute("src", "/assets/story-props/rope-loop.webp");
    await relaxed(two);
    await controls(two).getByRole("button", { name: "We’re ready" }).click();
    await expect(controls(two).getByRole("button", { name: "Fetch the ribbon" })).toBeDisabled();
    await one.setViewportSize({ width: 390, height: 640 });
    await controls(one).getByRole("button", { name: "Hold the branch", exact: true }).scrollIntoViewIfNeeded();
    const shortPhoneAction = await controls(one).getByRole("button", { name: "Hold the branch", exact: true }).boundingBox();
    expect(shortPhoneAction).not.toBeNull();
    expect(shortPhoneAction!.y).toBeGreaterThanOrEqual(0);
    expect(shortPhoneAction!.y + shortPhoneAction!.height).toBeLessThanOrEqual(640);
    await controls(one).getByRole("button", { name: "Hold the branch", exact: true }).click();
    await controls(two).getByRole("button", { name: "Fetch the ribbon" }).click();
    await expect(world).toContainText("You did it together");
    await controls(two).getByRole("button", { name: "See what happens next" }).click();
    await controls(one).getByRole("button", { name: "We’re ready" }).click();
    await expect(controls(one)).toContainText("Start with the frog");
    await expect(controls(two)).toContainText("The owl comes just before the fox");
    for (const name of ["Frog", "Owl", "Fox"]) await controls(one).getByRole("button", { name, exact: true }).click();
    await controls(one).getByRole("button", { name: "Try our path" }).click();
    await expect(world).toContainText("You did it together");
    await one.screenshot({ path: "tmp/issue-493-core-phone.png", fullPage: true });
    await tv.screenshot({ path: "tmp/issue-493-core-tv.png", fullPage: true });
    await controls(one).getByRole("button", { name: "See what happens next" }).click();
    await expect.poll(async () => (await roomState<RunState>(one, code)).sceneId).toBe("scene_team_tricks_done");
    expect(await one.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const firstPlayerId = await one.evaluate((room) => (JSON.parse(localStorage.getItem(`kad.session.${room}`)!) as { playerId: string }).playerId, code);
    for (const sceneId of ["interaction_cups", "interaction_echo", "interaction_sneak", "interaction_balance", "interaction_spark", "interaction_feed", "interaction_camp", "interaction_cheer", "interaction_wake"]) {
      await action(one, code, { type: "PLAYTEST_GOTO", sceneId });
      const state = await roomState<RunState>(one, code);
      if (state.prompt?.kind !== "interaction") throw Error("Expected authored interaction");
      const lead = state.prompt.actorId === firstPlayerId ? one : two;
      await relaxed(lead);
      await controls(lead).getByRole("button", { name: "We’re ready" }).click();
      if (sceneId === "interaction_cups") await controls(lead).getByRole("button", { name: "Look under: Right cup", exact: true }).click();
      if (sceneId === "interaction_echo") {
        for (const name of ["Star", "Leaf", "Star", "Bell"]) await controls(lead).getByRole("button", { name, exact: true }).click();
        await controls(lead).getByRole("button", { name: "Send our greeting", exact: true }).click();
      }
      if (sceneId === "interaction_sneak") await controls(lead).getByRole("button", { name: "Tiptoe!", exact: true }).click();
      if (sceneId === "interaction_balance") {
        for (const phone of [one, two]) {
          await controls(phone).getByRole("button", { name: "Lift my side", exact: true }).click();
          await controls(phone).getByRole("button", { name: "Lift my side", exact: true }).click();
        }
        await controls(lead).getByRole("button", { name: "Carry it through", exact: true }).click();
      }
      if (sceneId === "interaction_spark") for (const phone of [one, two]) {
        await controls(phone).getByRole("button", { name: "Catch the starlight", exact: true }).click();
        await controls(phone).getByRole("button", { name: "Pass it on", exact: true }).click();
      }
      if (sceneId === "interaction_feed") {
        await controls(one).getByRole("button", { name: "Offer an apple slice", exact: true }).click();
        await expect(world).toContainText("Bun sniffs, crunches");
        await controls(lead).getByRole("button", { name: "Give Bun a wave", exact: true }).click();
      }
      if (sceneId === "interaction_camp") {
        await controls(one).getByRole("button", { name: "Hang a lantern", exact: true }).click();
        await controls(two).getByRole("button", { name: "Bring some flowers", exact: true }).click();
        await expect(world).toContainText("2 of 2 friends");
        await controls(lead).getByRole("button", { name: "Settle into camp", exact: true }).click();
      }
      if (sceneId === "interaction_cheer") {
        await controls(one).getByRole("button", { name: "Give a mighty cheer", exact: true }).click();
        await controls(two).getByRole("button", { name: "Strike a heroic pose", exact: true }).click();
        await controls(lead).getByRole("button", { name: "Take a happy bow", exact: true }).click();
      }
      if (sceneId === "interaction_wake") {
        for (let tap = 0; tap < 4; tap++) await controls(one).getByRole("button", { name: "Knock gently", exact: true }).click();
        await expect(world).toContainText("Did somebody say picnic?");
        await tv.screenshot({ path: "tmp/issue-493-more-tv.png", fullPage: true });
        await one.screenshot({ path: "tmp/issue-493-more-phone.png", fullPage: true });
        await controls(lead).getByRole("button", { name: "Welcome him to the picnic", exact: true }).click();
      }
      await expect(controls(lead).getByRole("button", { name: "See what happens next" })).toBeVisible();
      await controls(lead).getByRole("button", { name: "See what happens next" }).click();
      await expect.poll(async () => (await roomState<RunState>(one, code)).sceneId).toBe("scene_team_tricks_done");
    }
  } finally {
    await Promise.all([first.close(), second.close(), display.close()]);
  }
});
