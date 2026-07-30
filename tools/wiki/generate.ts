/**
 * World Encyclopedia Generator CLI — main entry point.
 *
 * Reads structured YAML canon files from canon/ and produces/updates
 * Markdown pages in wiki/content/ for the Hugo-based encyclopedia.
 *
 * Usage: npx tsx tools/wiki/generate.ts [--force]
 */

import fs from 'node:fs';
import path from 'node:path';
import type { GeneratorConfig, ValidationMessage } from './types.ts';
import { parseCanonDirectory } from './canon-parser.ts';
import { validateCanon } from './canon-validator.ts';
import { discoverAllAssets } from './asset-discovery.ts';
import { generatePage, getEntityPagePath, resolveConventionAssets } from './page-generator.ts';
import { checkIncremental, updateManifest, getCanonFileMtimes } from './incremental.ts';

function main(): void {
  // 1. Parse CLI args
  const forceAll = process.argv.includes('--force');

  // 2. Resolve paths relative to repository root (cwd)
  const canonDir = path.resolve('canon');
  const assetsDir = path.resolve('assets');
  const contentDir = path.resolve('wiki', 'content');
  const manifestPath = path.resolve('wiki', '.gen-manifest.json');

  const config: GeneratorConfig = {
    canonDir,
    assetsDir,
    contentDir,
    manifestPath,
    forceAll,
  };

  // 3. Check if canon directory exists — fatal error if not
  if (!fs.existsSync(canonDir)) {
    process.stderr.write('Error: canon/ directory not found\n');
    process.exit(1);
  }

  // 4. Parse canon files
  const { registry, errors: parseErrors } = parseCanonDirectory(canonDir);

  const allWarnings: ValidationMessage[] = [];
  const allErrors: ValidationMessage[] = [];

  // Classify parse messages
  for (const msg of parseErrors) {
    process.stderr.write(`[${msg.level}] ${msg.file}: ${msg.message}\n`);
    if (msg.level === 'error') {
      allErrors.push(msg);
    } else {
      allWarnings.push(msg);
    }
  }

  // 5. If parse errors at error level prevent further work (no entities parsed), exit 1
  if (registry.entities.size === 0 && allErrors.length > 0) {
    process.stderr.write('Fatal: No entities could be parsed. Halting.\n');
    printSummary(0, 0, 0, allWarnings.length, allErrors.length);
    process.exit(1);
  }

  // 6. Validate canon data
  const validationResult = validateCanon(registry, assetsDir);

  for (const msg of validationResult.messages) {
    process.stderr.write(`[${msg.level}] ${msg.entityId ?? msg.file}: ${msg.message}\n`);
    if (msg.level === 'error') {
      allErrors.push(msg);
    } else {
      allWarnings.push(msg);
    }
  }

  // 7. If validation has errors (valid === false), report and exit 1
  if (!validationResult.valid) {
    process.stderr.write('Fatal: Validation errors detected. Halting.\n');
    printSummary(registry.entities.size, 0, 0, allWarnings.length, allErrors.length);
    process.exit(1);
  }

  // 8. Incremental check (skip if --force)
  let entitiesToProcess: Set<string>;

  if (forceAll) {
    entitiesToProcess = new Set(registry.entities.keys());
  } else {
    const incrementalResult = checkIncremental(config, registry);
    console.log(incrementalResult.message);

    if (!incrementalResult.hasChanges) {
      printSummary(registry.entities.size, 0, 0, allWarnings.length, allErrors.length);
      process.exit(0);
    }

    entitiesToProcess = incrementalResult.entitiesToProcess;
  }

  // 9. Discover assets
  const { results: assetResults, warnings: assetWarnings } = discoverAllAssets(
    registry.entities,
    assetsDir,
  );
  allWarnings.push(...assetWarnings);

  for (const w of assetWarnings) {
    process.stderr.write(`[warning] ${w.entityId ?? w.file}: ${w.message}\n`);
  }

  // 10. Generate pages for each entity to process
  let pagesCreated = 0;
  let pagesUpdated = 0;

  // Ensure content directory exists
  if (!fs.existsSync(contentDir)) {
    fs.mkdirSync(contentDir, { recursive: true });
  }

  for (const entityId of entitiesToProcess) {
    const entity = registry.entities.get(entityId);
    if (!entity) continue;

    const pagePath = getEntityPagePath(entity, contentDir);
    const pageDir = path.dirname(pagePath);

    // Ensure the page directory exists
    if (!fs.existsSync(pageDir)) {
      fs.mkdirSync(pageDir, { recursive: true });
    }

    // Check if page already exists and read current content
    let existingContent: string | undefined;
    const pageExists = fs.existsSync(pagePath);
    if (pageExists) {
      existingContent = fs.readFileSync(pagePath, 'utf-8');
    }

    // Get assets and reverse refs for this entity
    // Prefer explicit assets from asset-discovery, then fall back to convention-based resolution
    const discoveredAssets = assetResults.get(entityId);
    const assets = discoveredAssets && discoveredAssets.source === 'explicit'
      ? discoveredAssets
      : resolveConventionAssets(entity, assetsDir);
    const reverseRefs = registry.reverseRefs.get(entityId) ?? [];

    // Generate the page
    const { content, warnings: pageWarnings } = generatePage(
      { entity, assets, reverseRefs, existingContent },
      registry,
    );

    allWarnings.push(...pageWarnings);
    for (const w of pageWarnings) {
      process.stderr.write(`[warning] ${w.entityId ?? w.file}: ${w.message}\n`);
    }

    // Write the result to the target file path
    fs.writeFileSync(pagePath, content, 'utf-8');

    // Track whether it was a create or update
    if (pageExists) {
      pagesUpdated++;
    } else {
      pagesCreated++;
    }
  }

  // 11. Update manifest with current file mtimes
  const canonMtimes = getCanonFileMtimes(canonDir);
  updateManifest(manifestPath, canonMtimes);

  // 12. Print summary report and exit 0
  printSummary(
    registry.entities.size,
    pagesCreated,
    pagesUpdated,
    allWarnings.length,
    allErrors.length,
  );

  process.exit(0);
}

/**
 * Print the summary report to stdout.
 */
function printSummary(
  totalEntities: number,
  pagesCreated: number,
  pagesUpdated: number,
  warningsCount: number,
  errorsCount: number,
): void {
  console.log('Wiki Generator \u2014 Summary');
  console.log('========================');
  console.log(`Total entities: ${totalEntities}`);
  console.log(`Pages created:  ${pagesCreated}`);
  console.log(`Pages updated:  ${pagesUpdated}`);
  console.log(`Warnings:       ${warningsCount}`);
  console.log(`Errors:         ${errorsCount}`);
}

main();
