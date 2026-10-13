/**
 * The tray's objects — what the phone's bottom bar is made of (spec §2.2).
 *
 * A row of tabs with line icons reads as an app. A row of *things* on a
 * shelf reads as the game: the lantern you hold up to look at the world, the
 * rolled map, your satchel. Royal Match and its cousins do this with a tray
 * of painted props along the bottom; this is the same idea in the realm's
 * own palette — night purples, teal lantern-light, old gold, warm leather —
 * drawn as small painterly SVGs rather than photographs of buttons.
 *
 * Each object is a picture, nothing more: the tab around it owns the label,
 * the pressed state and the focus ring (components.css, `.kad-tray`), and
 * spec §11 still holds — every object has a word under it, and "selected" is
 * a lift and a glow *and* a gold label, never a colour alone.
 *
 * `useId` keys the gradients, because the same object is drawn more than
 * once on a page (two bars, two states) and SVG gradient ids are global.
 */

import { useId } from "react";
import type { ReactElement } from "react";

export type TrayObjectName = "lantern" | "map" | "satchel" | "tv" | "phone";

export interface TrayObjectProps {
  name: TrayObjectName;
  className?: string;
}

export function TrayObject({ name, className = "" }: TrayObjectProps): ReactElement {
  const id = useId().replace(/:/g, "");
  const g = (key: string): string => `tray-${id}-${key}`;
  const cls = `kad-tray-object${className ? ` ${className}` : ""}`;

  switch (name) {
    case "lantern":
      return (
        <svg className={cls} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id={g("glow")} cx="50%" cy="55%" r="55%">
              <stop offset="0%" stopColor="#dffff6" />
              <stop offset="35%" stopColor="#5fe9cf" />
              <stop offset="100%" stopColor="#1a6f8a" />
            </radialGradient>
            <linearGradient id={g("iron")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4a4858" />
              <stop offset="100%" stopColor="#15131d" />
            </linearGradient>
          </defs>
          {/* handle */}
          <path d="M16 13c0-7 16-7 16 0" fill="none" stroke={`url(#${g("iron")})`} strokeWidth="2.6" strokeLinecap="round" />
          {/* roof */}
          <path d="M11 17l13-6 13 6z" fill={`url(#${g("iron")})`} />
          <rect x="21" y="8" width="6" height="4" rx="1.5" fill="#3a3848" />
          {/* glass */}
          <path d="M13 18h22v18H13z" fill={`url(#${g("glow")})`} />
          {/* flame */}
          <path d="M24 22c4 4 4 7 1 9-1-1-1-2 0-4-3 2-4 5-1 8-5-1-7-6-3-10 1 2 2 2 3-3z" fill="#f4fff9" opacity="0.9" />
          {/* frame bars */}
          <path d="M13 18v18M35 18v18M24 18v18" stroke="#1b1a24" strokeWidth="2" />
          <path d="M11 17h26M11 36h26" stroke="#2b2a35" strokeWidth="2.4" strokeLinecap="round" />
          {/* base */}
          <path d="M10 37h28l2 5H8z" fill={`url(#${g("iron")})`} />
          {/* a little scrollwork, like the marsh lantern's */}
          <path d="M9 24c-3 0-3 4 0 4M39 24c3 0 3 4 0 4" fill="none" stroke="#3a3848" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "map":
      return (
        <svg className={cls} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={g("parch")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f3e2b6" />
              <stop offset="100%" stopColor="#caa366" />
            </linearGradient>
            <linearGradient id={g("roll")} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#8a6433" />
              <stop offset="50%" stopColor="#d9b16e" />
              <stop offset="100%" stopColor="#8a6433" />
            </linearGradient>
          </defs>
          {/* the sheet, slightly curled */}
          <path d="M10 12c6 2 22 2 28 0v24c-6-2-22-2-28 0z" fill={`url(#${g("parch")})`} stroke="#8a6433" strokeWidth="1" />
          {/* coastline + hills */}
          <path d="M14 29c3-5 7-3 9-7s6-3 9 1" fill="none" stroke="#7aa0b8" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M16 20l2-3 2 3M27 18l2-3 2 3" fill="none" stroke="#6b8a4a" strokeWidth="1.4" strokeLinecap="round" />
          {/* the route, dashed, ending on an X */}
          <path d="M14 33c5-2 8-8 13-10 3-1 5-2 6-5" fill="none" stroke="#b8322b" strokeWidth="1.5" strokeDasharray="2 2" strokeLinecap="round" />
          <path d="M31 15l4 4M35 15l-4 4" stroke="#b8322b" strokeWidth="1.8" strokeLinecap="round" />
          {/* rolled ends */}
          <rect x="6" y="10" width="6" height="28" rx="3" fill={`url(#${g("roll")})`} />
          <rect x="36" y="10" width="6" height="28" rx="3" fill={`url(#${g("roll")})`} />
          {/* wax seal */}
          <circle cx="24" cy="35" r="3.4" fill="#c0392b" />
          <circle cx="24" cy="35" r="1.6" fill="#8e2a1f" />
        </svg>
      );
    case "satchel":
      return (
        <svg className={cls} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={g("leather")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a56a36" />
              <stop offset="100%" stopColor="#5a3719" />
            </linearGradient>
            <linearGradient id={g("flap")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c6873f" />
              <stop offset="100%" stopColor="#8b5a2b" />
            </linearGradient>
            <linearGradient id={g("gold")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffe6a3" />
              <stop offset="100%" stopColor="#c9962f" />
            </linearGradient>
          </defs>
          {/* strap */}
          <path d="M15 17c0-9 18-9 18 0" fill="none" stroke="#5a3719" strokeWidth="3" strokeLinecap="round" />
          {/* body */}
          <rect x="8" y="16" width="32" height="24" rx="5" fill={`url(#${g("leather")})`} />
          {/* stitching */}
          <rect x="10.5" y="18.5" width="27" height="19" rx="3.5" fill="none" stroke="#e7b87a" strokeWidth="0.8" strokeDasharray="1.5 1.8" opacity="0.7" />
          {/* flap */}
          <path d="M8 21v-2a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v2c0 5-5 8-8 8H16c-3 0-8-3-8-8z" fill={`url(#${g("flap")})`} />
          {/* buckle */}
          <rect x="20.5" y="24" width="7" height="8" rx="1.6" fill={`url(#${g("gold")})`} />
          <rect x="22.5" y="26" width="3" height="4" rx="0.8" fill="#5a3719" />
          {/* a corner of parchment peeking out */}
          <path d="M31 18l5-4 1 5z" fill="#f3e2b6" />
        </svg>
      );
    case "tv":
      return (
        <svg className={cls} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={g("screen")} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#8b6cf5" />
              <stop offset="100%" stopColor="#2b1f5a" />
            </linearGradient>
          </defs>
          <rect x="7" y="11" width="34" height="24" rx="4" fill="#2b2a35" />
          <rect x="10" y="14" width="28" height="18" rx="2" fill={`url(#${g("screen")})`} />
          <path d="M18 40h12M24 35v5" stroke="#2b2a35" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M20 29l4-9 4 9z" fill="#f5c86c" opacity="0.9" />
        </svg>
      );
    case "phone":
      return (
        <svg className={cls} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={g("screen")} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#8b6cf5" />
              <stop offset="100%" stopColor="#2b1f5a" />
            </linearGradient>
          </defs>
          <rect x="15" y="6" width="18" height="36" rx="4" fill="#2b2a35" />
          <rect x="17.5" y="10" width="13" height="26" rx="2" fill={`url(#${g("screen")})`} />
          <circle cx="24" cy="39" r="1.4" fill="#8a88a0" />
          <path d="M21 25l3-7 3 7z" fill="#f5c86c" opacity="0.9" />
        </svg>
      );
    default:
      return <svg className={cls} viewBox="0 0 48 48" aria-hidden="true" focusable="false" />;
  }
}
