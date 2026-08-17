/**
 * Turning the live layer on, once, in one place.
 *
 * Both entry points call this and neither of them decides anything: whether the
 * layer runs is a function of the environment and of `content`, and having two
 * copies of that decision is how the two entry points end up disagreeing about
 * what "on" means.
 *
 * Returns `undefined` when the layer is off, which is the same thing
 * `HandlerDeps.narrator` being unset means — so an entry point can spread this
 * into its deps without a conditional, and there is no third state where
 * something is half-installed.
 */

import type { ContentStore } from "../content/loader.ts";
import { createNarrator } from "./narrator.ts";
import type { Narrator } from "./port.ts";
import { assertCacheHits, liveEnabled, liveRegion } from "./enabled.ts";

export function installNarrator(
  content: ContentStore,
  env: Record<string, string | undefined> = process.env,
  log: (line: string) => void = (line) => { console.log(line); },
): Narrator | undefined {
  if (!liveEnabled(env)) return undefined;

  const region = liveRegion(env);
  if (region === null) {
    /*
     * Loud, and off. Without a region the Bedrock client builds a base URL for
     * `bedrock-mantle.undefined.api.aws` and every prefetch becomes a DNS
     * failure — silent, because prefetch failures are silent by design. Better
     * to say so once at boot than to look like a layer that is simply never
     * finding anything.
     */
    log("LIVE_LLM_ENABLED=true but no AWS region is set. The live layer is OFF.");
    return undefined;
  }

  log(`live narration: on, ${region}`);
  return createNarrator({
    rules: content.rules(),
    awsRegion: region,
    assertCache: assertCacheHits(env),
    log,
  });
}
