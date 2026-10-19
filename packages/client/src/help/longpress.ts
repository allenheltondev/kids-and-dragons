/**
 * Press and hold on a card, a buff or an item, without breaking taps or scrolling.
 *
 * Things say they can be held by wearing `helpAttrs(...)`; one listener on the document finds them,
 * so a list of cards needs no hook per card and a thing added later is held for free. The listener is
 * installed by the lazy help control, so a phone pays nothing until that has loaded.
 *
 * The hold is a timer a finger can lose: it is cancelled when the pointer drifts more than a few
 * pixels (that is a scroll or a swipe), lifts, or the browser takes the gesture (`pointercancel`,
 * which is what a scroll becomes). Nothing here calls preventDefault on a pointer or touch event, so a
 * tap still clicks and a list still scrolls. When the hold does fire, the click that follows the finger
 * lifting is swallowed once, so showing what a card does never also plays the card. That swallow is
 * scoped to the held element and expires shortly after the finger lifts, so a browser that sends no
 * release click (a modal went inert under the finger, or the element is not clickable) cannot leave it
 * armed to eat the next unrelated tap, and a click inside a dialog, such as "Got it" in the sheet that
 * just opened, is never swallowed.
 */

import type { HelpThingKind } from "@kad/shared";
import { HELP_THING_KINDS } from "@kad/shared";
import type { HelpThing } from "./focus";

/** Long enough that no ordinary tap or scroll start reaches it, short enough that nobody wonders. */
export const HOLD_MS = 500;
/** How far a finger may drift and still be holding. */
export const HOLD_SLOP_PX = 8;

/** How long after the finger lifts a release click can still be the hold's own. */
export const SWALLOW_MS = 400;

const SELECTOR = "[data-help-kind]";

/** Spread onto a card, a buff row or an item: it can now be pressed and held. */
export function helpAttrs(thing: HelpThing): Record<string, string> {
  return {
    "data-help-kind": thing.kind,
    "data-help-name": thing.name,
    ...(thing.text !== undefined ? { "data-help-text": thing.text } : {}),
    ...(thing.icon !== undefined ? { "data-help-icon": thing.icon } : {}),
  };
}

function heldElement(target: EventTarget | null): HTMLElement | null {
  const element = target instanceof Element ? target.closest<HTMLElement>(SELECTOR) : null;
  const kind = element?.dataset.helpKind;
  return element && kind && (HELP_THING_KINDS as readonly string[]).includes(kind) ? element : null;
}

function thingOf(element: HTMLElement): HelpThing {
  const { helpKind, helpName, helpText, helpIcon } = element.dataset;
  return {
    kind: helpKind as HelpThingKind,
    name: helpName ?? "",
    ...(helpText ? { text: helpText } : {}),
    ...(helpIcon ? { icon: helpIcon } : {}),
  };
}

/** Starts listening. Returns the function that stops. */
export function installLongPress(onHold: (thing: HelpThing) => void, root: Document = document): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let origin: { x: number; y: number } | null = null;
  /** The element whose release click is still to be swallowed, until the finger lifts and a moment passes. */
  let swallowing: HTMLElement | null = null;
  let expiry: ReturnType<typeof setTimeout> | null = null;

  const forget = (): void => {
    swallowing = null;
    if (expiry !== null) clearTimeout(expiry);
    expiry = null;
  };
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    origin = null;
  };
  const lifted = (): void => {
    cancel();
    if (swallowing === null || expiry !== null) return;
    expiry = setTimeout(forget, SWALLOW_MS);
  };
  const down = (event: PointerEvent): void => {
    // A mouse's other buttons are not a hold.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    cancel();
    forget();
    const element = heldElement(event.target);
    if (element === null) return;
    origin = { x: event.clientX, y: event.clientY };
    timer = setTimeout(() => {
      timer = null;
      swallowing = element;
      onHold(thingOf(element));
    }, HOLD_MS);
  };
  const move = (event: PointerEvent): void => {
    if (origin === null) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > HOLD_SLOP_PX) cancel();
  };
  const click = (event: MouseEvent): void => {
    const held = swallowing;
    if (held === null) return;
    // The release click is the hold's: on the held element, or retargeted somewhere behind the sheet that
    // opened under the finger (its scrim would close it). A click inside a dialog is always a real tap.
    const inDialog = event.target instanceof Element && event.target.closest('[role="dialog"]') !== null;
    if (!inDialog) {
      event.preventDefault();
      event.stopPropagation();
      if (event.target instanceof Node && held.contains(event.target)) forget();
      return;
    }
    forget();
  };
  // Android shows a menu on a long press; the sheet is the answer to it instead.
  const menu = (event: Event): void => {
    if (heldElement(event.target) !== null) event.preventDefault();
  };

  root.addEventListener("pointerdown", down, { passive: true });
  root.addEventListener("pointermove", move, { passive: true });
  root.addEventListener("pointerup", lifted, { passive: true });
  root.addEventListener("pointercancel", lifted, { passive: true });
  root.addEventListener("click", click, true);
  root.addEventListener("contextmenu", menu);
  return () => {
    cancel();
    forget();
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("pointermove", move);
    root.removeEventListener("pointerup", lifted);
    root.removeEventListener("pointercancel", lifted);
    root.removeEventListener("click", click, true);
    root.removeEventListener("contextmenu", menu);
  };
}
