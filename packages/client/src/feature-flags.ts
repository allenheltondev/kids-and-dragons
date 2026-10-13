/**
 * Build-time feature flags, read in one place.
 *
 * `VITE_FIELD_GUIDE` gates the Field Guide (epic #101) until launch (#112).
 *
 *  - Unset: ON under `import.meta.env.DEV`, OFF otherwise. `npm run dev`,
 *    vitest (mode "test") and the Playwright suite (whose webServer runs
 *    `npm run dev`) therefore exercise the work with no extra env, while
 *    `vite build` (staging and production) ships it dark.
 *  - Set: "true"/"1" forces it on, anything else ("false", "0", "") forces it
 *    off, so `VITE_FIELD_GUIDE=false npm run dev` previews the player view.
 *
 * Tests flip it with `setFieldGuideOverride(true | false)` and restore it with
 * `setFieldGuideOverride(null)`.
 */

let override: boolean | null = null;

export function setFieldGuideOverride(value: boolean | null): void {
  override = value;
}

export function fieldGuideEnabled(): boolean {
  if (override !== null) return override;
  const raw = import.meta.env.VITE_FIELD_GUIDE as string | undefined;
  if (raw === undefined) return import.meta.env.DEV === true;
  return raw === "true" || raw === "1";
}
