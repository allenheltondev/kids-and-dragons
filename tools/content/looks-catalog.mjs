/**
 * The hero looks catalog (docs/hero-looks.md §3.1, §6, §7; #664), checked for
 * what its schema cannot see.
 *
 * `content/looks.json` lists every coat, special, nameplate frame and title a
 * hero may choose. The schema checks each entry's shape; this checks the
 * catalog as a whole: ids unique across all four lists (a receipt names one
 * look, never two), the plain plate there and free with no art (it is today's
 * look, and what every hero wears until she picks another), at least one free
 * title, every frame's art at `nameplates/<id>.webp`, every species with its
 * own starter colours for each of her two parts, main and accent
 * (`STARTER_COATS`), named and coloured apart within a part (whether they can
 * be told apart is a client test, coat-palette.test.ts; her two parts are
 * never held against each other: the pair is hers), every special earned
 * (never a starter), every frame the art manifest
 * calls delivered (`nameplateFrames.ids`) one the catalog has, and every
 * unlock rule naming a tier, class, campaign or camp friend that exists.
 *
 * Pure: `looksCatalogProblems` takes what validate.mjs has already loaded and
 * returns problems, so it is tested without the filesystem.
 */

const LOOKS = "content/looks.json";
/** The catalog's four lists, in the order a receipt's id is looked up. */
const LOOK_LISTS = ["coats", "specials", "nameplates", "titles"];
/** Her two parts (owner, 2026-11-07): each species has a starter set for each. */
const PARTS = ["main", "accent"];
const MANIFEST = "assets/manifest.json";

/** How many free colours each species starts with, per part (§7.1: "about six"). */
export const STARTER_COATS = { min: 4, max: 8 };

/**
 * @param {object} input
 * @param {object} input.catalog    content/looks.json, schema-valid
 * @param {object} [input.manifest] assets/manifest.json -> nameplateFrames
 * @param {Set<string>} input.tiers
 * @param {Set<string>} input.classes
 * @param {Set<string>} input.campaigns
 * @param {Set<string>} input.friends   content/camp.json friends
 * @param {Set<string>} input.species
 * @param {Map<string, object>} [input.chapters] every loaded chapter, by id: their `findLook` effects
 * @returns {{ file: string, at: string, problem: string, hint?: string }[]}
 */
export function looksCatalogProblems({ catalog, manifest, tiers, classes, campaigns, friends, species, chapters }) {
  const out = [];
  const fail = (at, problem, hint, file = LOOKS) => out.push({ file, at, problem, ...(hint ? { hint } : {}) });

  const seen = new Map();
  for (const list of LOOK_LISTS) {
    (catalog[list] ?? []).forEach((entry, i) => {
      const at = `/${list}/${i}`;
      if (seen.has(entry.id)) fail(`${at}/id`, `"${entry.id}" is already ${seen.get(entry.id)}`, "A look id names one look across coats, specials, nameplates and titles: a receipt names it alone.");
      else seen.set(entry.id, `${list}[${i}]`);
      const rule = entry.unlock;
      if (rule.tier !== undefined && !tiers.has(rule.tier)) fail(`${at}/unlock/tier`, `no tier "${rule.tier}"`);
      if (rule.classRank !== undefined && !classes.has(rule.classRank.class)) fail(`${at}/unlock/classRank/class`, `no class "${rule.classRank.class}" in content/rules.json`);
      if (rule.campaign !== undefined && !campaigns.has(rule.campaign)) fail(`${at}/unlock/campaign`, `no campaign "${rule.campaign}" in content/campaigns`);
      if (rule.friend !== undefined && !friends.has(rule.friend)) fail(`${at}/unlock/friend`, `no camp friend "${rule.friend}" in content/camp.json`);
    });
  }

  const plain = catalog.nameplates.find((n) => n.id === "plain");
  if (!plain) fail("/nameplates", 'no "plain" nameplate', "The plain plate is today's look: every hero wears it until she picks another (§7.2).");
  else {
    if (plain.unlock.from !== "starter") fail("/nameplates", "the plain plate must be a starter", "Every hero has it.");
    if (plain.art !== undefined) fail("/nameplates", "the plain plate has no art", "It is the name drawn exactly as today, with nothing behind it.");
  }
  catalog.nameplates.forEach((frame, i) => {
    if (frame.id === "plain") return;
    if (frame.art === undefined) fail(`/nameplates/${i}`, `the ${frame.name} frame has no art`, "Every frame but the plain plate is a painting (#665).");
    else if (frame.art !== `nameplates/${frame.id}.webp`) fail(`/nameplates/${i}/art`, `expected "nameplates/${frame.id}.webp"`, "A frame's art is named for it.");
  });
  if (!catalog.titles.some((t) => t.unlock.from === "starter")) fail("/titles", "no starter title", "A few titles are free from the start (§7.3).");

  // Colours (#666, §7.1; two parts): each species its own starter set per part, about six, named and coloured apart within it.
  const bySpecies = new Map();
  catalog.coats.forEach((coat, i) => {
    for (const id of coat.species) {
      if (!species.has(id)) {
        fail(`/coats/${i}/species`, `no species "${id}"`);
        continue;
      }
      const key = `${id} ${coat.part}`;
      const set = bySpecies.get(key) ?? { names: new Map(), colors: new Map(), starters: 0 };
      bySpecies.set(key, set);
      if (set.names.has(coat.name)) fail(`/coats/${i}/name`, `${id}'s ${coat.part} part already has a color called "${coat.name}" (${set.names.get(coat.name)})`, "The shelf shows the names side by side.");
      else set.names.set(coat.name, coat.id);
      const color = coat.color.toUpperCase();
      if (set.colors.has(color)) fail(`/coats/${i}/color`, `${color} is already ${set.colors.get(color)}`, "Two tiles that look the same are one choice.");
      else set.colors.set(color, coat.id);
      if (coat.unlock.from === "starter") set.starters += 1;
    }
  });
  if (catalog.coats.length > 0) {
    for (const id of [...species].sort()) {
      for (const part of PARTS) {
        const starters = bySpecies.get(`${id} ${part}`)?.starters ?? 0;
        if (starters < STARTER_COATS.min || starters > STARTER_COATS.max) {
          fail("/coats", `${id} has ${starters} starter ${part} colors`, `About six per part per species, natural for it (§7.1): ${STARTER_COATS.min} to ${STARTER_COATS.max}.`);
        }
      }
    }
  }

  // Specials (§5.5; owner 2026-11-07): whole-figure effects, earned, never a starter.
  (catalog.specials ?? []).forEach((special, i) => {
    if (special.unlock.from === "starter") fail(`/specials/${i}/unlock`, `${special.id} is a special and a starter`, "Specials are earned (§5.5).");
  });

  // Look finds in chapters (§6, #669).
  if (chapters) out.push(...lookFindProblems(catalog, chapters, species));

  const delivered = manifest?.ids ?? [];
  const frames = new Map(catalog.nameplates.map((n) => [n.id, n]));
  delivered.forEach((id, i) => {
    const frame = frames.get(id);
    if (!frame || frame.art === undefined) fail(`/nameplateFrames/ids/${i}`, `"${id}" is not a frame with art in ${LOOKS}`, "List only frames the catalog paints.", MANIFEST);
  });
  return out;
}

/**
 * Every `findLook` in a chapter, wherever it is authored, with its JSON
 * pointer: a deep walk, as camp-catalog.mjs `chapterFinds` is, so a find the
 * walk missed cannot reach the table unchecked.
 */
export function chapterLookFinds(chapter) {
  const found = [];
  const walk = (value, at) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${at}/${i}`));
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.type === "findLook") found.push({ effect: value, at });
    for (const [key, v] of Object.entries(value)) walk(v, `${at}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
  };
  walk(chapter, "");
  return found;
}

/**
 * The look finds (docs/hero-looks.md §6; content/README.md "Look finds"):
 * each names looks the catalog has, every one earned by a find; a coat find
 * names one coat for every species and no more, so no kid at the table misses
 * out; the `rewardId` is `<chapter id>.<name>` and names the same looks
 * wherever the chapter authors it; and every found look in the catalog is
 * handed over somewhere, since nothing else can give it.
 */
function lookFindProblems(catalog, chapters, species) {
  const out = [];
  const looks = new Map();
  for (const list of LOOK_LISTS) for (const entry of catalog[list] ?? []) looks.set(entry.id, { list, entry });
  const offered = new Set();
  for (const [chapterId, chapter] of chapters) {
    const file = `content/chapters/${chapterId}.json`;
    const byReward = new Map();
    for (const { effect, at } of chapterLookFinds(chapter)) {
      const fail = (where, problem, hint) => out.push({ file, at: `${at}${where}`, problem, ...(hint ? { hint } : {}) });
      const ids = Array.isArray(effect.looks) ? effect.looks : [];
      if (typeof effect.rewardId !== "string" || !effect.rewardId.startsWith(`${chapterId}.`)) {
        fail("/rewardId", `"${effect.rewardId}" is not "${chapterId}.<name>"`, "A look find's reward is named for the chapter that hands it over, and never changes once it ships.");
      }
      const key = [...ids].sort().join(",");
      const seen = byReward.get(effect.rewardId);
      if (seen !== undefined && seen !== key) fail("/looks", `${effect.rewardId} names other looks elsewhere in this chapter`, "One reward, one set of looks, on every way in.");
      else byReward.set(effect.rewardId, key);
      const coatSpecies = new Map();
      ids.forEach((id, i) => {
        const look = looks.get(id);
        if (!look) return fail(`/looks/${i}`, `no look "${id}" in ${LOOKS}`);
        if (look.entry.unlock.from !== "found") return fail(`/looks/${i}`, `"${id}" is not a found look`, 'A find hands over a look whose unlock is { "from": "found" }.');
        offered.add(id);
        if (look.list === "coats") {
          for (const s of look.entry.species) {
            if (coatSpecies.has(s)) fail(`/looks/${i}`, `two coats for ${s}: ${coatSpecies.get(s)} and ${id}`, "One coat per species in a find.");
            else coatSpecies.set(s, id);
          }
        }
      });
      if (coatSpecies.size > 0) {
        const missing = [...species].filter((s) => !coatSpecies.has(s)).sort();
        if (missing.length > 0) fail("/looks", `a coat find with no coat for ${missing.join(", ")}`, "Every seated hero gets one: name a coat for every species.");
      }
    }
  }
  for (const [id, { list, entry }] of looks) {
    if (entry.unlock.from === "found" && !offered.has(id)) {
      // A warning, not a failure: a trimmed set of chapters (a test's) may leave the find out.
      out.push({ file: LOOKS, at: `/${list}`, problem: `"${id}" is found, but no chapter hands it over`, hint: "Place a findLook for it, or give it another unlock.", warning: true });
    }
  }
  return out;
}
