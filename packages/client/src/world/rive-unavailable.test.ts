import { expect, it, vi } from "vitest";

// A display whose browser cannot start the Rive runtime (no WebAssembly, or a
// policy that blocks it): the runtime promise rejects.
vi.mock("@rive-app/canvas-advanced", () => ({ default: () => Promise.reject(new Error("WebAssembly is not defined")) }));
vi.mock("@rive-app/canvas-advanced/rive.wasm?url", () => ({ default: "/rive.wasm" }));

import { createRig, riveAvailable } from "./rive-rig";

it("says Rive is unavailable, and builds no rig, so the scene keeps its still art (#264)", async () => {
  expect(await riveAvailable()).toBe(false);
  expect(await createRig("unicorn", "fledgling")).toBeNull();
});
