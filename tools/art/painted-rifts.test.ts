import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

it("keeps the painted rift palette, animation seams, amber flicker and transition handoffs valid", () => {
  const source = fileURLToPath(new URL("../../art/source/painted-rifts/test_build.py", import.meta.url));
  execFileSync(process.platform === "win32" ? "python" : "python3", [source], {
    encoding: "utf8",
    timeout: 30_000,
    stdio: "pipe",
  });
}, 45_000);
