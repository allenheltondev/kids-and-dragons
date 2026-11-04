import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The parts of `manifest.camp` the art tools count (docs/camp.md §8.3, docs/briefs/camp.md). */
export interface CampManifest {
  camp?: {
    backdrops: { family: string; path: string }[];
    frames: {
      stage: number;
      pieces: { id: string; path: string }[];
      movingParts?: { piece: string; path: string }[];
    }[];
  };
}

/**
 * Every camp painting the manifest declares, once each (the four bedrolls share
 * one painting), and the ones not yet on disk. Paths are under `assets/`.
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
  ])];
  return { need: paths.length, missing: paths.filter(path => !existsSync(join(root, 'assets', path))) };
}
