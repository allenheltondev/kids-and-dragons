/** Cloth regions and alpha-measured height and width fractions in the 1024px paintings; leather stays natural. */
export const CAMP_KIT_STYLES = {
  rolled: {
    paintHeight: 508 / 1024,
    paintWidth: 831 / 1024,
    path: "/assets/camp/kits/rolled.png",
    cloth: "M60 700L170 690L155 560L410 560L420 650L540 625L575 627L635 618L640 649L673 658L693 688L718 733L720 791L697 822L610 851L320 920L60 920Z M264 684L309 676L342 686L365 709L383 747L395 790L404 868L363 883L350 827L339 788L322 752L303 724L276 706Z M521 637L555 625L589 643L612 671L627 702L641 742L651 809L612 826L601 761L590 719L570 679L547 654Z",
  },
  quilted: {
    paintHeight: 479 / 1024,
    paintWidth: 851 / 1024,
    path: "/assets/camp/kits/quilted.png",
    cloth: "M60 930V760Q150 670 260 675L350 643Q430 628 509 609L515 599L546 557Q558 553 578 562L637 574L655 580L700 580L714 608L704 638L777 655L816 672L840 693L842 733L825 765L650 818L353 920Z",
  },
  patched: {
    paintHeight: 393 / 1024,
    paintWidth: 877 / 1024,
    path: "/assets/camp/kits/patched.png",
    cloth: "M60 930V780L210 738L220 716L310 696L355 668L430 677L490 650L544 659L578 610L602 614L642 628L686 645L721 659L736 671L722 701L716 719L786 738L817 744L771 762L710 786L570 834L340 930Z",
  },
} as const;
export type CampKitStyle = keyof typeof CAMP_KIT_STYLES;
const styles = Object.keys(CAMP_KIT_STYLES) as CampKitStyle[];

/**
 * A hero's bedroll-and-pack style: the one her kid picked (`HeroKit.style`),
 * when it is one this build can draw, and otherwise the style her id hashes
 * to. The hash is only the fallback for a hero with no stored style, so a
 * hero nobody has chosen for looks exactly as she did before kits were stored,
 * stable across disconnects and party reordering; it is never written back.
 */
export function campKitStyle(characterId: string, stored?: string | null): CampKitStyle {
  if (stored && Object.hasOwn(CAMP_KIT_STYLES, stored)) return stored as CampKitStyle;
  let hash = 0;
  for (const char of characterId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return styles[hash % styles.length]!;
}

/** Multiply luminance by the hero accent, retaining the painting's folds and dark seams. */
export function campClothMatrix(accent: string): string {
  const color = /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#7FD4C1";
  const rgb = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16) / 255);
  return [...rgb.flatMap(channel => [.2126 * channel, .7152 * channel, .0722 * channel, 0, 0]), 0, 0, 0, 1, 0].join(" ");
}
