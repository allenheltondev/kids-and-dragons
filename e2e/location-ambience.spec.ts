import { test, expect } from "@playwright/test";

test("gallery ambience survives a check and continues beyond the twelve-second clip", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kids & Dragons", exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    // Exercise the real browser decoder and audio engine without a sixteen-second wall-clock wait.
    const enginePath = "/src/audio/engine.ts";
    const scenePath = "/src/audio/scene-audio.ts";
    const { createAudioEngine } = await import(enginePath);
    const { ambienceForScene } = await import(scenePath);
    const chapter = await (await fetch("/content/chapters/gemfall-08.json")).json();
    const ctx = new OfflineAudioContext(2, 16 * 48000, 48000);
    const clip = await ctx.decodeAudioData(await (await fetch("/assets/audio/cues/cavern-air.webm")).arrayBuffer());
    const sources: AudioBufferSourceNode[] = [];
    const native = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => { const source = native(); sources.push(source); return source; };
    const engine = createAudioEngine({ createContext: () => ctx, storage: undefined,
      samples: () => ({ preload() {}, cue: () => clip, music: () => null, wantMusic() {} }),
    });
    const state = { chapterId: chapter.id, campaignId: "gemfall", phase: "scene", sceneId: "scene_mouth", encounter: null };
    engine.sink.ambience(ambienceForScene(chapter, state));
    engine.unlock();
    engine.sink.stopSceneCues();
    engine.sink.ambience(ambienceForScene(chapter, { ...state, sceneId: "check_remains", phase: "check" }));
    const audio = await ctx.startRendering();
    const data = audio.getChannelData(0);
    let energy = 0;
    for (let i = 13 * 48000; i < 15 * 48000; i++) energy += data[i]! ** 2;
    return { count: sources.length, loop: sources[0]!.loop, rmsAfterClip: Math.sqrt(energy / (2 * 48000)) };
  });
  expect(result.count).toBe(1);
  expect(result.loop).toBe(true);
  expect(result.rmsAfterClip).toBeGreaterThan(0.001);
});
