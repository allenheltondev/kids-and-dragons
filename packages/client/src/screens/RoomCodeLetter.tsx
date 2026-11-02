import { useEffect, useRef, useState } from "react";

/** Centre the visible ink of each capital, rather than its font's line box. */
export function RoomCodeLetter({ letter }: { letter: string }) {
  const glyph = useRef<SVGTextElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number; anchor: "start" | "middle" }>({ x: 32, y: 46, anchor: "middle" });
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let live = true;
    const align = () => {
      if (!live || !glyph.current) return;
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return;
      context.font = `800 44px ${getComputedStyle(glyph.current).fontFamily}`;
      const ink = context.measureText(letter);
      setPosition({
        x: 32 + (ink.actualBoundingBoxLeft - ink.actualBoundingBoxRight) / 2,
        y: 32 + (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2,
        anchor: "start",
      });
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
