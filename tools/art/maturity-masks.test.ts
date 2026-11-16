import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Reviewed landmarks on the approved #490 paintings: silver is still plumage,
// while eyes, horns, gold wings, noses and class cloth never take a coat color.
const samples = [
  ["characters/griffin/legendary", 260, 150, "accent"],
  ["characters/griffin/legendary", 900, 750, "accent"],
  ["characters/griffin/legendary", 100, 270, "protected"],
  ["characters/griffin/legendary", 500, 420, "protected"],
  ["characters/griffin/legendary", 175, 230, "protected"],
  ["character-rigs/starweaver/legendary/unicorn", 410, 350, "accent"],
  ["character-rigs/starweaver/legendary/unicorn", 280, 140, "accent"],
  ["character-rigs/starweaver/legendary/unicorn", 800, 600, "accent"],
  ["character-rigs/starweaver/legendary/unicorn", 550, 640, "main"],
  ["character-rigs/starweaver/legendary/unicorn", 200, 150, "protected"],
  ["character-rigs/starweaver/legendary/unicorn", 530, 485, "protected"],
  ["character-rigs/starweaver/legendary/bigfoot", 525, 460, "protected"],
  ["character-rigs/starweaver/legendary/bigfoot", 540, 680, "main"],
  ["character-rigs/starweaver/legendary/bigfoot", 408, 209, "accent"],
  ["characters/manticore/legendary", 150, 270, "protected"],
  ["characters/manticore/legendary", 275, 390, "accent"],
  ["characters/manticore/legendary", 550, 480, "main"],
  ["characters/manticore/legendary", 850, 400, "protected"],
] as const;

describe("maturity mask boundaries", () => {
  it("colors the reviewed parts and preserves eyes, signature parts and class gear", () => {
    const code = `
import json
from PIL import Image
samples = json.loads(${JSON.stringify(JSON.stringify(samples))})
print(json.dumps([list(Image.open('assets/' + p + '/coat-mask.png').getpixel((x,y))) for p,x,y,kind in samples]))
`;
    const values = JSON.parse(execFileSync(process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3"), ["-c", code], {
      cwd: path.resolve(import.meta.dirname, "../.."), encoding: "utf8",
    })) as number[][];
    for (const [i, [painting, x, y, kind]] of samples.entries()) {
      const [r, g, b] = values[i]!;
      const label = `${painting} (${x},${y}) ${kind}`;
      expect(b, label).toBeGreaterThan(200);
      if (kind === "protected") {
        expect(Math.max(r!, g!), label).toBeLessThan(8);
      } else {
        expect(kind === "main" ? r : g, label).toBeGreaterThan(64);
        expect(kind === "main" ? g : r, label).toBeLessThan(8);
      }
    }
  });
});
