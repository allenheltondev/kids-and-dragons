/** Painted combat markers shared by the phone and the stage. Glyphs remain the fallback. */
export type CombatMarker = "fire" | "thorns" | "rift" | "exit" | "hold" | "seal" | "captive";
export const COMBAT_MARKER_ART: Readonly<Record<Exclude<CombatMarker, "captive">, string>> = {
  fire: "hazard-fire", thorns: "hazard-thorns", rift: "hazard-rift", exit: "exit-gate",
  hold: "objective-hold", seal: "objective-seal",
};
export function combatMarkerArt(kind: CombatMarker, name?: string, freed = false): string | null {
  // Bun is the only authored combat captive. Unknown future captives keep their
  // honest rescue glyph rather than borrowing another character's identity.
  if (kind === "captive") return name === "Bun"
    ? freed ? "/assets/entities/snowhorn_goat/portrait.webp" : "/assets/combat-ux/rescue-bun.webp"
    : null;
  return `/assets/combat-ux/${COMBAT_MARKER_ART[kind]}.webp`;
}
export function markerFromIcon(kind: string, icon: string): CombatMarker {
  if (kind === "captive") return "captive";
  if (kind === "exit") return "exit";
  if (kind === "objective") return icon === "shield" ? "hold" : "seal";
  return icon === "flame" ? "fire" : icon === "thorn" ? "thorns" : "rift";
}
