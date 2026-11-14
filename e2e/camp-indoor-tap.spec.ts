/**
 * A friend tapped on a phone at an indoor rest (#624, docs/camp.md §3.2; the #654 review's P1).
 *
 * Indoors the camp is packed down into the scene's own picture, and the full camp is not up, so
 * a tap used to reach nobody: the phone said the friend was on its way and the TV did nothing.
 * Now the packed scene takes it (camp-taps.ts `routeFriendTap`): the friend's words over its
 * head where it sits. The phone says what the TV does: the friend says hi, not that it is coming.
 *
 * Two devices, seeded as tools/playtest/table.ts seeds a table: gemfall-05c's bell house rest
 * with a crew that has Bun and the duckling out. The TV with WebGL reads the packed scene's own
 * words (`__kadScene().packedFriendWords()`); one without it, the still stage's bubble.
 */

import { test, expect } from "@playwright/test";
import { onAir, openPhone, openTv, seedTable } from "./seed";

const TAP = { timeout: 20_000 };

test("an indoor rest: a friend tapped on the phone says its words over its head on the TV", async ({ browser }) => {
  test.setTimeout(120_000);
  const table = await seedTable({
    mode: "party",
    tv: true,
    campaignId: "gemfall",
    heroes: [{ name: "Aster", species: "unicorn" }],
    chapterId: "gemfall-05c",
    sceneId: "rest_bell_house",
    camp: { grownBy: ["gemfall"], friends: ["bun", "duckling"] },
  });
  const tv = await openTv(browser, table, { viewport: { width: 1920, height: 1080 } });
  const phone = await openPhone(browser, table.phones[0]!);
  try {
    await onAir(tv.page);
    await onAir(phone.page);

    // The TV draws Bun in the packed row (or, with no WebGL, the still stage's row).
    const bunShown = () =>
      tv.page.evaluate(() => {
        const scene = (globalThis as { __kadScene?: () => { showsPackedFriend(id: string): boolean } | null }).__kadScene?.();
        if (scene) return scene.showsPackedFriend("bun");
        return document.querySelectorAll("[data-testid='packed-friend']").length > 0;
      });
    await expect.poll(bunShown, { ...TAP, message: "the TV seats Bun in the packed camp" }).toBe(true);

    // The phone opens its camp from its bag (You, past the rest's choice) and says hi to Bun.
    await phone.page.getByRole("button", { name: "You", exact: true }).click(TAP);
    await phone.page.locator("[data-testid='camp-button']:visible").first().click(TAP);
    // The panel opens on her own kit; the friends have their own page.
    await phone.page.getByRole("tab", { name: /Friends/ }).click(TAP);
    const friends = phone.page.getByTestId("camp-friends");
    await friends.getByRole("button", { name: "Say hi to Bun" }).click(TAP);
    await expect(friends.getByRole("status")).toHaveText("Bun says hi! Look at the TV.", TAP);

    // And the TV shows Bun's words: one of its catalog reactions.
    const said = () =>
      tv.page.evaluate(() => {
        const scene = (globalThis as { __kadScene?: () => { packedFriendWords(): { id: string; words: string }[] } | null }).__kadScene?.();
        if (scene) return scene.packedFriendWords().find((w) => w.id === "bun")?.words ?? "";
        return document.querySelector("[data-testid='friend-words']")?.textContent ?? "";
      });
    await expect.poll(said, { ...TAP, message: "the TV shows Bun's words" }).toMatch(/^Bun /);
    // The full camp never came up indoors.
    expect(await tv.page.evaluate(() => (globalThis as { __kadCamp?: () => { camp(): unknown } | null }).__kadCamp?.()?.camp() ?? null)).toBeNull();
  } finally {
    await phone.context.close();
    await tv.context.close();
  }
});
