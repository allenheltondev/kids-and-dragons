/**
 * The in-progress character, shared between the phone doing the choosing and
 * the WorldView drawing the preview (spec §5: "the character rendering live on
 * WorldView as choices are made").
 *
 * WHY this is a module-local store and not run state: a draft is not a fact
 * about the run. `ClientIntent` has no DRAFT_CHARACTER message and `RunState`
 * has no draft field, so there is deliberately no way to put an unconfirmed
 * choice on the wire — only CREATE_CHARACTER is authoritative. That is the
 * right call for the server, and it means the live preview is exact in Travel
 * Mode (both surfaces are the same browser tab) and degrades to a "still
 * choosing" frame on a separate TV in Party Mode. When cross-device preview is
 * wanted, the fix is one new intent on the server plus swapping this module's
 * `useCreationDraft` for a store selector — no component changes.
 *
 * Written with `useSyncExternalStore` rather than zustand so `screens/` owns no
 * global state library decisions; the store package is the other half's.
 */

import { useSyncExternalStore } from "react";
import type { Appearance, ClassId, SpeciesId, Stats } from "@kad/shared";

/** The five screens of spec §5, in order. One decision each. */
export const CREATION_STEPS = ["species", "class", "stats", "appearance", "name"] as const;

export type CreationStep = (typeof CREATION_STEPS)[number];

export interface CreationDraft {
  step: CreationStep;
  species: SpeciesId | null;
  /** `class` is a reserved word in enough places that the field is `klass`. */
  klass: ClassId | null;
  /** Points the player has assigned, over and above base + species. */
  assigned: Stats;
  appearance: Appearance;
  name: string;
  /** True once CREATE_CHARACTER is in flight, so the preview can settle. */
  submitting: boolean;
}

export const NO_POINTS: Stats = { might: 0, quick: 0, clever: 0, heart: 0 };

export const EMPTY_DRAFT: CreationDraft = {
  step: "species",
  species: null,
  klass: null,
  assigned: NO_POINTS,
  appearance: { palette: "", accent: "" },
  name: "",
  submitting: false,
};

let current: CreationDraft = EMPTY_DRAFT;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setCreationDraft(next: CreationDraft): void {
  current = next;
  emit();
}

export function patchCreationDraft(patch: Partial<CreationDraft>): void {
  setCreationDraft({ ...current, ...patch });
}

export function resetCreationDraft(): void {
  setCreationDraft(EMPTY_DRAFT);
}

export function getCreationDraft(): CreationDraft {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCreationDraft(): CreationDraft {
  return useSyncExternalStore(subscribe, getCreationDraft, getCreationDraft);
}
