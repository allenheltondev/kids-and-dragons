import { useId, useState } from "react";
import { CAMP_KIT_STYLES, campClothMatrix, type CampKitStyle } from "./camp-kit-art";

/** Tint only the cloth, leaving a single registered painting's leather and cup untouched. */
export function CampBedroll({ style, accent }: { style: CampKitStyle; accent: string }): React.JSX.Element {
  const id = useId().replace(/:/g, "");
  const [failed, setFailed] = useState<string | null>(null);
  const art = CAMP_KIT_STYLES[style];
  if (failed === art.path) return <svg viewBox="0 0 1024 1024" aria-hidden="true">
    <image href="/assets/camp/frames/stage1/bedroll.png" width="1024" height="1024" />
  </svg>;
  return <svg viewBox="0 0 1024 1024" aria-hidden="true" data-camp-kit={style}>
    <defs>
      <clipPath id={`${id}-cloth`}><path d={art.cloth} clipRule="evenodd" /></clipPath>
      <filter id={`${id}-color`} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
        <feColorMatrix type="matrix" values={campClothMatrix(accent)} />
      </filter>
    </defs>
    <image href={art.path} width="1024" height="1024" onError={() => setFailed(art.path)} />
    <image href={art.path} width="1024" height="1024" clipPath={`url(#${id}-cloth)`} filter={`url(#${id}-color)`} />
  </svg>;
}
