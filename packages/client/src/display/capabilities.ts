/**
 * What this screen can do (#264), so the owner can record it for docs/hardware.md.
 * Every probe is guarded: a TV browser is exactly where a missing API is
 * normal, and a report that throws would be no use on the device it is for.
 */

import { getAudioProbe, type AudioState } from "../audio/cue";
import { describeFullscreen, type FullscreenState } from "./fullscreen";
import type { WakeLockState } from "./wake-lock";

export type CapabilityId = "webgl" | "wakeLock" | "fullscreen" | "audio" | "serviceWorker";

export interface Capability {
  id: CapabilityId;
  label: string;
  ok: boolean;
  detail: string;
}

export function probeWebGL(doc: Pick<Document, "createElement"> | undefined = typeof document === "undefined" ? undefined : document): Pick<Capability, "ok" | "detail"> {
  if (!doc) return { ok: false, detail: "Not available" };
  try {
    const canvas = doc.createElement("canvas");
    const two = canvas.getContext("webgl2");
    const gl = two ?? canvas.getContext("webgl");
    if (!gl) return { ok: false, detail: "Not available. The board is drawn as still art." };
    const version = two ? "WebGL 2" : "WebGL 1";
    let renderer = "";
    try {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      if (info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    } catch {
      // The renderer's name is a nicety.
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { ok: true, detail: renderer ? `${version} (${renderer})` : version };
  } catch {
    return { ok: false, detail: "Not available. The board is drawn as still art." };
  }
}

export function describeWakeLock(state: WakeLockState): Pick<Capability, "ok" | "detail"> {
  switch (state) {
    case "held": return { ok: true, detail: "Held. The screen stays awake." };
    case "released": return { ok: true, detail: "Available, not held right now" };
    case "denied": return { ok: false, detail: "Available, but the browser refused it" };
    case "unsupported": return { ok: false, detail: "Not available. Turn off the TV's sleep timer." };
  }
}

export function describeAudio(status: AudioState | "unknown"): Pick<Capability, "ok" | "detail"> {
  switch (status) {
    case "running": return { ok: true, detail: "Playing" };
    case "locked": return { ok: false, detail: "Waiting for a tap" };
    case "suspended": return { ok: false, detail: "Held back by the browser until a tap" };
    case "unsupported": return { ok: false, detail: "Not available. The game plays silent." };
    case "unknown": return { ok: false, detail: "Not started yet" };
  }
}

export function probeServiceWorker(nav: Pick<Navigator, "serviceWorker"> | undefined = typeof navigator === "undefined" ? undefined : navigator): Pick<Capability, "ok" | "detail"> {
  if (!nav || !("serviceWorker" in nav) || !nav.serviceWorker) return { ok: false, detail: "Not available. No offline book." };
  return nav.serviceWorker.controller
    ? { ok: true, detail: "Running, and controlling this page" }
    : { ok: true, detail: "Available, not controlling this page yet" };
}

export async function probeCapabilities(wakeLock: WakeLockState, fullscreen: FullscreenState = "unsupported"): Promise<Capability[]> {
  return [
    { id: "webgl", label: "WebGL", ...probeWebGL() },
    { id: "wakeLock", label: "Wake lock", ...describeWakeLock(wakeLock) },
    { id: "fullscreen", label: "Full screen", ...describeFullscreen(fullscreen) },
    { id: "audio", label: "Audio", ...describeAudio(getAudioProbe()?.state() ?? "unknown") },
    { id: "serviceWorker", label: "Service worker", ...probeServiceWorker() },
  ];
}
