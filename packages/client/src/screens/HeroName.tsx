/**
 * A hero's name in the DOM, in her name style (docs/hero-looks.md §7.2; #664):
 * her frame behind it and her title under it, at 0.6 of the name's size.
 *
 * The name is drawn exactly as the surface draws it today: this renders the
 * same text, in whatever element and class the caller already uses, and adds
 * nothing for a hero with no look (no wrapper, no class), so an old hero
 * reads exactly as before. A frame is only drawn once its art is delivered
 * (hero-name.ts `nameplateFrameArt`); until then the plain plate stands in
 * and nothing is requested.
 *
 * In the DOM there is always room to wrap, so a title is never hidden here;
 * the TV's rule (hidden under 14px at 720p, or against a neighbour) is the
 * stage's (world/nameplate.ts).
 */

import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { HeroLookView } from "@kad/shared";
import { heroNameStyle, type HeroNameStyle } from "../world/hero-name";
import "./HeroName.css";

export interface HeroNameProps {
  name: ReactNode;
  look: Pick<HeroLookView, "nameplate" | "title"> | null | undefined;
  /** For a preview (the editors), a style already worked out. */
  style?: HeroNameStyle;
}

/** The frame's nine-slice, as CSS custom properties for `border-image`. */
function frameStyle(style: HeroNameStyle): CSSProperties | undefined {
  const frame = style.frame;
  if (!frame) return undefined;
  const { left, top, right, bottom } = frame.slice;
  return {
    ["--hero-name-frame" as string]: `url("${frame.url}")`,
    ["--hero-name-slice" as string]: `${String(top)} ${String(right)} ${String(bottom)} ${String(left)}`,
  };
}

/** Her name, framed and titled. With no look, just the name, exactly as before. */
export function HeroName({ name, look, style: given }: HeroNameProps): ReactElement {
  const style = given ?? heroNameStyle(look);
  if (style.title === null && style.frame === null) return <>{name}</>;
  return (
    <span
      className={`hero-name${style.frame ? " hero-name--framed" : ""}`}
      data-frame={style.frame?.id}
      style={frameStyle(style)}
    >
      <span className="hero-name__name">{name}</span>
      {style.title !== null ? <span className="hero-name__title">{style.title}</span> : null}
    </span>
  );
}
