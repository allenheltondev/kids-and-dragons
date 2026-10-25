import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { combatMarkerArt, markerFromIcon, type CombatMarker } from "./combat-art";
import manifest from "../../../../assets/manifest.json";

describe("combat illustrations", () => {
  it("ships a small runtime image for every declared illustration", () => {
    const ids = [...manifest.combatUx.markers, ...manifest.combatUx.reactions, ...manifest.combatUx.rescueCharacters.map(c => c.waiting)];
    expect(ids).toHaveLength(10);
    for (const id of ids) {
      const file = fileURLToPath(new URL(`../../../../assets/combat-ux/${id}.webp`, import.meta.url));
      expect(readFileSync(file).toString("ascii", 8, 12)).toBe("WEBP");
      expect(statSync(file).size).toBeLessThan(40_000);
    }
  });
  it("gives every environment kind distinct art, and keeps unknown captives honest", () => {
    const kinds: CombatMarker[] = ["fire", "thorns", "rift", "exit", "hold", "seal"];
    expect(new Set(kinds.map(kind => combatMarkerArt(kind))).size).toBe(6);
    expect(combatMarkerArt("captive", "Bun")).toContain("rescue-bun.webp");
    expect(combatMarkerArt("captive", "Bun", true)).toBe("/assets/entities/snowhorn_goat/portrait.webp");
    expect(combatMarkerArt("captive", "Someone new")).toBeNull();
    expect(markerFromIcon("objective", "shield")).toBe("hold");
    expect(markerFromIcon("objective", "key")).toBe("seal");
  });
});
