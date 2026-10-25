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
import { checkTarget, neededLabel, outcomeWord } from "./DiceOverlay";
import { isMissingArt } from "./CharacterPortrait";
import { TrayObject } from "./TrayObjects";
import { characterArtUrl } from "../world/art-paths";
import manifest from "../../../../assets/manifest.json";
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
  WelcomeBack,
  hasIcon,
} from "./index";

const SCREENS = {
  HomeScreen,
  LobbyContent,
  NarrationPanel,
  ChapterCompletePanel,
  CreationPreview,
  CreationFlow,
  WelcomeBack,
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

describe("HomeScreen", () => {
  it("holds a seat for the busy line and the error before there is either", () => {
    // The body is vertically centred: anything mounting into it moves the
    // cards above, so the seat is drawn empty from the start.
    const html = renderToStaticMarkup(<HomeScreen />);
    expect(html).toContain('<div class="home__status"></div>');
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

  it("draws the approved purpose-drawn gear variant for every species", () => {
    const html = renderToStaticMarkup(
      <CharacterPortrait species="kitsune" characterClass="starweaver" tier="mythic" />,
    );
    expect(html).toContain('src="/assets/gear-portraits/starweaver/mythic/kitsune.png"');
    expect(html).toContain("portrait--gear");
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
  it("centres portraits by default and grounds stage art when asked", () => {
    expect(renderToStaticMarkup(<CharacterPortrait species="unicorn" />)).toContain(
      "portrait--centre",
    );
    expect(
      renderToStaticMarkup(<CharacterPortrait species="unicorn" stand="floor" />),
    ).toContain("portrait--floor");
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

  it("keeps the hero on screen", () => {
    const html = renderToStaticMarkup(<HeroStrip species={unicorn} klass={songkeeper} name="  Emberhoof  " />);
    expect(html).toContain('src="/assets/characters/unicorn/fledgling/assembled.png"');
    expect(html).toContain("Emberhoof");
  });

  it("gives the hero strip one short line before a class, not the whole blurb", () => {
    // The full blurb ran to three lines and then dropped to one when a class
    // was picked, moving every class card under the tap.
    const html = renderToStaticMarkup(<HeroStrip species={unicorn} klass={null} name="" />);
    const first = unicorn.blurb.slice(0, unicorn.blurb.indexOf(".") + 1);
    expect(html).toContain(first);
    expect(html).not.toContain(unicorn.blurb.slice(first.length).trim());
  });

  it("seats every species card's check, chosen or not", () => {
    const html = renderToStaticMarkup(
      <SpeciesStep species={speciesList} chosen="unicorn" onChoose={() => undefined} />,
    );
    expect(html.match(/creation-card__mark/g)).toHaveLength(speciesList.length);
    expect(html.match(/aria-label="Chosen"/g)).toHaveLength(1);
  });

  it("stands the drafted hero in the preview as soon as a species is picked", () => {
    expect(renderToStaticMarkup(<CreationPreview />)).not.toContain("/assets/characters/");
    patchCreationDraft({ species: "dragonling" });
    const html = renderToStaticMarkup(<CreationPreview />);
    expect(html).toContain('src="/assets/characters/dragonling/fledgling/assembled.png"');
    // ...somewhere with a floor under it (spec §6.2).
    expect(html).toContain("/assets/biomes/");
  });

  it("holds the finished-heroes row open before anybody has finished", () => {
    // Otherwise the first hero done grows a row and shrinks the stage.
    expect(renderToStaticMarkup(<CreationPreview />)).toContain('class="preview__done"');
  });
});

describe("what the dice card says", () => {
  it("names a natural 20 and a natural 1, since the die decided on its own", () => {
    expect(outcomeWord({ die: 20, result: "success" })).toBe("Natural 20!");
    expect(outcomeWord({ die: 1, result: "miss" })).toBe("Natural 1");
    expect(outcomeWord({ die: 11, result: "success" })).toBe("Success!");
  });

  it("gives a check its difficulty word, and an attack only the Guard", () => {
    expect(checkTarget(8)).toBe("Easy: needed 8");
    expect(checkTarget(12)).toBe("Tricky: needed 12");
    expect(checkTarget(16)).toBe("Hard: needed 16");
    expect(neededLabel({ tn: 13, result: "hit" })).toBe("Needed 13");
  });
});


describe("Icon", () => {
  it("uses the dedicated bag painting for inventory names", () => {
    for (const name of ["bag", "inventory", "item"]) {
      expect(renderToStaticMarkup(<Icon name={name} />)).toContain("/bag.webp");
    }
  });
  it("paints every supported tray object, including the mode switches", () => {
    for (const name of ["lantern", "globe", "map", "satchel", "scroll", "fieldGuide", "tv", "phone", "storybook"] as const) {
      const html = renderToStaticMarkup(<TrayObject name={name} />);
      expect(html, name).toContain("<img");
      expect(html, name).toContain(".webp");
      expect(html, name).not.toContain("<svg");
    }
  });

  it("uses each new painted icon directly instead of its old alias", () => {
    const sources = manifest.paintedIcons.ids.map(name => {
      const html = renderToStaticMarkup(<Icon name={name} label={name} />);
      expect(html, name).toContain(`<img`);
      expect(html, name).toContain(`/${name}.webp`);
      return html.match(/src="([^"]+)"/)?.[1];
    });
    expect(new Set(sources).size).toBe(manifest.paintedIcons.ids.length);
  });
  it("uses painted artwork for every committed inventory icon", () => {
    const missing = [...iconNames(items)].filter(
      (name) => !renderToStaticMarkup(<Icon name={name} />).includes("<img"),
    );
    expect(missing).toEqual([]);
  });

  it("keeps painted icons decorative unless they have an accessible label", () => {
    expect(renderToStaticMarkup(<Icon name="potion" />)).toContain('alt=""');
    const labelled = renderToStaticMarkup(<Icon name="potion" label="Healing potion" />);
    expect(labelled).toContain('alt="Healing potion"');
    expect(labelled).not.toContain('aria-hidden="true"');
  });
  it("falls back to a neutral glyph for an unknown name", () => {
    const html = renderToStaticMarkup(<Icon name="no-such-icon" />);
    expect(html).toContain("<svg");
  });

  it("covers every icon the committed content asks for", () => {
    const missing = [...iconNames(rules), ...iconNames(items)].filter((name) => !hasIcon(name));
    expect(missing).toEqual([]);
  });
});
