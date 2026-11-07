/**
 * The hero looks catalog (docs/hero-looks.md §3.1, §6, §7; #664), checked for
 * what its schema cannot see.
 *
 * `content/looks.json` lists every coat, nameplate frame and title a hero may
 * choose. The schema checks each entry's shape; this checks the catalog as a
 * whole: ids unique across all three lists (a receipt names one look, never
 * two), the plain plate there and free with no art (it is today's look, and
 * what every hero wears until she picks another), at least one free title,
 * every frame's art at `nameplates/<id>.webp`, every species with its own
 * starter colours (`STARTER_COATS`), named and coloured apart within it
 * (whether they can be told apart is a client test, coat-palette.test.ts),
 * every frame the art manifest
 * calls delivered (`nameplateFrames.ids`) one the catalog has, and every
 * unlock rule naming a tier, class, campaign or camp friend that exists.
 *
 * Pure: `looksCatalogProblems` takes what validate.mjs has already loaded and
 * returns problems, so it is tested without the filesystem.
 */

const LOOKS = "content/looks.json";
const MANIFEST = "assets/manifest.json";

/** How many free colours each species starts with (§7.1: "about six"). */
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
 * @returns {{ file: string, at: string, problem: string, hint?: string }[]}
 */
export function looksCatalogProblems({ catalog, manifest, tiers, classes, campaigns, friends, species }) {
  const out = [];
  const fail = (at, problem, hint, file = LOOKS) => out.push({ file, at, problem, ...(hint ? { hint } : {}) });

  const seen = new Map();
  for (const list of ["coats", "nameplates", "titles"]) {
    (catalog[list] ?? []).forEach((entry, i) => {
      const at = `/${list}/${i}`;
      if (seen.has(entry.id)) fail(`${at}/id`, `"${entry.id}" is already ${seen.get(entry.id)}`, "A look id names one look across coats, nameplates and titles: a receipt names it alone.");
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

  // Colours (#666, §7.1): each species its own starter set, about six, named and coloured apart.
  const bySpecies = new Map();
  catalog.coats.forEach((coat, i) => {
    for (const id of coat.species) {
      if (!species.has(id)) {
        fail(`/coats/${i}/species`, `no species "${id}"`);
        continue;
      }
      const set = bySpecies.get(id) ?? { names: new Map(), colors: new Map(), starters: 0 };
      bySpecies.set(id, set);
      if (set.names.has(coat.name)) fail(`/coats/${i}/name`, `${id} already has a color called "${coat.name}" (${set.names.get(coat.name)})`, "The shelf shows the names side by side.");
      else set.names.set(coat.name, coat.id);
      const color = coat.color.toUpperCase();
      if (set.colors.has(color)) fail(`/coats/${i}/color`, `${color} is already ${set.colors.get(color)}`, "Two tiles that look the same are one choice.");
      else set.colors.set(color, coat.id);
      if (coat.unlock.from === "starter") set.starters += 1;
    }
  });
  if (catalog.coats.length > 0) {
    for (const id of [...species].sort()) {
      const starters = bySpecies.get(id)?.starters ?? 0;
      if (starters < STARTER_COATS.min || starters > STARTER_COATS.max) {
        fail("/coats", `${id} has ${starters} starter colors`, `About six per species, natural for it (§7.1): ${STARTER_COATS.min} to ${STARTER_COATS.max}.`);
      }
    }
  }

  const delivered = manifest?.ids ?? [];
  const frames = new Map(catalog.nameplates.map((n) => [n.id, n]));
  delivered.forEach((id, i) => {
    const frame = frames.get(id);
    if (!frame || frame.art === undefined) fail(`/nameplateFrames/ids/${i}`, `"${id}" is not a frame with art in ${LOOKS}`, "List only frames the catalog paints.", MANIFEST);
  });
  return out;
}
