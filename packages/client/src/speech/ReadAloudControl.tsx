/** The read-aloud switch: one icon button on every screen, beside sound. */

import { useReadAloud } from "./read-aloud";

import "./ReadAloudControl.css";

/*
 * Drawn here rather than in the shared icon set, which is part of the first
 * paint; this control loads after it. A speech bubble with lines of text, and
 * crossed out when off: shape, not colour, tells the two apart (spec §11).
 */
const GLYPH = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function BubbleIcon({ off }: { off: boolean }): React.JSX.Element {
  return (
    <svg className="kad-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g {...GLYPH}>
        <path d="M3 4h18v12h-9l-5 4v-4H3Z" />
        <path d={off ? "M7 8h10M7 12h6M3 21 21 3" : "M7 8h10M7 12h6"} />
      </g>
    </svg>
  );
}

export function ReadAloudControl(): React.JSX.Element | null {
  const { supported, on, setOn } = useReadAloud();
  if (!supported) return null;
  return (
    <div className="kad-readaloud">
      <button
        type="button"
        className="kad-readaloud__button kad-focusable"
        aria-label={on ? "Turn read-aloud off" : "Turn read-aloud on"}
        aria-pressed={on}
        onClick={() => setOn(!on)}
      >
        <BubbleIcon off={!on} />
      </button>
    </div>
  );
}
