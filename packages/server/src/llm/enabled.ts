/**
 * The kill switch — architecture §6.6.
 *
 * "`LIVE_LLM_ENABLED=false` disables the entire live layer. The game remains
 * fully playable."
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS OPT-*IN* RATHER THAN OPT-OUT
 *
 * §6.6 phrases it as a switch you turn off, which implies a default of on. This
 * reads the variable the other way round: **anything but an explicit `true` is
 * off.**
 *
 * The reason is what each default costs when it is wrong. A layer that is off
 * when somebody meant it on costs one evening of slightly plainer narration and
 * announces itself the moment anybody looks. A layer that is on when nobody
 * meant it on is unreviewed text on a television in a child's living room, plus
 * a bill — and it announces itself to nobody. Those are not symmetrical, so the
 * variable is not either.
 *
 * The same asymmetry decides the region check below. A misconfigured region
 * does not turn the layer off loudly, it turns it into a DNS failure per call;
 * refusing to build a narrator without one keeps the failure at boot, where
 * somebody is looking.
 */

/**
 * Whether this process may make live calls.
 *
 * Exact-match on `"true"` rather than truthiness: `LIVE_LLM_ENABLED=false` is
 * a non-empty string, and every "is this set?" check ever written turns that
 * into on.
 */
export function liveEnabled(env: Record<string, string | undefined>): boolean {
  return env.LIVE_LLM_ENABLED === "true";
}

/** The region the layer would call in, or null if it cannot be determined. */
export function liveRegion(env: Record<string, string | undefined>): string | null {
  return env.LIVE_LLM_REGION ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? null;
}
