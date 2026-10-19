/** The "?" button in the corner row, the sheet it opens, and the press-and-hold on cards, buffs and things (#256). */

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import { Icon } from "../screens/icons";
import { hear, stopSpeaking } from "../speech/read-aloud";
import { routeCode, useRoute } from "../router";
import { useGameStore } from "../store";
import { useHelp } from "./content";
import { closeHelp, openHelp, showThingHelp, useHelpFocus, useHelpSurface } from "./focus";
import { installLongPress } from "./longpress";

import "./HelpControl.css";

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

  const kind = thing === null ? undefined : help?.things[thing.kind];
  const entry = thing === null ? help?.surfaces[surface] : kind;
  const icon = thing?.icon ?? entry?.icon ?? "scroll";
  // A thing's own words say what it does; its kind's words are the fallback.
  const text = thing?.text ?? entry?.text ?? "";
  const title = thing === null ? "Help" : thing.name;

  // Reading aloud is the point of the button for a child who cannot read yet: say it as soon as it shows.
  useEffect(() => {
    if (text !== "") hear(text, { source: "ui" });
  }, [text]);

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
        <div className="kad-help__body">
          <span className="kad-help__picture" aria-hidden="true"><Icon name={icon} size="2.4em" /></span>
          <div className="kad-help__words">
            <h2 id={titleId} className="kad-help__title">{title}</h2>
            {text !== "" ? <p className="kad-help__text">{text}</p> : <p className="kad-help__text kad-muted">One moment…</p>}
          </div>
        </div>
        <div className="kad-help__actions">
          <Button variant="secondary" size="lg" icon={<Icon name="sound" />} disabled={text === ""}
            onClick={() => hear(text, { source: "ui" })}>
            Hear it again
          </Button>
          <Button variant="primary" size="lg" onClick={closeHelp}>Got it</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
