/** Storybook equipment for the bottom tray. Broad colours and carved gold
 * edges echo the shared glyphs; the button owns selection and labels. */
import type { ReactElement } from "react";
import { PAINTED_ART } from "../assets/artwork";
export type TrayObjectName = "lantern" | "globe" | "map" | "satchel" | "scroll" | "fieldGuide" | "tv" | "phone" | "storybook";
export interface TrayObjectProps { name: TrayObjectName; className?: string; }
export function TrayObject({ name, className = "" }: TrayObjectProps): ReactElement {
  return <img className={`kad-tray-object${className ? ` ${className}` : ""}`}
    src={PAINTED_ART[name]} alt="" aria-hidden="true" draggable={false} decoding="async" />;
}
