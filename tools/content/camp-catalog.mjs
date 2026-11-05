/**
 * The camp catalog's cross-file rules (#618, docs/camp.md §4, §5, §9, §12.2):
 * what `schemas/camp.schema.json` cannot see.
 *
 * `content/camp.json` says what the camp *is* (where a piece comes from, what
 * it costs, which reward hands it over); `assets/manifest.json` → `camp` says
 * what it looks like. Neither may name an id the other lacks. And every chapter
 * find must name a real piece of the right catalog through an offer the
 * catalog declares for that chapter, so a malformed find fails
 * `npm run content:validate`, never the table.
 *
 * Pure: `campCatalogProblems` takes what validate.mjs has already loaded and
 * returns problems; it reads nothing and prints nothing. Its tests
 * (camp-catalog.test.mjs) call it directly, so each rule has a failing case
 * without copying the content tree.
 */

/** Dash Cash a starter (stage 1) shop piece costs (§5.3). */
export const STARTER_PRICE = 5;
/** The price band of a stage-2 shop piece (§5.2). Later stages cost at least the floor. */
export const STAGE_TWO_PRICES = { min: 10, max: 15 };

/** The manifest's crew-piece `group` for each catalog group (shop pieces by stage). */
function manifestGroup(piece) {
  if (piece.group !== "shop") return piece.group;
  return piece.stage === 1 ? "starter-shop" : `stage${piece.stage}-shop`;
}

/**
 * Every `findForCamp` and `findForKit` in a chapter, wherever it is authored
 * (an `onEnter`, a choice, a branch, an interaction, a rescue, a retired
 * interaction kept for saves), with its JSON pointer. A deep walk, because an
 * effect list can sit anywhere a chapter puts one, and a find the walk missed
 * would reach the table unchecked.
 */
export function chapterFinds(chapter) {
  const out = [];
  const walk = (value, at) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${at}/${i}`));
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.type === "findForCamp" || value.type === "findForKit") out.push({ effect: value, at });
    for (const [key, v] of Object.entries(value)) walk(v, `${at}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
  };
  walk(chapter, "");
  return out;
}

/** Every figure a chapter casts, in any scene. */
function castFigures(chapter) {
  const out = new Set();
  for (const scene of Object.values(chapter.scenes ?? {})) for (const member of scene?.cast ?? []) out.add(member?.figure);
  return out;
}

/**
 * Problems with the catalog, as `{ file, at, problem, hint? }`.
 *
 * @param {object} input
 * @param {object} input.catalog       content/camp.json, schema-valid
 * @param {object} input.manifest      assets/manifest.json → camp
 * @param {Map<string, object>} input.chapters  every schema-valid chapter, by id
 * @param {Set<string>} [input.brokenChapters]  chapter ids that failed to load (not reported again)
 * @param {Set<string>} input.campaigns         campaign ids
 * @param {object} input.milestones    shared MILESTONE_KIT_PIECES
 */
export function campCatalogProblems({ catalog, manifest, chapters, brokenChapters = new Set(), campaigns, milestones }) {
  const problems = [];
  const CAMP = "content/camp.json";
  const MANIFEST = "assets/manifest.json";
  const fail = (at, problem, hint, file = CAMP) => problems.push({ file, at, problem, ...(hint ? { hint } : {}) });

  // ------------------------------------------------------------------ the catalog against the manifest

  /** Index a list by id, failing duplicates. */
  const byId = (list, at) => {
    const map = new Map();
    (list ?? []).forEach((entry, i) => {
      if (map.has(entry.id)) fail(`${at}/${i}/id`, `"${entry.id}" is listed twice`);
      else map.set(entry.id, { entry, at: `${at}/${i}` });
    });
    return map;
  };
  const art = manifest ?? {};
  const crew = byId(catalog.crewPieces, "/crewPieces");
  const styles = byId(catalog.kit.styles, "/kit/styles");
  const tents = byId(catalog.kit.tents, "/kit/tents");
  const decorations = byId(catalog.kit.decorations, "/kit/decorations");

  /** Both directions: every catalog id is declared art, and every declared art id is in the catalog. */
  const matchArt = (mine, theirs, what, artPath, compare) => {
    const declared = new Map((theirs ?? []).map((entry) => [entry.id, entry]));
    for (const [id, { entry, at }] of mine) {
      const painted = declared.get(id);
      if (!painted) {
        fail(`${at}/id`, `${what} "${id}" is not declared in ${MANIFEST} → ${artPath}`, "Every catalog id is declared art; declare it there (#623), never here.");
        continue;
      }
      compare?.(entry, painted, at);
    }
    for (const id of declared.keys()) {
      if (!mine.has(id)) fail("", `${MANIFEST} → ${artPath} declares "${id}", which the catalog does not list`, "Give it a group (and a price or offer) in content/camp.json.");
    }
  };

  matchArt(crew, art.crewPieces, "crew piece", "camp.crewPieces", (piece, painted, at) => {
    if (piece.hotspot !== painted.hotspot) fail(`${at}/hotspot`, `"${piece.id}" stands at "${piece.hotspot}", but its art stands at "${painted.hotspot}"`);
    if (manifestGroup(piece) !== painted.group) {
      fail(`${at}/group`, `"${piece.id}" is ${piece.group}${piece.group === "shop" ? ` at stage ${piece.stage}` : ""}, but its art is painted as ${painted.group}`);
    }
    if (piece.group === "find" && painted.chapter && !piece.offers.some((o) => o.chapter === painted.chapter)) {
      fail(`${at}/offers`, `"${piece.id}" was painted for ${painted.chapter}, which none of its offers names`);
    }
    if (piece.group === "trophy" && painted.campaign !== piece.campaign) {
      fail(`${at}/campaign`, `"${piece.id}" is the trophy for ${piece.campaign}, but its art is ${painted.campaign}'s`);
    }
  });
  matchArt(styles, art.kitStyles, "kit style", "camp.kitStyles");
  matchArt(tents, art.tentStyles, "tent style", "camp.tentStyles", (tent, painted, at) => {
    if (tent.group !== painted.group) fail(`${at}/group`, `tent "${tent.id}" is ${tent.group}, but its art is painted as ${painted.group}`);
  });
  matchArt(decorations, art.decorations, "decoration", "camp.decorations", (deco, painted, at) => {
    if (deco.group !== painted.group) fail(`${at}/group`, `decoration "${deco.id}" is ${deco.group}, but its art is painted as ${painted.group}`);
    if (deco.group === "find" && painted.chapter && !deco.offers.some((o) => o.chapter === painted.chapter)) {
      fail(`${at}/offers`, `"${deco.id}" was painted for ${painted.chapter}, which none of its offers names`);
    }
  });

  // Kit pieces and crew pieces are separate catalogs with separate ids (§12.1).
  for (const [id, { at }] of [...tents, ...decorations]) {
    if (crew.has(id)) fail(`${at}/id`, `"${id}" is both a kit piece and a crew piece`, "Kit and crew pieces never cross (docs/camp.md §12.1): give them separate ids.");
  }

  // A frame piece comes with a frame whose hotspots have its kind.
  for (const [id, { entry, at }] of crew) {
    if (entry.group !== "frame") continue;
    const frame = (art.frames ?? []).find((f) => f.stage === entry.stage);
    if (!(frame?.hotspots ?? []).some((h) => h.kind === entry.hotspot)) {
      fail(`${at}/stage`, `"${id}" comes with frame stage ${entry.stage}, which has no ${entry.hotspot} hotspot in ${MANIFEST}`);
    }
  }
  for (const [id, { entry, at }] of crew) {
    if (entry.group === "trophy" && !campaigns.has(entry.campaign)) fail(`${at}/campaign`, `"${id}" is the trophy for "${entry.campaign}", which is not a campaign`);
  }

  // ------------------------------------------------------------------ the shops (§5.2, §5.3, §12.4)

  const shopPieces = [...crew.values()].filter(({ entry }) => entry.group === "shop");
  for (const { entry, at } of shopPieces) {
    if (entry.stage === 1 && entry.price !== STARTER_PRICE) {
      fail(`${at}/price`, `starter piece "${entry.id}" costs ${entry.price}; every starter piece costs ${STARTER_PRICE} Dash Cash`, "docs/camp.md §5.3: the first pieces in each shop cost 5.");
    } else if (entry.stage === 2 && (entry.price < STAGE_TWO_PRICES.min || entry.price > STAGE_TWO_PRICES.max)) {
      fail(`${at}/price`, `stage-2 piece "${entry.id}" costs ${entry.price}; stage-2 pieces cost ${STAGE_TWO_PRICES.min} to ${STAGE_TWO_PRICES.max} Dash Cash`, "docs/camp.md §5.2.");
    } else if (entry.stage > 2 && entry.price < STAGE_TWO_PRICES.min) {
      fail(`${at}/price`, `stage-${entry.stage} piece "${entry.id}" costs ${entry.price}, less than a stage-2 piece`);
    }
  }
  const stages = new Map();
  catalog.shops.forEach((shop, i) => {
    const at = `/shops/${i}`;
    if (stages.has(shop.stage)) fail(`${at}/stage`, `two shop lists for stage ${shop.stage}`);
    stages.set(shop.stage, shop);
    shop.pieces.forEach((id, j) => {
      const piece = crew.get(id)?.entry;
      if (!piece) fail(`${at}/pieces/${j}`, `"${id}" is not a crew piece`);
      else if (piece.group !== "shop") fail(`${at}/pieces/${j}`, `"${id}" is ${piece.group}, not a shop piece, so it has no price`, "Only shop pieces are bought (docs/camp.md §4.3).");
      else if (piece.stage > shop.stage) fail(`${at}/pieces/${j}`, `stage-${shop.stage} shop offers "${id}", a stage-${piece.stage} piece`, "A shop list prices pieces of its own stage or lower.");
    });
    // Lower-stage pieces the crew does not own stay in later shops (§12.4).
    for (const { entry } of shopPieces) {
      if (entry.stage <= shop.stage && !shop.pieces.includes(entry.id)) {
        fail(`${at}/pieces`, `stage-${shop.stage} shop leaves out "${entry.id}" (stage ${entry.stage})`, "Lower-stage pieces stay in later shops (docs/camp.md §12.4).");
      }
    }
  });
  if (!stages.has(1)) fail("/shops", "there is no starter (stage 1) shop", "The shop opens after two chapters, before any campaign is finished (docs/camp.md §5.3).");
  for (const { entry, at } of shopPieces) {
    if (!stages.has(entry.stage)) fail(`${at}/stage`, `"${entry.id}" is a stage-${entry.stage} shop piece, and there is no stage-${entry.stage} shop`);
  }

  // ------------------------------------------------------------------ milestones (§5.4)

  const tiers = catalog.milestones.tiers ?? {};
  const unlockedBy = new Map();
  for (const [tier, id] of Object.entries(tiers)) {
    const at = `/milestones/tiers/${tier}`;
    const tent = tents.get(id)?.entry;
    if (!tent) fail(at, `tier ${tier} unlocks "${id}", which is not a tent style`);
    else if (tent.group !== "milestone") fail(at, `tier ${tier} unlocks "${id}", a free catalog tent`);
    const painted = (art.tentStyles ?? []).find((t) => t.id === id);
    if (painted && painted.tier !== tier) fail(at, `tier ${tier} unlocks "${id}", whose art is painted for ${painted.tier ?? "no tier"}`);
    if (unlockedBy.has(id)) fail(at, `"${id}" is unlocked by both ${unlockedBy.get(id)} and ${tier}`);
    unlockedBy.set(id, tier);
  }
  for (const [classId, ranks] of Object.entries(catalog.milestones.distinctions ?? {})) {
    for (const [rank, id] of Object.entries(ranks)) {
      const at = `/milestones/distinctions/${classId}/${rank}`;
      const deco = decorations.get(id)?.entry;
      if (!deco) fail(at, `${classId} ${rank} unlocks "${id}", which is not a decoration`);
      else if (deco.group !== "milestone") fail(at, `${classId} ${rank} unlocks "${id}", which is ${deco.group}, not a milestone decoration`);
      const painted = (art.decorations ?? []).find((d) => d.id === id);
      if (painted && (painted.class !== classId || painted.distinction !== rank)) {
        fail(at, `${classId} ${rank} unlocks "${id}", whose art is painted for ${painted.class ?? "no class"} ${painted.distinction ?? ""}`.trimEnd());
      }
      if (unlockedBy.has(id)) fail(at, `"${id}" is unlocked by both ${unlockedBy.get(id)} and ${classId} ${rank}`);
      unlockedBy.set(id, `${classId} ${rank}`);
    }
  }
  for (const [id, { at }] of [...tents, ...decorations]) {
    const entry = (tents.get(id) ?? decorations.get(id)).entry;
    if (entry.group === "milestone" && !unlockedBy.has(id)) fail(`${at}/group`, `milestone piece "${id}" is unlocked by no tier or distinction`);
  }
  if (JSON.stringify(sortedDeep(catalog.milestones.tiers)) !== JSON.stringify(sortedDeep(milestones.tiers)) ||
      JSON.stringify(sortedDeep(catalog.milestones.distinctions)) !== JSON.stringify(sortedDeep(milestones.distinctions))) {
    fail("/milestones", "the milestones disagree with packages/shared/src/camp-milestones.ts (MILESTONE_KIT_PIECES)", "The server grants and migrates by that copy; change both together.");
  }

  // ------------------------------------------------------------------ offers and reward ids (§12.2)

  /** rewardId → { kind, pieceId, chapter } for every declared offer. */
  const offers = new Map();
  const register = (kind, id, list, at) => {
    const chaptersSeen = new Set();
    list.forEach((offer, i) => {
      const where = `${at}/offers/${i}`;
      if (offers.has(offer.rewardId)) {
        fail(`${where}/rewardId`, `reward id "${offer.rewardId}" is already the offer of "${offers.get(offer.rewardId).pieceId}"`, "A reward id names exactly one offer, forever (docs/camp.md §12.2).");
        return;
      }
      offers.set(offer.rewardId, { kind, pieceId: id, chapter: offer.chapter });
      if (!chapters.has(offer.chapter) && !brokenChapters.has(offer.chapter)) fail(`${where}/chapter`, `no chapter "${offer.chapter}"`);
      if (chaptersSeen.has(offer.chapter)) {
        fail(`${where}/chapter`, `"${id}" has two offers in ${offer.chapter}`, "Every way into one place shares one reward id (docs/camp.md §5.1).");
      }
      chaptersSeen.add(offer.chapter);
    });
  };
  for (const [id, { entry, at }] of crew) if (entry.group === "find") register("camp", id, entry.offers, at);
  for (const [id, { entry, at }] of decorations) if (entry.group === "find") register("kit", id, entry.offers, at);
  const friendIds = new Set();
  (catalog.friends ?? []).forEach((friend, i) => {
    const at = `/friends/${i}`;
    if (friendIds.has(friend.id)) fail(`${at}/id`, `friend "${friend.id}" is listed twice`);
    friendIds.add(friend.id);
    register("friend", friend.id, friend.offers, at);
    // A friend references a real cast figure: somebody a scene of its chapter puts on stage.
    friend.offers.forEach((offer, j) => {
      const chapter = chapters.get(offer.chapter);
      if (chapter && !castFigures(chapter).has(friend.figure)) {
        fail(`${at}/offers/${j}/chapter`, `friend "${friend.id}" is ${friend.figure}, which no scene of ${offer.chapter} casts`, "A friend is a creature the party met there (docs/camp.md §4.4): cast it in the scene that befriends it.");
      }
    });
  });

  // ------------------------------------------------------------------ the finds chapters hand over (§5.1, §5.4)

  const crewFind = (id) => crew.get(id)?.entry;
  const kitFind = (id) => decorations.get(id)?.entry ?? tents.get(id)?.entry;
  //
  // "Offered on every way in, given once" (§5.1, §12.2) holds by construction:
  // a find must name its piece's offer for this very chapter, and a piece has
  // at most one offer per chapter (above). So every way into one place, in a
  // graph campaign or any other, shares one reward id, and no reward id can be
  // offered anywhere else.
  for (const [chapterId, chapter] of chapters) {
    const file = `content/chapters/${chapterId}.json`;
    for (const { effect, at } of chapterFinds(chapter)) {
      const camp = effect.type === "findForCamp";
      const kind = camp ? "camp" : "kit";
      const piece = camp ? crewFind(effect.pieceId) : kitFind(effect.pieceId);
      if (!piece) {
        const other = camp ? kitFind(effect.pieceId) : crewFind(effect.pieceId);
        fail(`${at}/pieceId`, `${effect.type} names "${effect.pieceId}", which is not a ${camp ? "crew" : "kit"} piece in ${CAMP}`, other ? `It is a ${camp ? "kit" : "crew"} piece: use ${camp ? "findForKit" : "findForCamp"}.` : undefined, file);
        continue;
      }
      if (piece.group !== "find") {
        fail(`${at}/pieceId`, `${effect.type} names "${effect.pieceId}", a ${piece.group} piece; a chapter hands over only find pieces`, undefined, file);
        continue;
      }
      const offer = offers.get(effect.rewardId);
      if (!offer || offer.kind !== kind || offer.pieceId !== effect.pieceId) {
        fail(`${at}/rewardId`, `"${effect.rewardId}" is not an offer of "${effect.pieceId}" in ${CAMP}`, `Its offers: ${piece.offers.map((o) => o.rewardId).join(", ")}. Declare a new offer there, with a reward id no other offer uses.`, file);
        continue;
      }
      if (offer.chapter !== chapterId) {
        fail(`${at}/rewardId`, `"${effect.rewardId}" is ${offer.chapter}'s offer, not ${chapterId}'s`, "A reward id names one offer in one place, shared by every way into it (docs/camp.md §12.2).", file);
      }
    }
  }

  return problems;
}

function sortedDeep(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.keys(value).filter((k) => !k.startsWith("$")).sort().map((k) => [k, sortedDeep(value[k])]));
}
