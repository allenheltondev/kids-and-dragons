import { useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import "./phone-magic.css";

/** One feedback layer for creation, choices, inventory, maps and the tray. */
export function PhoneMagic({ enabled, children }: { enabled: boolean; children: ReactNode }): React.JSX.Element {
  const lastBuzz = useRef(0);
  const animations = useRef(new WeakMap<HTMLElement, Animation>());

  function activate(event: MouseEvent<HTMLDivElement>): void {
    if (!enabled || event.defaultPrevented || !(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLElement>("button, a[href], summary, input[type=checkbox], input[type=radio], [role=button], [role=tab]");
    if (!control || control.closest(":disabled, [aria-disabled=true], [inert]")) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    // Individual scale composes with existing lifts and translations. Never
    // delay the action, move focus, or remount a game surface for decoration.
    animations.current.get(control)?.cancel();
    if (typeof control.animate === "function") {
      animations.current.set(control, control.animate([
        { scale: "0.96", offset: 0 },
        { scale: "1.025", offset: 0.55 },
        { scale: "1", offset: 1 },
      ], { duration: 260, easing: "cubic-bezier(.2,.7,.3,1)" }));
    }

    // Vibration is an enhancement: browsers such as iOS Safari omit it.
    // A short, throttled tick avoids a buzz storm during rapid choices.
    const now = Date.now();
    if (event.nativeEvent.isTrusted && now - lastBuzz.current > 80 && typeof navigator.vibrate === "function") {
      lastBuzz.current = now;
      try { navigator.vibrate(8); } catch { /* Optional hardware feedback. */ }
    }
  }

  return <div className="phone-magic" data-phone-magic={enabled || undefined} onClickCapture={activate}>{children}</div>;
}
