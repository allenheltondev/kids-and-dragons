/** The read-aloud switch: one icon button on every screen, beside sound. */

import { useReadAloud } from "./read-aloud";

import "./ReadAloudControl.css";

/*
 * Drawn here rather than in the shared icon set, which is part of the first
 * paint; this control loads after it. Lines of text with sound coming off
 * them, so it reads as "say these words out loud" and not as a message; crossed
 * out when off: shape, not colour, tells the two apart (spec §11).
 */
const GLYPH = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function ReadAloudIcon({ off }: { off: boolean }): React.JSX.Element {
  return (
    <svg className="kad-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g {...GLYPH}>
        <path d="M3 7h9M3 12h6M3 17h9" />
        <path d="M15 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
        {off ? <path d="M3 21 21 3" /> : null}
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
        title="Read aloud"
        onClick={() => setOn(!on)}
      >
        <ReadAloudIcon off={!on} />
      </button>
    </div>
  );
}
