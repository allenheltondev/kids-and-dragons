/**
 * Writes the MCP server's chapter index (packages/server/src/mcp/chapter-index.ts)
 * into a function's build directory, as `chapter-index.json`.
 *
 * The index is made by the server's own content loader, so each revision is
 * hashed exactly as the API hashes it. The loader is TypeScript that Node's
 * type stripping cannot run (parameter properties), so it is bundled with
 * esbuild first, as the Lambdas are, and the bundle is imported and thrown away.
 *
 *   node infra/chapter-index.mjs <dir>     writes <dir>/chapter-index.json
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export async function writeChapterIndex(dir, root = ROOT) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "kad-chapter-index-"));
  try {
    const outfile = path.join(tmp, "builder.mjs");
    await esbuild.build({
      stdin: {
        contents: [
          'export { loadContent } from "./packages/server/src/content/loader.ts";',
          'export { buildChapterIndex } from "./packages/server/src/mcp/chapter-index.ts";',
        ].join("\n"),
        resolveDir: root,
        loader: "ts",
        sourcefile: "chapter-index-builder.ts",
      },
      outfile,
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      banner: { js: "import { createRequire as __kadCreateRequire } from 'node:module'; const require = __kadCreateRequire(import.meta.url);" },
      logLevel: "warning",
    });
    const { loadContent, buildChapterIndex } = await import(pathToFileURL(outfile).href);
    const index = buildChapterIndex(await loadContent(path.join(root, "content")));
    await writeFile(path.join(dir, "chapter-index.json"), `${JSON.stringify(index)}\n`);
    return index;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node infra/chapter-index.mjs <dir>");
    process.exit(2);
  }
  const index = await writeChapterIndex(path.resolve(dir));
  console.log(`chapter index of ${String(index.chapters.length)} chapters -> ${path.join(dir, "chapter-index.json")}`);
}
