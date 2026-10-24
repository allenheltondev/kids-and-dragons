import { useEffect } from "react";
import { markBooted } from "./booted";

/** Renders nothing. Its effect runs when the first render commits: the app has booted. */
export function BootMark(): null {
  useEffect(() => {
    markBooted();
  }, []);
  return null;
}
