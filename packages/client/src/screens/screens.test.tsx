/**
 * Guards for the two ways a screen can take the table down mid-session.
 *
 * 1. A surface renders before its data arrives. Every screen has to survive an
 *    empty store — the TV can be hard-refreshed at any moment (spec §2.1) and
 *    mounts with no session, no run state and no content.
 * 2. A chapter names an icon we do not have. spec §1.5 makes icons the
 *    interface, so a missing one must degrade, never throw — and the icon set
 *    has to actually cover the committed content.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import rules from "../../../../content/rules.json";
import items from "../../../../content/items.json";
import {
  ChapterCompletePanel,
  CreationFlow,
  CreationPreview,
  DiceOverlay,
  HomeScreen,
  Icon,
  LobbyContent,
  NarrationPanel,
  PlayerPanel,
  SignInFlow,
  hasIcon,
} from "./index";

const SCREENS = {
  HomeScreen,
  LobbyContent,
  NarrationPanel,
  ChapterCompletePanel,
  CreationPreview,
  CreationFlow,
  PlayerPanel,
  DiceOverlay,
  SignInFlow,
};

/** Every `icon:` string reachable from a content file. */
function iconNames(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) iconNames(entry, found);
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "icon" && typeof entry === "string") found.add(entry);
      else iconNames(entry, found);
    }
  }
  return found;
}

describe("screens", () => {
  it.each(Object.entries(SCREENS))("%s renders with an empty store", (_name, Screen) => {
    expect(() => renderToStaticMarkup(<Screen />)).not.toThrow();
  });
});

describe("Icon", () => {
  it("falls back to a neutral glyph for an unknown name", () => {
    const html = renderToStaticMarkup(<Icon name="no-such-icon" />);
    expect(html).toContain("<svg");
  });

  it("covers every icon the committed content asks for", () => {
    const missing = [...iconNames(rules), ...iconNames(items)].filter((name) => !hasIcon(name));
    expect(missing).toEqual([]);
  });
});
