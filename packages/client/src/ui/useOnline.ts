import { useEffect, useState } from "react";

/** What the browser believes right now. No window (SSR, tests) counts as online. */
function readOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

/**
 * Whether the device thinks it has a network, from `navigator.onLine` and the
 * window `online` / `offline` events. A hint only: "online" can still be a
 * dead Wi-Fi, which the channel's own retries cover.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(readOnline);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const up = (): void => {
      setOnline(true);
    };
    const down = (): void => {
      setOnline(false);
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    setOnline(readOnline());
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
