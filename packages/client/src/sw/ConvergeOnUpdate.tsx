import { useConvergeOnUpdate } from "./converge";

/**
 * Renders nothing: a home for `useConvergeOnUpdate` (#456) that App loads
 * after first paint, like the help and sound controls, so the update reload's
 * calm rules (`calm.ts`, `busy.ts`) cost the join screen nothing.
 */
export function ConvergeOnUpdate(): null {
  useConvergeOnUpdate();
  return null;
}
