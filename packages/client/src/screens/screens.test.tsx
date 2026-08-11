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
import { CosmeticRow, HeroStrip, SpeciesStep } from "./CreationFlow";
import { nextFace } from "./DiceOverlay";
import { isMissingArt } from "./CharacterPortrait";
import { characterArtUrl } from "../world/art-paths";
import manifest from "../../../../assets/manifest.json";
import { HORN_STYLES, MARKINGS, PALETTES, WING_STYLES, defaultAppearance } from "./creationContent";
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
  const heal = {
    kind: "consumable" as const,
    name: "Sunbloom Draught",
    text: "Heal 4 HP.",
    icon: "potion",
    effect: { type: "heal" as const, amount: 4 },
  };
  const bonus = {
    kind: "consumable" as const,
    name: "Brave Whistle",
    text: "+2 on your next roll.",
    icon: "whistle",
    effect: { type: "rollBonus" as const, amount: 2 },
  };

  it("keeps the bag's Use button out of combat — the fight owns item use now", () => {
    // During an encounter the item is an action card in CombatControls
    // (§7.2's fourth universal action), not a bag button.
    expect(canUseInventoryItem(potion, true, heal)).toBe(false);
    expect(canUseInventoryItem(potion, false, heal)).toBe(true);
  });

  it("only a heal is usable outside a fight", () => {
    // A roll bonus (or a thrown item) has nothing to land on out here, and the
    // server would refuse rather than consume — so the button never shows.
    expect(canUseInventoryItem(potion, false, bonus)).toBe(false);
    expect(canUseInventoryItem(potion, false, undefined)).toBe(false);
  });

  it("and not at full health — the server refuses a heal of zero", () => {
    // Hidden, never disabled: the same no-op rule the combat cards follow.
    expect(canUseInventoryItem(potion, false, heal, true)).toBe(false);
    expect(canUseInventoryItem(potion, false, heal, false)).toBe(true);
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

  it("draws approved class gear for the exact creature and tier", () => {
    const html = renderToStaticMarkup(
      <CharacterPortrait species="unicorn" characterClass="duskrunner" tier="radiant" />,
    );
    expect(html).toContain('src="/assets/gear-portraits/duskrunner/radiant/unicorn.png"');
    expect(html).toContain("portrait--gear");
  });

  it("keeps base species art for a creature without its own gear portrait", () => {
    const html = renderToStaticMarkup(
      <CharacterPortrait species="kitsune" characterClass="starweaver" tier="mythic" />,
    );
    expect(html).toContain('src="/assets/characters/kitsune/mythic/assembled.png"');
    expect(html).not.toContain("portrait--gear");
  });

  it("is decoration: no alt text, because the name is beside it in every use", () => {
    const html = renderToStaticMarkup(<CharacterPortrait species="kitsune" />);
    expect(html).toContain('alt=""');
  });

  it("carries the chosen accent as the colour of the light it stands in", () => {
    const html = renderToStaticMarkup(<CharacterPortrait species="bigfoot" lit accent="#70E09F" />);
    expect(html).toContain("--portrait-accent:#70E09F");
  });

  /*
   * The figure stands on its ground-contact line, not on the bottom of its
   * canvas — the same `ANCHOR_Y` the Pixi sprites use. Asserted against the
   * manifest rather than against the number, because the number is the
   * manifest's to change.
   */
  it("hands CSS the ground-contact offset from the art contract", () => {
    const canvas = manifest.canvas;
    const floor = (1 - canvas.originY / canvas.height) * 100;
    expect(renderToStaticMarkup(<CharacterPortrait species="unicorn" />)).toContain(
      `--portrait-floor:${String(floor)}%`,
    );
  });

  /*
   * One mounted portrait outlives the picture it shows: characters cross tiers,
   * rows are reused for another species, and `/assets` deploys separately from
   * the bundle, so a URL that 404s now can exist in ten minutes. The fallback
   * is therefore keyed to the URL that failed.
   *
   * This is asserted on the predicate rather than by driving a rerender because
   * the package has no DOM environment (vitest runs `node`, and screens are
   * tested through `renderToStaticMarkup` — see signin.test.tsx). The component
   * uses the same predicate for its independent gear and base-art failure URLs.
   */
  /*
   * A box that is a *place* stands the figure on its floor; a box that is a
   * *picture* centres it. The species cards are the second kind — a portrait
   * beside a paragraph, with no floor in it to stand on.
   */
  it("stands on the floor by default and centres where asked", () => {
    expect(renderToStaticMarkup(<CharacterPortrait species="unicorn" />)).toContain(
      "portrait--floor",
    );
    expect(
      renderToStaticMarkup(<CharacterPortrait species="unicorn" stand="centre" />),
    ).toContain("portrait--centre");
  });

  it("re-asks for a new URL after a different one failed", () => {
    const unicorn = characterArtUrl("unicorn");
    const griffin = characterArtUrl("griffin");
    const unicornMythic = characterArtUrl("unicorn", "mythic");

    expect(isMissingArt(null, unicorn)).toBe(false);
    // The one that actually 404'd keeps the icon...
    expect(isMissingArt(unicorn, unicorn)).toBe(true);
    // ...and nothing else does: a species change, or a tier the character just
    // grew into, both get their own request.
    expect(isMissingArt(unicorn, griffin)).toBe(false);
    expect(isMissingArt(unicorn, unicornMythic)).toBe(false);
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

/**
 * The layout invariants behind the appearance and name steps. Both of these
 * were real: a check added to the chosen chip made it wider and reflowed the
 * row under the finger that tapped it, and every cosmetic option borrowed an
 * interface glyph — "Plain" was a check, inside a chip whose selected state is
 * also a check.
 */
describe("creation options", () => {
  const cosmetics = [...MARKINGS, ...HORN_STYLES, ...WING_STYLES];

  it("shows each cosmetic option as the thing it names", () => {
    const missing = cosmetics.filter((option) => !hasIcon(option.icon));
    expect(missing).toEqual([]);
    // Nothing here reuses the glyph that carries selection.
    expect(cosmetics.map((option) => option.icon)).not.toContain("check");
  });

  it("keeps a seat for the check whether or not anything is chosen", () => {
    const row = (chosen: string | undefined) =>
      renderToStaticMarkup(
        <CosmeticRow legend="Markings" options={MARKINGS} chosen={chosen} onChoose={() => undefined} />,
      );
    const marks = (html: string) => html.split('class="creation-option__mark"').length - 1;

    // One slot per option, both ways round — the row's geometry does not
    // depend on what is selected.
    expect(marks(row(undefined))).toBe(MARKINGS.length);
    expect(marks(row("dapple"))).toBe(MARKINGS.length);
    expect(row(undefined)).not.toContain("Chosen");
    expect(row("dapple")).toContain("Chosen");
  });

  /**
   * Colour and accent are the one step creation does not require an answer to
   * (CreationFlow `stepDone`), and this is what makes that safe: a player who
   * taps straight past still leaves with a real colour, because picking a
   * species already applied one.
   *
   * Worth pinning because the failure is silent and downstream. An empty
   * accent is not a crash — it is a flame with no colour in the keepsake
   * lantern and an unlit portrait, noticed weeks later by somebody wondering
   * why one character looks wrong.
   */
  it("leaves every species with a usable colour before the step is even shown", () => {
    // From the manifest, so a seventh species is covered the day it lands.
    for (const { id } of manifest.species) {
      const appearance = defaultAppearance(id as Parameters<typeof defaultAppearance>[0]);
      expect(appearance.palette, id).not.toBe("");
      expect(PALETTES.map((p) => p.id), id).toContain(appearance.palette);
      // The accent is a hex the chrome renders directly — SignInFlow puts it
      // straight into a `color`, which fails open and invisible on "".
      expect(appearance.accent, id).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

/**
 * The die's face is theatre — the server rolled the number before this client
 * heard about it (architecture §4.2). What the scramble owes the table is only
 * that it always shows a legal face and never appears to stick.
 */
describe("dice scramble", () => {
  it("never repeats the face already showing", () => {
    for (let previous = 1; previous <= 20; previous += 1) {
      for (const random of [0, 0.25, 0.5, 0.75, 0.999999]) {
        expect(nextFace(previous, random)).not.toBe(previous);
      }
    }
  });

  it("only ever shows a face the die has", () => {
    for (let previous = 1; previous <= 20; previous += 1) {
      for (let i = 0; i < 40; i += 1) {
        const face = nextFace(previous, i / 40);
        expect(face).toBeGreaterThanOrEqual(1);
        expect(face).toBeLessThanOrEqual(20);
        expect(Number.isInteger(face)).toBe(true);
      }
    }
  });

  it("can reach every other face", () => {
    // 19 inputs, 19 distinct faces: the skip must not fold two inputs onto one.
    const seen = new Set(Array.from({ length: 19 }, (_, i) => nextFace(7, i / 19)));
    expect(seen.size).toBe(19);
    expect(seen.has(7)).toBe(false);
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
