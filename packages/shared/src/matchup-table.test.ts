/**
 * The shipped matchup table (content/rules.json -> matchups) holds the design
 * rules from docs/matchups.md: every species has a plus and a minus, nothing is
 * bigger than 2, ids are unique and real, and no class is best or worst against
 * everything.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { MatchupEdge } from "./types/matchups.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "rules.json"), "utf8"));
const abilities = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "abilities.json"), "utf8"));

const TRAITS = ["armored", "thorny", "skittish", "flier", "swarming", "fiery", "frozen", "slippery", "ghostly", "hulking"];
const TAGS = ["sneak", "force", "climb", "charm", "swim", "search"];
const SPECIES = Object.keys(rules.species);
const CLASSES = Object.keys(rules.classes);

const edges: MatchupEdge[] = rules.matchups.edges;
const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
/** Positive helps the hero. A defend roll is the foe's, so negative helps. */
const sign = (e: MatchupEdge): number => {
  const roll = e.on === "defend" ? -(e.roll ?? 0) : (e.roll ?? 0);
  return Math.sign(roll + (e.damage ?? 0));
};

describe("matchup table", () => {
  it("defines all six check tags", () => {
    expect(Object.keys(rules.matchups.checkTags).sort()).toEqual([...TAGS].sort());
    for (const t of Object.values<any>(rules.matchups.checkTags)) {
      expect(t.name).toBeTruthy();
      expect(t.text).toBeTruthy();
    }
  });

  it("has unique snake_case ids and a sentence of text", () => {
    const ids = edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of edges) {
      expect(e.id).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(e.text.length).toBeGreaterThan(10);
      expect(e.text).not.toMatch(/\d/);
    }
  });

  it("keeps magnitudes at 1 or 2 and gives every edge an effect", () => {
    for (const e of edges) {
      expect(Math.abs(e.roll ?? 0), e.id).toBeLessThanOrEqual(2);
      expect(Math.abs(e.damage ?? 0), e.id).toBeLessThanOrEqual(2);
      expect(Math.abs(e.roll ?? 0) + Math.abs(e.damage ?? 0), e.id).toBeGreaterThan(0);
      if (e.damage !== undefined) {
        expect(e.on, e.id).toBe("attack");
        expect(e.damage, e.id).toBeGreaterThan(0);
      }
    }
  });

  it("names only moves that roll an attack on an attack edge", () => {
    const rollsAttack = (id: string): boolean =>
      id === "attack" ||
      (abilities.abilities[id]?.effects ?? []).some((e: { effect?: { type?: string } }) => e.effect?.type === "attack");
    // Shove pushes, Bramble Wall makes terrain, Tanglelight roots, Vanish dodges:
    // an attack edge on any of them would promise a boost nothing ever pays.
    for (const never of ["shove", "bramble_wall", "tanglelight", "vanish", "glimmer", "starfall"]) {
      expect(rollsAttack(never), never).toBe(false);
    }
    for (const e of edges.filter((x) => x.on === "attack")) {
      for (const id of list(e.ability)) expect(rollsAttack(id), `${e.id} names ${id}`).toBe(true);
    }
  });

  it("references only real traits, tags, abilities, species and classes", () => {
    const abilityIds = new Set([
      "attack",
      ...Object.keys(abilities.abilities),
      ...SPECIES,
      ...CLASSES,
    ]);
    for (const e of edges) {
      for (const t of list(e.foe)) expect(TRAITS, e.id).toContain(t);
      for (const t of list(e.tag)) expect(TAGS, e.id).toContain(t);
      for (const a of list(e.ability)) expect(abilityIds.has(a), `${e.id}: ${a}`).toBe(true);
      for (const s of list(e.hero.species)) expect(SPECIES, e.id).toContain(s);
      for (const c of list(e.hero.class)) expect(CLASSES, e.id).toContain(c);
      if (e.on === "check") {
        expect(list(e.tag).length, e.id).toBeGreaterThan(0);
      } else {
        expect(list(e.foe).length, e.id).toBeGreaterThan(0);
      }
    }
  });

  it("gives every species at least one plus and one minus", () => {
    for (const s of SPECIES) {
      const own = edges.filter((e) => list(e.hero.species).includes(s) && !e.hero.class);
      expect(own.some((e) => sign(e) > 0), `${s} plus`).toBe(true);
      expect(own.some((e) => sign(e) < 0), `${s} minus`).toBe(true);
    }
  });

  it("gives every class pluses and minuses, and each trait two class pluses and a minus", () => {
    const classEdges = edges.filter((e) => e.hero.class && !e.hero.species);
    for (const c of CLASSES) {
      const own = classEdges.filter((e) => list(e.hero.class).includes(c));
      expect(own.some((e) => sign(e) > 0), `${c} plus`).toBe(true);
      expect(own.some((e) => sign(e) < 0), `${c} minus`).toBe(true);
    }
    for (const trait of TRAITS) {
      const about = classEdges.filter((e) => list(e.foe).includes(trait));
      const plus = new Set(about.filter((e) => sign(e) > 0).flatMap((e) => list(e.hero.class)));
      const minus = new Set(about.filter((e) => sign(e) < 0).flatMap((e) => list(e.hero.class)));
      expect(plus.size, `${trait} plus classes`).toBeGreaterThanOrEqual(2);
      expect(minus.size, `${trait} minus classes`).toBeGreaterThanOrEqual(1);
    }
  });

  it("makes every pairing a plus naming both species and class", () => {
    const pairings = edges.filter((e) => e.hero.species || e.hero.class).filter((e) => e.hero.species && e.hero.class);
    expect(pairings.length).toBeGreaterThanOrEqual(6);
    expect(pairings.length).toBeLessThanOrEqual(10);
    for (const e of pairings) expect(sign(e), e.id).toBeGreaterThan(0);
  });
});
