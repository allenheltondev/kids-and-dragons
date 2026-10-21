/** Storybook equipment for the bottom tray. Broad colours and carved gold
 * edges echo the shared glyphs; the button owns selection and labels. */
import type { ReactElement } from "react";
import { PAINTED_ART } from "../assets/artwork";
export type TrayObjectName = "lantern" | "globe" | "map" | "satchel" | "scroll" | "fieldGuide" | "tv" | "phone" | "storybook";
export interface TrayObjectProps { name: TrayObjectName; className?: string; }
const EDGE = { stroke: "#ffe4a1", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const OBJECTS: Partial<Record<TrayObjectName, ReactElement>> = {
  // An open storybook with a ribbon marking the page you are on (#358).
  storybook: (
    <g {...EDGE}>
      <path d="M24 12c-5-4-12-5-19-4v28c7-1 14 0 19 4Z" fill="#f3e2b8" />
      <path d="M24 12c5-4 12-5 19-4v28c-7-1-14 0-19 4Z" fill="#e9d29c" />
      <path d="M9 15c4-.4 8 .3 11 2M9 21c4-.4 8 .3 11 2M9 27c4-.4 8 .3 11 2M28 17c3-1.7 7-2.4 11-2M28 23c3-1.7 7-2.4 11-2" fill="none" stroke="#a98a5a" strokeWidth="1.6" />
      <path d="M33 8v14l3-2.5 3 2.5V8" fill="#b84a7a" />
      <path d="M24 12v28" fill="none" />
    </g>
  ),
  // A dragon-eared looking glass, still a television on a stand.
  tv: (
    <g {...EDGE}>
      <path d="M9 13 6 4l12 8m21 1 3-9-12 8" fill="#b79adf" />
      <path d="M8 12h32l4 5-2 19H6L4 17Z" fill="#7560a5" />
      <path d="M10 18h28v12H10Z" fill="#302748" stroke="none" />
      <path d="M24 18l2 4 5 2-5 2-2 4-2-4-5-2 5-2Z" fill="#70dbc2" stroke="none" />
      <path d="M24 36v7m-8 1h16" fill="none" strokeWidth="3" />
      <path d="M11 33h.01m26 0h.01" fill="none" strokeWidth="2.8" />
    </g>
  ),
  // A pocket looking glass with the same enchanted crystal.
  phone: (
    <g {...EDGE}>
      <path d="M17 3h14l4 5-1 33-4 4H18l-4-4-1-33Z" fill="#7560a5" />
      <path d="M18 11h12v23H18Z" fill="#302748" stroke="none" />
      <path d="M24 15l5 8-5 8-5-8Z" fill="#70dbc2" stroke="none" />
      <path d="M24 18v10" stroke="#285d65" fill="none" strokeWidth="1.6" />
      <path d="M21 7h6m-4 32h2" fill="none" />
      <path d="M5 17v6m-3-3h6m34 9v4m-2-2h4" fill="none" strokeWidth="1.8" />
    </g>
  ),
};
export function TrayObject({ name, className = "" }: TrayObjectProps): ReactElement {
  const artwork = PAINTED_ART[name];
  if (artwork !== undefined) {
    return <img className={`kad-tray-object${className ? ` ${className}` : ""}`}
      src={artwork} alt="" aria-hidden="true" draggable={false} decoding="async" />;
  }
  return (
    <svg className={`kad-tray-object${className ? ` ${className}` : ""}`} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {OBJECTS[name]}
    </svg>
  );
}
