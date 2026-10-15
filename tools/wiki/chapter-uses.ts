/**
 * Which chapters use a canon entity.
 *
 * The wiki says two things that depend on this: whether a protected mystery
 * (`canon_status: intentionally_undefined`) is published at all, and whether a
 * page wears the "not in a story yet" badge. Both should follow the chapters,
 * so that a new campaign that brings a creature on stage takes the badge off
 * its page without anyone editing canon.
 *
 * A chapter uses an entity when its JSON names it, either by id slug as a
 * whole token (`entities/cinder_wolf`, `"creature": "river_drake"`, an
 * `itemId`, a `biome`) or by title in the story's own words ("the Great
 * River"). Titles shorter than five letters are skipped so a short name
 * never matches inside an ordinary word.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CanonEntity } from './types.ts';

export interface ChapterText {
  id: string;
  /** The whole chapter file, lowercased. */
  text: string;
}

/** Read every chapter under `chaptersDir`. Absent directory → no chapters. */
export function loadChapterTexts(chaptersDir: string): ChapterText[] {
  if (!fs.existsSync(chaptersDir)) return [];
  return fs
    .readdirSync(chaptersDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const raw = fs.readFileSync(path.join(chaptersDir, f), 'utf-8');
      const id = (JSON.parse(raw) as { id?: string }).id ?? f.replace(/\.json$/, '');
      return { id, text: raw.toLowerCase() };
    });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The chapter ids that use `entity`, in file order. */
export function findChapterUses(entity: CanonEntity, chapters: ChapterText[]): string[] {
  const needles: RegExp[] = [];
  const slugs = new Set([entity.id.split('.')[1], entity.assetId].filter((s): s is string => !!s));
  for (const slug of slugs) {
    needles.push(new RegExp(`(?<![a-z0-9_])${escapeRegExp(slug.toLowerCase())}(?![a-z0-9_])`));
  }
  const title = entity.title.toLowerCase().replace(/^the\s+/, '').trim();
  if (title.length >= 5) {
    needles.push(new RegExp(`(?<![a-z])${escapeRegExp(title)}(?![a-z])`));
  }
  return chapters.filter((c) => needles.some((n) => n.test(c.text))).map((c) => c.id);
}

/**
 * Chapter uses for every entity, with geography inferred from the places it
 * joins.
 *
 * A story names a road or a river in its own words ("the west branch",
 * "the Sunward road"), so a route or a river feature the text does not name
 * still counts as used when the story goes where it goes: a route when one
 * chapter visits every place it `connects`, a river feature when a chapter
 * visits any place it `reaches`.
 */
export function findAllChapterUses(
  entities: Iterable<CanonEntity>,
  chapters: ChapterText[],
): Map<string, string[]> {
  const uses = new Map<string, string[]>();
  const all = [...entities];
  for (const e of all) uses.set(e.id, findChapterUses(e, chapters));

  const order = chapters.map((c) => c.id);
  for (const e of all) {
    if (uses.get(e.id)!.length > 0) continue;
    const rel = e.relationships ?? {};
    const connects = rel['connects'] ?? [];
    const reaches = rel['reaches'] ?? [];
    let inferred = new Set<string>();
    if (e.type === 'route' && connects.length > 0) {
      const [first, ...rest] = connects.map((id) => new Set(uses.get(id) ?? []));
      inferred = new Set([...first!].filter((c) => rest.every((s) => s.has(c))));
    } else if (e.type === 'feature') {
      inferred = new Set(reaches.flatMap((id) => uses.get(id) ?? []));
    }
    if (inferred.size > 0) uses.set(e.id, order.filter((c) => inferred.has(c)));
  }
  return uses;
}
