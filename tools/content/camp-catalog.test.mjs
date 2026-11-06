/**
 * The camp catalog's rules (#618, camp-catalog.mjs): the shipped catalog
 * passes, and every rule has a failing case. The rules are called directly on
 * the real catalog, manifest and chapters with one thing broken; the gate
 * itself is run over a copy of the tree for the schema and for a chapter's
 * find, so a malformed catalog or find fails `npm run content:validate`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MILESTONE_KIT_PIECES } from "../../packages/shared/src/camp-milestones.ts";
import { campCatalogProblems, chapterFinds } from "./camp-catalog.mjs";
import { cleanup, copyTree, readJson, REPO, validate, writeJson } from "./validate-harness.mjs";

afterAll(cleanup, 60_000);

const json = (...parts) => JSON.parse(readFileSync(join(REPO, ...parts), "utf8"));
const CATALOG = json("content", "camp.json");
const MANIFEST = json("assets", "manifest.json").camp;
const CAST_FIGURES = json("assets", "manifest.json").castFigures;
const CHAPTERS = new Map(
  readdirSync(join(REPO, "content", "chapters"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => json("content", "chapters", f))
    .map((chapter) => [chapter.id, chapter]),
);
const CAMPAIGNS = new Set(
  readdirSync(join(REPO, "content", "campaigns"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => json("content", "campaigns", f).id),
);

/** The problems with the shipped data after `mutate` breaks one thing in a copy of it. */
function problems(mutate = () => {}) {
  const input = {
    catalog: structuredClone(CATALOG),
    manifest: structuredClone(MANIFEST),
    chapters: new Map([...CHAPTERS].map(([id, chapter]) => [id, structuredClone(chapter)])),
    campaigns: new Set(CAMPAIGNS),
    milestones: structuredClone(MILESTONE_KIT_PIECES),
    castFigures: structuredClone(CAST_FIGURES),
  };
  mutate(input);
  return campCatalogProblems(input).map((p) => `${p.file}${p.at}: ${p.problem}${p.hint ? ` (${p.hint})` : ""}`);
}

const piece = (catalog, id) => catalog.crewPieces.find((p) => p.id === id);
const deco = (catalog, id) => catalog.kit.decorations.find((d) => d.id === id);
/** Put `effects` on the entry scene of `chapterId`. */
const findIn = (chapters, chapterId, ...effects) => {
  const chapter = chapters.get(chapterId);
  const entry = chapter.scenes[chapter.entry];
  entry.onEnter = [...(entry.onEnter ?? []), ...effects];
  return chapter;
};
const camp = (pieceId, rewardId) => ({ type: "findForCamp", pieceId, rewardId });
const kit = (pieceId, rewardId) => ({ type: "findForKit", pieceId, rewardId });

describe("the shipped catalog", () => {
  it("passes, with the first chapters' finds where #622 authored them", () => {
    expect(problems()).toEqual([]);
    const shipped = [...CHAPTERS.values()]
      .flatMap((chapter) => chapterFinds(chapter).map(({ effect, at }) => `${chapter.id}${at.replace(/\/\d+$/, "")} ${effect.type} ${effect.rewardId}`))
      .sort();
    expect(shipped).toEqual([
      "first-steps-01/scenes/rest_picnic/onEnter findForCamp first-steps-01.picnic_blanket",
      "first-steps-01/scenes/rest_ready/onEnter findForKit first-steps-01.clipboard_star",
      "gemfall-01/scenes/interaction_lantern_pole/onEnter findForCamp gemfall-01.wagon_lantern",
      "gemfall-01/scenes/interaction_quay_line/onEnter findForKit gemfall-01.lamp_ribbon",
      "riftlight-exchange-rift/scenes/awning_flap/onEnter findForCamp riftlight-exchange-rift.noodle_awning",
      "riftlight-exchange-rift/scenes/awning_up/onEnter findForCamp riftlight-exchange-rift.noodle_awning",
      "riftlight-exchange-rift/scenes/trail_found/onEnter findForKit riftlight-exchange-rift.gull_feather",
      "riftlight-exchange-rift/scenes/trail_lost/onEnter findForKit riftlight-exchange-rift.gull_feather",
    ]);
  });

  it("prices every starter piece at 5 and every stage-2 piece at 10 to 15", () => {
    const shop = CATALOG.crewPieces.filter((p) => p.group === "shop");
    expect(shop.filter((p) => p.stage === 1).map((p) => p.price)).toEqual([5, 5, 5, 5]);
    for (const p of shop.filter((p) => p.stage === 2)) expect(p.price).toBeGreaterThanOrEqual(10), expect(p.price).toBeLessThanOrEqual(15);
  });
});

describe("finds in chapters", () => {
  it("accepts a find through its offer, on every way into its place", () => {
    expect(
      problems(({ chapters }) => {
        const chapter = findIn(chapters, "riftlight-exchange-rift", camp("find_noodle_awning", "riftlight-exchange-rift.noodle_awning"));
        // A second way in, offering the same find under the same reward id.
        const other = Object.keys(chapter.scenes).find((id) => id !== chapter.entry);
        chapter.scenes[other].onEnter = [...(chapter.scenes[other].onEnter ?? []), camp("find_noodle_awning", "riftlight-exchange-rift.noodle_awning")];
        findIn(chapters, "gemfall-01", kit("deco_lamp_ribbon", "gemfall-01.lamp_ribbon"));
      }),
    ).toEqual([]);
  });

  it.each([
    ["a findForCamp naming no crew piece", camp("find_rubber_duck", "gemfall-01.wagon_lantern"), 'findForCamp names "find_rubber_duck", which is not a crew piece'],
    ["a findForCamp naming a kit piece", camp("deco_lamp_ribbon", "gemfall-01.lamp_ribbon"), "use findForKit"],
    ["a findForKit naming a crew piece", kit("find_wagon_lantern", "gemfall-01.wagon_lantern"), "use findForCamp"],
    ["a find of a shop piece", camp("shop_log_bench", "gemfall-01.wagon_lantern"), "a shop piece; a chapter hands over only find pieces"],
    ["a find of a free catalog decoration", kit("deco_bunting", "gemfall-01.lamp_ribbon"), "a catalog piece"],
    ["a reward id that is no offer of the piece", camp("find_wagon_lantern", "gemfall-01.lantern"), '"gemfall-01.lantern" is not an offer of "find_wagon_lantern"'],
    ["another piece's reward id", camp("find_wagon_lantern", "gemfall-01.lamp_ribbon"), "is not an offer of"],
    ["another place's reward id", camp("find_picnic_blanket", "first-steps-01.picnic_blanket"), "is first-steps-01's offer, not gemfall-01's"],
  ])("rejects %s", (_label, effect, message) => {
    const found = problems(({ chapters }) => findIn(chapters, "gemfall-01", effect));
    expect(found.join("\n")).toContain(message);
    expect(found.every((p) => p.startsWith("content/chapters/gemfall-01.json/scenes/"))).toBe(true);
  });

  it("finds a find wherever a chapter puts it: a choice, a branch", () => {
    const found = problems(({ chapters }) => {
      const chapter = chapters.get("bramblewood-01");
      const scene = Object.values(chapter.scenes).find((s) => s.choices?.length);
      scene.choices[0].effects = [camp("nope", "x")];
    });
    expect(found.join("\n")).toMatch(/bramblewood-01\.json\/scenes\/[^/]+\/choices\/0\/effects\/0\/pieceId/);
  });

  it("rejects a piece offered twice in one place: every way in shares one reward id", () => {
    const found = problems(({ catalog }) => {
      piece(catalog, "find_noodle_awning").offers.push({ rewardId: "riftlight-exchange-rift.second_awning", chapter: "riftlight-exchange-rift" });
    });
    expect(found.join("\n")).toContain('"find_noodle_awning" has two offers in riftlight-exchange-rift');
  });

  it("rejects one reward id for two offers, and an offer in no chapter", () => {
    expect(problems(({ catalog }) => (deco(catalog, "deco_lamp_ribbon").offers[0].rewardId = "gemfall-01.wagon_lantern")).join("\n")).toContain(
      'reward id "gemfall-01.wagon_lantern" is already the offer of "find_wagon_lantern"',
    );
    expect(problems(({ catalog }) => (piece(catalog, "find_wagon_lantern").offers[0].chapter = "gemfall-99")).join("\n")).toContain('no chapter "gemfall-99"');
  });
});

describe("the catalog against its art", () => {
  it("rejects a catalog id the manifest does not declare, and a declared piece the catalog leaves out", () => {
    expect(problems(({ catalog }) => catalog.crewPieces.push({ id: "shop_disco_ball", hotspot: "lanterns", group: "shop", stage: 1, price: 5 })).join("\n")).toContain(
      'crew piece "shop_disco_ball" is not declared in assets/manifest.json',
    );
    expect(problems(({ catalog }) => (catalog.crewPieces = catalog.crewPieces.filter((p) => p.id !== "trophy_gemfall"))).join("\n")).toContain(
      'camp.crewPieces declares "trophy_gemfall", which the catalog does not list',
    );
    expect(problems(({ catalog }) => (catalog.kit.decorations = catalog.kit.decorations.filter((d) => d.id !== "deco_pinwheel"))).join("\n")).toContain(
      'camp.decorations declares "deco_pinwheel"',
    );
    expect(problems(({ catalog }) => (catalog.kit.tents = catalog.kit.tents.filter((t) => t.id !== "mythic"))).join("\n")).toContain('camp.tentStyles declares "mythic"');
    expect(problems(({ catalog }) => catalog.kit.styles.pop()).join("\n")).toContain('camp.kitStyles declares "patched"');
  });

  it("rejects a piece whose hotspot, group, painted chapter or campaign disagrees with its art", () => {
    expect(problems(({ catalog }) => (piece(catalog, "shop_log_bench").hotspot = "awning")).join("\n")).toContain('"shop_log_bench" stands at "awning"');
    expect(problems(({ catalog }) => Object.assign(piece(catalog, "shop_log_bench"), { stage: 2, price: 10 })).join("\n")).toContain("painted as starter-shop");
    expect(problems(({ catalog }) => (piece(catalog, "find_wagon_lantern").offers[0].chapter = "gemfall-02")).join("\n")).toContain("was painted for gemfall-01");
    expect(problems(({ catalog }) => (piece(catalog, "trophy_gemfall").campaign = "riftlight")).join("\n")).toContain("its art is gemfall's");
    expect(problems(({ catalog }) => (catalog.kit.tents.find((t) => t.id === "sworn").group = "catalog")).join("\n")).toContain('tent "sworn" is catalog');
  });

  it("holds the shared hotspots to the art's frames, stage by stage (#620)", () => {
    const hot = (catalog, id) => catalog.hotspots.find((h) => h.id === id);
    expect(problems(({ catalog }) => (hot(catalog, "awning").kind = "lanterns")).join("\n")).toContain('hotspot "awning" is a lanterns here');
    expect(problems(({ catalog }) => (hot(catalog, "awning").stage = 3)).join("\n")).toContain('first stands at stage 2 in the art, not 3');
    expect(problems(({ catalog }) => delete hot(catalog, "cookfire").default).join("\n")).toContain('shows "cookfire_pot" by default in the art');
    expect(problems(({ catalog }) => catalog.hotspots.push({ id: "lookout", kind: "awning", stage: 3 })).join("\n")).toContain('hotspot "lookout" is in no frame');
    expect(problems(({ catalog }) => (catalog.hotspots = catalog.hotspots.filter((h) => h.id !== "trophy_2"))).join("\n")).toContain('has hotspot "trophy_2", which the catalog does not list');
  });

  it("rejects a kit piece and a crew piece sharing an id (§12.1)", () => {
    const found = problems(({ catalog, manifest }) => {
      catalog.kit.decorations.push({ id: "shop_log_bench", group: "catalog" });
      manifest.decorations.push({ id: "shop_log_bench", group: "catalog" });
    });
    expect(found.join("\n")).toContain('"shop_log_bench" is both a kit piece and a crew piece');
  });
});

describe("the shops", () => {
  it("rejects a starter piece that is not 5 and a stage-2 piece outside 10 to 15", () => {
    expect(problems(({ catalog }) => (piece(catalog, "shop_lantern_string").price = 6)).join("\n")).toContain("every starter piece costs 5 Dash Cash");
    expect(problems(({ catalog }) => (piece(catalog, "shop_lantern_arch").price = 20)).join("\n")).toContain("stage-2 pieces cost 10 to 15");
    expect(problems(({ catalog }) => (piece(catalog, "shop_lantern_arch").price = 9)).join("\n")).toContain("stage-2 pieces cost 10 to 15");
  });

  it("rejects a shop list that prices a higher stage's piece, or anything that is not for sale", () => {
    expect(problems(({ catalog }) => catalog.shops[0].pieces.push("shop_lantern_arch")).join("\n")).toContain('stage-1 shop offers "shop_lantern_arch", a stage-2 piece');
    expect(problems(({ catalog }) => catalog.shops[0].pieces.push("find_wagon_lantern")).join("\n")).toContain('"find_wagon_lantern" is find, not a shop piece');
    expect(problems(({ catalog }) => catalog.shops[0].pieces.push("not_a_piece")).join("\n")).toContain('"not_a_piece" is not a crew piece');
  });

  it("rejects a later shop that drops a lower-stage piece, a missing starter shop, and a stage with no shop", () => {
    expect(problems(({ catalog }) => (catalog.shops[1].pieces = catalog.shops[1].pieces.filter((id) => id !== "shop_log_bench"))).join("\n")).toContain(
      'stage-2 shop leaves out "shop_log_bench" (stage 1)',
    );
    expect(problems(({ catalog }) => catalog.shops.shift()).join("\n")).toContain("there is no starter (stage 1) shop");
    expect(problems(({ catalog }) => {
      catalog.shops = catalog.shops.filter((shop) => shop.stage !== 2);
    }).join("\n")).toContain("there is no stage-2 shop");
  });
});

describe("milestones (§5.4)", () => {
  it("rejects a tier unlocking a free tent, a distinction unlocking the wrong class's decoration, and a milestone piece nothing unlocks", () => {
    expect(problems(({ catalog }) => (catalog.milestones.tiers.sworn = "rolled")).join("\n")).toContain('tier sworn unlocks "rolled", a free catalog tent');
    expect(problems(({ catalog }) => (catalog.milestones.distinctions.thornguard.master = "deco_songkeeper_master")).join("\n")).toContain(
      "whose art is painted for songkeeper master",
    );
    expect(problems(({ catalog }) => delete catalog.milestones.tiers.mythic).join("\n")).toContain('milestone piece "mythic" is unlocked by no tier or distinction');
  });

  it("rejects a catalog that disagrees with the shared copy the server grants by", () => {
    expect(problems(({ milestones }) => (milestones.tiers.sworn = "kit_tent_sworn")).join("\n")).toContain("disagree with packages/shared/src/camp-milestones.ts");
  });
});

describe("friends (§4.4)", () => {
  const lamb = (overrides = {}) => ({
    id: "lamb",
    figure: "entities/goat",
    name: "Lamb",
    offers: [{ rewardId: "riftlight-exchange-rift.lamb", chapter: "riftlight-exchange-rift" }],
    reactions: ["The lamb nibbles your sleeve."],
    ...overrides,
  });
  const befriend = (friendId, rewardId) => ({ type: "befriend", friendId, rewardId });

  it("ships the friends that belong to nobody, Bun cast by the goat she is drawn from under her own name (#624, #626)", () => {
    expect(CATALOG.friends.map((f) => f.id)).toEqual(["bun", "mosshorn", "duckling", "kid_goat", "harbor_gull", "silver_otter"]);
    // Pepper is Nim's pony, with a job and later scenes of her own (§4.4): never a friend.
    expect(CATALOG.friends.map((f) => f.name)).not.toContain("Pepper");
    expect(problems()).toEqual([]);
    // Bun is cast as the snowhorn goat her figure is drawn from; under another name she is nobody.
    expect(
      problems(({ chapters }) => {
        for (const scene of Object.values(chapters.get("first-steps-01").scenes)) for (const m of scene.cast ?? []) if (m.name === "Bun") m.name = "Bunny";
      }).join("\n"),
    ).toContain('friend "bun" is cast/bun, which no scene of first-steps-01 casts');
  });

  it("accepts a friend a scene of its chapter casts", () => {
    expect(
      problems(({ catalog, chapters }) => {
        const chapter = chapters.get("riftlight-exchange-rift");
        chapter.scenes[chapter.entry].cast = [{ figure: "entities/goat" }];
        catalog.friends.push(lamb());
      }),
    ).toEqual([]);
  });

  it("rejects a friend no scene of its chapter casts, a friend listed twice, and a friend reusing a find's reward id", () => {
    expect(problems(({ catalog }) => catalog.friends.push(lamb({ figure: "entities/nobody_here" }))).join("\n")).toContain(
      'friend "lamb" is entities/nobody_here, which no scene of riftlight-exchange-rift casts',
    );
    expect(problems(({ catalog }) => catalog.friends.push({ ...catalog.friends[0] })).join("\n")).toContain('friend "bun" is listed twice');
    expect(
      problems(({ catalog }) => catalog.friends.push(lamb({ offers: [{ rewardId: "riftlight-exchange-rift.noodle_awning", chapter: "riftlight-exchange-rift" }] }))).join("\n"),
    ).toContain("is already the offer of");
  });

  it("accepts a befriend through its friend's offer, on a choice, on every way into the place (#624)", () => {
    expect(
      problems(({ chapters }) => {
        const chapter = chapters.get("riftlight-glacier-survival");
        const entry = chapter.scenes[chapter.entry];
        entry.choices = [{ ...entry.choices[0], effects: [befriend("kid_goat", "riftlight-glacier-survival.kid_goat")] }, ...entry.choices.slice(1)];
        findIn(chapters, "riftlight-glacier-survival", befriend("kid_goat", "riftlight-glacier-survival.kid_goat"));
      }),
    ).toEqual([]);
  });

  it.each([
    ["a friend the catalog does not have", befriend("pepper", "gemfall-04c.pepper"), 'befriend names "pepper", which is not a friend'],
    ["a reward id that is not the friend's", befriend("kid_goat", "riftlight-exchange-rift.noodle_awning"), 'is not an offer of friend "kid_goat"'],
    ["another friend's reward id", befriend("kid_goat", "riftlight-ashspan-bridge.duckling"), 'is not an offer of friend "kid_goat"'],
  ])("rejects a befriend naming %s", (_, effect, message) => {
    expect(problems(({ chapters }) => findIn(chapters, "riftlight-exchange-rift", effect)).join("\n")).toContain(message);
  });

  it("rejects a befriend in a chapter that is not its offer's", () => {
    expect(problems(({ chapters }) => findIn(chapters, "riftlight-saltrot-arrival", befriend("kid_goat", "riftlight-glacier-survival.kid_goat"))).join("\n")).toContain(
      "is riftlight-glacier-survival's offer, not riftlight-saltrot-arrival's",
    );
  });
});

describe("through the gate (npm run content:validate)", { timeout: 60_000 }, () => {
  it("fails a malformed catalog at its schema, and a malformed find in a chapter", () => {
    const dir = copyTree();
    const catalog = readJson(dir, "content", "camp.json");
    piece(catalog, "shop_log_bench").price = "five";
    writeJson(dir, ["content", "camp.json"], catalog);
    const schema = validate(dir);
    expect(schema.code).not.toBe(0);
    expect(schema.out).toContain("content/camp.json");

    const fixed = copyTree();
    const path = ["content", "chapters", "gemfall-02.json"];
    const chapter = readJson(fixed, ...path);
    chapter.scenes[chapter.entry].onEnter = [...(chapter.scenes[chapter.entry].onEnter ?? []), camp("find_wagon_lantern", "gemfall-01.wagon_lantern")];
    writeJson(fixed, path, chapter);
    const find = validate(fixed);
    expect(find.code).not.toBe(0);
    expect(find.out).toContain("is gemfall-01's offer, not gemfall-02's");

    const effect = readJson(fixed, ...path);
    effect.scenes[effect.entry].onEnter.at(-1).rewardId = undefined;
    delete effect.scenes[effect.entry].onEnter.at(-1).rewardId;
    writeJson(fixed, path, effect);
    const schemaFind = validate(fixed);
    expect(schemaFind.code).not.toBe(0);
    expect(schemaFind.out).toContain('missing "rewardId"');
  });

  it("fails a befriend naming no real friend, and a befriend with no friend at all (#624)", () => {
    const dir = copyTree();
    const path = ["content", "chapters", "riftlight-exchange-rift.json"];
    const chapter = readJson(dir, ...path);
    chapter.scenes[chapter.entry].onEnter = [...(chapter.scenes[chapter.entry].onEnter ?? []), { type: "befriend", friendId: "pepper", rewardId: "riftlight-exchange-rift.pepper" }];
    writeJson(dir, path, chapter);
    const unknown = validate(dir);
    expect(unknown.code).not.toBe(0);
    expect(unknown.out).toContain('befriend names "pepper", which is not a friend');

    const effect = readJson(dir, ...path);
    delete effect.scenes[effect.entry].onEnter.at(-1).friendId;
    writeJson(dir, path, effect);
    const schema = validate(dir);
    expect(schema.code).not.toBe(0);
    expect(schema.out).toContain('missing "friendId"');
  });
});
