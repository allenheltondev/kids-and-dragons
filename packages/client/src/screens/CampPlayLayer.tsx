import { campMusicReaction } from "../world/friend-personality";
import { useEffect, useRef } from "react";
import { campMomentKind, type CampPlayMessage } from "@kad/shared";
import { useChapter, useGameStore, useRunState } from "../store";
import { cue } from "../audio";
import { campFamilyFor } from "../world/lobby-camp";
import { FetchScene, INSTRUMENTS } from "./CampActivities";
import "./CampPlayLayer.css";

const EMPTY: readonly (CampPlayMessage & { key: number })[] = [];
/** Read-only live play on the shared board. Delayed events cannot follow the party into a story. */
export function CampPlayLayer(): React.JSX.Element | null {
  const state = useRunState();
  const chapter = useChapter();
  const plays = useGameStore(s => s.campPlays ?? EMPTY);
  const drop = useGameStore(s => s.dropCampPlay);
  const heard = useRef(new Set<number>());
  const musicFriend = useRef({ at: -Infinity, turn: 0 });
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const downtime = state && campMomentKind(state) !== null;
  const live = plays.filter(p => downtime && p.runId === state.runId && p.momentId === state.campMoment?.id);
  useEffect(() => {
    for (const event of plays) {
      if (!state || !downtime || event.runId !== state.runId || event.momentId !== state.campMoment?.id) {
        clearTimeout(timers.current.get(event.key));
        timers.current.delete(event.key);
        heard.current.delete(event.key);
        drop(event.key);
        continue;
      }
      if (timers.current.has(event.key)) continue;
      if (!heard.current.has(event.key)) {
        heard.current.add(event.key);
        if (event.play.activity === "music") {
          cue(`camp-${event.play.instrument}`);
          const now = performance.now();
          if (now - musicFriend.current.at >= 4000) {
            const reaction = campMusicReaction(state, event.play.instrument, event.heroId, musicFriend.current.turn++);
            if (reaction) useGameStore.getState().reactFriend(reaction);
            musicFriend.current.at = now;
          }
        }
        else cue("whoosh");
      }
      const timer = setTimeout(() => { drop(event.key); timers.current.delete(event.key); heard.current.delete(event.key); }, event.play.activity === "music" ? 1800 : 5000);
      timers.current.set(event.key, timer);
    }
  }, [plays, drop, downtime, state?.runId, state?.campMoment?.id]);
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); }, []);
  if (!state || !downtime || live.length === 0) return null;
  const fetch = [...live].reverse().find(p => p.play.activity === "fetch");
  const friendId = fetch?.play.activity === "fetch" ? fetch.play.friendId : null;
  const friend = state.campMoment?.friends?.cards.find(f => f.id === friendId);
  const notes = live.filter(p => p.play.activity === "music").slice(-6);
  return <div className="camp-play-layer" aria-hidden="true">
    {fetch?.play.activity === "fetch" && friend ? <div className="camp-play-layer__fetch" key={fetch.key}><FetchScene friend={friend} toss={fetch.play} family={campFamilyFor(state, chapter)} playing /><span>{friend.name} plays fetch</span></div> : null}
    {notes.length > 0 ? <div className="camp-play-layer__music">{notes.map(p => p.play.activity === "music" ? <span key={p.key} className="camp-play-layer__note" data-instrument={p.play.instrument}>{INSTRUMENTS[p.play.instrument].sound} ♪</span> : null)}</div> : null}
  </div>;
}
