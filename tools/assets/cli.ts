/**
 * The asset store's command line (docs/asset-store.md). Plain node runs it:
 *
 *   npm run assets:status [-- paths…]          what differs between the tree and the lock
 *   npm run assets:pull   [-- paths…] [--force] fetch the lock's art into the tree (no credentials)
 *   npm run assets:push   [-- paths…] [--prune] upload new and changed art, record it in the lock
 *   npm run assets:verify [-- --present P…]     the CI and deploy gate
 *   npm run assets:url    -- <path>             a file's public store URL
 *   npm run assets:provenance -- <path>         where a painting came from: commit, PR, prompt, uploader
 *   npm run assets:migrate [-- --untrack]       the one-time cutover out of git
 *   npm run assets:archive-history              every historical version into the store, before a rewrite
 *   npm run assets:filter-args                  the git filter-repo command for the rewrite
 *
 * Write commands take `--writer aws|mcp` (AWS credentials, or the MCP server and
 * a key; default KAD_ASSET_WRITER, else aws), `--bucket NAME` or `--dir FOLDER`
 * (a trial store), and `--dry-run`. `pull`, `status`, `verify`, `url` and `filter-args` need no
 * credentials and no node_modules.
 */

import { parseArgs } from "node:util";
import { archiveHistory, filterRepoCommand, migrate, pull, push, status, untrack, urlFor, verify, writeIgnoreBlock } from "./commands.ts";
import { REPO_ROOT, loadConfig } from "./lib.ts";
import { openWriteStore, type BlobStore } from "./stores.ts";

const [command, ...rest] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    root: { type: "string" },
    force: { type: "boolean" },
    prune: { type: "boolean" },
    "dry-run": { type: "boolean" },
    bucket: { type: "string" },
    dir: { type: "string" },
    writer: { type: "string" },
    issue: { type: "string" },
    untrack: { type: "boolean" },
    present: { type: "string", multiple: true },
    "no-store": { type: "boolean" },
    "store-paths-from": { type: "string" },
    "fix-ignore": { type: "boolean" },
    quiet: { type: "boolean" },
    json: { type: "boolean" },
  },
});

const root = values.root ?? REPO_ROOT;

/** The store a write command uses; a dry run touches none, so it needs no credentials. */
async function writeStore(): Promise<BlobStore> {
  if (values["dry-run"]) return { name: "(dry run)", has: () => Promise.resolve(true), put: () => Promise.resolve(false) };
  return openWriteStore(loadConfig(root), { dir: values.dir, bucket: values.bucket, writer: values.writer });
}
const log = (line: string): void => console.log(line);
const errlog = (line: string): void => console.error(line);

/** `--issue 704` or `--issue #704`: the art issue the push is for, stamped on its blobs. */
function issueOf(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw.replace(/^#/, ""));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--issue takes an issue number: ${raw}`);
  return n;
}

async function main(): Promise<number> {
  switch (command) {
    case "status": {
      const s = await status(root, positionals);
      const rows: Array<[string, string[], string]> = [
        ["missing", s.missing, "npm run assets:pull"],
        ["stale", s.stale, "npm run assets:pull"],
        ["modified", s.modified, "npm run assets:push"],
        ["added", s.added, "npm run assets:push"],
        ["deleted", s.deleted, "npm run assets:push -- --prune <folder>"],
        ["dropped", s.dropped, "npm run assets:pull removes them"],
      ];
      log(`assets:status: ${s.ok.length} current`);
      for (const [label, paths, fix] of rows) {
        if (paths.length === 0) continue;
        log(`  ${label}: ${paths.length}  (${fix})`);
        if (!values.quiet) for (const p of paths.slice(0, 25)) log(`    ${p}`);
        if (!values.quiet && paths.length > 25) log(`    … and ${paths.length - 25} more`);
      }
      return 0;
    }
    case "pull": {
      await pull(root, { prefixes: positionals, force: values.force, log });
      return 0;
    }
    case "push": {
      const store = await writeStore();
      await push(root, store, { prefixes: positionals, prune: values.prune, dryRun: values["dry-run"], issue: issueOf(values.issue), log });
      return 0;
    }
    case "migrate": {
      if (values.untrack) {
        await untrack(root, { log });
        return 0;
      }
      const store = await writeStore();
      await migrate(root, store, { dryRun: values["dry-run"], log });
      log("  Next: commit assets.lock.json, check a fresh clone can npm run assets:pull, then npm run assets:migrate -- --untrack.");
      return 0;
    }
    case "verify": {
      if (values["fix-ignore"]) writeIgnoreBlock(root, loadConfig(root));
      let storePaths: string[] | undefined;
      if (values["store-paths-from"]) {
        const fs = await import("node:fs");
        storePaths = fs.readFileSync(values["store-paths-from"], "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
      }
      const { problems } = await verify(root, {
        store: values["no-store"] ? false : undefined,
        storePaths,
        present: values.present,
        log: errlog,
      });
      return problems.length === 0 ? 0 : 1;
    }
    case "provenance": {
      if (positionals.length === 0) throw new Error("usage: npm run assets:provenance -- <path> [path…] [--json]");
      const { formatProvenance, provenance } = await import("./provenance.ts");
      const results = [];
      for (const p of positionals) results.push(await provenance(root, p));
      if (values.json) log(JSON.stringify(results, null, 2));
      else for (const r of results) for (const line of formatProvenance(r)) log(line);
      return 0;
    }
    case "url": {
      if (positionals.length === 0) throw new Error("usage: npm run assets:url -- <path> [path…]");
      for (const p of positionals) log(urlFor(root, p));
      return 0;
    }
    case "archive-history": {
      const store = await writeStore();
      await archiveHistory(root, store, { dryRun: values["dry-run"], log });
      return 0;
    }
    case "filter-args": {
      log(filterRepoCommand(root));
      return 0;
    }
    default:
      errlog("usage: node tools/assets/cli.ts <status|pull|push|verify|url|provenance|migrate|archive-history|filter-args> [args]  (docs/asset-store.md)");
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    errlog(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
