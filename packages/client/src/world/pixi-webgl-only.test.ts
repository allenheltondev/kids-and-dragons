/**
 * The build plugin that leaves Pixi's WebGPU and canvas renderers out (../../pixi-webgl-only.ts).
 * It reads Pixi's own import graph, so these pin the decisions a Pixi upgrade must not flip: what
 * WebGL uses stays real, what only the other two renderers use becomes a stub that registers nothing
 * and says what it is if anything builds it.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extensions } from "pixi.js";
import { exportNames, stubSource, webglOnlyStubs } from "../../pixi-webgl-only";

const lib = path.dirname(createRequire(import.meta.url).resolve("pixi.js"));
const stubs = new Set([...webglOnlyStubs(lib)].map((file) => path.relative(lib, file).split(path.sep).join("/")));

describe("which Pixi modules the build stubs", () => {
  it("stubs the WebGPU and canvas renderers and the adaptors only they use", () => {
    for (const file of [
      "rendering/renderers/gpu/WebGPURenderer.mjs",
      "rendering/renderers/canvas/CanvasRenderer.mjs",
      "rendering/renderers/gpu/GpuDeviceSystem.mjs",
      "scene/graphics/gpu/GpuGraphicsAdaptor.mjs",
      "scene/graphics/canvas/CanvasGraphicsAdaptor.mjs",
    ]) expect(stubs, file).toContain(file);
  });

  it("keeps everything the WebGL path reaches, though it lives beside them", () => {
    for (const file of [
      "rendering/renderers/gl/WebGLRenderer.mjs",
      // Every filter carries a GPU program; WebGL's own stencil system maps through the GPU's modes.
      "rendering/renderers/gpu/shader/GpuProgram.mjs",
      "rendering/renderers/gpu/shader/BindGroup.mjs",
      "rendering/renderers/gpu/state/GpuStencilModesToPixi.mjs",
      // `Text` is drawn on a canvas and uploaded, whatever the renderer.
      "scene/text/canvas/CanvasTextGenerator.mjs",
      "scene/text/canvas/CanvasTextMetrics.mjs",
      "rendering/renderers/autoDetectRenderer.mjs",
    ]) expect(stubs, file).not.toContain(file);
  });

  it("never stubs a module outside the gpu and canvas folders", () => {
    for (const file of stubs) expect(file).toMatch(/(^|\/)(gpu|canvas)\//);
  });
});

describe("a stub", () => {
  it("exports the names the real module did", () => {
    expect(exportNames("class A {}\nconst b = 1;\nexport { A, b as B };\n")).toEqual(["A", "B"]);
    expect(exportNames("export class C {}\nexport { D } from './d.mjs';\n")).toEqual(["C"]);
  });

  it("registers nothing, and says what it is when built", async () => {
    const url = `data:text/javascript,${encodeURIComponent(stubSource(["GpuThing"], "GpuThing.mjs"))}`;
    const { GpuThing } = (await import(/* @vite-ignore */ url)) as { GpuThing: new () => unknown };
    expect(() => extensions.add(GpuThing as never)).not.toThrow();
    expect(() => new GpuThing()).toThrow(/GpuThing.*left out of this build.*WebGL only/);
  });
});
