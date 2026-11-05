import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The parts of `manifest.camp` the art tools count (docs/camp.md §8.3, docs/briefs/camp.md). */
export interface CampManifest {
  camp?: {
    backdrops: { family: string; path: string }[];
    kitStyles?: { id: string; path: string }[];
    frames: {
      stage: number;
      pieces: { id: string; path: string }[];
      movingParts?: { piece: string; path: string }[];
    }[];
    /** Phase 2 (#623): the crew's hotspot pieces, the hero's tents, souvenir line and decorations. */
    crewPieces?: { id: string; path: string; movingParts?: { path: string }[] }[];
    tentStyles?: { id: string; path: string; flap: string }[];
    souvenirDisplay?: { id: string; path: string };
    decorations?: { id: string; path: string }[];
    /** Owed painted icons, at packages/client/src/assets/painted/<id>.webp. */
    paintedIcons?: string[];
  };
}

/** Where a camp icon lands, and how the inventory names it. */
const paintedIcon = (id: string): string => `painted/${id}.webp`;

/**
 * Every camp painting the manifest declares, once each (the four bedrolls share
 * one painting, and the four stage-2 tent spots their fallback tent), and the
 * ones not yet on disk. Paths are under `assets/`; a camp icon is
 * `painted/<id>.webp`, under `packages/client/src/assets/`.
 */
export function campArtOwed(root: string, manifest: CampManifest): { need: number; missing: string[] } {
  const camp = manifest.camp;
  if (!camp) return { need: 0, missing: [] };
  const paths = [...new Set([
    ...camp.backdrops.map(backdrop => backdrop.path),
    ...camp.frames.flatMap(frame => [
      ...frame.pieces.map(piece => piece.path),
      ...(frame.movingParts ?? []).map(part => part.path),
    ]),
    ...(camp.kitStyles ?? []).map(style => style.path),
    ...(camp.crewPieces ?? []).flatMap(piece => [piece.path, ...(piece.movingParts ?? []).map(part => part.path)]),
    ...(camp.tentStyles ?? []).flatMap(tent => [tent.path, tent.flap]),
    ...(camp.souvenirDisplay ? [camp.souvenirDisplay.path] : []),
    ...(camp.decorations ?? []).map(decoration => decoration.path),
  ])];
  const icons = [...new Set(camp.paintedIcons ?? [])];
  return {
    need: paths.length + icons.length,
    missing: [
      ...paths.filter(path => !existsSync(join(root, 'assets', path))),
      ...icons.filter(id => !existsSync(join(root, 'packages/client/src/assets', paintedIcon(id)))).map(paintedIcon),
    ],
  };
}
