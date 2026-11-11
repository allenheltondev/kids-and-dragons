/**
 * Bundles the Lambda entry points into `infra/.build/<fn>/index.mjs`.
 *
 * Not `sam build`. The server is a TypeScript workspace package that imports
 * another one (`@kad/shared`) by name and its own modules with explicit `.ts`
 * extensions; SAM's built-in esbuild support handles neither reliably from a
 * monorepo root. Owning ~60 lines of build here is cheaper than the workarounds,
 * and it is also the only place that can put `content/` inside the API bundle —
 * see the note below, that part is load-bearing.
 *
 * `sam deploy` then uploads these directories as-is; there is no `sam build`
 * step in the deploy path at all.
 *
 * Everything is bundled, including the AWS SDK. The Node 22 runtime ships v3,
 * but only *some* of it, and "which @aws-sdk packages are preinstalled" is not a
 * contract worth betting a deploy on. A few extra MB in the artifact buys a
 * function that runs the same code it was tested with.
 */

import { rm, mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(ROOT, "infra", ".build");

/**
 * `content` marks the functions that need the game as data at runtime.
 *
 * Only the API does. Chapters are already validated in CI, and a chapter the
 * server cannot read is a session that cannot start — putting that behind an S3
 * fetch would trade a build-time guarantee for a runtime failure at the table.
 */
const FUNCTIONS = [
  { name: "api", entry: "packages/server/src/lambda/http.ts", content: true },
  { name: "channel-authorizer", entry: "packages/server/src/lambda/channel-authorizer.ts" },
  { name: "sweep", entry: "packages/server/src/lambda/sweep.ts" },
  // "It's your turn" pushes (#466), invoked by the API asynchronously.
  { name: "push-sender", entry: "packages/server/src/lambda/push-sender.ts" },
  // Monthly: deletes Lambda log streams older than 30 days (#524).
  { name: "log-sweep", entry: "packages/server/src/lambda/log-sweep.ts" },
  // The MCP server (docs/mcp-server.md): asset upload URLs, later the operator tools.
  { name: "mcp", entry: "packages/server/src/lambda/mcp.ts" },
];

await rm(OUT, { recursive: true, force: true });

/*
 * The content gate, before any of it is packaged (tools/content/graph-proofs.ts,
 * `contentGateForBuild`). Two things, and both are checked rather than assumed:
 *
 *  - The content passes `npm run content:validate`, all of it. The validator
 *    runs here every build and its verdict is what decides, so a package is
 *    not made from content that fails any rule. CI and deploy.sh run the same
 *    gate before they get here; this is the copy that cannot be skipped by
 *    calling the build directly. It reads the art on disk, as that gate does,
 *    so the art has to be pulled first (`npm run assets:pull`).
 *
 *  - Every graph campaign has a current proof. The API loads `content/` at
 *    every cold start, and a graph with no proof is walked there: over five
 *    seconds before the first tap is answered, where a proof makes it 88
 *    milliseconds. The proofs are not committed, so this run is where a package
 *    gets them, and the package itself is checked again below.
 */
const { contentGateForBuild, staleGraphProofs } = await import("../tools/content/graph-proofs.ts");
const gate = contentGateForBuild(ROOT);
if (gate.refreshed.length > 0) console.log(`graph proofs: walked and recorded ${gate.refreshed.join(", ")}`);
if (!gate.ok) {
  console.error(gate.report);
  throw new Error(
    gate.unproven.length > 0
      ? `content gate: ${gate.unproven.join(", ")} did not validate, so it has no graph proof and the API would walk it at every cold start. Fix the content (npm run content:validate) and build again.`
      : "content gate: the content does not pass npm run content:validate (the report is above). A package is not built from it. Fix the content and build again.",
  );
}

for (const fn of FUNCTIONS) {
  const dir = path.join(OUT, fn.name);
  await mkdir(dir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(ROOT, fn.entry)],
    outfile: path.join(dir, "index.mjs"),
    bundle: true,
    platform: "node",
    // The runtime the CI matrix and architecture §1 both name. Bumping one
    // without the other is how a deploy starts failing on syntax.
    target: "node22",
    format: "esm",
    /*
     * The AWS SDK still ships CommonJS internally, and some of it reaches for
     * `require("node:https")` at load time. esbuild's ESM output has no
     * `require` to give it, so the bundle throws on import — before any handler
     * code runs, which makes it look like a broken deploy rather than a bundling
     * flag. Defining one from `import.meta.url` is the documented fix; esbuild's
     * shim uses it when it is in scope.
     */
    banner: {
      js: [
        "import { createRequire as __kadCreateRequire } from 'node:module';",
        "import { fileURLToPath as __kadFileURLToPath } from 'node:url';",
        "import { dirname as __kadDirname } from 'node:path';",
        "const require = __kadCreateRequire(import.meta.url);",
        "const __filename = __kadFileURLToPath(import.meta.url);",
        "const __dirname = __kadDirname(__filename);",
      ].join("\n"),
    },
    sourcemap: true,
    // Keeps stack traces readable in CloudWatch. The artifact is not the
    // bottleneck here; a 2am log that says `t` is.
    minify: false,
    logLevel: "info",
    // esbuild resolves `./foo.ts` and the `@kad/shared` workspace symlink on its
    // own; nothing else needs a plugin.
  });

  if (fn.content) {
    // `KAD_CONTENT_DIR` (see paths.ts) points the loader here at runtime.
    await cp(path.join(ROOT, "content"), path.join(dir, "content"), { recursive: true });
    // What ships, not what was on disk a moment ago: the copy itself must carry the proofs.
    const unproven = staleGraphProofs(dir);
    if (unproven.length > 0) {
      throw new Error(`graph proofs: the ${fn.name} package has no current proof for ${unproven.join(", ")}; it would walk at every cold start.`);
    }
  }

  // Marks the bundle as ESM for the runtime, and stops Lambda looking for deps
  // that are already inlined.
  await writeFile(
    path.join(dir, "package.json"),
    `${JSON.stringify({ type: "module" }, null, 2)}\n`,
    "utf8",
  );
}

console.log(`\n  bundled ${FUNCTIONS.length} functions into infra/.build\n`);
