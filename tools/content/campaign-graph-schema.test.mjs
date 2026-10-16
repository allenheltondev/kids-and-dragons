/**
 * schemas/campaign.schema.json against graph campaigns (#192).
 *
 * The schema is the first half of the content gate and the only half an
 * editor sees as you type, so it has to accept the declaration the authoring
 * doc teaches and refuse the shapes the doc says do not exist. It is judged
 * here with the same ajv settings `content:validate` uses (strict, 2020-12),
 * against the Rift Sampler — the illustrative fixture, which deliberately
 * lives outside content/ so nothing ships it — and against both campaigns
 * that do ship, which must still pass untouched: an optional `graph` that
 * broke an ordered campaign would be a Gemfall regression, not a feature.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (...parts) => JSON.parse(readFileSync(join(REPO, ...parts), "utf8"));
const FIXTURE = ["packages", "shared", "src", "fixtures", "rift-sampler.campaign.json"];

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(read("schemas", "campaign.schema.json"));

/** The schema's verdict, with its errors as `path message` lines for a readable failure. */
function judge(campaign) {
  const ok = validate(campaign);
  return { ok, errors: (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`) };
}

function bent(mutate) {
  const campaign = read(...FIXTURE);
  mutate(campaign);
  return judge(campaign);
}

describe("the shipped ordered campaigns", () => {
  it.each(["gemfall", "the-hollow-crown"])("%s still validates, with no graph", (id) => {
    const campaign = read("content", "campaigns", `${id}.json`);
    expect(campaign.graph).toBeUndefined();
    const { ok, errors } = judge(campaign);
    expect(ok, errors.join("\n")).toBe(true);
  });
});

describe("the Rift Sampler", () => {
  it("validates", () => {
    const { ok, errors } = judge(read(...FIXTURE));
    expect(ok, errors.join("\n")).toBe(true);
  });

  it("is not content: no campaigns/ file carries it", () => {
    // The loader and content:validate read content/campaigns/*.json and
    // nothing else, so living outside it is what keeps the fixture off the
    // lobby. Guard the obvious way it could end up there.
    const { id } = read(...FIXTURE);
    expect(() => read("content", "campaigns", `${id}.json`)).toThrow();
  });
});

describe("the Rift Lifecycle (#196)", () => {
  const LIFECYCLE = ["packages", "shared", "src", "fixtures", "rift-lifecycle.campaign.json"];

  it("validates: every rift property, as the schema knows them", () => {
    const { ok, errors } = judge(read(...LIFECYCLE));
    expect(ok, errors.join("\n")).toBe(true);
  });

  it("is not content either", () => {
    const { id } = read(...LIFECYCLE);
    expect(() => read("content", "campaigns", `${id}.json`)).toThrow();
  });
});

describe("what the schema refuses", () => {
  it("a version this build does not read", () => {
    expect(bent((c) => (c.graph.version = 2)).ok).toBe(false);
  });

  it("a graph missing entry, nodes or edges", () => {
    for (const key of ["entry", "nodes", "edges", "version"]) {
      expect(bent((c) => delete c.graph[key]).ok, key).toBe(false);
    }
  });

  it("an edge kind that is not forward, sideways or return", () => {
    expect(bent((c) => (c.graph.edges["to-orchard"].kind = "backward")).ok).toBe(false);
  });

  it("a revisit policy it does not know", () => {
    expect(bent((c) => (c.graph.nodes.quarry.revisit = "sometimes")).ok).toBe(false);
  });

  it("the reserved extension names until their issues define them", () => {
    // #196 defined `rift`, closed like everything else: a property it does
    // not define is refused, so an author cannot use one early.
    expect(bent((c) => (c.graph.edges["to-orchard"].rift = { type: "one-way" })).ok).toBe(false);
    expect(bent((c) => (c.graph.nodes.quarry.state = {})).ok).toBe(false);
  });

  it("a rift whose properties are not the ones #196 defines", () => {
    const rift = (value) => bent((c) => (c.graph.edges["to-orchard"].rift = value)).ok;
    expect(rift({})).toBe(true);
    expect(rift({ uses: 0 })).toBe(false);
    expect(rift({ uses: 1.5 })).toBe(false);
    expect(rift({ lasts: { unit: "turns", count: 2 } })).toBe(false);
    expect(rift({ lasts: { unit: "visits" } })).toBe(false);
    expect(rift({ unstable: {} })).toBe(false);
    expect(rift({ unstable: { flicker: { open: 1 } } })).toBe(false);
    expect(rift({ reveal: "sometimes" })).toBe(false);
    expect(rift({ oneWay: false })).toBe(false);
    expect(rift({ persistent: false })).toBe(false);
    expect(rift({ linkedTo: "Not An Id" })).toBe(false);
    expect(rift({ opensWhen: { item: "lens" } })).toBe(false);
  });

  it("a guard that reads the party rather than the journey", () => {
    // `item` is a chapter Condition field. A graph decision must come out the
    // same on any evening, for any phones, so it is not one here.
    expect(bent((c) => (c.graph.edges["to-orchard"].when = { item: "lens" })).ok).toBe(false);
  });

  it("an effect it does not know, or one missing its target", () => {
    expect(bent((c) => (c.graph.edges["to-orchard"].effects = [{ type: "grantItem", itemId: "x" }])).ok).toBe(false);
    expect(bent((c) => (c.graph.edges["to-orchard"].effects = [{ type: "unlock" }])).ok).toBe(false);
  });

  it("a malformed node or edge id", () => {
    expect(bent((c) => (c.graph.nodes["Big Hall"] = { chapter: "sampler-tower" })).ok).toBe(false);
  });

  it("locked, once and irreversible as anything but true", () => {
    for (const key of ["locked", "once", "irreversible"]) {
      expect(bent((c) => (c.graph.edges["to-orchard"][key] = false)).ok, key).toBe(false);
    }
  });
});

describe("world state (#198)", () => {
  const WORLD = ["packages", "shared", "src", "fixtures", "world-state.campaign.json"];
  const world = (mutate) => {
    const campaign = read(...WORLD);
    mutate(campaign);
    return judge(campaign);
  };

  it("the Ash Wyrm Sampler validates", () => {
    const { ok, errors } = judge(read(...WORLD));
    expect(ok, errors.join("\n")).toBe(true);
  });

  it("is not content either", () => {
    expect(() => read("content", "campaigns", `${read(...WORLD).id}.json`)).toThrow();
  });

  it("refuses a fact of a type or domain it does not know, or with another type's fields", () => {
    expect(world((c) => (c.graph.facts["ford-path"].type = "maybe")).ok).toBe(false);
    expect(world((c) => (c.graph.facts["ford-path"].domain = "weather")).ok).toBe(false);
    expect(world((c) => (c.graph.facts["river-folk"].values = ["a", "b"])).ok).toBe(false);
    expect(world((c) => delete c.graph.facts["mill-village"].initial).ok).toBe(false);
    expect(world((c) => (c.graph.facts["mill-village"].values = ["standing"])).ok).toBe(false);
    expect(world((c) => (c.graph.facts["ford-path"].visible = false)).ok).toBe(false);
  });

  it("refuses fact effects without their value, and an adjustment of nothing", () => {
    expect(world((c) => (c.graph.edges["to-village"].effects = [{ type: "setFact", fact: "ford-path" }])).ok).toBe(false);
    expect(world((c) => (c.graph.edges["to-village"].effects = [{ type: "adjustFact", fact: "river-folk", by: 0 }])).ok).toBe(false);
  });

  it("refuses a fact test with a key it does not know, and a visit ordinal below 1", () => {
    expect(world((c) => (c.graph.edges["to-village"].when = { facts: { "river-folk": { above: 1 } } })).ok).toBe(false);
    expect(world((c) => (c.graph.edges["to-village"].when = { visit: { min: 0 } })).ok).toBe(false);
    expect(world((c) => (c.graph.edges["to-village"].when = { visit: {} })).ok).toBe(false);
  });

  it("refuses a variant revisit of closed, and a completion rule with no effects", () => {
    expect(world((c) => (c.graph.nodes.village.variants[0].revisit = "closed")).ok).toBe(false);
    expect(world((c) => (c.graph.nodes.lair.onComplete = [{ when: { outcome: "success" } }])).ok).toBe(false);
  });
});

describe("rift actions (#197)", () => {
  const ACTIONS = ["packages", "shared", "src", "fixtures", "rift-actions.campaign.json"];
  const ferry = (mutate) => {
    const campaign = read(...ACTIONS);
    mutate(campaign);
    return judge(campaign);
  };

  it("the Ferry Rift validates: effects, redirects, actions and a fallback, as the schema knows them", () => {
    const { ok, errors } = judge(read(...ACTIONS));
    expect(ok, errors.join("\n")).toBe(true);
  });

  it("is not content either", () => {
    expect(() => read("content", "campaigns", `${read(...ACTIONS).id}.json`)).toThrow();
  });

  it("knows each rift effect's shape: an edge, and for a redirect where to", () => {
    for (const type of ["discoverRift", "openRift", "closeRift", "stabilizeRift"]) {
      expect(ferry((c) => (c.graph.edges["isle-to-harbor"].effects = [{ type, edge: "ferry-rift" }])).ok, type).toBe(true);
      expect(ferry((c) => (c.graph.edges["isle-to-harbor"].effects = [{ type }])).ok, type).toBe(false);
    }
    expect(ferry((c) => (c.graph.edges["isle-to-harbor"].effects = [{ type: "redirectRift", edge: "ferry-rift" }])).ok).toBe(false);
    expect(ferry((c) => (c.graph.edges["isle-to-harbor"].effects = [{ type: "openRift", edge: "ferry-rift", to: "cove" }])).ok).toBe(false);
  });

  it("refuses an action it does not know, a rule with keys it does not know, and fallback as anything but true", () => {
    // `requires` is class gating's (#199): the shape it defines, and nothing else.
    expect(ferry((c) => (c.graph.edges["ferry-rift"].rift.actions.teleport = {})).ok).toBe(false);
    expect(ferry((c) => (c.graph.edges["ferry-rift"].rift.actions.redirect.requires = { class: "wizard" })).ok).toBe(false);
    expect(ferry((c) => (c.graph.edges["ferry-rift"].rift.actions.redirect.colour = "red")).ok).toBe(false);
    expect(ferry((c) => (c.graph.edges["ferry-rift"].rift.actions = {})).ok).toBe(false);
    expect(ferry((c) => (c.graph.edges["ferry-rift"].rift.redirects = [])).ok).toBe(false);
    expect(ferry((c) => (c.graph.edges["harbor-row"].fallback = false)).ok).toBe(false);
  });
});

describe("temporary buffs (#200)", () => {
  const BUFFS = ["packages", "shared", "src", "fixtures", "rift-buffs.campaign.json"];
  const buffs = (mutate) => {
    const campaign = read(...BUFFS);
    mutate(campaign);
    return judge(campaign);
  };

  it("the Humming Spring validates: every kind, duration, stacking mode, target and expiry", () => {
    const { ok, errors } = judge(read(...BUFFS));
    expect(ok, errors.join("\n")).toBe(true);
  });

  it("is not content either", () => {
    expect(() => read("content", "campaigns", `${read(...BUFFS).id}.json`)).toThrow();
  });

  it("refuses a buff of a kind, target, stacking or expiry it does not know, and unbounded numbers", () => {
    expect(buffs((c) => (c.graph.buffs["rift-shield"].kind = "speed")).ok).toBe(false);
    expect(buffs((c) => (c.graph.buffs["rift-shield"].target = "all")).ok).toBe(false);
    expect(buffs((c) => (c.graph.buffs["rift-shield"].stack = "merge")).ok).toBe(false);
    expect(buffs((c) => (c.graph.buffs["rift-shield"].expiresOn = ["dawn"])).ok).toBe(false);
    expect(buffs((c) => (c.graph.buffs["rift-shield"].amount = 0)).ok).toBe(false);
    expect(buffs((c) => (c.graph.buffs["rift-shield"].amount = 9)).ok).toBe(false);
    expect(buffs((c) => (c.graph.buffs["rift-shield"].duration = { scope: "encounters", count: 9 })).ok).toBe(false);
    expect(buffs((c) => (c.graph.buffs["rift-shield"].duration = { scope: "encounters" })).ok).toBe(false);
    expect(buffs((c) => (c.graph.buffs["rift-shield"].duration = { scope: "forever" })).ok).toBe(false);
    expect(buffs((c) => (c.graph.buffs["rift-shield"].glow = true)).ok).toBe(false);
  });

  it("refuses a grantBuff without its buff", () => {
    expect(buffs((c) => (c.graph.edges["camp-to-den"].effects = [{ type: "grantBuff" }])).ok).toBe(false);
  });
});

describe("story-check buffs (#222)", () => {
  const SPARK = ["packages", "shared", "src", "fixtures", "rift-spark.campaign.json"];
  const spark = (mutate) => {
    const campaign = read(...SPARK);
    mutate(campaign);
    return judge(campaign);
  };

  it("the Glowing Falls validates: appliesTo, spend, a uses duration, the chapter expiry and firstCrossing", () => {
    const { ok, errors } = judge(read(...SPARK));
    expect(ok, errors.join("\n")).toBe(true);
  });

  it("is not content either", () => {
    expect(() => read("content", "campaigns", `${read(...SPARK).id}.json`)).toThrow();
  });

  it("refuses what it does not know: another appliesTo, spend or scope, uses without a count, firstCrossing as false", () => {
    expect(spark((c) => (c.graph.buffs.riftspark.appliesTo = "both")).ok).toBe(false);
    expect(spark((c) => (c.graph.buffs.riftspark.spend = "later")).ok).toBe(false);
    expect(spark((c) => (c.graph.buffs.riftspark.duration = { scope: "uses" })).ok).toBe(false);
    expect(spark((c) => (c.graph.buffs.riftspark.duration = { scope: "uses", count: 6 })).ok).toBe(false);
    expect(spark((c) => (c.graph.buffs.riftspark.expiresOn = ["dusk"])).ok).toBe(false);
    expect(spark((c) => (c.graph.edges["camp-to-grove"].effects[0].firstCrossing = false)).ok).toBe(false);
  });
});

describe("class rift interaction (#199)", () => {
  const CLASSES = ["packages", "shared", "src", "fixtures", "rift-classes.campaign.json"];
  const sealed = (mutate) => {
    const campaign = read(...CLASSES);
    mutate(campaign);
    return judge(campaign);
  };
  const open = (c) => c.graph.edges["veil-rift"].rift.actions.open;

  it("the Sealed Rift validates: lists of ways, a lone named way, requires and hints", () => {
    const { ok, errors } = judge(read(...CLASSES));
    expect(ok, errors.join("\n")).toBe(true);
  });

  it("is not content either", () => {
    expect(() => read("content", "campaigns", `${read(...CLASSES).id}.json`)).toThrow();
  });

  it("knows a requirement's shape: real classes, item ids, at least one of them, nothing else", () => {
    expect(sealed((c) => (open(c)[1].requires = { anyClass: ["starweaver", "songkeeper"], anyItem: ["luckstone"] })).ok).toBe(true);
    expect(sealed((c) => (open(c)[1].requires = { anyClass: ["wizard"] })).ok).toBe(false);
    expect(sealed((c) => (open(c)[1].requires = { anyClass: [] })).ok).toBe(false);
    expect(sealed((c) => (open(c)[1].requires = { anyClass: ["thornguard", "thornguard"] })).ok).toBe(false);
    expect(sealed((c) => (open(c)[1].requires = {})).ok).toBe(false);
    expect(sealed((c) => (open(c)[1].requires = { species: ["unicorn"] })).ok).toBe(false);
    expect(sealed((c) => (open(c)[1].requires = { anyItem: ["Not An Id"] })).ok).toBe(false);
  });

  it("knows a way's id and hint, and a list of ways is never empty", () => {
    expect(sealed((c) => (open(c)[1].id = "Force Open")).ok).toBe(false);
    expect(sealed((c) => (open(c)[1].hint = "")).ok).toBe(false);
    expect(sealed((c) => (c.graph.edges["veil-rift"].rift.actions.open = [])).ok).toBe(false);
  });
});
