import { useId, useState } from "react";
import { CAMP_KIT_STYLES, campClothMatrix, campTentCloth, type CampKitStyle } from "./camp-kit-art";
import { campPaint } from "./camp-paint";
import { TENT_ART } from "./camp-scene";

/** Tint only the cloth, leaving a single registered painting's leather and cup untouched. */
export function CampBedroll({ style, accent }: { style: CampKitStyle; accent: string }): React.JSX.Element {
  return <CampClothArt {...CAMP_KIT_STYLES[style]} accent={accent} kit={style} fallback={
    <svg viewBox="0 0 1024 1024" aria-hidden="true">
      <image href="/assets/camp/frames/stage1/bedroll.png" width="1024" height="1024" />
    </svg>
  } />;
}

/**
 * A hero's tent as a phone's picker shows it: its painting, cloth and flap in
 * her color (the flap is cut from the tent at the same place, so the tent's
 * own cloth region tints it here), cropped to what is painted
 * (camp-paint.ts). `fallback` while it is owed, or when its painting will
 * not load; `onDrawn` hears which one shows (true: the painting).
 */
export function CampTent({ tent, accent, fallback, onDrawn }: { tent: string; accent: string; fallback: React.JSX.Element; onDrawn?: (painted: boolean) => void }): React.JSX.Element {
  const art = TENT_ART.find((t) => t.id === tent);
  const paint = art ? campPaint(art.path) : null;
  if (!art || !paint) return fallback;
  const px = (v: number) => Math.round(v * 1024);
  const viewBox = `${String(px(paint.left))} ${String(px(paint.top))} ${String(px(paint.right - paint.left))} ${String(px(paint.bottom - paint.top))}`;
  return <CampClothArt path={`/assets/${art.path}`} cloth={campTentCloth(art.id)} accent={accent} tent={art.id} viewBox={viewBox} fallback={fallback}
    {...(onDrawn ? { onMissing: () => onDrawn(false), onLoaded: () => onDrawn(true) } : {})} />;
}

/** A painting with its cloth tinted; `viewBox` crops it (a phone's picker shows only what is painted). */
export function CampClothArt({ path, cloth, accent, kit, tent, viewBox = "0 0 1024 1024", fallback, onMissing, onLoaded }: {
  path: string;
  cloth: string | undefined;
  accent: string;
  kit?: CampKitStyle;
  tent?: string;
  viewBox?: string;
  fallback: React.JSX.Element;
  onMissing?: (src: string) => void;
  /** The painting loaded and is what shows. */
  onLoaded?: () => void;
}): React.JSX.Element {
  const id = useId().replace(/:/g, "");
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === path) return fallback;
  return <svg viewBox={viewBox} aria-hidden="true" data-camp-kit={kit} data-camp-tent={tent} data-cropped={viewBox === "0 0 1024 1024" ? undefined : "true"}>
    <defs>
      <clipPath id={`${id}-cloth`}><path d={cloth} clipRule="evenodd" /></clipPath>
      <filter id={`${id}-color`} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
        <feColorMatrix type="matrix" values={campClothMatrix(accent)} />
      </filter>
    </defs>
    <image href={path} width="1024" height="1024" onError={() => { setFailed(path); onMissing?.(path); }} {...(onLoaded ? { onLoad: onLoaded } : {})} />
    {cloth ? <image href={path} width="1024" height="1024" clipPath={`url(#${id}-cloth)`} filter={`url(#${id}-color)`} /> : null}
  </svg>;
}
