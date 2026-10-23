import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { getConventionAssetPath } from '../wiki/page-generator.ts';

export interface EnvironmentManifest {
  biomes: string[];
  backgroundOnlyBiomes?: string[];
  sceneIllustrations?: string[];
}

/** Compare canon places with declared art, so an omitted manifest entry stays visible. */
export function environmentCoverage(root: string, manifest: EnvironmentManifest): {
  need: number; missing: string[];
} {
  const declared = new Set([
    ...manifest.biomes.map(id => `assets/biomes/${id}/bg.webp`),
    ...(manifest.backgroundOnlyBiomes ?? []).map(id => `assets/biomes/${id}/bg.webp`),
    ...(manifest.sceneIllustrations ?? []).map(id => `assets/${id}.webp`),
  ]);
  const missing: string[] = [];
  let need = 0;
  for (const taxonomy of ['biomes', 'locations']) {
    const document = yaml.load(readFileSync(join(root, 'canon', `${taxonomy}.yaml`), 'utf8')) as
      Record<string, { id: string; asset_id?: string }[]>;
    for (const entity of document[taxonomy] ?? []) {
      need++;
      const [type, slug] = entity.id.split('.');
      const image = getConventionAssetPath(type!, entity.asset_id ?? slug!);
      if (!image || !declared.has(image)) {
        missing.push(`${entity.id} (backdrop not declared in manifest)`);
      } else if (!existsSync(join(root, image))) {
        missing.push(`${entity.id} (missing ${image})`);
      }
    }
  }
  return { need, missing };
}
