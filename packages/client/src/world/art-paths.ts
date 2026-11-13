/**
 * Where the commissioned art lives, and the canvas contract it is drawn on.
 *
 * Split out of `actor-art.ts` for one reason: that module imports `pixi.js` for
 * its placeholder Graphics, and `screens/` now draws the same art as plain
 * `<img>` elements — the species portraits in creation, the party lineup in the
 * lobby, the face on your sheet. Importing a URL helper must never drag the
 * renderer into the main bundle (WorldView loads PixiStage lazily precisely so
 * it does not, see layout/WorldView.tsx), so anything both sides need lives
 * here and nothing here imports Pixi.
 *
 * Every path is a fact about `assets/`, which `assets/manifest.json` and
 * docs/art-pipeline.md own. Nothing derives a filename anywhere else.
 */

import type { Chapter, ClassId, RunState, SpeciesId, TierId } from "@kad/shared";

/** assets/manifest.json → canvas. */
export const CANVAS = { width: 1024, height: 1024, originX: 512, originY: 900 } as const;
export const ANCHOR_X = CANVAS.originX / CANVAS.width;
export const ANCHOR_Y = CANVAS.originY / CANVAS.height;

export const CAMP_ART = {
  backdrop: "/assets/camp/backdrops/open_plains.webp",
  fire: "/assets/camp/frames/stage1/campfire.png",
  flame: "/assets/camp/frames/stage1/campfire-flame.png",
} as const;

/*
 * ---------------------------------------------------------------------------
 * SMALL ART, FOR A PHONE, AND LIGHT ART FOR EVERY SCREEN
 *
 * A backdrop is painted 1920 x 1080, a story plate 1600 x 900 and a figure 1024 x 1024, for
 * a television. Two kinds of copy stand beside a painting (`npm run art:small` makes both,
 * and tools/art/small-art.test.ts keeps one for every painting the rules below name):
 *
 *   - **Half size, for a phone** (`<name>@0.5x.webp`). A phone's world pane draws a backdrop
 *     some 800 pixels wide and a figure a few hundred, from the same files: four times the
 *     download and four times the decoded memory it can show. So scene, biome and camp
 *     backdrops, story plates and the figures of everyone who is not a hero have a copy half
 *     as wide and half as tall, and a phone asks for that instead.
 *   - **Full size, for every other screen** (`<name>@1x.webp`). A figure is a PNG of about
 *     a megabyte; the same pixels as a WebP are a fifth to a tenth of that, its alpha
 *     exactly the painting's. So every figure, a hero's paintings among them, has one, and a
 *     tablet, a laptop and a television ask for it. A hero has only this copy, so a phone
 *     asks for it too: her coat is tinted from her painting and its mask pixel for pixel, and
 *     the copy is on the mask's own canvas (docs/art-pipeline.md says why she has no half).
 *
 * The names are Pixi's own convention: a texture loaded from `@0.5x` reports the full
 * painting's width and height at half the pixels, and `@1x` is what it would have assumed,
 * so nothing that places or sizes a sprite knows the difference. A DOM `<img>` is sized by
 * its box either way.
 *
 * Here, and pure, because the service worker concatenates this file: the chapter it warms
 * overnight (sw/chapter-art.ts) must be the files this device will draw, and a worker has a
 * user agent but no screen.
 */

/**
 * Whether this build has every copy, of both kinds, current (small-art-build.ts): set for
 * the page by vite.config.ts and for the worker by sw-build.ts, and not at all in a test or
 * a tool, where every URL is the painting's own.
 */
declare const __KAD_SMALL_ART__: boolean | undefined;

/** The paintings that have a half-size copy: scene, biome and camp backdrops, story plates, and the figures of everyone who is not a hero. */
const SMALL_ART = /^\/assets\/(?:(?:scenes\/[^/@]+\/[^/@]+|biomes\/[^/@]+\/bg|plates\/[^/@]+\/[^/@]+|camp\/backdrops\/[^/@]+)\.webp|(?:entities|cast)\/[^/@]+\/assembled\.png)$/;

/**
 * The paintings that have a full-size WebP: every figure. Someone met or fought, a hero's
 * base and class paintings, and her gear portraits (`<species>.png`, never the
 * `<species>.coat-mask.png` beside it: a mask's channels are weights and stay lossless).
 */
const WHOLE_ART = /^\/assets\/(?:(?:entities|cast)\/[^/@]+\/assembled|characters\/[^/@]+\/[^/@]+\/assembled|character-rigs\/[^/@]+\/[^/@]+\/[^/@]+\/assembled|gear-portraits\/[^/@]+\/[^/@]+\/[^/@.]+)\.png$/;

/** What a half-size copy's name ends with, in place of its painting's extension. */
export const SMALL_ART_SUFFIX = "@0.5x.webp";

/** What a full-size WebP's name ends with, in place of its painting's `.png`. */
export const WHOLE_ART_SUFFIX = "@1x.webp";

/** A painting's half-size copy, or null when it is not one that has one. */
export function smallArtUrl(url: string): string | null {
  return SMALL_ART.test(url) ? url.replace(/\.(?:png|webp)$/, SMALL_ART_SUFFIX) : null;
}

/** A painting's full-size WebP, or null when it is not one that has one. */
export function wholeArtUrl(url: string): string | null {
  return WHOLE_ART.test(url) ? url.replace(/\.png$/, WHOLE_ART_SUFFIX) : null;
}

/** Every copy a painting has, of either kind: what the build holds the asset store to. */
export function artCopyUrls(url: string): string[] {
  return [smallArtUrl(url), wholeArtUrl(url)].filter((copy): copy is string => copy !== null);
}

/**
 * The painting a full-size WebP was made from: `x@1x.webp` → `x.png`, and anything else as it
 * is. What is said of a painting by its path (its coat mask, whether it is a cut-out) is said
 * of the painting, whichever of the two files a device drew.
 */
export function paintingOfCopy(url: string): string {
  return url.endsWith(WHOLE_ART_SUFFIX) ? url.slice(0, -WHOLE_ART_SUFFIX.length) + ".png" : url;
}

/** Whether this build may ask for copies at all: it has every one, current. Never in a test or a tool. */
export function artCopiesReady(): boolean {
  return typeof __KAD_SMALL_ART__ !== "undefined" && __KAD_SMALL_ART__ === true;
}

/**
 * Whether this device is a phone, by the one thing a page and a worker both know: browsers
 * on a phone say `Mobile` (Android) or `iPhone`; a tablet, a laptop and a television do not.
 * A wrong guess costs a soft picture on a big screen or a heavy one on a small one, never
 * a missing one.
 */
export function wantsSmallArt(
  agent: string | undefined = typeof navigator === "undefined" ? undefined : navigator.userAgent,
  ready: boolean = artCopiesReady(),
): boolean {
  return ready && agent !== undefined && /\bMobile\b|iPhone/.test(agent) && !/\biPad\b|\bTV\b|Tizen|Web0S|SMART-TV/i.test(agent);
}

/**
 * The file this device draws `url` from: its half-size copy on a phone, else its full-size
 * WebP where the build has the copies (`whole`), else the painting itself.
 */
export function fitArt(url: string, small: boolean = wantsSmallArt(), whole: boolean = artCopiesReady()): string {
  return (small ? smallArtUrl(url) : null) ?? (whole ? wholeArtUrl(url) : null) ?? url;
}

/**
 * The tier every character starts at (content/rules.json → tierLevels, level 1).
 * It is what creation has to draw: the draft has no level yet, and the hero the
 * player is building is a fledgling by definition.
 */
export const STARTING_TIER: TierId = "fledgling";

/**
 * The tiers that have painted art, in level order. Ascendant, starborn and
 * legendary (levels 15, 20 and 30, spec §8.1) are rules before they are
 * pictures, so a hero past Mythic is drawn as Mythic until theirs is
 * commissioned: add a tier here when its art lands. Lives here, not in
 * @kad/shared, because the service worker concatenates this file and cannot
 * import at runtime.
 */
const ART_TIERS: readonly TierId[] = ["fledgling", "sworn", "radiant", "mythic"];

/** The tier whose art draws a hero of `tier`: itself, or Mythic, the highest painted. */
export function artTierOf(tier: TierId): TierId {
  return ART_TIERS.includes(tier) ? tier : "mythic";
}

export function characterArtUrl(species: SpeciesId, tier: TierId = STARTING_TIER): string {
  return fitArt(`/assets/characters/${species}/${artTierOf(tier)}/assembled.png`);
}

/**
 * Class figures are commissioned one exact species/class/tier combination at a
 * time. This set is intentionally tested against manifest.figureVariants: the
 * runtime stays tiny while the manifest remains the source of truth.
 */
// Every commissioned class/tier group currently has the full species roster.
// The manifest coverage test guards this compact representation.
const CLASS_FIGURE_VARIANTS = new Set<string>(
  [
  "starweaver/mythic",
  "songkeeper/mythic",
  "songkeeper/radiant",
  "songkeeper/sworn",
  "starweaver/radiant",
  "duskrunner/mythic",
  "duskrunner/radiant",
  "duskrunner/sworn",
  "starweaver/sworn",
  "thornguard/mythic",
  "thornguard/radiant",
  "thornguard/sworn"
].flatMap(prefix=>
    ["bigfoot", "dragonling", "griffin", "kitsune", "manticore", "unicorn"].map(species=>prefix+"/"+species),
  ),
);

function classFigureKey(species: SpeciesId, tier: TierId, characterClass: ClassId): string {
  return `${characterClass}/${artTierOf(tier)}/${species}`;
}

function hasClassFigure(species: SpeciesId, tier: TierId, characterClass?: ClassId): boolean {
  return (
    characterClass !== undefined &&
    CLASS_FIGURE_VARIANTS.has(classFigureKey(species, tier, characterClass))
  );
}

/** The still-image fallback matching the illustration selected for a world figure. */
export function characterWorldArtUrl(
  species: SpeciesId,
  tier: TierId = STARTING_TIER,
  characterClass?: ClassId,
): string {
  if (hasClassFigure(species, tier, characterClass)) {
    return fitArt(`/assets/character-rigs/${characterClass}/${artTierOf(tier)}/${species}/assembled.png`);
  }
  return characterArtUrl(species, tier);
}

/**
 * Approved purpose-drawn class-gear variants exist for every species and geared
 * tier. They are complete opaque illustrations, not rig parts, so this path is
 * deliberately separate from `assets/gear/` and is consumed only by portrait
 * surfaces.
 *
 * Returning `null` is part of the contract: fledglings wear no class gear,
 * while every ClassId has an accepted Sworn, Radiant, and Mythic variant.
 * Callers can fall back to the species/tier art without probing a fledgling URL
 * known not to exist.
 */
export function gearPortraitUrl(
  species: SpeciesId,
  characterClass: ClassId,
  tier: TierId,
): string | null {
  if (tier === "fledgling") return null;
  return fitArt(`/assets/gear-portraits/${characterClass}/${artTierOf(tier)}/${species}.png`);
}

/** The best commissioned still image available for a resolved character. */
export function characterPortraitArtUrl(
  species: SpeciesId,
  tier: TierId = STARTING_TIER,
  characterClass?: ClassId,
): string {
  return (
    (characterClass === undefined ? null : gearPortraitUrl(species, characterClass, tier)) ??
    characterArtUrl(species, tier)
  );
}

/**
 * Where a painting's coat mask would be (docs/hero-looks.md §4.2), whether or
 * not it has one: `x/assembled.png` → `x/coat-mask.png`, a gear portrait's
 * `x/<species>.png` → `x/<species>.coat-mask.png`. A painting's full-size WebP
 * (`fitArt`) has the painting's own mask: same canvas, same alpha.
 */
export function maskPathBeside(drawn: string): string {
  const painting = paintingOfCopy(drawn);
  return painting.endsWith("/assembled.png")
    ? painting.slice(0, -"assembled.png".length) + "coat-mask.png"
    : painting.replace(/\.png$/, ".coat-mask.png");
}

/**
 * Whether a hero's look draws on her coat mask: a colour on either part, or a
 * special. A hero wearing none is drawn as painted, so prefetching her mask
 * ahead of play would only spend a phone's data; the book's own offline warm
 * (hero-art.ts `heroOfflineArt`) still fetches it, since a colour can be picked
 * there offline. Pure, so the service worker can call it.
 */
export function wearsLook(look: { coat?: string | null; accent?: string | null; special?: string | null } | null | undefined): boolean {
  return Boolean(look && (look.coat || look.accent || look.special));
}

/**
 * A painting's coat mask URL, or null when `masked` (the art manifest's
 * `coatMasks.paintings`, paths under `assets/`) does not list it: a painting
 * with no mask draws as painted, and nothing asks for a file that is not
 * there. Here rather than in coat-masks.ts because the service worker, which
 * cannot import the manifest, prefetches masks too (§5.4): sw-build.ts hands
 * it the list as `__KAD_COAT_MASKS__`.
 */
export function coatMaskFor(paintingUrl: string, masked: ReadonlySet<string> | readonly string[]): string | null {
  if (!paintingUrl.startsWith("/assets/")) return null;
  const path = paintingOfCopy(paintingUrl).slice("/assets/".length);
  const listed = Array.isArray(masked) ? masked.includes(path) : (masked as ReadonlySet<string>).has(path);
  return listed ? maskPathBeside(paintingUrl) : null;
}

/**
 * Enemy cutouts. A chapter authors `art: "enemies/will_o_wisp"`; the files
 * live in `assets/entities/<id>/assembled.png`, so the prefix is convention,
 * not a directory — strip it if present, trust the rest.
 */
export function enemyArtUrl(artId: string): string {
  if (artId.startsWith("cast/")) return fitArt(`/assets/${artId}/assembled.png`);
  const id = artId.startsWith("enemies/") ? artId.slice("enemies/".length) : artId;
  return fitArt(`/assets/entities/${id}/assembled.png`);
}

/** The 1920×1080 backdrop for a biome (asset-brief §4.5). */
export function biomeBackdropUrl(biome: string): string {
  return fitArt(`/assets/biomes/${biome}/bg.webp`);
}

/** Scene illustrations or a story-only biome background, without changing combat terrain. */
export function sceneBackdropUrl(art: string): string | null {
  return /^(?:scenes\/[a-z0-9_-]+\/[a-z0-9_-]+|biomes\/[a-z0-9_]+\/bg)$/.test(art)
    ? fitArt(`/assets/${art}.webp`) : null;
}

/** Authored backdrops follow the scene; combat terrain is a separate tile layer. */
export function sceneArtFor(chapter: Chapter | null, state: RunState | null): string | null {
  if (!chapter || chapter.id !== state?.chapterId || !state.sceneId) return null;
  const scene = chapter.scenes[state.sceneId];
  return scene?.art ?? null;
}

/** The 4×4 combat tile sheet for a biome — floor row, then blocked row. */
export function biomeTilesUrl(biome: string): string {
  return `/assets/biomes/${biome}/tiles.png`;
}

/**
 * The biome creation happens in when nothing else says otherwise.
 *
 * A draft character belongs to no chapter yet — there is no run state to read a
 * biome off — but the preview still has to stand somewhere, and a hero floating
 * in a void is the thing this file exists to stop. `enchanted_woods` is the
 * reference chapter's biome (spec §6.2); once a chapter *is* loaded the preview
 * uses that instead, so this is a first-frame default, not a hardcoded setting.
 */
export const CREATION_BIOME = "enchanted_woods";

/** Shared by the cast stage and offline chapter warming. */
export function castArtUrl(figure: string): string | null {
 const match=/^(entities|characters|cast)\/([a-z0-9]+(?:[_-][a-z0-9]+)*)$/.exec(figure);
 if(!match)return null;
 const [,kind,id]=match;
 // A hero's painting is never halved: her coat is tinted from it and its mask, pixel for pixel.
 return fitArt(kind==="characters" ? "/assets/characters/"+id+"/fledgling/assembled.png" : "/assets/"+kind+"/"+id+"/assembled.png");
}
