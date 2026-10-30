/**
 * The matchup lines on the species and class cards (docs/matchups.md): what
 * each species and class is good at, what to watch out for, and how a pair
 * works together. Pure helpers are tested directly; the rendered cards are
 * checked for the words, the signs and the absence of numbers.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClassDef, ClassId, MatchupRules, SpeciesDef, SpeciesId } from "@kad/shared";
import rules from "../../../../content/rules.json";
import { classMatchups, matchupSign, speciesMatchups } from "./creationContent";
import { ClassStep, SpeciesStep } from "./CreationFlow";

const matchups = rules.matchups as unknown as MatchupRules;
const speciesList = Object.values(rules.species) as unknown as SpeciesDef[];
const SPECIES = Object.keys(rules.species) as SpeciesId[];
const CLASSES = Object.keys(rules.classes) as ClassId[];
const classList = Object.values(rules.classes) as unknown as ClassDef[];

function textOf(lines: { text: string }[]): string[] {
  return lines.map((line) => line.text);
}

describe("matchupSign", () => {
  it("reads an attack or check roll as the hero's own", () => {
    expect(matchupSign({ id: "a", hero: {}, on: "attack", roll: 1, text: "" })).toBe("+");
    expect(matchupSign({ id: "b", hero: {}, on: "check", roll: -1, text: "" })).toBe("-");
    expect(matchupSign({ id: "c", hero: {}, on: "attack", damage: 1, text: "" })).toBe("+");
  });

  it("flips a defend roll: a negative number protects the hero", () => {
    expect(matchupSign({ id: "d", hero: {}, on: "defend", roll: -1, text: "" })).toBe("+");
    expect(matchupSign({ id: "e", hero: {}, on: "defend", roll: 1, text: "" })).toBe("-");
  });
});

describe("species and class card lines", () => {
  it("gives every species and every class at least one line to read", () => {
    for (const id of SPECIES) {
      const lines = speciesMatchups(matchups, id);
      expect(lines.good.length + lines.watch.length, id).toBeGreaterThan(0);
    }
    for (const id of CLASSES) {
      const lines = classMatchups(matchups, id);
      expect(lines.good.length + lines.watch.length, id).toBeGreaterThan(0);
    }
  });

  it("holds a species card to two good lines and one watch-out, and only its own edges", () => {
    for (const id of SPECIES) {
      const lines = speciesMatchups(matchups, id);
      expect(lines.good.length).toBeLessThanOrEqual(2);
      expect(lines.watch.length).toBeLessThanOrEqual(1);
      expect(lines.good.every((line) => line.sign === "+")).toBe(true);
      expect(lines.watch.every((line) => line.sign === "-")).toBe(true);
      expect(lines.together).toEqual([]);
      const own = matchups.edges
        .filter((edge) => edge.hero.species === id && edge.hero.class === undefined)
        .map((edge) => edge.text);
      for (const text of [...textOf(lines.good), ...textOf(lines.watch)]) expect(own).toContain(text);
    }
  });

  it("gives a species its strength and its weakness, in table order", () => {
    // Dragonling: two plus edges on its own, and minus edges after them.
    const dragonling = speciesMatchups(matchups, "dragonling");
    expect(textOf(dragonling.good)).toEqual([
      "A dragonling is small but mighty, so heavy lifting is easier.",
      "A dragonling can flap up high, so fliers are easy to reach.",
    ]);
    expect(textOf(dragonling.watch)).toEqual(["A dragonling puffs little smoke clouds, so sneaking is harder."]);
  });

  it("gives a class only its own edges, not those of a species it is paired with", () => {
    const lines = classMatchups(matchups, "thornguard", "bigfoot");
    const classOnly = matchups.edges
      .filter((edge) => edge.hero.class === "thornguard" && edge.hero.species === undefined)
      .map((edge) => edge.text);
    for (const text of [...textOf(lines.good), ...textOf(lines.watch)]) expect(classOnly).toContain(text);
    expect(textOf(lines.good).join(" ")).not.toContain("bigfoot");
  });

  it("names the pairing as Together when both are picked", () => {
    const together = classMatchups(matchups, "thornguard", "bigfoot");
    expect(together.together).toEqual([
      {
        text: "A Thornguard bigfoot is steady as a boulder against big, hard-hitting things.",
        sign: "+",
      },
    ]);
    // A pairing shows on the species card too, once a class is known.
    expect(speciesMatchups(matchups, "bigfoot", "thornguard").together).toEqual(together.together);
    // And not before a class is picked, nor a species on a class.
    expect(classMatchups(matchups, "thornguard", null).together).toEqual([]);
    expect(speciesMatchups(matchups, "bigfoot", null).together).toEqual([]);
  });

  it("shows nothing when the rules have no matchups", () => {
    expect(speciesMatchups(undefined, "dragonling")).toEqual({ good: [], watch: [], together: [] });
    expect(classMatchups(null, "songkeeper")).toEqual({ good: [], watch: [], together: [] });
  });
});

describe("species cards with matchups", () => {
  it("keeps the first choice short and details outside every selection button", () => {
    const html = renderToStaticMarkup(<SpeciesStep species={speciesList} chosen={null} onChoose={() => undefined} matchups={matchups} />);
    const buttons = [...html.matchAll(/<button[\s\S]*?<\/button>/g)].map(m => m[0]);
    expect(buttons).toHaveLength(speciesList.length);
    for (const button of buttons) {
      expect(button).toContain("creation-species__art");
      expect(button).toContain("creation-species__details");
      expect(button).not.toContain("creation-notes");
      expect(button).not.toContain("<details");
    }
    expect(html.match(/<details /g)).toHaveLength(speciesList.length);
    expect(html).not.toMatch(/<details[^>]*\bopen/);
  });
  it("writes Good at, Watch out and the signs in words, with no numbers", () => {
    const html = renderToStaticMarkup(
      <SpeciesStep species={speciesList} chosen={null} onChoose={() => undefined} matchups={matchups} />,
    );
    expect(html).toContain("Good at:");
    expect(html).toContain("Watch out:");
    expect(html).toContain("A dragonling is small but mighty, so heavy lifting is easier.");
    expect(html).toContain('aria-hidden="true">+</span>');
    expect(html).toContain('aria-hidden="true">−</span>');
    // The note lines carry no raw numbers: the words say how much.
    const items = [...html.matchAll(/<li class="creation-notes__item[^"]*">([\s\S]*?)<\/li>/g)].map((m) => m[1] ?? "");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      // Strip tags and character entities (&#x27; is an apostrophe, not a number).
      expect(item.replace(/<[^>]+>/g, "").replace(/&#?\w+;/g, "")).not.toMatch(/\d/);
    }
  });

  it("renders exactly as before when the rules have no matchups", () => {
    const without = renderToStaticMarkup(
      <SpeciesStep species={speciesList} chosen="unicorn" onChoose={() => undefined} />,
    );
    const withNull = renderToStaticMarkup(
      <SpeciesStep species={speciesList} chosen="unicorn" onChoose={() => undefined} matchups={null} />,
    );
    expect(without).not.toContain("creation-notes");
    expect(withNull).toBe(without);
  });

  it("shows the pairing on each species once a class has been picked", () => {
    const html = renderToStaticMarkup(
      <SpeciesStep
        species={speciesList}
        chosen={null}
        onChoose={() => undefined}
        matchups={matchups}
        klass="thornguard"
      />,
    );
    expect(html).toContain("Together:");
    expect(html).toContain("A Thornguard bigfoot is steady as a boulder against big, hard-hitting things.");
  });
});

describe("class cards with matchups", () => {
  it("teaches the role before the fantasy name and keeps extra reading optional", () => {
    const html = renderToStaticMarkup(<ClassStep classes={classList} chosen={null} onChoose={() => undefined} matchups={matchups} />);
    expect(html.indexOf("Protect your friends")).toBeLessThan(html.indexOf("Thornguard"));
    expect(html).toContain("Be quick and sneaky");
    expect(html).toContain("Cast wonderful spells");
    expect(html).toContain("Help your friends shine");
    const buttons = [...html.matchAll(/<button[\s\S]*?<\/button>/g)].map(m => m[0]);
    expect(buttons).toHaveLength(classList.length);
    expect(buttons.every(button => !button.includes("creation-notes") && !button.includes("<details"))).toBe(true);
  });
  it("shows a class's own lines, and its pairing with the species picked", () => {
    const html = renderToStaticMarkup(
      <ClassStep classes={classList} chosen={null} onChoose={() => undefined} matchups={matchups} species="bigfoot" />,
    );
    expect(html).toContain("Together:");
    expect(html).toContain("A Thornguard bigfoot is steady as a boulder against big, hard-hitting things.");
    expect(html).toContain("Good at:");
  });

  it("renders the class cards exactly as before without matchups", () => {
    const without = renderToStaticMarkup(<ClassStep classes={classList} chosen={null} onChoose={() => undefined} />);
    expect(without).not.toContain("creation-notes");
  });
});
