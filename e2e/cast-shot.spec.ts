/**
 * Review tool, not a test: photograph story scenes with a cast on a TV and on
 * a Travel Mode phone, so a human can judge whether the party and whoever
 * they have met stand clear of the narration (world/cast.ts,
 * world/stage-inset.ts). Like rig-shot, everything it could assert is pinned
 * by unit tests; "does it read from the sofa" is not.
 *
 * Run against a dev server launching Gemfall:
 *   npm run dev            # VITE_LAUNCH_CAMPAIGN unset → gemfall
 *   KAD_CAST_SCENES=scene_tavern,choice_ember npx playwright test e2e/cast-shot.spec.ts
 * Shots land in art/review/cast-<scene>-{tv,phone}.png.
 */

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import type { Chapter, CastMember } from "../packages/shared/src/index";
import { MUSIC_SPECS } from "../packages/client/src/audio/paths";

const TAP = { timeout: 20_000 } as const;
const SCENES = (process.env.KAD_CAST_SCENES ?? "scene_tavern,choice_ember,scene_motive_wealth")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => id.length > 0);

// Review an unreleased figure in the real stage without editing campaign data.
// KAD_CAST_PREVIEW='{"figure":"cast/orin_vale","name":"Master Orin Vale"}'
// KAD_CAST_SHOT_PREFIX=art/review/riftlight-cast/pilot
async function previewCast(context: BrowserContext): Promise<void> {
  const castInput = process.env.KAD_CAST_PREVIEW;
  const artInput = process.env.KAD_SCENE_ART_PREVIEW;
  const musicInput = process.env.KAD_SCENE_MUSIC_PREVIEW;
  if (!castInput && !artInput && !musicInput) return;
  const input = castInput ? JSON.parse(castInput) as CastMember | CastMember[] : undefined;
  const members = input ? (Array.isArray(input) ? input : [input]) : undefined;
  if (members && (!members.length || members.length > 3 || members.some((member) => !/^(characters|entities|cast)\/[a-z0-9_]+$/.test(member.figure)))) throw new Error("Invalid cast preview figures (one to three required)");
  // Either one backdrop for all selected scenes, or a scene-id -> art map.
  const art = artInput?.startsWith("{") ? JSON.parse(artInput) as Record<string, string> : artInput;
  const paths = typeof art === "object" ? Object.values(art) : art ? [art] : [];
  if (paths.some((path) => !/^scenes\/[a-z0-9_-]+\/[a-z0-9_-]+$/.test(path))) throw new Error("Invalid scene art preview path");
  const music = musicInput?.startsWith("{") ? JSON.parse(musicInput) as Record<string, string> : musicInput;
  const tracks = typeof music === "object" ? Object.values(music) : music ? [music] : [];
  if (tracks.some((track) => !Object.hasOwn(MUSIC_SPECS, track))) throw new Error("Unknown scene music preview");
  await context.route("**/content/chapters/*.json", async (route) => {
    const response = await route.fetch();
    const chapter = await response.json() as Chapter;
    for (const id of SCENES) {
      const scene = chapter.scenes[id];
      if (scene && scene.type !== "encounter") {
        if (members) scene.cast = members;
        const backdrop = typeof art === "object" ? art[id] : art;
        if (backdrop) scene.art = backdrop;
        const track = typeof music === "object" ? music[id] : music;
        if (track) scene.music = track;
      }
    }
    await route.fulfill({ response, json: chapter });
  });
}

const SHOT_PREFIX = process.env.KAD_CAST_SHOT_PREFIX ?? "art/review/cast";

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
  }
  await page.getByRole("button", { name: /^next$/i }).click(TAP);
  await page.getByPlaceholder("Tap to type").fill(name, TAP);
  await page.getByRole("button", { name: /that's me/i }).click(TAP);
  await page.getByRole("button", { name: /^Ready to play$/i }).click(TAP);
}

test("photograph a cast on the story stage", async ({ browser }) => {
  test.setTimeout(300_000);
  const contexts: { close(): Promise<void> }[] = [];
  const phone = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await previewCast(ctx);
    contexts.push(ctx);
    return ctx.newPage();
  };

  const host = await phone();
  await host.goto("/");
  await host.getByRole("button", { name: /want to host/i }).click();
  await host.getByText("Phone Mode").click();
  await host.fill('input[placeholder="Type your name"]', "Allen");
  await host.getByRole("button", { name: /start a game/i }).click();
  await expect(host).toHaveURL(/\/p\/[A-Z]{4}$/);
  const code = new URL(host.url()).pathname.split("/").pop()!;

  const others = [await phone(), await phone()];
  for (const page of others) {
    await page.goto("/");
    await page.getByLabel(/room code/i).fill(code);
    await page.getByRole("button", { name: /join a game/i }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${code}$`));
  }

  const party: [Page, string, string][] = [
    [host, "unicorn", "Sparklehoof"],
    [others[0]!, "kitsune", "Tumblefern"],
    [others[1]!, "bigfoot", "Bramblebeard"],
  ];
  for (const [page, species, name] of party) await createCharacter(page, species, name);

  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await previewCast(tvCtx);
  contexts.push(tvCtx);
  const tv = await tvCtx.newPage();
  await tv.goto(`/tv/${code}`);
  if (process.env.KAD_SCENE_MUSIC_PREVIEW) await tv.keyboard.press("Shift");

  // "Ready to play" at the end of creation already said ready.
  await host.getByRole("button", { name: /begin the adventure/i }).click(TAP);
  await expect(tv.locator(".narration__body")).toBeVisible({ timeout: 30_000 });

  for (const scene of SCENES) {
    await host.getByRole("button", { name: /^playtest/i }).click(TAP);
    await host.getByRole("button", { name: new RegExp(`^${scene}(story|check|choice_point|rest|encounter)$`) }).click(TAP);
    await host.getByRole("button", { name: /^close$/i }).click(TAP);
    // The veil, the entrance, the rigs settling into idle.
    await tv.waitForTimeout(4_000);
    await tv.screenshot({ path: `${SHOT_PREFIX}-${scene}-tv.png` });
    // Another seat's phone, parked on its World tab: the host's stays on the
    // tab the Playtest drawer lives on.
    const watcher = others[0]!;
    await watcher.getByRole("button", { name: /^world$/i }).click(TAP).catch(() => undefined);
    await watcher.screenshot({ path: `${SHOT_PREFIX}-${scene}-phone.png` });
    // The host's phone too, the moment its World tab opens: a pane that was
    // hidden must be framed on its first frame, not zoom out into place.
    await host.getByRole("button", { name: /^world$/i }).click(TAP);
    await host.waitForTimeout(200);
    await host.screenshot({ path: `${SHOT_PREFIX}-${scene}-host.png` });
    await host.getByRole("button", { name: /^you$/i }).click(TAP);
  }

  await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
});
