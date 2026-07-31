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

import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClassDef, SpeciesDef } from "@kad/shared";
import { canUseInventoryItem } from "./PlayerPanel";
import { HeroStrip, SpeciesStep } from "./CreationFlow";
import { patchCreationDraft, resetCreationDraft } from "./creationDraft";
import rules from "../../../../content/rules.json";
import items from "../../../../content/items.json";
import {
  ChapterCompletePanel,
  CharacterPortrait,
  CombatControls,
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
  CombatControls,
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

describe("PlayerPanel inventory", () => {
  const potion = { itemId: "sunbloom_draught", kind: "consumable" as const };

  it("does not offer a consumable action during combat", () => {
    expect(canUseInventoryItem(potion, true)).toBe(false);
    expect(canUseInventoryItem(potion, false)).toBe(true);
  });
});

/**
 * spec §5.1 — species are chosen by their picture. The art is deployed
 * separately from the bundle, so the guards here are "the right file is asked
 * for" and "asking is not load-bearing": a portrait is decoration on top of a
 * name that is already text, and it degrades to the species icon.
 */
describe("CharacterPortrait", () => {
  it("asks for the species art at the starting tier by default", () => {
    const html = renderToStaticMarkup(<CharacterPortrait species="unicorn" />);
    expect(html).toContain('src="/assets/characters/unicorn/fledgling/assembled.png"');
  });

  it("draws the tier the character has actually reached", () => {
    const html = renderToStaticMarkup(<CharacterPortrait species="griffin" tier="mythic" />);
    expect(html).toContain('src="/assets/characters/griffin/mythic/assembled.png"');
  });

  it("is decoration: no alt text, because the name is beside it in every use", () => {
    const html = renderToStaticMarkup(<CharacterPortrait species="kitsune" />);
    expect(html).toContain('alt=""');
  });

  it("carries the chosen accent as the colour of the light it stands in", () => {
    const html = renderToStaticMarkup(<CharacterPortrait species="bigfoot" lit accent="#70E09F" />);
    expect(html).toContain("--portrait-accent:#70E09F");
  });
});

/*
 * The store's snapshot is fixed at its initial value under
 * `renderToStaticMarkup` (zustand serves `getInitialState` to the server
 * renderer), so these render the steps directly with the committed rules rather
 * than seeding the store — which is also the tighter test: these components take
 * their content as props precisely so nothing about a species is written in
 * this package.
 */
describe("creation art", () => {
  const speciesList = Object.values(rules.species) as unknown as SpeciesDef[];
  const unicorn = speciesList.find((def) => def.id === "unicorn") as SpeciesDef;
  const songkeeper = rules.classes.songkeeper as unknown as ClassDef;

  afterEach(() => {
    resetCreationDraft();
  });

  it("offers every species as a portrait, not only as a word", () => {
    const html = renderToStaticMarkup(
      <SpeciesStep species={speciesList} chosen={null} onChoose={() => undefined} />,
    );
    for (const id of Object.keys(rules.species)) {
      expect(html).toContain(`src="/assets/characters/${id}/fledgling/assembled.png"`);
      // The picture is an addition to the name, never a replacement for it:
      // spec §11 wants the word there too, and the e2e taps by accessible name.
      expect(html).toContain((rules.species as Record<string, { name: string }>)[id]?.name ?? "");
    }
  });

  it("keeps the hero — and the colour just chosen for them — on screen", () => {
    const html = renderToStaticMarkup(
      <HeroStrip species={unicorn} klass={songkeeper} name="  Emberhoof  " accent="#70E09F" />,
    );
    expect(html).toContain('src="/assets/characters/unicorn/fledgling/assembled.png"');
    expect(html).toContain("Emberhoof");
    // The accent is the light the hero stands in, so tapping a swatch changes
    // something about the character and not only about the swatch.
    expect(html).toContain("--portrait-accent:#70E09F");
  });

  it("stands the drafted hero in the preview as soon as a species is picked", () => {
    expect(renderToStaticMarkup(<CreationPreview />)).not.toContain("<img");
    patchCreationDraft({ species: "dragonling" });
    const html = renderToStaticMarkup(<CreationPreview />);
    expect(html).toContain('src="/assets/characters/dragonling/fledgling/assembled.png"');
    // ...somewhere with a floor under it (spec §6.2).
    expect(html).toContain("/assets/biomes/");
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
