/**
 * A hero's name style (docs/hero-looks.md §7.2, §7.3; #664): which frame sits
 * behind her name and which title goes under it, everywhere her name is shown.
 *
 * The catalog is the content's own (`content/looks.json`), bundled with the
 * client the way the camp's art manifest is, so the TV, the phones and the
 * book all read the same words for a title and the same frames, offline too.
 *
 * **A frame is drawn only once its art is delivered.** The art manifest lists
 * the delivered frames (`nameplateFrames.ids`); a frame that is not listed,
 * or one the catalog paints nothing for (the plain plate), is the plain plate:
 * the name exactly as today, with nothing behind it, and no request for a
 * file that is not there.
 *
 * `lookChoices` lists the Color shelf's coats (#666) by the same rule
 * (starters and her receipts, nothing locked shown), and her species' only.
 */

import { holdsLook, lookTitleText, PLAIN_NAMEPLATE } from "@kad/shared";
import type { HeroLookView, LookCatalog, SpeciesId } from "@kad/shared";
import looksJson from "../../../../content/looks.json";
import { nameplateFrames } from "../../../../assets/manifest.json";

/** The catalog, as the server reads it. */
export const LOOKS: LookCatalog = {
  coats: (looksJson as unknown as LookCatalog).coats ?? [],
  nameplates: (looksJson as unknown as LookCatalog).nameplates,
  titles: (looksJson as unknown as LookCatalog).titles,
};

/** A delivered frame's painting, and where its nine slices are cut. */
export interface NameplateFrameArt {
  id: string;
  url: string;
  /** Insets in the painting's own pixels. */
  slice: { left: number; top: number; right: number; bottom: number };
  canvas: { width: number; height: number };
}

const DELIVERED: ReadonlySet<string> = new Set((nameplateFrames as { ids: readonly string[] }).ids);

/**
 * A frame's painting, or null for the plain plate: no art in the catalog, or
 * art not delivered yet. `delivered` is the manifest's list; tests pass their own.
 */
export function nameplateFrameArt(id: string | null | undefined, delivered: ReadonlySet<string> = DELIVERED, catalog: LookCatalog = LOOKS): NameplateFrameArt | null {
  if (!id || id === PLAIN_NAMEPLATE || !delivered.has(id)) return null;
  const frame = catalog.nameplates.find((n) => n.id === id);
  if (!frame?.art) return null;
  return { id, url: `/assets/${frame.art}`, slice: { ...nameplateFrames.slice }, canvas: { ...nameplateFrames.canvas } };
}

/** What to draw around a hero's name. Both null: exactly as before looks. */
export interface HeroNameStyle {
  /** The title line under the name, in the catalog's words, or null for none. */
  title: string | null;
  /** The frame behind it, or null for the plain plate. */
  frame: NameplateFrameArt | null;
  /** The frame id she chose, drawn or not (for a CSS hook and the editors). */
  frameId: string | null;
}

const NONE: HeroNameStyle = { title: null, frame: null, frameId: null };

/** Her name style, from the look she carries (`ResolvedCharacter.look`). */
export function heroNameStyle(look: Pick<HeroLookView, "nameplate" | "title"> | null | undefined, catalog: LookCatalog = LOOKS, delivered: ReadonlySet<string> = DELIVERED): HeroNameStyle {
  if (!look) return NONE;
  const title = lookTitleText(catalog, look.title);
  const frame = nameplateFrameArt(look.nameplate, delivered, catalog);
  if (title === null && frame === null && (look.nameplate ?? PLAIN_NAMEPLATE) === PLAIN_NAMEPLATE) return NONE;
  return { title, frame, frameId: look.nameplate ?? null };
}

/** The longest title in the catalog: what the collision tests are run with (§7.2). */
export function longestTitle(catalog: LookCatalog = LOOKS): string {
  return catalog.titles.reduce((a, t) => (t.text.length > a.length ? t.text : a), "");
}

/** One look on a shelf: its id and its name. */
export interface LookChoice {
  id: string;
  name: string;
}

/**
 * What a shelf offers her: every look of that kind she holds (a starter, or
 * one she has a receipt for), in catalog order. Earned looks she has not got
 * yet are not shown (§8.1): nothing is a locked tease.
 */
export function lookChoices(
  kind: "nameplate" | "title" | "coat",
  look: Pick<HeroLookView, "unlocked"> | null | undefined,
  species?: SpeciesId,
  catalog: LookCatalog = LOOKS,
): LookChoice[] {
  const unlocked = look?.unlocked ?? [];
  if (kind === "nameplate") return catalog.nameplates.filter((n) => holdsLook(catalog, unlocked, n.id)).map((n) => ({ id: n.id, name: n.name }));
  if (kind === "title") return catalog.titles.filter((t) => holdsLook(catalog, unlocked, t.id)).map((t) => ({ id: t.id, name: t.text }));
  return catalog.coats
    .filter((c) => (species === undefined || c.species.includes(species)) && holdsLook(catalog, unlocked, c.id))
    .map((c) => ({ id: c.id, name: c.name }));
}
