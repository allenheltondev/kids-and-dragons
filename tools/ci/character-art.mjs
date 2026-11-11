#!/usr/bin/env node
/**
 * Kids & Dragons — does this pull request change a hero's art without the owner's approval? (#729)
 *
 * Art that depicts a player's hero is stored only once the owner has looked at it
 * (.agents/skills/art-creation/SKILL.md, step 4). After the cutover a painting reaches the
 * game as a line in assets.lock.json, so this reads the lock at the PR's base and head and
 * lists every character path the PR adds or repaints. With any, the check fails unless the PR
 * carries the `art-approved` label, which the owner adds after looking. Each path is listed
 * with its link in the store, so the looking can happen from the PR.
 *
 * Removing art, and everything outside the character folders, needs no approval. Before the
 * cutover (no lock at head) there is nothing to read, and the cutover itself (a lock at head
 * but not at base) moves art already in git, so both pass; the skill's rule still stands
 * then, on review.
 *
 * Usage (in a workflow; BASE and HEAD are commit shas, LABELS the PR's labels as JSON):
 *     node tools/ci/character-art.mjs "$BASE" "$HEAD" --labels "$LABELS"
 * Writes the list to $GITHUB_STEP_SUMMARY when set. Exit 1 means approval is owed.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** The folders whose art shows a player's hero (the skill's step 4 names the same three). */
export const CHARACTER_ROOTS = ["assets/characters/", "assets/character-rigs/", "assets/gear-portraits/"];
export const APPROVAL_LABEL = "art-approved";
const LOCK_FILE = "assets.lock.json";

/**
 * The character paths `head` adds or repaints relative to `base`, sorted.
 * Each lock is `{ files: { [path]: { sha256, bytes } } }`, or null for none.
 */
export function characterChanges(base, head) {
  const before = base?.files ?? {};
  const after = head?.files ?? {};
  return Object.keys(after)
    .filter((p) => CHARACTER_ROOTS.some((root) => p.startsWith(root)))
    .filter((p) => before[p]?.sha256 !== after[p].sha256)
    .sort()
    .map((p) => ({ path: p, sha256: after[p].sha256, change: before[p] ? "repainted" : "added" }));
}

/** The blob's public link, as `npm run assets:url` gives it (packages/shared/src/asset-store.ts blobUrl). */
export function storeLink(storeUrl, sha256, path) {
  if (!storeUrl) return null;
  const dot = path.lastIndexOf(".");
  const ext = dot > path.lastIndexOf("/") ? path.slice(dot + 1).toLowerCase() : "";
  return `${storeUrl.replace(/\/+$/, "")}/sha256/${sha256.slice(0, 2)}/${sha256}${ext ? `.${ext}` : ""}`;
}

/** The verdict and its report, in Markdown. */
export function review({ changes, labels, storeUrl }) {
  if (changes.length === 0) return { ok: true, report: "No character art changes in this pull request." };
  const approved = labels.includes(APPROVAL_LABEL);
  const lines = changes.map((c) => {
    const link = storeLink(storeUrl, c.sha256, c.path);
    return `- ${c.change}: \`${c.path}\`${link ? ` ([view](${link}))` : ""}`;
  });
  const head = approved
    ? `Character art in this pull request, approved with the \`${APPROVAL_LABEL}\` label:`
    : `This pull request adds or repaints character art, which needs the owner's approval. ` +
      `Look at each painting at play size, then add the \`${APPROVAL_LABEL}\` label (the check re-runs on labeling):`;
  return { ok: approved, report: [head, "", ...lines].join("\n") };
}

function readAt(rev, file) {
  try {
    return execFileSync("git", ["show", `${rev}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { labels: { type: "string", default: "[]" } } });
  const [base, head] = positionals;
  if (!base || !head) {
    console.error('usage: node tools/ci/character-art.mjs BASE HEAD [--labels \'["art-approved"]\']');
    process.exit(2);
  }
  const headLock = readAt(head, LOCK_FILE);
  if (headLock === null) {
    console.log(`No ${LOCK_FILE} at ${head}: before the cutover, character art is reviewed by hand.`);
    return;
  }
  const baseLock = readAt(base, LOCK_FILE);
  if (baseLock === null) {
    console.log(`${LOCK_FILE} first appears in this change: the cutover moves art already in git, so there is nothing new to approve.`);
    return;
  }
  const config = JSON.parse(readAt(head, "assets.config.json") ?? "{}");
  const labels = JSON.parse(values.labels);
  const verdict = review({
    changes: characterChanges(JSON.parse(baseLock), JSON.parse(headLock)),
    labels: Array.isArray(labels) ? labels : [],
    storeUrl: config.storeUrl ?? null,
  });
  console.log(verdict.report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Character art\n\n${verdict.report}\n`);
  if (!verdict.ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
