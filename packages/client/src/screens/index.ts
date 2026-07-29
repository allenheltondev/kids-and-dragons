/**
 * The player-facing surface.
 *
 * Every export here takes **no props** and reads the store (store/contract.ts):
 * the layout shells in `layout/` decide *where* a screen renders, never *what*
 * it renders, which is what keeps WorldView and PlayerView from knowing the
 * room mode (architecture §4.6).
 *
 * | Export                 | Surface    | Rendered when                        |
 * |------------------------|------------|--------------------------------------|
 * | `HomeScreen`           | full page  | no session                           |
 * | `LobbyContent`         | WorldView  | phase === "lobby"                    |
 * | `NarrationPanel`       | WorldView  | phase is scene-like                  |
 * | `DiceOverlay`          | WorldView  | a ROLL presentation arrives          |
 * | `ChapterCompletePanel` | WorldView  | phase === "chapter_complete"         |
 * | `CreationPreview`      | WorldView  | phase === "creation"                 |
 * | `CreationFlow`         | PlayerView | phase === "creation" and I have none |
 * | `PlayerPanel`          | PlayerView | otherwise                            |
 * | `SignInFlow`           | PlayerView | somebody opened the keepsake offer   |
 *
 * `KeepsakeOffer` is the one exception to the no-props rule being *interesting*:
 * it also takes none, and renders nothing at all unless the deployment can
 * actually offer sign-in and this household has not already been claimed.
 */

export { HomeScreen } from "./HomeScreen";
export { LobbyContent } from "./LobbyContent";
export { NarrationPanel } from "./NarrationPanel";
export { DiceOverlay } from "./DiceOverlay";
export { ChapterCompletePanel } from "./ChapterCompletePanel";
export { CreationPreview } from "./CreationPreview";
export { CreationFlow } from "./CreationFlow";
export { PlayerPanel } from "./PlayerPanel";
export { SignInFlow, KeepsakeOffer } from "./SignInFlow";
export { KeepsakeLantern, type KeepsakeLanternProps, type LanternMote } from "./KeepsakeLantern";

/** Shared by every screen, and by anything else that renders game content. */
export { Icon, hasIcon, statIcon, speciesIcon, classIcon, itemKindIcon } from "./icons";
export type { IconProps } from "./icons";
