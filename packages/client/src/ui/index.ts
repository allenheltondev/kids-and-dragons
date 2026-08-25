/**
 * Shared primitives only.
 *
 * The bar for landing here is "two screens owned by different people need to
 * agree on it". Character sheets, choice cards, dice faces, and inventory grids
 * are screen-owned; this is not a component library and should not grow into
 * one.
 *
 * Two things that are now shared and still deliberately did *not* land here,
 * because the bar is about ownership rather than about reuse count:
 *
 *   - `screens/CharacterPortrait` — six screens draw it, and it is still game
 *     domain: it takes a `SpeciesId` and a `TierId` and knows where the
 *     commissioned art lives. A primitive that has to be told what a species is
 *     is not a primitive. It is exported from `screens/index.ts`, which is
 *     where anything that knows about characters belongs.
 *   - the creation flow's option row and the prompt's `.choice` row. They are
 *     the same *idea* — icon, label, and a mark whose seat is reserved so
 *     choosing cannot reflow the row — at two sizes with two behaviours. What
 *     they genuinely share is a rule, not an implementation, and the rule is
 *     written down in both places rather than abstracted into a third.
 *
 * The CSS equivalent of this bar is `screens/shared.css`: `.kad-chip`,
 * `.kad-label`, `.kad-tap`. A declaration earns a place there once three or
 * four screens have each invented it separately.
 */

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button";
export { Panel, type PanelProps } from "./Panel";
export { Spinner, type SpinnerProps } from "./Spinner";
export { ScreenReaderOnly, type ScreenReaderOnlyProps } from "./ScreenReaderOnly";
export { ErrorToast } from "./ErrorToast";
export { ConnectionBanner, RECONNECT_GRACE_MS } from "./ConnectionBanner";
