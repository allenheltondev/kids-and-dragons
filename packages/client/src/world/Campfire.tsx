import { useEffect, useState } from "react";
import { CAMP_ART } from "./art-paths";
import "./Campfire.css";

/** Both paintings share a canvas: only the registered flame moves, anchored at the logs. */
export function Campfire({ active = true }: { active?: boolean }): React.JSX.Element {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const [baseFailed, setBaseFailed] = useState(false);
  const [flameFailed, setFlameFailed] = useState(false);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);

  return <svg className="campfire" viewBox="0 0 1024 1024" aria-hidden="true"
    data-flicker={active && visible ? "on" : "off"}>
    {!baseFailed && <image href={CAMP_ART.fire} width="1024" height="1024" onError={() => setBaseFailed(true)} />}
    {!baseFailed && !flameFailed && <image className="campfire__flame" href={CAMP_ART.flame}
      width="1024" height="1024" onError={() => setFlameFailed(true)} />}
  </svg>;
}
