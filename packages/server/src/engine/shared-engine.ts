/**
 * The real binding: the engine port → `@kad/shared`.
 *
 * This is the **only** file in the server that imports the game rules, so if
 * `applyIntent`'s signature moves, exactly one file stops compiling. It also
 * hands back `makeRng`, because the dice must come from the same module as the
 * rules that consume them — a second PRNG in the server would mean a replay
 * could roll differently from the run it is replaying (architecture §4.1).
 *
 * The import is dynamic on purpose. `@kad/shared` is a source-level workspace
 * package compiled on the fly by `tsx`; loading it lazily means `/api/health`,
 * the static routes, and the SSE stream still answer when the engine module is
 * mid-edit — which is exactly when you want a dev server you can still talk to.
 */

import type { Rng } from "@kad/shared";
import type { Engine } from "./port.ts";

export interface SharedRuntime {
  engine: Engine;
  rng: (seed: string | number) => Rng;
}

let cached: Promise<SharedRuntime> | null = null;

export function loadSharedRuntime(): Promise<SharedRuntime> {
  if (!cached) {
    const pending = import("@kad/shared").then((shared) => ({
      engine: {
        applyIntent: shared.applyIntent,
        createRunState: shared.createRunState,
      },
      rng: shared.makeRng,
    }));
    // Drop a failed load so the next request retries the (possibly fixed) module.
    pending.catch(() => {
      if (cached === pending) cached = null;
    });
    cached = pending;
  }
  return cached;
}
