/**
 * Chapter 0 spike — 7 concurrent Rive rigs composited into a Pixi scene.
 *
 * `docs/art-pipeline.md` §7 states the question and the stakes:
 *
 *     stand up 7 concurrent Rive rigs composited into a Pixi scene and measure
 *     frame time on the actual TV-connected hardware. If it doesn't hold 60fps,
 *     the fallback is a custom transform rig (a tree of Pixi sprites with
 *     keyframed transforms in JSON, ~300 lines of runtime) — cheaper to render,
 *     more painful to author. Decide this before any rigging work starts,
 *     because it determines the authoring tool.
 *
 * Seven is 3 players + 4 enemies, the worst party/encounter the spec allows
 * (spec §7.1). The seam being measured is the one §7 names: Rive and Pixi are
 * separate renderers, so each rig draws into its own offscreen canvas and that
 * canvas is uploaded as a Pixi texture. The upload is the suspicious part —
 * it is a per-frame CPU→GPU transfer that a normal Pixi scene never pays.
 *
 * What this deliberately does NOT do, because doing it would flatter the result:
 *
 *   - No dirty-rig skipping. §7 says "only dirty rigs re-upload", and that is
 *     the right production optimisation, but every figure on a board plays
 *     `idle` and `idle` is a 24-tick loop — so in the state the game spends
 *     most of its time in, *every rig is dirty every frame*. Measuring the
 *     skip would measure a case that does not occur. The toggle exists so you
 *     can see the size of the saving, and it defaults to off.
 *   - No vsync-limited FPS as the headline number. A run that hits 60fps
 *     because the display capped it looks identical to one with headroom to
 *     spare. The verdict is read off *frame time* — how long the work takes,
 *     independent of when the browser chooses to show it.
 *
 * Run it: `npm run spike:rive`, then open the printed LAN URL on the TV.
 */
import { Application, Container, Sprite, Texture } from "pixi.js";
import RiveCanvas from "@rive-app/canvas-advanced";
import wasmUrl from "@rive-app/canvas-advanced/rive.wasm?url";
// A real delivered rig, not the one-clip spike file this used to load. Its own
// README asked to be re-pointed the day a full rig existed: thirteen animations
// and a state machine with real transitions is more to advance per frame than
// one bare `idle` loop, even though only one animation ever plays at a time.
import rigUrl from "../../../assets/characters/unicorn/fledgling/rig.riv?url";

/**
 * The design space the real scene uses, so the sprites here are the size they
 * will be in play rather than a size that happens to be easy.
 * `world/scene.ts`: DESIGN 1600×900, a character drawn at 46% of design height.
 */
const DESIGN = { width: 1600, height: 900 } as const;
const ACTOR_HEIGHT = DESIGN.height * 0.46;

/** Frame budget for 60fps, in ms. The whole question is whether we fit under it. */
const BUDGET_MS = 1000 / 60;

const WARMUP_MS = 1500;
const MEASURE_MS = 6000;

type Timings = { rive: number; upload: number; pixi: number; total: number };

interface Rig {
  canvas: HTMLCanvasElement;
  renderer: ReturnType<Awaited<ReturnType<typeof RiveCanvas>>["makeRenderer"]>;
  artboard: any;
  machine: any;
  texture: Texture;
  sprite: Sprite;
}

const ui = {
  count: document.getElementById("count") as HTMLInputElement,
  countOut: document.getElementById("countOut") as HTMLElement,
  buffer: document.getElementById("buffer") as HTMLSelectElement,
  dirty: document.getElementById("dirty") as HTMLInputElement,
  run: document.getElementById("run") as HTMLButtonElement,
  copy: document.getElementById("copy") as HTMLButtonElement,
  live: document.getElementById("live") as HTMLElement,
  verdict: document.getElementById("verdict") as HTMLElement,
  report: document.getElementById("report") as HTMLElement,
  env: document.getElementById("env") as HTMLElement,
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] ?? 0;
}

async function main(): Promise<void> {
  ui.env.textContent = [
    `${screen.width}×${screen.height} @ dpr ${devicePixelRatio}`,
    `window ${innerWidth}×${innerHeight}`,
    navigator.userAgent,
  ].join("  ·  ");

  const rive = await RiveCanvas({ locateFile: () => wasmUrl });
  const bytes = new Uint8Array(await (await fetch(rigUrl)).arrayBuffer());

  const app = new Application();
  await app.init({
    width: innerWidth,
    height: Math.max(320, innerHeight - 260),
    background: "#141033",
    antialias: false,
    // The spike drives its own loop so it can time the phases separately; a
    // ticker running underneath would render a second, untimed frame.
    autoStart: false,
  });
  (document.getElementById("stage") as HTMLElement).appendChild(app.canvas);
  app.ticker.stop();

  const world = new Container();
  app.stage.addChild(world);

  let rigs: Rig[] = [];
  const loadedFile = await rive.load(bytes);
  if (!loadedFile) throw new Error(`${rigUrl} is not a readable Rive file`);

  /**
   * (Re)build the fleet. Every Rive handle is a refcounted C++ object, so the
   * old set is deleted rather than dropped — leaking them would make each
   * successive run slower and look like a real regression.
   */
  function build(count: number, buffer: number): void {
    for (const r of rigs) {
      r.machine?.delete?.();
      r.artboard?.delete?.();
      r.renderer?.delete?.();
      r.sprite.destroy();
      r.texture.destroy(true);
    }
    world.removeChildren();
    rigs = [];

    for (let i = 0; i < count; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = buffer;
      canvas.height = buffer;

      const renderer = rive.makeRenderer(canvas);
      const artboard = loadedFile.defaultArtboard();
      const machine = new rive.StateMachineInstance(artboard.stateMachineByIndex(0), artboard);

      const texture = Texture.from(canvas);
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 1);
      sprite.height = ACTOR_HEIGHT;
      sprite.width = ACTOR_HEIGHT;

      rigs.push({ canvas, renderer, artboard, machine, texture, sprite });
      world.addChild(sprite);
    }
    layout();
  }

  /** Spread the fleet across the design space, scaled to the actual viewport. */
  function layout(): void {
    const scale = Math.min(app.screen.width / DESIGN.width, app.screen.height / DESIGN.height);
    world.scale.set(scale);
    world.x = (app.screen.width - DESIGN.width * scale) / 2;
    world.y = (app.screen.height - DESIGN.height * scale) / 2;

    const spacing = DESIGN.width / (rigs.length + 1);
    rigs.forEach((r, i) => {
      r.sprite.x = spacing * (i + 1);
      // Two rows, so seven figures do not become a thin line of thumbnails.
      r.sprite.y = DESIGN.height * (i % 2 === 0 ? 0.62 : 0.95);
    });
  }

  // --- the loop -----------------------------------------------------------

  let last = performance.now();
  let measuring: { started: number; samples: Timings[] } | null = null;
  let warmupUntil = 0;
  let liveAcc: Timings[] = [];

  function frame(now: number): void {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const t0 = performance.now();

    // Phase 1 — advance and draw every rig into its own offscreen canvas.
    for (const r of rigs) {
      r.renderer.clear();
      r.machine.advance(dt);
      r.artboard.advance(dt);
      r.renderer.save();
      r.renderer.align(
        rive.Fit.contain,
        rive.Alignment.center,
        { minX: 0, minY: 0, maxX: r.canvas.width, maxY: r.canvas.height },
        r.artboard.bounds,
      );
      r.artboard.draw(r.renderer);
      r.renderer.restore();
    }
    // Canvas2D draw calls are queued; this is what actually executes them.
    rive.resolveAnimationFrame();
    const t1 = performance.now();

    // Phase 2 — the seam: hand each canvas to the GPU as a Pixi texture.
    // `dirty` is a no-op while everything plays `idle` (see the header note);
    // the checkbox exists to show that, not to make the number look better.
    const uploadEvery = !ui.dirty.checked;
    for (const r of rigs) if (uploadEvery) r.texture.source.update();
    const t2 = performance.now();

    // Phase 3 — Pixi composites the scene.
    app.renderer.render(app.stage);
    const t3 = performance.now();

    const sample: Timings = {
      rive: t1 - t0,
      upload: t2 - t1,
      pixi: t3 - t2,
      total: t3 - t0,
    };

    liveAcc.push(sample);
    if (liveAcc.length >= 30) {
      const mean = (k: keyof Timings) => liveAcc.reduce((a, s) => a + s[k], 0) / liveAcc.length;
      ui.live.textContent =
        `${rigs.length} rigs @ ${ui.buffer.value}px   ` +
        `frame ${mean("total").toFixed(2)}ms   ` +
        `(rive ${mean("rive").toFixed(2)} · upload ${mean("upload").toFixed(2)} · pixi ${mean("pixi").toFixed(2)})`;
      liveAcc = [];
    }

    if (measuring && now >= warmupUntil) measuring.samples.push(sample);
    if (measuring && now - measuring.started >= WARMUP_MS + MEASURE_MS) finish();

    requestAnimationFrame(frame);
  }

  function finish(): void {
    if (!measuring) return;
    const samples = measuring.samples;
    measuring = null;
    ui.run.disabled = false;
    ui.run.textContent = "Run measurement";

    const totals = samples.map((s) => s.total).sort((a, b) => a - b);
    const mean = (k: keyof Timings) => samples.reduce((a, s) => a + s[k], 0) / samples.length;
    const over = totals.filter((t) => t > BUDGET_MS).length;
    const p95 = percentile(totals, 95);
    const holds = p95 <= BUDGET_MS;

    ui.verdict.textContent = holds
      ? `HOLDS 60fps — p95 frame ${p95.toFixed(2)}ms, under the ${BUDGET_MS.toFixed(2)}ms budget`
      : `MISSES 60fps — p95 frame ${p95.toFixed(2)}ms, over the ${BUDGET_MS.toFixed(2)}ms budget`;
    ui.verdict.className = holds ? "verdict pass" : "verdict fail";

    const lines = [
      `Kids & Dragons — art-pipeline.md §7 spike`,
      ``,
      `device      ${navigator.userAgent}`,
      `screen      ${screen.width}×${screen.height} @ dpr ${devicePixelRatio}`,
      `stage       ${app.screen.width}×${app.screen.height}`,
      `rigs        ${rigs.length}   offscreen ${ui.buffer.value}×${ui.buffer.value}px`,
      `uploads     ${ui.dirty.checked ? "dirty-only" : "every rig, every frame"}`,
      `samples     ${samples.length} frames over ${(MEASURE_MS / 1000).toFixed(0)}s (after ${(WARMUP_MS / 1000).toFixed(1)}s warmup)`,
      ``,
      `frame time  mean ${mean("total").toFixed(2)}ms   p50 ${percentile(totals, 50).toFixed(2)}   p95 ${p95.toFixed(2)}   p99 ${percentile(totals, 99).toFixed(2)}   max ${percentile(totals, 100).toFixed(2)}`,
      `  rive      mean ${mean("rive").toFixed(2)}ms`,
      `  upload    mean ${mean("upload").toFixed(2)}ms`,
      `  pixi      mean ${mean("pixi").toFixed(2)}ms`,
      ``,
      `over budget ${over}/${totals.length} frames (${((over / totals.length) * 100).toFixed(1)}%) exceeded ${BUDGET_MS.toFixed(2)}ms`,
      ``,
      holds
        ? `VERDICT: Rive holds. Author the rigs in Rive (§6).`
        : `VERDICT: Rive misses at this rig count. Before falling back to the custom`,
      holds ? `` : `transform rig, re-run at a smaller offscreen buffer — if the cost is in`,
      holds ? `` : `'upload' rather than 'rive', the seam is the problem, not the runtime.`,
    ];
    ui.report.textContent = lines.filter((l) => l !== undefined).join("\n");
    ui.copy.disabled = false;
  }

  // --- controls -----------------------------------------------------------

  function rebuild(): void {
    ui.countOut.textContent = ui.count.value;
    build(Number(ui.count.value), Number(ui.buffer.value));
  }

  ui.count.addEventListener("input", rebuild);
  ui.buffer.addEventListener("change", rebuild);
  addEventListener("resize", () => {
    app.renderer.resize(innerWidth, Math.max(320, innerHeight - 260));
    layout();
  });

  ui.run.addEventListener("click", () => {
    ui.run.disabled = true;
    ui.run.textContent = "Measuring…";
    ui.verdict.textContent = "";
    ui.verdict.className = "verdict";
    ui.report.textContent = "";
    ui.copy.disabled = true;
    const now = performance.now();
    warmupUntil = now + WARMUP_MS;
    measuring = { started: now, samples: [] };
  });

  ui.copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(ui.report.textContent ?? "");
    ui.copy.textContent = "Copied";
    setTimeout(() => (ui.copy.textContent = "Copy report"), 1200);
  });

  rebuild();
  requestAnimationFrame(frame);
}

void main().catch((err) => {
  document.getElementById("live")!.textContent = `failed to start: ${err.message}`;
  console.error(err);
});
