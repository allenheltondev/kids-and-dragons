/** The "?" button in the corner row, the sheet it opens, and the press-and-hold on cards, buffs and things (#256). */

import { useEffect, useId, useRef, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import { ChunkBoundary, lazyChunk } from "../ui/ChunkBoundary";
import { Icon } from "../screens/icons";
import { hear, stopSpeaking } from "../speech/read-aloud";
import { routeCode, useRoute } from "../router";
import { useGameStore } from "../store";
import { useHelp } from "./content";
import { closeHelp, openHelp, showThingHelp, useHelpFocus, useHelpSurface } from "./focus";
import { installLongPress } from "./longpress";

import "./HelpControl.css";

/** A grown-up's list of how the installed app is doing (#459). Fetched only when opened. */
const DiagnosticsPanel = lazyChunk(() => import("./DiagnosticsPanel"), (module) => module.default);

export function HelpControl(): React.JSX.Element | null {
  const route = useRoute();
  const hasSession = useGameStore((store) => store.session !== null);
  // The TV is nobody's hands (spec §2.1), and a screen with no room has nothing in play to explain.
  const phone = route.name === "player" && routeCode(route) !== null && hasSession;
  const open = useHelpFocus((focus) => focus.open);

  useEffect(() => (phone ? installLongPress(showThingHelp) : undefined), [phone]);
  // Leaving the room (or the page) leaves no sheet behind.
  useEffect(() => { if (!phone) closeHelp(); }, [phone]);

  if (!phone) return null;
  return (
    <>
      <button
        type="button"
        className="kad-help__button kad-focusable"
        aria-label="Help"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openHelp}
      >
        <span aria-hidden="true" className="kad-help__glyph">?</span>
      </button>
      {open ? <HelpSheet /> : null}
    </>
  );
}

function HelpSheet(): React.JSX.Element {
  const help = useHelp();
  const surface = useHelpSurface();
  const thing = useHelpFocus((focus) => focus.thing);
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const [diagnostics, setDiagnostics] = useState(false);
  // The sheet says what this screen is for; a button beside it opens the quick "How to play" cards instead.
  const [reference, setReference] = useState(false);

  const kind = thing === null ? undefined : help?.things[thing.kind];
  const entry = thing === null ? help?.surfaces[surface] : kind;
  const icon = thing?.icon ?? entry?.icon ?? "scroll";
  // A thing's own words say what it does; its kind's words are the fallback.
  const text = thing?.text ?? entry?.text ?? "";
  const title = thing === null ? "Help" : thing.name;

  // Reading aloud is the point of the button for a child who cannot read yet: say it as soon as it shows.
  useEffect(() => {
    if (reference) stopSpeaking();
    else if (text !== "") hear(text, { source: "ui" });
  }, [text, reference]);

  // Focus moves in, the page behind goes inert, Tab stays inside, Escape closes, and focus goes back.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const app = document.getElementById("root");
    app?.setAttribute("inert", "");
    const focusable = (): HTMLElement[] =>
      [...(sheet.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
    focusable()[focusable().length - 1]?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeHelp();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!sheet.current?.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      app?.removeAttribute("inert");
      stopSpeaking();
      // The opener may be gone (a card that played); focus is then left where the browser puts it.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // In the body, not the corner row: the row is a stacking context below the toast and the dice.
  return createPortal(
    <div className="kad-help__scrim" onClick={(event) => { if (event.target === event.currentTarget) closeHelp(); }}>
      <div ref={sheet} className="kad-help__sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {reference ? (
          <div className="kad-help__reference">
            <h2 id={titleId} className="kad-help__title">How to play</h2>
            <p className="kad-help__hint">Tap a card to hear it.</p>
            <ul className="kad-help__tiles">
              {(help?.howToPlay ?? []).map((tile) => (
                <li key={tile.id}>
                  <button type="button" className="kad-help__tile kad-focusable" onClick={() => { hear(tile.text, { source: "ui" }); }}>
                    <span className="kad-help__tile-picture" aria-hidden="true"><Icon name={tile.icon} size="1.8em" /></span>
                    <span className="kad-help__tile-words">
                      <span className="kad-help__tile-title">{tile.title}</span>
                      <span className="kad-help__tile-text">{tile.text}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="kad-help__body">
            <span className="kad-help__picture" aria-hidden="true"><Icon name={icon} size="2.4em" /></span>
            <div className="kad-help__words">
              <h2 id={titleId} className="kad-help__title">{title}</h2>
              {text !== "" ? <p className="kad-help__text">{text}</p> : <p className="kad-help__text kad-muted">One moment…</p>}
            </div>
          </div>
        )}
        {thing === null && !reference ? (
          <div className="kad-help__grownups">
            <button
              type="button"
              className="kad-help__diagnostics-toggle kad-focusable"
              aria-expanded={diagnostics}
              onClick={() => { setDiagnostics((open) => !open); }}
            >
              Diagnostics
            </button>
            {diagnostics ? (
              <ChunkBoundary inline message="The diagnostics could not load.">
                <Suspense fallback={<p>Checking…</p>}>
                  <DiagnosticsPanel />
                </Suspense>
              </ChunkBoundary>
            ) : null}
          </div>
        ) : null}
        <div className="kad-help__actions">
          {reference ? (
            <Button variant="secondary" size="lg" icon={<Icon name="back" />} onClick={() => { setReference(false); }}>
              Back
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="lg" icon={<Icon name="sound" />} disabled={text === ""}
                onClick={() => hear(text, { source: "ui" })}>
                Hear it again
              </Button>
              {thing === null ? (
                <Button variant="secondary" size="lg" icon={<Icon name="scroll" />} disabled={(help?.howToPlay.length ?? 0) === 0}
                  onClick={() => { setReference(true); }}>
                  How to play
                </Button>
              ) : null}
            </>
          )}
          <Button variant="primary" size="lg" onClick={closeHelp}>Got it</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
