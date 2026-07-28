/**
 * RFC 6902 helpers, typed against the protocol's `JsonPatchOp`.
 *
 * `fast-json-patch` ships CommonJS with an `.mjs` sibling that Node does not
 * select (no `exports` map), so Node's ESM loader cannot see its named exports
 * and `import { compare }` throws at startup — under a bundler it works, which
 * is exactly the sort of difference that shows up only when you run the real
 * server. Importing the default and unwrapping it here means one file knows
 * that, instead of every call site.
 */

import jsonpatch from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import type { JsonPatchOp } from "@kad/shared";

/** The patch that turns `previous` into `next`. */
export function diff(previous: unknown, next: unknown): JsonPatchOp[] {
  return jsonpatch.compare(previous as object, next as object) as JsonPatchOp[];
}

/** Applies a patch to a *copy* — the input document is never mutated. */
export function applyOps<T>(document: T, ops: JsonPatchOp[]): T {
  return jsonpatch.applyPatch(jsonpatch.deepClone(document), ops as Operation[]).newDocument;
}

export const deepClone = jsonpatch.deepClone as <T>(value: T) => T;
