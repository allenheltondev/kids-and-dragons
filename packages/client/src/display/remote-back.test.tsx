// @vitest-environment jsdom
/**
 * Back on a TV remote, against a real sheet rather than a listener in a test (#264).
 *
 * The unit tests in remote-focus.test.ts prove where the relayed Escape goes. This one proves
 * what it is for: the display settings sheet — the one control the shared screen's corner row
 * always keeps — closes on a Back press and hands focus back to the button that opened it, so
 * a remote is never left pointing at nothing. It installs the listener the way App does on the
 * TV route (`installRemoteFocus(document, { armed: true })`, App.tsx).
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { A11yControl } from "../a11y/A11yControl";
import { DEFAULT_PREFS } from "../a11y/prefs";
import { useA11y } from "../a11y/store";
import { installRemoteFocus } from "./remote-focus";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined }));
  useA11y.setState({ prefs: DEFAULT_PREFS, open: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-text");
});

/**
 * Back, as a TV sends it: no named key, the platform's legacy code. Inside `act` because the
 * relay is dispatched outside React's own event system, so the close it causes is not flushed
 * until React is given the chance — in a browser the native key press does that itself.
 */
function pressBack(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "", cancelable: true, bubbles: true });
  Object.defineProperty(event, "keyCode", { value: 10009 });
  act(() => { document.dispatchEvent(event); });
  return event;
}

it("closes the display settings sheet and gives the remote its button back", () => {
  render(<A11yControl />);
  const stop = installRemoteFocus(document, { armed: true });
  const opener = screen.getByRole("button", { name: "Display settings" });
  opener.focus();
  fireEvent.click(opener);

  const sheet = screen.getByRole("dialog", { name: "Display settings" });
  expect(sheet).toBeTruthy();
  // Focus is inside the sheet, so this is also the case where the relay starts from a control.
  expect(sheet.contains(document.activeElement)).toBe(true);

  expect(pressBack().defaultPrevented).toBe(true);
  expect(screen.queryByRole("dialog", { name: "Display settings" })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Display settings" }));
  stop();
});

it("leaves Back to the browser once the sheet is closed again", () => {
  render(<A11yControl />);
  const stop = installRemoteFocus(document, { armed: true });
  // Nothing open: Back is how a person gets out of the page, so it is not swallowed.
  expect(pressBack().defaultPrevented).toBe(false);
  stop();
});
