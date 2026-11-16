import { useRef, useState, type CSSProperties } from "react";
import { carryState, crossingOpenings, crossingPhase, crossingSafe, crossingWindow, interactionActor, skillSteps, throwFlight, throwSituation,
  type InteractionAction, type InteractionPrompt, type PartyMember } from "@kad/shared";
import { HeroImage } from "../world/hero-art-dom";
import { reducedMotion } from "../a11y/prefs";
import { propUrl } from "./InteractionArt";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import "./RiftlightSkillGame.css";

function Prop({ id, className, style }: { id?: string; className: string; style?: CSSProperties }) {
  const [failed, setFailed] = useState(false);
  return id && !failed ? <img src={propUrl(id)} className={className} style={style} alt="" draggable={false} onError={() => setFailed(true)} />
    : <span className={`${className} rift-prop-fallback`} style={style} aria-hidden="true"><Icon name="star" /></span>;
}

/** The landscape is the board. Every scored quantity below comes from the shared rules. */
export function RiftlightSkillGame({ prompt, party, now, playerId, props = [], watcher, busy, send }: {
  prompt: InteractionPrompt; party: PartyMember[]; now: number; playerId?: string; props?: string[]; watcher?: string; busy?: boolean;
  send?: (action: InteractionAction) => Promise<boolean>;
}) {
  const game = prompt.challenge!;
  const spec = prompt.spec;
  const members = party.filter(m => m.connected);
  const ids = members.map(m => m.playerId);
  const actor = interactionActor(prompt, ids);
  const mine = actor === playerId;
  const active = prompt.phase === "active";
  const still = reducedMotion();
  const [strength, setStrength] = useState(0.45);
  const [angle, setAngle] = useState(0.5);
  const [moment, setMoment] = useState(0.1);
  const [error, setError] = useState(false);
  const sending = useRef(false);
  const gesture = useRef<number | null>(null);
  const acting = members.find(m => m.playerId === actor);
  const post = async (action: InteractionAction) => {
    if (!send || busy || sending.current) return;
    sending.current = true; setError(false);
    try { setError(!await send(action)); } catch { setError(true); } finally { sending.current = false; }
  };
  const commit = (extra: { position?: number; angle?: number } = {}) => void post({ action: "commit", round: game.round, ...extra });
  const hero = (id: string | undefined, className: string, style?: CSSProperties) => {
    const member = members.find(m => m.playerId === id);
    return member ? <span className={className} style={style}><HeroImage hero={member.character} place="world" alt="" /><small>{member.character.name}</small></span> : null;
  };
  const progress = <div className="rift-progress" aria-label={`${game.progress} of ${skillSteps(prompt, ids)} stages complete`}>
    {Array.from({ length: skillSteps(prompt, ids) }, (_, i) => <span key={i} data-done={i < game.progress} data-current={i === game.progress}>{i < game.progress ? "✓" : i + 1}</span>)}
  </div>;
  let body;
  if (spec.kind === "precision") {
    const situation = throwSituation(prompt.phase === "result" && prompt.outcome === "success"
      ? { ...prompt, challenge: { ...game, progress: Math.max(0, game.progress - 1) } } : prompt);
    const flight = throwFlight(prompt, strength, angle);
    const x = (n: number) => 10 + n * 78;
    const y = (n: number) => 78 - n * 80;
    const landing = Math.max(-0.08, Math.min(1.08, flight.landing));
    const points = Array.from({ length: 25 }, (_, i) => {
      const t = i / 24;
      return `${x(landing * t)},${y(4 * flight.peak * t * (1 - t))}`;
    }).join(" ");
    const setAim = (event: React.PointerEvent<HTMLElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      setStrength(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)));
      setAngle(Math.max(0, Math.min(1, 1 - (event.clientY - box.top) / box.height)));
    };
    body = <>
      <p className="rift-read">{situation.wind > 0 ? "Wind carries right →" : "← Wind carries left"}<span>Clear the edge. Land inside the gold.</span></p>
      <div className="rift-field rift-field--throw" data-still={still}>
        <div className="rift-ground" />
        <div className="rift-obstacle" style={{ left: `${x(situation.target / 2)}%`, height: `${situation.clearance * 80}%` }} aria-hidden="true" />
        <div className="rift-landing" style={{ left: `${x(situation.target - situation.width / 2)}%`, width: `${situation.width * 78}%` }}><Prop key={props[1]} id={props[1]} className="rift-destination" /></div>
        {hero(actor, "rift-hero rift-hero--thrower")}
        {mine && active && <svg className="rift-trajectory" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /><circle cx={x(landing)} cy={y(0)} r="1.5" /></svg>}
        <Prop key={props[0]} id={props[0]} className="rift-object" style={{ left: `${x(mine && active ? landing : 0)}%` }} />
        {game.lastThrow && <span key={game.round} className="rift-flight" data-good={game.lastThrow.good} style={{ "--landing": `${x(game.lastThrow.landing)}%`, "--halfway": `${x(game.lastThrow.landing / 2)}%`, "--peak": `${22 + game.lastThrow.peak * 80}%` } as CSSProperties}><Prop id={props[0]} className="rift-flight__object" /></span>}
        {mine && active && !still && <div className="rift-aim-surface" aria-hidden="true"
          onPointerDown={event => { if (event.button !== 0 || busy) return; gesture.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); setAim(event); }}
          onPointerMove={event => { if (gesture.current === event.pointerId) setAim(event); }}
          onPointerUp={() => { gesture.current = null; }} onPointerCancel={() => { gesture.current = null; }} onLostPointerCapture={() => { gesture.current = null; }} />}
      </div>
      {mine && active && send ? <>
        <p className="rift-hint">Drag to aim: across for strength, up for a higher arc.</p>
        <div className="rift-aim-controls">
          <label>Strength <output>{Math.round(strength * 100)}%</output><input aria-label="Throw strength" type="range" min="0" max="100" value={Math.round(strength * 100)} disabled={busy} onChange={e => setStrength(Number(e.target.value) / 100)} /></label>
          <label>Arc <output>{angle < 0.35 ? "Low" : angle > 0.65 ? "High" : "Middle"}</output><input aria-label="Throw height" type="range" min="0" max="100" value={Math.round(angle * 100)} disabled={busy} onChange={e => setAngle(Number(e.target.value) / 100)} /></label>
        </div>
        <Button block disabled={busy} onClick={() => commit({ position: strength, angle })}>{spec.actionLabel}</Button>
      </> : active && <p className="rift-hint">{acting?.character.name}: choose strength and arc on your phone.</p>}
    </>;
  } else if (spec.kind === "timing") {
    const window = crossingWindow(prompt);
    const phase = active ? still ? moment : crossingPhase(prompt, now) : prompt.stopPosition ?? 0;
    const safe = active ? crossingSafe(prompt, phase) : prompt.outcome === "success" || prompt.outcome === "assisted";
    const openings = crossingOpenings(prompt);
    const opening = openings.find(w => phase >= w.start && phase <= w.end);
    const open = active ? opening !== undefined : safe;
    const remain = opening ? Math.max(0, opening.end - phase) : 0;
    const floes = props.includes("moving-floe");
    const weather = props.find(id => ["water-surge", "icicle-drips", "wind-banner", "roof-slab", "ice-knob"].includes(id));
    body = <>
      <p className="rift-read">{!active ? prompt.outcome === "success" ? "Across safely." : prompt.outcome === "assisted" ? "A helping hand makes a way." : "Back on safe footing." : safe ? "Enough time. Go!" : open ? "Closing. Wait for the next opening." : "Watch for a long opening."}{active && <span>{game.strain > 0 ? "Recovery: the opening is slower and wider." : "Start while there is time to finish your move."}</span>}</p>
      <div className={`rift-field rift-field--crossing rift-field--${spec.setting ?? "water"}`} data-open={open} data-safe={safe} data-still={still}>
        {floes ? <><Prop id="moving-floe" className="rift-floe rift-floe--near" /><Prop id="moving-floe" className="rift-floe rift-floe--far" /></> : <><div className="rift-bank rift-bank--near" /><div className="rift-bank rift-bank--far" /></>}
        {watcher && spec.setting === "watch" && !weather ? <img className="rift-watcher" src={watcher} alt="" /> : <div className="rift-weather" aria-hidden="true">{weather ? <Prop id={weather} className="rift-weather__painting" /> : <><i /><i /><i /></>}</div>}
        {!floes && props[0] !== weather && <Prop key={props[0]} id={props[0]} className="rift-timing-subject" />}
        {props[1] && props[1] !== weather && props[1] !== "moving-floe" && <Prop key={props[1]} id={props[1]} className="rift-far-prop" />}
        {hero(actor, "rift-hero rift-hero--crossing", { left: `${15 + Math.min(1, game.progress / skillSteps(prompt, ids)) * 48}%` })}
        <span className="rift-crossing-path" aria-hidden="true" />
      </div>
      {active && <><div className="rift-time" role="img" aria-label={safe ? "Enough time to cross" : open ? "Opening is too short now" : "Wait for the opening"}>
        {openings.map((w, i) => <span key={i} className="rift-time__opening" style={{ left: `${w.start * 100}%`, width: `${(w.end - w.start) * 100}%` }} />)}
        <span className="rift-time__travel" style={{ left: `${phase * 100}%`, width: `${Math.min(window.travel, 1 - phase) * 100}%` }} data-safe={safe} />
      </div>
      <p className="rift-hint">{open ? `${Math.round(remain * window.periodMs / 100) / 10}s of opening left` : "Gold: the opening. White: the time you need to cross."}</p></>}
      {mine && active && send && <>
        {still && <label className="rift-still">Choose a crossing moment<input aria-label="Crossing moment" type="range" min="0" max="100" value={Math.round(moment * 100)} disabled={busy} onChange={e => setMoment(Number(e.target.value) / 100)} /></label>}
        <Button block disabled={busy} onClick={() => commit({ position: phase })}>{spec.actionLabel}</Button>
      </>}
    </>;
  } else if (spec.kind === "balance") {
    const carry = carryState(prompt, ids);
    const side = playerId && carry.left.includes(playerId) ? "left" : "right";
    const level = playerId ? prompt.levels?.[playerId] ?? 0 : 0;
    body = <>
      <p className="rift-read">{!active ? prompt.outcome === "success" ? "Delivered safely." : "Back on safe footing." : carry.safe ? "Level. Take a careful step." : !carry.joined ? "Everyone take an end." : carry.tilt > 0 ? "Right end dipping" : "Left end dipping"}<span>{game.progress === 0 ? "Get both ends off the ground." : game.progress === 1 ? "Higher ground under the left end." : "Higher ground under the right end."}</span></p>
      <div className="rift-field rift-field--carry" data-still={still}>
        <div className="rift-ground" />
        <div className="rift-beam" style={{ transform: `rotate(${Math.max(-18, Math.min(18, carry.tilt * 35))}deg)` }}>
          <Prop id={props[0]} className="rift-beam__painting" />
        </div>
        {members.map(m => <span key={m.playerId}>{hero(m.playerId, "rift-hero rift-hero--carrier", { left: `${carry.left.includes(m.playerId) ? 12 + carry.left.indexOf(m.playerId) * 14 : 72 + carry.right.indexOf(m.playerId) * 14}%` })}</span>)}
        {(!carry.left.length || !carry.right.length) && <span className="rift-prop-support">Solo support</span>}
      </div>
      <div className="rift-supports">{[carry.left, carry.right].map((team, index) => <div key={index}><strong>{index === 0 ? "Left end" : "Right end"}</strong>{team.length ? team.map(id => <span key={id}>{members.find(m => m.playerId === id)?.character.name}<meter min="0" max="1" value={prompt.levels?.[id] ?? 0} /></span>) : <span>A prop holds this end</span>}</div>)}</div>
      {active && playerId && send && <div className="rift-lift-controls">
        <Button variant="secondary" disabled={busy || level <= 0} onClick={() => void post({ action: "adjust", round: game.round, direction: "down" })}>Ease {side} end</Button>
        <Button variant="secondary" disabled={busy || level >= 1} onClick={() => void post({ action: "adjust", round: game.round, direction: "up" })}>Lift {side} end</Button>
      </div>}
      {mine && active && send && <Button block disabled={busy || !carry.joined} onClick={() => commit()}>Take a careful step</Button>}
    </>;
  } else return null;
  return <div className={`rift-game rift-game--${spec.kind}`}>
    {progress}{body}
    {game.feedback && !(spec.kind === "timing" && !active && prompt.outcome !== "failure") && <p className="rift-feedback" role="status">{game.feedback}</p>}
    {game.strain > 0 && <label className="rift-strain">{spec.kind === "precision" ? "Landing chances slipping" : "Footing slipping"}<meter aria-label="Accumulated strain" min="0" max="1" value={game.strain} /></label>}
    {error && <p role="alert">That move did not arrive. Try again.</p>}
  </div>;
}
