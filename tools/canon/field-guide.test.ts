/**
 * The field guide is the one canon projection a player reads, so these tests
 * are about what must never be in it, and about the guide agreeing with itself.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadCanon } from "@kad/canon";
import { buildFieldGuide } from "./field-guide-build.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const registry = loadCanon(path.join(REPO, "canon"));
const exists = (rel: string): boolean => existsSync(path.join(REPO, "assets", rel));

const { guide, report } = buildFieldGuide(registry, exists);

/** Fields that are the storyteller's, never the player's. */
const FORBIDDEN = [
  "hidden_truths",
  "canon_constraints",
  "common_story_uses",
  "agent_instructions",
  "visual_identity",
  "standard_behavior",
  "canon_note",
  "notes",
  "tags",
  "canon_status",
  "current_tensions",
  "historical_hooks",
  "encounter",
  "stats",
  "band",
  "speech_register",
];

function keysDeep(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keysDeep(child, into);
    }
  }
  return into;
}

describe("field guide", () => {
  it("gives every published entry its delivered illustration", () => {
    for (const entry of Object.values(guide.entries)) {
      // A class has no picture in the guide, on purpose: the client draws its
      // painted badge, and the room's painting would give the room away.
      if (entry.kind === "class") continue;
      expect(entry.art, `${entry.id} must not silently render a category glyph`).toBeDefined();
      expect(exists(entry.art!.replace(/^\/assets\//, "")), entry.id).toBe(true);
    }
  });

  it("covers every kind of thing a player can meet", () => {
    const categories = new Set(Object.values(guide.entries).map((e) => e.category));
    expect([...categories].sort()).toEqual(["classes", "creatures", "factions", "folk", "peoples", "places"]);
    // Bandless creatures are in too, not just the fightable ones.
    expect(guide.entries["creature.embermoth"]).toBeDefined();
  });

  it("never emits a storyteller-only key, anywhere in the output", () => {
    const keys = keysDeep(JSON.parse(JSON.stringify(guide)));
    for (const forbidden of FORBIDDEN) expect(keys.has(forbidden), forbidden).toBe(false);
  });

  it("never leaks the text of a hidden truth or a canon constraint", () => {
    const text = JSON.stringify(guide);
    for (const entity of registry.byId.values()) {
      const loose = entity as unknown as {
        canon_constraints?: string;
        lore?: { hidden_truths?: string[] };
      };
      for (const secret of [loose.canon_constraints, ...(loose.lore?.hidden_truths ?? [])]) {
        if (secret && secret.length > 20) expect(text.includes(secret)).toBe(false);
      }
    }
  });

  it("keys each entry by its own canon id", () => {
    for (const [key, entry] of Object.entries(guide.entries)) expect(entry.id).toBe(key);
  });

  it("resolves every opinion target to an entry", () => {
    // Regional relationships may point at features and routes, which the guide
    // does not carry; they are reported below instead.
    const broken = report.unresolved.filter((u) => !u.field.startsWith("regional_"));
    expect(broken).toEqual([]);
    for (const entry of Object.values(guide.entries)) {
      const targets = [
        ...(entry.lore?.likes ?? []),
        ...(entry.lore?.dislikes ?? []),
        ...(entry.likedBy ?? []),
        ...(entry.dislikedBy ?? []),
      ].map((o) => o.of);
      for (const target of targets) expect(guide.entries[target], `${entry.id} -> ${target}`).toBeDefined();
    }
  });

  it("only reports unresolved regional links that point at features or routes", () => {
    for (const u of report.unresolved) {
      expect(u.to).toMatch(/^(feature|route)\./);
    }
  });

  it("indexes the reverse of every like", () => {
    for (const entry of Object.values(guide.entries)) {
      for (const like of entry.lore?.likes ?? []) {
        const target = guide.entries[like.of];
        expect(target?.likedBy?.some((r) => r.of === entry.id && r.because === like.because)).toBe(true);
      }
    }
  });

  it("is deterministic, down to key order", () => {
    const again = buildFieldGuide(loadCanon(path.join(REPO, "canon")), exists);
    expect(JSON.stringify(again.guide)).toBe(JSON.stringify(guide));
    const ids = Object.keys(guide.entries);
    const order = ["creatures", "peoples", "classes", "folk", "places", "factions"];
    const sorted = [...ids].sort(
      (a, b) =>
        order.indexOf(guide.entries[a]!.category) - order.indexOf(guide.entries[b]!.category) ||
        a.localeCompare(b),
    );
    expect(ids).toEqual(sorted);
  });

  it("offers non-combat tips only as kind and text", () => {
    const withTips = Object.values(guide.entries).filter((e) => e.tips);
    expect(withTips.length).toBeGreaterThan(0);
    for (const entry of withTips) {
      for (const tip of entry.tips!) expect(Object.keys(tip).sort()).toEqual(["kind", "text"]);
    }
  });

  it("reports the entities that have no lore yet", () => {
    for (const id of report.withoutLore) {
      const entry = guide.entries[id]!;
      expect(entry.lore ?? entry.place).toBeUndefined();
    }
    // Printed so a failing run (or `--reporter verbose`) shows the backlog.
    console.info(`field guide: ${report.withoutLore.length} without lore: ${report.withoutLore.join(", ")}`);
  });

  describe("classes and their class places", () => {
    const CLASSES = {
      "class.thornguard": { home: "location.dojo", title: "The Dojo", gear: "a thorn bracer" },
      "class.starweaver": { home: "location.academy", title: "The Academy", gear: "a star circlet" },
      "class.duskrunner": { home: "location.rookery", title: "The Rookery", gear: "a dusk hood" },
      "class.songkeeper": { home: "location.conservatory", title: "The Conservatory", gear: "a song bell on a cord" },
    } as const;

    it("has an entry for each of the four classes, each with its role, gear and three distinctions", () => {
      for (const [id, want] of Object.entries(CLASSES)) {
        const entry = guide.entries[id]!;
        expect(entry, id).toBeDefined();
        expect(entry.category).toBe("classes");
        expect(entry.kind).toBe("class");
        expect(entry.class?.gear).toBe(want.gear);
        expect(entry.class?.role).toBeTruthy();
        expect(entry.class?.distinctions.map((d) => d.rank)).toEqual(["apprentice", "expert", "master"]);
        for (const d of entry.class!.distinctions) expect(d.move.length).toBeGreaterThan(0);
      }
    });

    it("points each class at its place, and that place is in the guide with the room's painting", () => {
      for (const [id, want] of Object.entries(CLASSES)) {
        const entry = guide.entries[id]!;
        expect(entry.class?.home).toBe(want.home);
        expect(entry.class?.homeTitle).toBe(want.title);
        const place = guide.entries[want.home]!;
        expect(place, want.home).toBeDefined();
        expect(place.category).toBe("places");
        expect(place.title).toBe(want.title);
        expect(place.art).toMatch(/^\/assets\/scenes\/classes\/\w+\.webp$/);
      }
    });

    it("shows a class entry no picture of its place, so the room is not given away", () => {
      for (const id of Object.keys(CLASSES)) expect(guide.entries[id]!.art).toBeUndefined();
    });

    it("gives a class place no map pin: it is a side room, with no anchor to show", () => {
      const world = JSON.parse(readFileSync(path.join(REPO, "content", "world.json"), "utf8")) as {
        places: Record<string, unknown>;
      };
      for (const { home } of Object.values(CLASSES)) expect(world.places[home.split(".")[1]!], home).toBeUndefined();
      for (const entry of Object.values(guide.entries)) {
        expect(Object.keys(entry), entry.id).not.toContain("map_anchor");
      }
    });

    it("leaks nothing of the Rookery's constraint line", () => {
      expect(JSON.stringify(guide)).not.toContain("no crow is named");
    });

    it("is deterministic with the shipped content/field-guide.json", () => {
      const shipped = JSON.parse(readFileSync(path.join(REPO, "content", "field-guide.json"), "utf8")) as {
        entries: unknown;
      };
      expect(JSON.stringify(shipped.entries)).toBe(JSON.stringify(guide.entries));
    });
  });
});
