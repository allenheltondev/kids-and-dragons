/**
 * Graph proofs: a graph campaign's full route search, done once and recorded.
 *
 * `lintCampaignGraph` walks every state a party can reach (Riftlight: over a
 * hundred thousand, about seven seconds). `content:validate` runs it on every
 * check, and records a clean walk in `content/graph-proofs/<campaign>.json`
 * (`npm run content:proofs`): the campaign's fingerprint, the checker's, how
 * far the walk went and the warnings it gave.
 *
 * The server's loader trusts a proof whose fingerprint matches the content it
 * loaded, and otherwise walks as it always did. So a server never starts on a
 * graph nobody walked, and a server whose content CI validated starts in
 * milliseconds. The validator also needs the checker's fingerprint to match
 * (its own source, which it can read and a deployed bundle cannot), so a
 * changed checker re-walks every campaign once.
 *
 * The fingerprint is a stable hash of exactly what the walk reads: the
 * campaign's `graph` and `routeSets`, and the flags each chapter it names can
 * write. Prose, art and anything else in a chapter can change freely.
 */

import type { Campaign } from "./types/chapter.js";
import type { ChapterFlagWrites, GraphFinding } from "./campaign-graph-lint.js";

/** One campaign's recorded walk, as `content/graph-proofs/<id>.json` holds it. */
export interface GraphProof {
  campaign: string;
  /** {@link graphFingerprint} of the content the walk read. */
  fingerprint: string;
  /** The checker's own fingerprint when it walked: the validator's business. */
  checker: string;
  /** States the walk visited; it ran to completion, or there is no proof. */
  states: number;
  /** The walk's warnings, so a proven campaign still reports them. */
  warnings: Pick<GraphFinding, "path" | "code" | "message" | "hint">[];
}

/** Where a campaign's proof lives, relative to the content root. */
export function graphProofPath(campaignId: string): string {
  return `graph-proofs/${campaignId}.json`;
}

/**
 * What the walk reads, hashed. Chapters are taken in the order the graph names
 * them (node chapters, then variants), each once.
 */
export function graphFingerprint(
  campaign: Pick<Campaign, "graph" | "routeSets">,
  chapterFlags: (chapter: string) => ChapterFlagWrites | undefined,
): string {
  const chapters: string[] = [];
  for (const node of Object.values(campaign.graph?.nodes ?? {})) {
    for (const id of [node.chapter, ...(node.variants ?? []).map((v) => v.chapter)]) {
      if (!chapters.includes(id)) chapters.push(id);
    }
  }
  const writes = chapters.map((id) => [id, chapterFlags(id) ?? null]);
  return stableHash(JSON.stringify([campaign.graph ?? null, campaign.routeSets ?? null, writes]));
}

/**
 * A 128-bit hash of a string, as hex: four interleaved 32-bit FNV-1a lanes.
 * Not cryptographic, and it need not be: it tells content apart from content
 * edited since its walk, not from an attacker. Pure, so it runs anywhere
 * shared code does.
 */
export function stableHash(text: string): string {
  const lanes = [0x811c9dc5, 0x01000193 ^ 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    for (let lane = 0; lane < 4; lane++) {
      lanes[lane] = Math.imul(lanes[lane]! ^ (code + lane * 0x9e37), 0x01000193) >>> 0;
    }
  }
  return lanes.map((lane) => lane.toString(16).padStart(8, "0")).join("");
}
