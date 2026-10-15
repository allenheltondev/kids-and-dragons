import { useEffect } from "react";
import { create } from "zustand";
import type { WorldAnchor } from "@kad/shared";

interface AtlasView {
  step: number;
  regionId: string | null;
  routeId: string | null;
  showRoutes: boolean;
  center: WorldAnchor | null;
}
const INITIAL: AtlasView = { step: 0, regionId: null, routeId: null, showRoutes: true, center: null };
const useNavigation = create<{ scope: string; view: AtlasView }>(() => ({ scope: "", view: INITIAL }));

/** Local navigation survives closing Map, but never crosses a run/chapter. */
export function updateAtlasView(scope: string, patch: Partial<AtlasView>): void {
  useNavigation.setState((state) => ({ scope, view: { ...(state.scope === scope ? state.view : INITIAL), ...patch } }));
}

export function useAtlasNavigation(scope: string): AtlasView {
  const view = useNavigation((state) => state.scope === scope ? state.view : INITIAL);
  useEffect(() => {
    if (useNavigation.getState().scope !== scope) updateAtlasView(scope, INITIAL);
  }, [scope]);
  return view;
}

export function resetAtlasNavigation(): void {
  useNavigation.setState({ scope: "", view: INITIAL });
}
