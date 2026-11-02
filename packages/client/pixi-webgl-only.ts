/**
 * The stage draws with WebGL and nothing else (`preference: ["webgl"]`, world/PixiStage.tsx), but
 * Pixi 8's feature `init` files register an adaptor for each of its three renderers at load time,
 * so the WebGPU and canvas renderers' code rode in the stage's chunk on every TV that opened it,
 * never run. This build plugin swaps the modules only those two renderers use for stubs that export
 * the same names: a class whose `extension` registers nothing, and which says so if anything ever
 * constructs it.
 *
 * Which modules: Pixi's own import graph decides, at build time, so a Pixi upgrade cannot quietly
 * stub something the WebGL path needs. A module is a candidate if it lives under
 * `rendering/renderers/{gpu,canvas}/` or is a `Gpu*`/`Canvas*` file in a feature's `gpu/` or
 * `canvas/` folder. A candidate stays real when any module outside the candidates (other than the
 * `init`/`index` files that only register or re-export) imports it, directly or through another
 * kept candidate: `GpuProgram` (every filter), `BindGroup`, the canvas text generator WebGL uses for
 * `Text`, and so on. Everything else is stubbed. Dynamic imports are not followed: they are how
 * `autoDetectRenderer` reaches the WebGPU and canvas renderers, and with WebGL the only preference it
 * never takes them.
 *
 * Build only. The dev server pre-bundles Pixi with esbuild, which this does not touch; the
 * production-build e2e shard and `perf:bundle` are what see it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

const STATIC_IMPORT = /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*['"](\.[^'"]+)['"]/g;

function isCandidate(rel: string): boolean {
  if (/^rendering\/renderers\/(gpu|canvas)\//.test(rel)) return true;
  return /\/(gpu|canvas)\/(Gpu|Canvas)[^/]*\.mjs$/.test(rel) || /\/(Gpu|Canvas)[A-Z][^/]*\.mjs$/.test(rel) && /\/(gpu|canvas)\//.test(rel);
}

/** Every module under `lib`, its static imports, and which of them can be stubbed. */
export function webglOnlyStubs(lib: string): Set<string> {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".mjs")) files.push(full);
    }
  })(lib);
  const imports = new Map<string, string[]>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    imports.set(file, [...text.matchAll(STATIC_IMPORT)].map((m) => path.resolve(path.dirname(file), (m[1] ?? m[2])!)));
  }
  const rel = (file: string) => path.relative(lib, file).split(path.sep).join("/");
  const candidates = new Set(files.filter((file) => isCandidate(rel(file))));
  const registersOnly = (file: string) => /\/(init|index)\.mjs$/.test(file);

  // What the rest of Pixi reaches: start from every non-candidate that does real work, and keep
  // whatever it imports, through candidates too.
  const kept = new Set<string>();
  const queue = files.filter((file) => !candidates.has(file) && !registersOnly(file));
  const seen = new Set(queue);
  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const dep of imports.get(file) ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      if (candidates.has(dep)) kept.add(dep);
      queue.push(dep);
    }
  }
  return new Set([...candidates].filter((file) => !kept.has(file)));
}

/** A module exporting `names`, each a class that registers nothing and refuses to be built. */
export function stubSource(names: readonly string[], file: string): string {
  const where = JSON.stringify(file);
  const lines = [
    "const stub = (name) => {",
    "  const Stub = class {",
    `    constructor() { throw new Error("pixi.js " + name + " (" + ${where} + ") is left out of this build: the stage draws with WebGL only (packages/client/pixi-webgl-only.ts)"); }`,
    "  };",
    '  Stub.extension = { type: [], name: "webgl-only:" + name };',
    "  return Stub;",
    "};",
  ];
  for (const name of names) lines.push(`export const ${name} = stub(${JSON.stringify(name)});`);
  return lines.join("\n");
}

/** The names a Pixi module exports: its trailing `export { A, B as C };` and any `export class|function|const`. */
export function exportNames(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) {
    for (const part of m[1]!.split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  for (const m of source.matchAll(/export\s+(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]!);
  names.delete("default");
  return [...names];
}

export function pixiWebglOnly(): Plugin {
  let stubs = new Set<string>();
  return {
    name: "kad:pixi-webgl-only",
    apply: "build",
    enforce: "pre",
    buildStart() {
      // `pixi.js` resolves to `lib/index.js`; its ES modules sit beside it as `.mjs`.
      const lib = path.dirname(createRequire(import.meta.url).resolve("pixi.js"));
      stubs = webglOnlyStubs(lib);
    },
    load(id) {
      const file = id.split("?")[0]!;
      if (!stubs.has(file)) return null;
      return stubSource(exportNames(readFileSync(file, "utf8")), path.basename(file));
    },
  };
}
