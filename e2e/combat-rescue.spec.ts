import { test, expect } from "@playwright/test";
import { currentActorId, type RunState } from "../packages/shared/src/index";
import { seedTable, openPhone, openTv, onAir } from "./seed";
import { roomState } from "./room-state";

test("Bun's rescue shows its mission and lets waiting friends suggest without spending a turn", async ({ browser }, info) => {
  test.setTimeout(150_000);
  const table = await seedTable({ mode: "party", tv: true, chapterId: "first-steps-01", sceneId: "encounter_bun", heroes: [
    { name: "Aster", species: "unicorn", class: "thornguard" },
    { name: "Fern", species: "unicorn", class: "songkeeper" },
  ] });
  const devices = [];
  try {
    for (const phone of table.phones) {
      const device = await openPhone(browser, phone);
      devices.push(device);
      await onAir(device.page);
      const you = device.page.getByRole("button", { name: "You", exact: true });
      if (await you.getAttribute("aria-pressed") !== "true") await you.click();
      const turn = device.page.getByRole("button", { name: "Your turn", exact: true });
      if (await turn.isVisible()) await turn.click();
      const catchup = device.page.getByRole("button", { name: "Got it", exact: true });
      if (await catchup.isVisible()) await catchup.click();
      await device.page.getByRole("button", { name: "I'm ready to fight!", exact: true }).click();
    }
    const display = await openTv(browser, table);
    devices.push(display);
    await onAir(display.page);
    await expect(devices[0].page.locator(".combat__grid")).toBeVisible();
    const before = await roomState<RunState>(devices[0].page, table.code);
    expect(before.encounter?.board.width).toBe(7);
    expect(before.encounter?.environment?.spec.victory).toBe("rescue");
    const activeId = currentActorId(before.encounter!);
    const waitingIndex = before.party.findIndex(m => m.character.id !== activeId);
    const waiting = devices[waitingIndex].page;
    const active = devices[waitingIndex === 0 ? 1 : 0].page;
    await active.screenshot({ path: info.outputPath("rescue-active-phone.png") });
    await expect(active.locator(".combat__actions button").first()).toBeInViewport({ ratio: .9 });
    await expect(waiting.getByRole("button", { name: "Suggest a spot" })).toBeVisible();
    await waiting.getByRole("button", { name: "Suggest a spot" }).click();
    await waiting.getByRole("button", { name: "Suggest column 4, row 5" }).click();
    await expect(display.page.getByText("Suggests this spot", { exact: false })).toBeVisible();
    const after = await roomState<RunState>(waiting, table.code);
    expect(after.seq).toBe(before.seq);
    expect(after.encounter).toEqual(before.encounter);
    await waiting.screenshot({ path: info.outputPath("rescue-phone.png") });
    await display.page.screenshot({ path: info.outputPath("rescue-tv.png") });
    await waiting.reload();
    await onAir(waiting);
    const you = waiting.getByRole("button", { name: "You", exact: true });
    if (await you.getAttribute("aria-pressed") !== "true") await you.click();
    await waiting.getByRole("button", { name: "View the fight", exact: true }).click();
    await expect(waiting.locator(".combat__grid")).toBeVisible();
    expect((await roomState<RunState>(waiting, table.code)).encounter).toEqual(before.encounter);
  } finally {
    for (const device of devices) await device.context.close();
  }
});
