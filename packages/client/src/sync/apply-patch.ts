/**
 * A structural-sharing JSON Patch apply.
 *
 * fast-json-patch's `applyPatch(doc, patch, false, false)` deep-clones the
 * *entire* document before touching it, which on every server message meant a
 * whole new RunState — every array, every character sheet — so every selector's
 * reference changed on every patch and React re-rendered surfaces whose data
 * had not moved.
 *
 * This applies the same operations but clones only the spine: the root and the
 * containers along each operation's path get a shallow copy, and the ops are
 * then applied in place on those copies. Untouched subtrees keep their exact
 * identity, so `state.party[1]` after a patch to `/party/0/hp` is the same
 * object it was before — which is what keeps zustand's snapshot comparisons
 * (store/index.ts) honest and cheap.
 *
 * The original document is never mutated: a half-applied patch can only exist
 * on the working copy, which is thrown away if an operation throws.
 */

import { applyOperation } from "fast-json-patch";
import type { Operation } from "fast-json-patch";

/** RFC 6901: `~1` is `/`, `~0` is `~` — in that order, or `~01` decodes wrong. */
function unescapeSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

function shallowClone<T>(value: T): T {
  if (Array.isArray(value)) return value.slice() as T;
  return { ...value };
}

/**
 * Clone every container from the root down to the operation's *parent*.
 *
 * The last pointer segment names the slot being written, so its parent is the
 * deepest thing that mutates; everything past it is either replaced wholesale
 * or untouched. `cloned` remembers what this patch already copied, so two ops
 * on `/party/0/...` share one copy of `party` and `party[0]` rather than
 * copying them again (which would drop the first op's write).
 */
function cloneAlongPath(
  root: Record<string, unknown> | unknown[],
  pointer: string,
  cloned: Set<unknown>,
): void {
  if (pointer === "" || pointer === "/") return;
  const segments = pointer.split("/").slice(1).map(unescapeSegment);

  let parent: Record<string, unknown> | unknown[] = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i] as string;
    const child: unknown = Array.isArray(parent) ? parent[Number(key)] : parent[key];
    // A missing or scalar step means the op will fail in applyOperation with
    // its usual error — nothing here to clone, and nothing shared to protect.
    if (!isContainer(child)) return;
    if (!cloned.has(child)) {
      const copy = shallowClone(child);
      if (Array.isArray(parent)) parent[Number(key)] = copy;
      else parent[key] = copy;
      cloned.add(copy);
      parent = copy;
    } else {
      parent = child;
    }
  }
}

/**
 * Apply `patch` to `doc`, returning a new root that shares every subtree the
 * patch did not touch. `doc` itself is left untouched.
 */
export function applyPatchShared<T extends object>(doc: T, patch: readonly Operation[]): T {
  let root = shallowClone(doc) as Record<string, unknown> | unknown[];
  const cloned = new Set<unknown>([root]);

  for (const op of patch) {
    cloneAlongPath(root, op.path, cloned);
    // `move` and `copy` also *read* from `from`; move mutates its parent too.
    if (op.op === "move" || op.op === "copy") cloneAlongPath(root, op.from, cloned);
    // mutateDocument: true — mutating is safe (and the point) because every
    // container this op can reach was just copied above.
    const result = applyOperation(root, op as Operation, false, true);
    // A root-path op ("" pointer) replaces the document rather than mutating.
    root = result.newDocument as Record<string, unknown> | unknown[];
  }

  return root as T;
}
