import { useEffect, useRef, useState } from "react";

type Position = { x: number; y: number; anchor: "start" | "middle" };

const FALLBACK: Position = { x: 32, y: 46, anchor: "middle" };

/**
 * Where each capital's ink sits, by font and letter. Measured once and kept: every
 * `loadingdone` (one per font face the page loads) asked every letter on screen to
 * measure again, each with a fresh canvas and a forced style read, which on a slow
 * phone was most of a second of its start for four letters that never moved.
 */
const measured = new Map<string, Position>();
let canvas: CanvasRenderingContext2D | null | undefined;

function inkPosition(letter: string, family: string): Position | null {
  const key = `${family}|${letter}`;
  const known = measured.get(key);
  if (known) return known;
  if (canvas === undefined) canvas = document.createElement("canvas").getContext("2d");
  if (!canvas) return null;
  canvas.font = `800 44px ${family}`;
  const ink = canvas.measureText(letter);
  const position: Position = {
    x: 32 + (ink.actualBoundingBoxLeft - ink.actualBoundingBoxRight) / 2,
    y: 32 + (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2,
    anchor: "start",
  };
  // Only a font that has loaded is worth keeping: until then the canvas measures a fallback face.
  if (typeof document.fonts?.check === "function" && document.fonts.check(canvas.font, letter)) measured.set(key, position);
  return position;
}

/** Centre the visible ink of each capital, rather than its font's line box. */
export function RoomCodeLetter({ letter }: { letter: string }) {
  const glyph = useRef<SVGTextElement>(null);
  const [position, setPosition] = useState<Position>(FALLBACK);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let live = true;
    let family: string | null = null;
    const align = () => {
      if (!live || !glyph.current) return;
      family ??= getComputedStyle(glyph.current).fontFamily;
      const next = inkPosition(letter, family);
      if (!next) return;
      setPosition((at) => (at.x === next.x && at.y === next.y && at.anchor === next.anchor ? at : next));
    };
    void fonts.ready.then(align);
    fonts.addEventListener("loadingdone", align);
    return () => { live = false; fonts.removeEventListener("loadingdone", align); };
  }, [letter]);
  return <span className="lobby__code-letter" aria-hidden="true">
    <svg className="lobby__code-glyph" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <text ref={glyph} x={position.x} y={position.y} textAnchor={position.anchor} fontSize="44" fontWeight="800">{letter}</text>
    </svg>
  </span>;
}
