import { useEffect } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { WorldAnchor } from "@kad/shared";

interface AtlasView {
  step: number;
  routeId: string | null;
  showRoutes: boolean;
  center: WorldAnchor | null;
}
const INITIAL: AtlasView = { step: 0, routeId: null, showRoutes: true, center: null };
const useNavigation = create<{ scope: string; view: AtlasView }>(() => ({ scope: "", view: INITIAL }));

/** Local navigation survives closing Map, but never crosses a run/chapter. */
export function updateAtlasView(scope: string, patch: Partial<AtlasView>): void {
  useNavigation.setState((state) => ({ scope, view: { ...(state.scope === scope ? state.view : INITIAL), ...patch } }));
}

/** Read only when restoring/recentering, not as a render subscription. */
export function getAtlasCenter(scope: string): WorldAnchor | null {
  const state = useNavigation.getState();
  return state.scope === scope ? state.view.center : null;
}

export function useAtlasNavigation(scope: string): Omit<AtlasView, "center"> {
  // Scroll saves must not render the whole atlas. Keep only visual settings
  // reactive, with stable selector identity while just the center changes.
  const view = useNavigation(useShallow((state) => {
    const settings = state.scope === scope ? state.view : INITIAL;
    return { step: settings.step, routeId: settings.routeId, showRoutes: settings.showRoutes };
  }));
  useEffect(() => {
    if (useNavigation.getState().scope !== scope) updateAtlasView(scope, INITIAL);
  }, [scope]);
  return view;
}

export function resetAtlasNavigation(): void {
  useNavigation.setState({ scope: "", view: INITIAL });
}
