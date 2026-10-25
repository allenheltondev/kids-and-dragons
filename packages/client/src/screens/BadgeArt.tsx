/** Decorative painted medals; unknown badge ids retain the original plain medal. */

import type { ReactElement } from "react";

import finished from "../assets/badges/finished.webp";
import storyCollector from "../assets/badges/finished-3.webp";
import guestStar from "../assets/badges/guest-star.webp";
import keptGoing from "../assets/badges/kept-going.webp";
import growingStrong from "../assets/badges/level-3.webp";
import mightyHero from "../assets/badges/level-5.webp";
import sharpEyes from "../assets/badges/finds-1.webp";
import trailReader from "../assets/badges/finds-5.webp";
import guideKeeper from "../assets/badges/finds-15.webp";

const paintings: Record<string, string> = {
  "finished": finished,
  "finished-3": storyCollector,
  "guest-star": guestStar,
  "kept-going": keptGoing,
  "level-3": growingStrong,
  "level-5": mightyHero,
  "finds-1": sharpEyes,
  "finds-5": trailReader,
  "finds-15": guideKeeper,
};

export function BadgeArt({ id, className = "" }: { id: string; className?: string }): ReactElement {
  const key = id.startsWith("finished:") && id.length > "finished:".length ? "finished" : id;
  const src = Object.hasOwn(paintings, key) ? paintings[key] : undefined;
  if (src) {
    return <img className={`badge-art ${className}`.trim()} src={src} width={256} height={256} alt="" aria-hidden="true" data-badge={id} />;
  }
  return (
    <svg className={`badge-art ${className}`.trim()} viewBox="0 0 100 100" aria-hidden="true" focusable="false" data-badge={id}>
      <path d="m30 70-9 26 12-6 6 8 6-26Zm40 0 9 26-12-6-6 8-6-26Z" fill="#5b3d9b" />
      <circle cx="50" cy="46" r="40" fill="#d9a24a" />
      <circle cx="50" cy="46" r="33" fill="#6a4aa8" />
      <path d="m50 26 6 12.5 13.7 1.8-10 9.6 2.5 13.6L50 56.700l-12.2 6.8 2.500-13.600-10-9.600L44 38.500Z" fill="#f5c86c" />
    </svg>
  );
}
