import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { CAMP_INSTRUMENTS, fetchResult, fetchWords, type CampInstrument, type CampPlay, type CampFriendCard, type RunState } from "@kad/shared";
import { useChapter, useGameStore } from "../store";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import { castArtUrl } from "../world/art-paths";
import { campFamilyFor } from "../world/lobby-camp";
import { CREW_PIECE_ART, pieceName } from "../world/camp-scene";
import leaf from "../assets/painted/leaf.webp";
import feather from "../assets/painted/feather.webp";
import "./CampActivities.css";

export const INSTRUMENTS: Record<CampInstrument, { name: string; sound: string; piece: string }> = {
  log: { name: "Log drum", sound: "Tok", piece: "shop_log_bench" },
  pot: { name: "Cooking pot", sound: "Dong", piece: "cookfire_pot" },
  bells: { name: "Lantern bells", sound: "Ting", piece: "shop_lantern_string" },
};
const pieceUrl = (id: string): string | undefined => {
  const piece = CREW_PIECE_ART.find(p => p.id === id);
  return piece ? `/assets/${piece.path}` : undefined;
};
function FriendPicture({ friend }: { friend: CampFriendCard }): ReactElement {
  const [failed, setFailed] = useState(false);
  const src = castArtUrl(friend.figure);
  return src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : <Icon name="heart" size="3em" />;
}

function FetchGift({ friendId, missed }: { friendId: string; missed: boolean }): ReactElement {
  if (!missed || friendId === "bun" || friendId === "kid_goat") return <img src={leaf} alt="" />;
  if (friendId === "duckling") return <img src={feather} alt="" />;
  if (friendId === "quay_gull" || friendId === "silver_otter") return <svg viewBox="0 0 60 45" aria-hidden="true"><path d="M7 29C4 19 18 8 31 9S56 20 53 31Q39 42 19 37Z" fill="#a2b6b0" stroke="#526a60" strokeWidth="3" /><path d="M17 22Q29 13 40 21" fill="none" stroke="#e4eee4" strokeWidth="3" /></svg>;
  return <svg viewBox="0 0 60 45" aria-hidden="true"><path d="M8 35L50 12M28 24L25 10M39 18L48 24" fill="none" stroke="#5b3b23" strokeWidth="8" strokeLinecap="round" /><path d="M8 33L50 10M28 22L25 8M39 16L48 22" fill="none" stroke="#bb8f53" strokeWidth="4" strokeLinecap="round" /></svg>;
}

type Toss = Extract<CampPlay, { activity: "fetch" }>;
/** The throw, chase, and return use exactly the same coordinates and verdict on every screen. */
export function FetchScene({ friend, toss, family, playing = false }: { friend: CampFriendCard; toss: Toss; family: string; playing?: boolean }): ReactElement {
  const result = fetchResult(toss);
  const style = {
    "--fetch-target": `${toss.target}%`, "--fetch-x": `${toss.aim}%`,
    "--fetch-y": `${80 - toss.strength * 0.55}%`,
    backgroundImage: `linear-gradient(transparent 40%, #243e2c66), url('/assets/camp/backdrops/${family}.webp')`,
  } as CSSProperties;
  return (
    <div className={`camp-fetch__scene${playing ? " is-playing" : ""}`} style={style} role="img" aria-label={playing ? fetchWords(friend.name, friend.id, result) : `${friend.name} waits at the ring. Match your leaf's landing spot to the ring.`}>
      <span className="camp-fetch__ring" aria-hidden="true" />
      <span className="camp-fetch__friend" aria-hidden="true"><FriendPicture friend={friend} /></span>
      <img className="camp-fetch__leaf" src={leaf} alt="" />
      {!playing ? <span className="camp-fetch__landing" aria-hidden="true">+</span> : null}
      {playing ? <span className="camp-fetch__return" aria-hidden="true"><FetchGift friendId={friend.id} missed={result === "search"} /></span> : null}
    </div>
  );
}

export function CampFetch({ state, held }: { state: RunState; held: boolean }): ReactElement {
  const chapter = useChapter();
  const playCamp = useGameStore(s => s.playCamp);
  const friends = state.campMoment?.friends;
  const out = friends?.cards.filter(f => friends.out.includes(f.id)) ?? [];
  const [friendId, setFriend] = useState(out[0]?.id ?? "");
  const friend = out.find(f => f.id === friendId) ?? out[0];
  const [aim, setAim] = useState(45);
  const [strength, setStrength] = useState(40);
  const [target, setTarget] = useState(70);
  const [toss, setToss] = useState<Toss | null>(null);
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState("");
  const id = useId();
  useEffect(() => {
    if (!toss) return;
    const timer = setTimeout(() => { setBusy(false); setTarget(t => t === 70 ? 30 : 70); }, 5000);
    return () => clearTimeout(timer);
  }, [toss]);
  if (!state.campMoment?.outdoor) return <p className="camp-panel__rule">Fetch waits until your crew is camping outdoors.</p>;
  if (!friend) return <p className="camp-panel__rule">Make a friend on an adventure, then come back here for a game of fetch.</p>;
  const preview: Toss = { activity: "fetch", friendId: friend.id, aim, strength, target };
  const throwLeaf = async (): Promise<void> => {
    if (busy || held) return;
    setBusy(true);
    setToss(null);
    if (await playCamp(preview)) {
      setToss(preview);
      setWords(fetchWords(friend.name, friend.id, fetchResult(preview)));
    } else { setBusy(false); setWords("That toss did not reach camp. Try again in a moment."); }
  };
  return (
    <section className="camp-activity" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Friend fetch</h3>
      <p>Line up the leaf with the ring. Your friend will bring something back!</p>
      <div className="camp-fetch__picks" aria-label="Fetch friends">
        {out.map(f => <button type="button" className="camp-fetch__pick kad-focusable" key={f.id} aria-pressed={friend.id === f.id} disabled={busy || held} onClick={() => { setFriend(f.id); setToss(null); setWords(""); }}><FriendPicture friend={f} /><span>{f.name}</span></button>)}
      </div>
      <FetchScene key={toss ? `${toss.aim}:${toss.strength}:${toss.target}` : "aim"} friend={friend} toss={busy && toss ? toss : preview} family={campFamilyFor(state, chapter)} playing={busy && toss !== null} />
      <div className="camp-fetch__controls">
        <label>Direction <span>Left to right</span><input aria-label="Throw direction" type="range" min="10" max="90" value={aim} disabled={busy || held} onChange={e => { setAim(Number(e.target.value)); setToss(null); }} /></label>
        <label>Distance <span>Near to far</span><input aria-label="Throw distance" type="range" min="10" max="90" value={strength} disabled={busy || held} onChange={e => { setStrength(Number(e.target.value)); setToss(null); }} /></label>
      </div>
      <Button block size="md" variant="primary" disabled={busy || held} onClick={() => void throwLeaf()}>{busy ? `${friend.name} is fetching…` : "Toss the leaf"}</Button>
      <p role="status" className="camp-activity__words">{words}</p>
    </section>
  );
}

export function CampMusic({ held }: { held: boolean }): ReactElement {
  const playCamp = useGameStore(s => s.playCamp);
  const [notes, setNotes] = useState<CampInstrument[]>([]);
  const [words, setWords] = useState("");
  const [sending, setSending] = useState(false);
  const id = useId();
  const tap = async (instrument: CampInstrument): Promise<void> => {
    if (sending || held) return;
    setSending(true);
    const sent = await playCamp({ activity: "music", instrument });
    if (sent) { setNotes(n => [...n, instrument].slice(-12)); setWords(INSTRUMENTS[instrument].sound + "!"); }
    else setWords("Give that a moment, then tap again.");
    setSending(false);
  };
  return (
    <section className="camp-activity" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Camp band</h3>
      <p>Tap a rhythm together. Listen on the shared screen, or in your World view.</p>
      <div className="camp-band__instruments">
        {CAMP_INSTRUMENTS.map(instrument => <button type="button" key={instrument} className="camp-band__instrument kad-focusable" disabled={held || sending} onClick={() => void tap(instrument)}><img src={pieceUrl(INSTRUMENTS[instrument].piece)} alt="" /><strong>{INSTRUMENTS[instrument].name}</strong><span>{INSTRUMENTS[instrument].sound}</span></button>)}
      </div>
      <div className="camp-band__trail" aria-label="Your last notes">{notes.map((n, i) => <span key={i} data-instrument={n}>{INSTRUMENTS[n].sound}</span>)}</div>
      <p role="status" className="camp-activity__words">{words}</p>
    </section>
  );
}

export function CampTreasures({ pieces, sources }: { pieces: readonly string[]; sources: Readonly<Record<string, string>> }): ReactElement {
  const [picked, setPicked] = useState<string | null>(null);
  const id = useId();
  const owned = [...new Set([...pieces, ...Object.keys(sources)])].filter(p => CREW_PIECE_ART.some(a => a.id === p));
  const shown = picked && owned.includes(picked) ? picked : owned[0];
  return (
    <section className="camp-activity" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Our treasures</h3>
      <p>Every treasure has a story. Pick one to remember yours.</p>
      {shown ? <>

        <div className="camp-treasures__memory" role="status">
          <img src={pieceUrl(shown)} alt="" />
          <div><h4>{pieceName(shown)}</h4><p>{sources[shown] ?? "Part of your crew's camp"}</p><span>What do you remember about bringing it home?</span></div>
        </div>
        <div className="camp-treasures__shelf" aria-label="Your crew's treasures">{owned.map(piece => <button type="button" key={piece} className="camp-treasures__pick kad-focusable" aria-pressed={piece === shown} onClick={() => setPicked(piece)}><img src={pieceUrl(piece)} alt="" /><span>{pieceName(piece)}</span></button>)}</div>
      </> : <p className="camp-panel__rule">Your collection is just beginning. Things your crew finds on adventures will be waiting here.</p>}
    </section>
  );
}

export function CampActivities({ state, held }: { state: RunState; held: boolean }): ReactElement {
  const [activity, setActivity] = useState<"fetch" | "music" | "treasures" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (activity) {
      previous.current = activity;
      const heading = root.current?.querySelector("h3");
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      root.current?.scrollIntoView?.({ block: "start" });
    } else if (previous.current) root.current?.querySelector<HTMLButtonElement>(`[data-activity="${previous.current}"]`)?.focus();
  }, [activity]);
  return <div className="camp-activities" ref={root}>
    {activity ? <Button variant="ghost" size="md" onClick={() => setActivity(null)} icon={<Icon name="back" />}>Back to activities</Button> : null}
    {!activity ? <div className="camp-activities__menu" aria-label="Things to play at camp">
      <button type="button" className="camp-play__choice kad-focusable" data-activity="fetch" onClick={() => setActivity("fetch")}><Icon name="heart" /><strong>Friend fetch</strong><span>Aim a leaf. See what comes back.</span><Icon name="forward" /></button>
      <button type="button" className="camp-play__choice kad-focusable" data-activity="music" onClick={() => setActivity("music")}><Icon name="star" /><strong>Camp band</strong><span>Make a little music together.</span><Icon name="forward" /></button>
      <button type="button" className="camp-play__choice kad-focusable" data-activity="treasures" onClick={() => setActivity("treasures")}><Icon name="bag" /><strong>Our treasures</strong><span>Look closer. Remember an adventure.</span><Icon name="forward" /></button>
    </div> : null}
    {activity === "fetch" ? <CampFetch state={state} held={held} /> : null}
    {activity === "music" ? <CampMusic held={held} /> : null}
    {activity === "treasures" ? <CampTreasures pieces={state.camp?.owned ?? []} sources={state.camp?.sources ?? {}} /> : null}
  </div>;
}
