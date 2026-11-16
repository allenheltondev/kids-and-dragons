import { useEffect, useRef } from "react";
import { useGameStore, useRunState } from "../store";
import { campFriendMoment } from "../world/friend-personality";

/** Only the shared World surface runs this. All motion uses the camp's existing safe paths. */
export function CampFriendsLife(): null {
  const state = useRunState();
  const latest = useRef(state);
  latest.current = state;
  const moment = state?.campMoment;
  const hasFriends = Boolean(moment?.outdoor && moment.friends?.out.length);
  useEffect(() => {
    if (!hasFriends) return;
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    const react = (): void => {
      const now = latest.current;
      if (now && now.runId === state?.runId && now.campMoment?.id === moment?.id) {
        const reaction = campFriendMoment(now, step++);
        if (reaction) useGameStore.getState().reactFriend(reaction);
      }
      timer = setTimeout(react, 18000);
    };
    timer = setTimeout(react, 8000);
    return () => clearTimeout(timer);
  }, [state?.runId, moment?.id, hasFriends]);
  return null;
}
