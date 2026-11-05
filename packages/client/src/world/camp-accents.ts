import awning from "../assets/camp-accents/cliffside-exchange-awning.webp";
import ribbon from "../assets/camp-accents/sky-islands-ribbon.webp";
import fireflies from "../assets/camp-accents/whispering-marsh-fireflies.webp";

interface CampAccent {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pivotX: number;
  pivotY: number;
  angle: number;
  motion: "glow" | "sway" | "flutter";
}

// Placement in the 1920 × 1080 painting, behind the camp's walking lanes.
const accents: Readonly<Record<string, CampAccent>> = {
  whispering_marsh: { url: fireflies, x: 1328, y: 274, width: 412, height: 206, pivotX: 0, pivotY: 0, angle: 0, motion: "glow" },
  cliffside_exchange: { url: awning, x: 1030, y: 255, width: 261, height: 87, pivotX: 20, pivotY: 24, angle: -5, motion: "sway" },
  sky_islands: { url: ribbon, x: 167, y: 154, width: 116, height: 58, pivotX: 17, pivotY: 28, angle: 0, motion: "flutter" },
};

export function campAccent(family: string): CampAccent | undefined {
  return accents[family];
}

export function campAccentPose(accent: CampAccent, elapsed: number, still: boolean) {
  const { x, y, pivotX, pivotY, angle, motion } = accent;
  const rest = { x: x + pivotX, y: y + pivotY, angle, alpha: 1, stretch: 1 };
  if (still) return rest;
  switch (motion) {
    case "glow":
      return { ...rest, x: rest.x + 6 * Math.sin(elapsed * 0.68), y: rest.y + 4 * Math.sin(elapsed * 0.91), alpha: 0.78 + 0.18 * Math.sin(elapsed * 1.1) };
    case "sway":
      return { ...rest, stretch: 1 + 0.08 * Math.sin(elapsed * 1.5) };
    case "flutter":
      return { ...rest, angle: angle + 4 * Math.sin(elapsed * 2) + 1.5 * Math.sin(elapsed * 4.3) };
  }
}
