import { useId, useState } from "react";
import { CAMP_KIT_STYLES, campClothMatrix, type CampKitStyle } from "./camp-kit-art";

/** Tint only the cloth, leaving a single registered painting's leather and cup untouched. */
export function CampBedroll({ style, accent }: { style: CampKitStyle; accent: string }): React.JSX.Element {
  return <CampClothArt {...CAMP_KIT_STYLES[style]} accent={accent} kit={style} fallback={
    <svg viewBox="0 0 1024 1024" aria-hidden="true">
      <image href="/assets/camp/frames/stage1/bedroll.png" width="1024" height="1024" />
    </svg>
  } />;
}

export function CampClothArt({ path, cloth, accent, kit, fallback, onMissing }: {
  path: string;
  cloth: string | undefined;
  accent: string;
  kit?: CampKitStyle;
  fallback: React.JSX.Element;
  onMissing?: (src: string) => void;
}): React.JSX.Element {
  const id = useId().replace(/:/g, "");
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === path) return fallback;
  return <svg viewBox="0 0 1024 1024" aria-hidden="true" data-camp-kit={kit}>
    <defs>
      <clipPath id={`${id}-cloth`}><path d={cloth} clipRule="evenodd" /></clipPath>
      <filter id={`${id}-color`} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
        <feColorMatrix type="matrix" values={campClothMatrix(accent)} />
      </filter>
    </defs>
    <image href={path} width="1024" height="1024" onError={() => { setFailed(path); onMissing?.(path); }} />
    {cloth ? <image href={path} width="1024" height="1024" clipPath={`url(#${id}-cloth)`} filter={`url(#${id}-color)`} /> : null}
  </svg>;
}
