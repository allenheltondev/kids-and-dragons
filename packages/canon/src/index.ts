/**
 * @kad/canon — `canon/*.yaml` is the truth; this package is how everything else
 * reads it. See docs/canon-contract.md.
 *
 * Deliberately not part of `@kad/shared`: the client depends on shared and has
 * no use for canon, so Zod would land in the game bundle for nothing. The
 * server, the tools, the wiki generator and the sync job depend on this; the
 * client never does.
 */

export * from "./ids.js";
export * from "./envelope.js";
export * from "./lore.js";
export * from "./encounter.js";
export * from "./mechanics.js";
export * from "./taxonomies.js";
export * from "./parse.js";
export * from "./registry.js";

import path from "node:path";
import { parseCanon } from "./parse.js";
import { buildRegistry } from "./registry.js";
import type { CanonRegistry } from "./registry.js";

/** Parse + index in one call. The entry point every consumer actually wants. */
export function loadCanon(canonDir = path.join(process.cwd(), "canon")): CanonRegistry {
  return buildRegistry(parseCanon(canonDir));
}
