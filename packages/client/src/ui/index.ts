/**
 * Shared primitives only.
 *
 * The bar for landing here is "two screens owned by different people need to
 * agree on it". Character sheets, choice cards, dice faces, and inventory grids
 * are screen-owned; this is not a component library and should not grow into
 * one.
 */

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button";
export { Panel, type PanelProps } from "./Panel";
export { Spinner, type SpinnerProps } from "./Spinner";
export { ScreenReaderOnly, type ScreenReaderOnlyProps } from "./ScreenReaderOnly";
export { ErrorToast } from "./ErrorToast";
