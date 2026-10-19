/** The display-settings button in the corner row, and the sheet it opens (#262). */

import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import { deviceWantsContrast, deviceWantsLessMotion, type Hand, type TextSize } from "./prefs";
import { useA11y } from "./store";

import "./A11yControl.css";

const TEXT_SIZES: readonly { id: TextSize; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "large", label: "Large" },
  { id: "largest", label: "Largest" },
];

// Short words so the three fit one row of a small phone; the full name is the accessible one.
const HANDS: readonly { id: Hand; label: string; name: string }[] = [
  { id: "off", label: "Off", name: "Off" },
  { id: "right", label: "Right", name: "Right hand" },
  { id: "left", label: "Left", name: "Left hand" },
];

export function A11yControl(): React.JSX.Element {
  const open = useA11y((state) => state.open);
  const setOpen = useA11y((state) => state.setOpen);
  // Stable, so the sheet's focus handling runs once per opening and not once per setting.
  const close = useCallback(() => { setOpen(false); }, [setOpen]);
  return (
    <>
      <button
        type="button"
        className="kad-a11y__button kad-focusable"
        aria-label="Display settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true" className="kad-a11y__glyph">Aa</span>
      </button>
      {open ? <A11ySheet onClose={close} /> : null}
    </>
  );
}

function A11ySheet({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { prefs, set } = useA11y();
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Once per opening: focus moves in, the page behind goes inert, Tab stays inside, Escape
  // closes, and focus goes back to whatever opened the sheet, whatever was changed in it.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const app = document.getElementById("root");
    app?.setAttribute("inert", "");
    const focusable = (): HTMLElement[] =>
      [...(sheet.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onCloseRef.current();
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
      opener?.focus();
    };
  }, []);

  // In the body, not the corner row: the row is a stacking context below the toast and the dice.
  return createPortal(
    <div className="kad-a11y__scrim" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={sheet} className="kad-a11y__sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="kad-a11y__title">Display settings</h2>
        <p className="kad-a11y__note">Saved on this device.</p>

        <section className="kad-a11y__group" aria-label="Text size">
          <h3 className="kad-a11y__heading">Text size</h3>
          <div className="kad-a11y__row">
            {TEXT_SIZES.map((size) => (
              <Button key={size.id} variant="secondary" size="lg" selected={prefs.text === size.id}
                className={`kad-a11y__option kad-a11y__option--${size.id}`} onClick={() => set({ text: size.id })}>
                {size.label}
              </Button>
            ))}
          </div>
        </section>

        <section className="kad-a11y__group" aria-label="One-handed play">
          <h3 className="kad-a11y__heading">One-handed play</h3>
          <p className="kad-a11y__note">Buttons move to your thumb.</p>
          <div className="kad-a11y__row">
            {HANDS.map((hand) => (
              <Button key={hand.id} variant="secondary" size="lg" selected={prefs.hand === hand.id}
                className="kad-a11y__option" aria-label={hand.name} onClick={() => set({ hand: hand.id })}>
                {hand.label}
              </Button>
            ))}
          </div>
        </section>

        <section className="kad-a11y__group" aria-label="Looks and motion">
          <div className="kad-a11y__row">
            <Button variant="secondary" size="lg" selected={prefs.contrast}
              className="kad-a11y__option" onClick={() => set({ contrast: !prefs.contrast })}>
              High contrast
            </Button>
            <Button variant="secondary" size="lg" selected={prefs.motion}
              className="kad-a11y__option" onClick={() => set({ motion: !prefs.motion })}>
              Less movement
            </Button>
          </div>
          {deviceWantsContrast() || deviceWantsLessMotion() ? (
            <p className="kad-a11y__note">Your device already asks for {deviceWantsContrast() && deviceWantsLessMotion() ? "both of these" : deviceWantsContrast() ? "high contrast" : "less movement"}.</p>
          ) : null}
        </section>

        <Button variant="primary" size="lg" block className="kad-a11y__done" onClick={onClose}>Done</Button>
      </div>
    </div>,
    document.body,
  );
}
