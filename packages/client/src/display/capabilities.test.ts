import { describe, expect, it } from "vitest";
import { describeAudio, describeWakeLock, probeServiceWorker, probeWebGL } from "./capabilities";

describe("the capability probes", () => {
  it("say no to WebGL without throwing when the context is refused", () => {
    const doc = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
    expect(probeWebGL(doc).ok).toBe(false);
    const throwing = { createElement: () => { throw new Error("blocked"); } } as unknown as Document;
    expect(probeWebGL(throwing).ok).toBe(false);
  });

  it("names WebGL 2 and the renderer when there is one", () => {
    const gl = {
      getExtension: (name: string) => name === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 1 } : null,
      getParameter: () => "Mali-G52",
    };
    const doc = { createElement: () => ({ getContext: (kind: string) => kind === "webgl2" ? gl : null }) } as unknown as Document;
    expect(probeWebGL(doc)).toEqual({ ok: true, detail: "WebGL 2 (Mali-G52)" });
  });

  it("reports the wake lock in each of its four states", () => {
    expect(describeWakeLock("held").ok).toBe(true);
    expect(describeWakeLock("released").ok).toBe(true);
    expect(describeWakeLock("denied").ok).toBe(false);
    expect(describeWakeLock("unsupported").detail).toMatch(/Not available/);
  });

  it("reports audio as ok only when it is playing", () => {
    expect(describeAudio("running").ok).toBe(true);
    for (const state of ["locked", "suspended", "unsupported", "unknown"] as const) expect(describeAudio(state).ok).toBe(false);
  });

  it("says whether a service worker controls the page", () => {
    expect(probeServiceWorker({} as Navigator).ok).toBe(false);
    expect(probeServiceWorker({ serviceWorker: { controller: {} } } as unknown as Navigator).detail).toMatch(/controlling this page$/);
    expect(probeServiceWorker({ serviceWorker: { controller: null } } as unknown as Navigator).detail).toMatch(/not controlling/);
  });
});
