/**
 * What help is about right now.
 *
 * One "?" button lives in the corner row and asks this which surface the player is looking at, so
 * a surface never draws a button of its own (and so can never be covered by one, or cover one, at
 * any text size). Three things feed it:
 *   - the layout shell says which pane is up (`setHelpPane`), because only it knows;
 *   - a surface that is only mounted while it is showing claims itself (`HelpClaim`);
 *   - the rest is read off the run: a fight, the bag, a question.
 * A long-press asks for a thing's help through the same sheet (`showThingHelp`).
 */

import { useEffect } from "react";
import { create } from "zustand";
import type { HelpSurfaceId, HelpThingKind } from "@kad/shared";
import { useMe, useRunState } from "../store";
import { usePlayerNavigation } from "../store/player-navigation";

export type HelpPane = "player" | "world" | "map";

/** A thing somebody pressed and held: its own words if it has them, its kind's words if not. */
export interface HelpThing {
  kind: HelpThingKind;
  name: string;
  icon?: string;
  /** What it does, from its own content (an item's text, a card's summary). */
  text?: string;
}

interface HelpFocus {
  pane: HelpPane;
  claims: readonly HelpSurfaceId[];
  /** The sheet is open: for the surface the "?" names, or for a thing. */
  open: boolean;
  thing: HelpThing | null;
}

export const useHelpFocus = create<HelpFocus>(() => ({ pane: "player", claims: [], open: false, thing: null }));

export function setHelpPane(pane: HelpPane): void {
  useHelpFocus.setState({ pane });
}

export function openHelp(): void {
  useHelpFocus.setState({ open: true, thing: null });
}

export function showThingHelp(thing: HelpThing): void {
  useHelpFocus.setState({ open: true, thing });
}

export function closeHelp(): void {
  useHelpFocus.setState({ open: false, thing: null });
}

/** A surface that is mounted only while it is showing says so, for as long as it is. */
export function HelpClaim({ surface }: { surface: HelpSurfaceId }): null {
  useEffect(() => {
    useHelpFocus.setState((focus) => ({ claims: [...focus.claims, surface] }));
    return () => {
      useHelpFocus.setState((focus) => {
        const at = focus.claims.lastIndexOf(surface);
        return { claims: at === -1 ? focus.claims : focus.claims.filter((_, i) => i !== at) };
      });
    };
  }, [surface]);
  return null;
}

/** Which surface the player is looking at. */
export function useHelpSurface(): HelpSurfaceId {
  const pane = useHelpFocus((focus) => focus.pane);
  const claimed = useHelpFocus((focus) => focus.claims[focus.claims.length - 1]);
  const section = usePlayerNavigation((navigation) => navigation.section);
  const me = useMe();
  const fighting = useRunState()?.encounter != null;
  if (pane === "world") return "world";
  if (pane === "map") return "map";
  if (claimed !== undefined) return claimed;
  if (section === "guide") return "guide";
  if (me === null) return "creation";
  if (fighting) return "combat";
  return section === "bag" ? "inventory" : "story";
}
