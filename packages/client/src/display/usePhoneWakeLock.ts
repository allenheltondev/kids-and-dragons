import { useEffect } from "react";
import { useRoute } from "../router";
import { useConnection, useSession } from "../store";
import { loadSharedDevice } from "../store/persistence";
import { shouldHoldPhoneWake } from "./phone-wake";
import { keepAwake } from "./wake-lock";

/**
 * Hold the screen awake on a phone while its room is open (#463). A refused or
 * missing lock is silent, as on the TV. Released on leaving the room.
 */
export function usePhoneWakeLock(): void {
  const route = useRoute();
  const connection = useConnection();
  const playerId = useSession()?.playerId ?? "";
  const hold = shouldHoldPhoneWake({
    route,
    connection,
    playerId,
    sharedDevice: sharedTablet(),
  });
  useEffect(() => {
    if (!hold) return;
    const lock = keepAwake();
    return () => { lock.stop(); };
  }, [hold]);
}

function sharedTablet(): boolean {
  try {
    return loadSharedDevice() !== null;
  } catch {
    return false;
  }
}
