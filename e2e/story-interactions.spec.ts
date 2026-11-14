import { test, expect, type Page, type Locator } from "@playwright/test";
import { interactionActor, type ClientIntent, type RunState } from "../packages/shared/src/index";
import { roomState } from "./room-state";
import { API } from "./api";

// Three live rendered surfaces are expensive to trace on a local Windows host.
// Keep CI failure traces so refresh and multi-phone failures can be diagnosed.
test.use({ actionTimeout: 15_000, trace: process.env.CI ? "retain-on-failure" : "off" });

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

// Exercise the supported keyboard path for controls that rerender during play.
// This also avoids depending on background-page animation frames for click stability
// while the test alternates between phones. Gemfall's browser flows cover touch.
async function activate(control: Locator) {
  await expect.poll(() => control.isVisible()).toBe(true);
  await expect.poll(() => control.isEnabled()).toBe(true);
  await control.press("Enter");
}

async function aimUntilResult(phones: Page[], code: string, label: string) {
  const ids = await Promise.all(phones.map(page => page.evaluate(room => JSON.parse(localStorage.getItem(`kad.session.${room}`)!).playerId as string, code)));
  const page = phones[0]!;
  for (let attempt = 0; attempt < 24; attempt++) {
    const state = await roomState<RunState>(page, code), before = state.prompt;
    if (before?.kind !== "interaction") throw Error("Expected aiming controls");
    if (before.phase === "result") return;
    const actor = interactionActor(before, state.party.filter(m => m.connected).map(m => m.playerId));
    const actingPhone = phones[ids.indexOf(actor!)]!;
    await actingPhone.bringToFront();
    if (before.spec.kind !== "precision" && before.spec.kind !== "timing") throw Error("Expected an aiming game");
    await actingPhone.getByRole("slider", { name: "Aim at the gold" }).fill(String(Math.round(before.spec.target * 100)));
    await activate(actingPhone.getByRole("region", { name: "Interaction controls" }).getByRole("button", { name: label, exact: true }));
    // Activating a control starts an async request. Wait for its committed round before
    // deciding to tap again; a successful attempt removes the aiming button.
    await expect.poll(async () => {
      const p = (await roomState<RunState>(page, code)).prompt;
      return p?.kind === "interaction" && (p.phase === "result" || (p.challenge?.round ?? -1) > (before.challenge?.round ?? -1));
    }).toBe(true);
  }
  expect((await roomState<RunState>(page, code)).prompt).toMatchObject({ phase: "result" });
}

test("reusable interactions run through phones, reduced-motion keyboard controls, TV, refresh, and authored branches", async ({ browser }) => {
  test.setTimeout(420_000);
  const first = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const second = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const display = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
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
      await activate(controls(page).locator("summary.game__help-summary"));
      const checkbox = controls(page).getByLabel("Relaxed play");
      await expect(checkbox).toBeVisible();
      if (!await checkbox.isChecked()) await checkbox.press("Space");
    };
    const world = tv.getByRole("region", { name: "Story interaction" });
    // Poll from the test runner: a background display may not receive animation
    // frames, which browser-side assertion polling otherwise waits behind.
    const worldSays = async (text: string) => {
      await expect.poll(async () => await world.count() ? await world.textContent() : "").toContain(text);
    };
    await tv.bringToFront();
    await worldSays("seed reaches the gold");
    await activate(controls(one).getByRole("button", { name: "We’re ready" }));
    await aimUntilResult([one, two], code, "Toss the seed!");
    await expect(controls(two).getByRole("button", { name: "See what happens next" })).toBeVisible();
    await two.reload();
    // A reloaded phone opens on its turn, not on the bag with a "Your turn" button to find (#588).
    await expect(two.getByRole("button", { name: "Your turn", exact: true })).toBeHidden();
    await expect(controls(two).getByRole("button", { name: "See what happens next" })).toBeVisible();
    await activate(controls(two).getByRole("button", { name: "See what happens next" }));
    await tv.bringToFront();
    await worldSays("Choose smooth pulls together");
    await expect(tv.locator(".interaction-art__main").first()).toHaveAttribute("src", "/assets/story-props/rope-loop.webp");
    await expect(one.locator(".interaction-art__main").first()).toHaveAttribute("src", "/assets/story-props/rope-loop.webp");
    // Whoever owns the beat leads the game (a game is one moment of the owner's beat, so the
    // bell's lead usually leads this one too); the other phone only joins in.
    const firstId = await one.evaluate((room) => (JSON.parse(localStorage.getItem(`kad.session.${room}`)!) as { playerId: string }).playerId, code);
    const branch = (await roomState<RunState>(one, code)).prompt;
    if (branch?.kind !== "interaction") throw Error("Expected the branch interaction");
    const [branchLead, branchOther] = branch.actorId === firstId ? [one, two] : [two, one];
    await relaxed(branchLead);
    await activate(controls(branchLead).getByRole("button", { name: "We’re ready" }));
    await expect(controls(branchOther).getByRole("button", { name: "Fetch the ribbon" })).toHaveCount(0);
    await one.setViewportSize({ width: 390, height: 640 });
    await controls(one).getByRole("button", { name: "Set my pull", exact: true }).focus();
    const shortPhoneAction = await controls(one).getByRole("button", { name: "Set my pull", exact: true }).boundingBox();
    expect(shortPhoneAction).not.toBeNull();
    expect(shortPhoneAction!.y).toBeGreaterThanOrEqual(0);
    expect(shortPhoneAction!.y + shortPhoneAction!.height).toBeLessThanOrEqual(640);
    for (const power of [0.4, 0.7, 0.5]) for (const phone of [one, two]) {
      await phone.bringToFront();
      const slider = controls(phone).getByRole("slider", { name: /Pull strength/ });
      await slider.fill(String(Math.round(power * 100)));
      await activate(controls(phone).getByRole("button", { name: "Set my pull", exact: true }));
    }
    await tv.bringToFront();
    await worldSays("You did it together");
    await activate(controls(two).getByRole("button", { name: "See what happens next" }));
    await activate(controls(one).getByRole("button", { name: "We’re ready" }));
    await expect(controls(one)).toContainText("Start with the frog");
    await expect(controls(two)).toContainText("The owl comes just before the fox");
    for (const name of ["Frog", "Owl", "Fox"]) await activate(controls(one).getByRole("button", { name, exact: true }));
    await activate(controls(one).getByRole("button", { name: "Try our path" }));
    await tv.bringToFront();
    await worldSays("You did it together");
    await one.screenshot({ path: "tmp/issue-493-core-phone.png", fullPage: true });
    await tv.screenshot({ path: "tmp/issue-493-core-tv.png", fullPage: true });
    await activate(controls(one).getByRole("button", { name: "See what happens next" }));
    await expect.poll(async () => (await roomState<RunState>(one, code)).sceneId).toBe("scene_team_tricks_done");
    expect(await one.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const firstPlayerId = await one.evaluate((room) => (JSON.parse(localStorage.getItem(`kad.session.${room}`)!) as { playerId: string }).playerId, code);
    for (const sceneId of ["interaction_cups", "interaction_echo", "interaction_sneak", "interaction_balance", "interaction_spark", "interaction_feed", "interaction_camp", "interaction_cheer", "interaction_wake"]) {
      await action(one, code, { type: "PLAYTEST_GOTO", sceneId });
      // Each jump begins a separate authored scenario. Reload the display so
      // it starts at that snapshot rather than holding the previous scene.
      await tv.reload();
      const state = await roomState<RunState>(one, code);
      if (state.prompt?.kind !== "interaction") throw Error("Expected authored interaction");
      await tv.bringToFront();
      await worldSays(state.prompt.spec.cue);
      const lead = state.prompt.actorId === firstPlayerId ? one : two;
      await lead.bringToFront();
      await relaxed(lead);
      await activate(controls(lead).getByRole("button", { name: "We’re ready" }));
      if (sceneId === "interaction_cups") await activate(controls(lead).getByRole("button", { name: "Look under: Right cup", exact: true }));
      if (sceneId === "interaction_echo") {
        for (const name of ["Star", "Leaf", "Star", "Bell"]) await activate(controls(lead).getByRole("button", { name, exact: true }));
        await activate(controls(lead).getByRole("button", { name: "Send our greeting", exact: true }));
      }
      if (sceneId === "interaction_sneak") await aimUntilResult([one, two], code, "Tiptoe!");
      if (sceneId === "interaction_balance") {
        for (const target of [0.5, 0.75, 0.25]) {
          for (const phone of [one, two]) {
            await phone.bringToFront();
            const state = await roomState<RunState>(phone, code);
            const playerId = await phone.evaluate(room => JSON.parse(localStorage.getItem(`kad.session.${room}`)!).playerId as string, code);
            if (state.prompt?.kind !== "interaction") throw Error("Expected balance");
            const level = state.prompt.levels?.[playerId] ?? 0;
            for (let step = 0; step < Math.abs(target - level) * 4; step++) await activate(controls(phone).getByRole("button", { name: target > level ? "Lift my side" : "Lower my side", exact: true }));
          }
          const before = (await roomState<RunState>(lead, code)).prompt;
          if (before?.kind !== "interaction") throw Error("Expected a balance step");
          await lead.bringToFront();
          await activate(controls(lead).getByRole("button", { name: "Take a careful step" }));
          for (const phone of [one, two]) await expect.poll(() => phone.evaluate(async () => {
            const path = "/src/store/index.ts";
            const p = (await import(path)).useGameStore.getState().state?.prompt;
            return p?.kind === "interaction" ? p.challenge?.round : undefined;
          })).toBe((before.challenge?.round ?? 0) + 1);
        }
      }
      if (sceneId === "interaction_spark") for (const [seat, phone] of [one, two].entries()) {
        await phone.bringToFront();
        // Reduced motion keeps the catch stationary; direction and strength still shape the throw.
        await expect(controls(phone).locator(".relay-skill")).toHaveAttribute("data-ready", "true");
        await activate(controls(phone).getByRole("button", { name: "Catch the starlight", exact: true }));
        await expect(controls(phone).getByText("Use aim controls and buttons", { exact: true })).toBeVisible();
        await controls(phone).getByRole("slider", { name: "Direction" }).fill(seat === 0 ? "0.44" : "-0.44");
        await controls(phone).getByRole("slider", { name: "Strength" }).fill("0.64");
        await activate(controls(phone).getByRole("button", { name: /^Throw to / }));
      }
      if (sceneId === "interaction_feed") {
        await activate(controls(one).getByRole("button", { name: "Offer an apple slice", exact: true }));
        await tv.bringToFront();
        await worldSays("Bun sniffs, crunches");
        await activate(controls(lead).getByRole("button", { name: "Give Bun a wave", exact: true }));
      }
      if (sceneId === "interaction_camp") {
        await activate(controls(one).getByRole("button", { name: "Hang a lantern", exact: true }));
        await activate(controls(two).getByRole("button", { name: "Bring some flowers", exact: true }));
        await tv.bringToFront();
        await worldSays("2 of 2 friends");
        await activate(controls(lead).getByRole("button", { name: "Settle into camp", exact: true }));
      }
      if (sceneId === "interaction_cheer") {
        await activate(controls(one).getByRole("button", { name: "Give a mighty cheer", exact: true }));
        await activate(controls(two).getByRole("button", { name: "Strike a heroic pose", exact: true }));
        await activate(controls(lead).getByRole("button", { name: "Take a happy bow", exact: true }));
      }
      if (sceneId === "interaction_wake") {
        for (let tap = 0; tap < 4; tap++) await activate(controls(one).getByRole("button", { name: "Knock gently", exact: true }));
        await tv.bringToFront();
        await worldSays("Did somebody say picnic?");
        await tv.screenshot({ path: "tmp/issue-493-more-tv.png", fullPage: true });
        await one.screenshot({ path: "tmp/issue-493-more-phone.png", fullPage: true });
        await activate(controls(lead).getByRole("button", { name: "Welcome him to the picnic", exact: true }));
      }
      await expect(controls(lead).getByRole("button", { name: "See what happens next" })).toBeVisible();
      await activate(controls(lead).getByRole("button", { name: "See what happens next" }));
      await expect.poll(async () => (await roomState<RunState>(one, code)).sceneId).toBe("scene_team_tricks_done");
    }
  } finally {
    await Promise.all([first.close(), second.close(), display.close()]);
  }
});
