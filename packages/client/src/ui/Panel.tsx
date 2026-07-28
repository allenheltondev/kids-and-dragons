/**
 * A titled surface. Deliberately dumb — it owns padding, radius, and elevation
 * so panels line up across screens written by different hands, and nothing else.
 */

import type { ReactNode } from "react";

export interface PanelProps {
  children: ReactNode;
  title?: ReactNode;
  /** Rendered opposite the title: a count, a timer, a dismiss. */
  aside?: ReactNode;
  tone?: "default" | "raised" | "quiet";
  className?: string;
  /** Panels are landmarks when they carry a title. */
  as?: "section" | "div" | "aside";
}

export function Panel({
  children,
  title,
  aside,
  tone = "default",
  className = "",
  as: Tag = "section",
}: PanelProps): React.JSX.Element {
  return (
    <Tag className={["kad-panel", `kad-panel--${tone}`, className].filter(Boolean).join(" ")}>
      {(title !== undefined || aside !== undefined) && (
        <header className="kad-panel__head">
          {title !== undefined && <h2 className="kad-panel__title">{title}</h2>}
          {aside}
        </header>
      )}
      <div className="kad-panel__body">{children}</div>
    </Tag>
  );
}
