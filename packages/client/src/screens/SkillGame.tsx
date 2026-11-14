import { useRef, useState, type CSSProperties } from "react";
import { aimWidth, balanceLift, balanceTarget, balanceTolerance, edgePace, interactionActor, interactionClues, playbackMs, precisionPosition,
  pullNeeded, skillAim, skillSteps, type InteractionAction, type InteractionPrompt, type PartyMember } from "@kad/shared";
import { reducedMotion } from "../a11y/prefs";
import { HeroImage } from "../world/hero-art-dom";
import { propUrl, PaintedGlyph } from "./InteractionArt";
import { Icon } from "./icons";
import { Button } from "../ui/Button";
import { buzz, litStep } from "./game-feel";
import "./SkillGame.css";

/** The manipulated object belongs in the authored landscape. Controls stay on phones. */
export function SkillGame({ prompt, party, now, playerId, object, busy = false, send }: {
  prompt: InteractionPrompt; party: PartyMember[]; now: number; playerId?: string; object?: string; busy?: boolean;
  send?: (action: InteractionAction) => Promise<boolean>;
}) {
  const game = prompt.challenge!;
  const spec = prompt.spec;
  const connected = party.filter(m => m.connected);
  const ids = connected.map(m => m.playerId);
  const mine = playerId === interactionActor(prompt, ids);
  const active = prompt.phase === "active";
  const editable = active && mine && !!send;
  const still = reducedMotion();
  const [power, setPower] = useState(0.15);
  const [liftPreview, setLiftPreview] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState(false);
  const sending = useRef(false);
  const gesture = useRef<{ id: number; y: number; height: number } | null>(null);
  const powerRef = useRef(power);
  const tileGesture = useRef<{ id: number; from: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressTileClick = useRef(false);
  const post = async (action: InteractionAction) => {
    if (!send || sending.current || busy) return;
    sending.current = true; setError(false);
    try { const ok = await send(action.action === "adjust" ? { ...action, round: game.round } : action); setError(!ok); if (ok) buzz(15); }
    catch { setError(true); }
    finally { sending.current = false; }
  };
  const commit = (extra: { position?: number; answer?: string[]; testOnly?: boolean } = {}) => post({ action: "commit", round: game.round, ...extra });
  const arrange = (answer: string[]) => post({ action: "arrange", round: game.round, answer });
  const action = (label: string, click: () => void, disabled = false, secondary = false) => <Button variant={secondary ? "secondary" : "primary"} block disabled={busy || disabled} onClick={click}>{label}</Button>;
  const token = (className = "skill-scene__object", style?: CSSProperties) => object && !failed
    ? <img className={className} style={style} src={propUrl(object)} alt="" draggable={false} onError={() => setFailed(true)} />
    : <span className={className} style={style} aria-hidden="true"><Icon name="star" /></span>;
  const heroes = <div className="skill-scene__heroes" aria-hidden="true">{connected.map(member => <HeroImage key={member.playerId} hero={member.character} place="world" alt="" />)}</div>;
  const progress = <ol className="skill-route" aria-label={`${game.progress} of ${skillSteps(prompt)} safe stages`}>{Array.from({ length: skillSteps(prompt) }, (_, i) => <li key={i} data-done={i < game.progress} data-current={i === game.progress}><span>{i < game.progress ? "✓" : i + 1}</span></li>)}</ol>;
  let body;
  if (spec.kind === "balance") {
    const lift = balanceLift(prompt, ids);
    const target = balanceTarget(prompt);
    const tolerance = balanceTolerance(prompt);
    const tilt = (lift - target) * 42;
    const joined = ids.length > 0 && ids.every(id => (prompt.levels?.[id] ?? 0) > 0);
    body = <>
      <div className="skill-scene skill-scene--balance" data-still={still}>
        <div className="skill-scene__path" aria-hidden="true" />
        <div className="skill-carry" style={{ "--tilt": `${still ? 0 : tilt}deg`, "--travel": `${game.progress * 24}%` } as CSSProperties}>
          <span className="skill-carry__beam" />{token()}
        </div>{heroes}
      </div>
      {progress}
      <p className="skill-reading">{game.progress === 0 ? "Take the weight" : game.progress === 1 ? "The load leans away. Lift higher" : "Over the ridge. Ease it lower"}</p>
      <div className="skill-gauge" role="meter" aria-label="Shared lift and safe footing" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(lift * 100)}>
        <span className="skill-gauge__gold" style={{ left: `${(target - tolerance) * 100}%`, width: `${tolerance * 200}%` }} />
        <span className="skill-gauge__needle" style={{ left: `${lift * 100}%` }} />
      </div>
      <p className="skill-caption">{!joined ? "Everyone needs a hand on the load." : Math.abs(lift - target) <= tolerance ? "Steady. Take a step together!" : lift < target ? "It dips. Lift a little higher." : "It tips up. Ease your lift down."}</p>
      {active && playerId && send && <div className="skill-lift-controls">
        {action("Lower my side", () => void post({ action: "adjust", direction: "down" }), (prompt.levels?.[playerId] ?? 0) <= 0, true)}
        <strong>{Math.round((prompt.levels?.[playerId] ?? 0) * 100)}%</strong>
        {action("Lift my side", () => void post({ action: "adjust", direction: "up" }), (prompt.levels?.[playerId] ?? 0) >= 1, true)}
      </div>}
      {active && playerId && send && <label className="skill-slider">Slide your lifting grip
        <input type="range" min="0" max="100" step="25" value={liftPreview ?? Math.round((prompt.levels?.[playerId] ?? 0) * 100)} disabled={busy}
          onChange={event => setLiftPreview(Number(event.target.value))}
          onPointerCancel={() => setLiftPreview(null)}
          onPointerUp={event => {
            const target = Number(event.currentTarget.value) / 100;
            const delta = Math.round((target - (prompt.levels?.[playerId] ?? 0)) * 4);
            setLiftPreview(null); if (delta) void post({ action: "adjust", direction: delta > 0 ? "up" : "down", steps: Math.abs(delta) });
          }} onKeyUp={event => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
            const delta = Math.round((Number(event.currentTarget.value) / 100 - (prompt.levels?.[playerId] ?? 0)) * 4);
            setLiftPreview(null); if (delta) void post({ action: "adjust", direction: delta > 0 ? "up" : "down", steps: Math.abs(delta) });
          }} />
      </label>}
      {editable && action("Take a careful step", () => void commit(), !joined)}
    </>;
  } else if (spec.kind === "cooperate") {
    const target = pullNeeded(prompt, ids);
    const committed = playerId ? game.pulls[playerId] !== undefined : false;
    const tolerance = prompt.relaxed ? 0.22 : 0.13;
    const updatePower = (value: number) => { powerRef.current = value; setPower(value); };
    body = <>
      <div className="skill-scene skill-scene--haul" data-still={still}>
        <div className="skill-ledge" aria-hidden="true">{[0, 1, 2].map(i => <span key={i} style={{ bottom: `${18 + i * 22}%` }} />)}</div>
        <div className="skill-hoist" style={{ bottom: `${20 + game.progress * 20}%` }}><span className="skill-hoist__rope" />{token()}</div>{heroes}
      </div>{progress}
      <p className="skill-reading">{game.progress === 0 ? spec.supportLabel : game.progress === 1
        ? playerId ? "The weight shifts. Give more support" : "Weight shifts: pull higher"
        : playerId ? "Almost there. Settle it gently" : "Nearly there: ease gently"}</p>
      <div className="skill-gauge" role="img" aria-label={`Safe pull: ${Math.round((target - tolerance) * 100)} to ${Math.round((target + tolerance) * 100)} percent`}>
        <span className="skill-gauge__gold" style={{ left: `${Math.max(0, target - tolerance) * 100}%`, width: `${(Math.min(1, target + tolerance) - Math.max(0, target - tolerance)) * 100}%` }} />
        {active && playerId && <span className="skill-gauge__needle" style={{ left: `${power * 100}%` }} />}
        {connected.map(member => game.pulls[member.playerId] !== undefined && <span className="skill-gauge__pull" key={member.playerId} style={{ left: `${game.pulls[member.playerId]! * 100}%` }} title={member.character.name}>●</span>)}
      </div>
      <p className="skill-caption">A friend's pull moves the gold. Help make up the difference, gently.</p>
      <ul className="skill-team">{connected.map(member => <li key={member.playerId}>{member.character.name}: {game.pulls[member.playerId] === undefined ? (playerId ? "reading the rope" : "choosing") : (playerId ? "pull ready" : "pull set")}</li>)}</ul>
      {active && playerId && send && <>
        {!still && <div className="skill-rope-drag" aria-hidden="true" data-ready={committed}
          onPointerDown={event => { if (busy || committed || event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); gesture.current = { id: event.pointerId, y: event.clientY, height: event.currentTarget.clientHeight }; updatePower(0); }}
          onPointerMove={event => { const g = gesture.current; if (g?.id === event.pointerId) updatePower(Math.max(0, Math.min(1, (event.clientY - g.y) / (g.height * 0.8)))); }}
          onPointerUp={event => { if (gesture.current?.id !== event.pointerId) return; gesture.current = null; void commit({ position: powerRef.current }); }}
          onPointerCancel={() => { gesture.current = null; updatePower(0.15); }} onLostPointerCapture={() => { gesture.current = null; }}>
          <span style={{ transform: `translateY(${power * 48}px)` }}><img src="/assets/ui/relay/catching-hands.webp" alt="" draggable={false} /></span><small>{committed ? "Your pull is ready" : "Pull the rope down. Release in the gold."}</small>
        </div>}
        <label className="skill-slider">Pull strength <output>{Math.round(power * 100)}%</output><input aria-label="Pull strength" type="range" min="0" max="100" value={Math.round(power * 100)} disabled={busy || committed} onChange={event => updatePower(Number(event.target.value) / 100)} /></label>
        {action(committed ? "Waiting for the team" : "Set my pull", () => void commit({ position: power }), committed)}
      </>}
    </>;
  } else if (spec.kind === "precision" || spec.kind === "timing") {
    const aim = skillAim(prompt);
    const width = aimWidth(aim, prompt);
    const position = !active && prompt.stopPosition !== undefined ? prompt.stopPosition : still ? power : precisionPosition(now - Date.parse(prompt.startedAt ?? ""), aim.periodMs * (prompt.relaxed ? 1.5 : 1));
    const safe = Math.abs(position - aim.target) <= width / 2;
    const stage = <div className="skill-scene skill-scene--aim" data-safe={safe} data-still={still}>
      <span className="skill-perch" style={{ left: `${(aim.target - width / 2) * 100}%`, width: `${width * 100}%` }}><span>✦</span></span>
      {token("skill-shot", { left: `${position * 100}%`, bottom: spec.kind === "precision" ? `${25 + Math.sin(position * Math.PI) * 28}%` : "32%" })}
      {heroes}
      <span className="skill-safety-line" aria-hidden="true" />
      <strong className="skill-opening">{spec.kind === "timing" ? safe ? "OPEN — GO!" : "Watch the opening…" : safe ? "Over the perch!" : "Watch the landing…"}</strong>
    </div>;
    const actor = connected.find(member => member.playerId === interactionActor(prompt, ids));
    body = <><p className="skill-reading">{actor?.character.name ?? "Your party"}'s turn · {Math.min(game.progress + 1, skillSteps(prompt))} / {skillSteps(prompt)}</p>{progress}{editable && !still ? <button type="button" className="skill-aim kad-focusable" aria-label={spec.actionLabel} disabled={busy}
      onPointerDown={event => { if (event.button === 0) void commit({ position }); }} onClick={event => { if (event.detail === 0) void commit({ position }); }}>{stage}<span>{spec.actionLabel}</span></button> : stage}
      {editable && still && <><label className="skill-slider">Aim at the gold <input type="range" min="0" max="100" value={Math.round(power * 100)} disabled={busy} onChange={event => setPower(Number(event.target.value) / 100)} /></label>{action(spec.actionLabel, () => void commit({ position }))}</>}
      <p className="skill-caption">{spec.kind === "timing" ? "Read the opening. A near miss gives you time to recover." : "Read the arc. A near miss lets you adjust your aim."}</p>
    </>;
  } else if (spec.kind === "sequence" || spec.kind === "memory") {
    const pattern = spec.kind === "memory";
    const elapsed = now - Date.parse(prompt.startedAt ?? "");
    const watching = active && pattern && !prompt.relaxed && elapsed < playbackMs(spec, false, edgePace(prompt)) + 250;
    const lit = pattern && watching && !still ? litStep(elapsed, spec.stepMs * edgePace(prompt), spec.answer.length) : null;
    const option = (id: string) => spec.options.find(o => o.id === id);
    const clues = playerId ? interactionClues(prompt, playerId, ids) : [];
    const answers = active ? game.arrangement : prompt.submittedAnswer ?? game.arrangement;
    const reorder = (from: number, to: number) => {
      const next = [...answers]; const [moved] = next.splice(from, 1);
      if (moved === undefined || to < 0 || to >= answers.length) return;
      next.splice(to, 0, moved); void arrange(next);
    };
    body = <>
      <div className="skill-mechanism" aria-label={pattern ? "The tune you are rebuilding" : "The path mechanism"}>
        {token("skill-mechanism__prop")}
        <ol className="skill-stones">{spec.answer.map((id, i) => {
          const shown = pattern && (prompt.relaxed || still || (watching && lit === i)) ? id : answers[i];
          const o = shown ? option(shown) : undefined;
          const face = <><span className="skill-stones__number">{i + 1}</span>{o ? <><PaintedGlyph label={o.label} /><Icon name={o.icon} /><span>{o.label}</span></> : <span>?</span>}{i < game.matched && <small>holds ✓</small>}</>;
          return <li key={i} data-lit={lit === i} data-held={i < game.matched}>{editable && !pattern && o ? <button type="button" className="skill-stones__edit kad-focusable" disabled={busy} aria-label={`Remove step ${i + 1}: ${o.label}`}
            onPointerDown={event => { if (event.button !== 0 || busy) return; suppressTileClick.current = false; tileGesture.current = { id: event.pointerId, from: i, x: event.clientX, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
            onPointerMove={event => { const g = tileGesture.current; if (g?.id === event.pointerId && Math.hypot(event.clientX - g.x, event.clientY - g.y) > 10) g.moved = true; }}
            onPointerUp={event => {
              const g = tileGesture.current; if (!g || g.id !== event.pointerId) return;
              suppressTileClick.current = g.moved;
              if (g.moved) event.currentTarget.closest("ol")?.querySelectorAll("li").forEach((slot, to) => {
                const box = slot.getBoundingClientRect();
                if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom && to !== g.from) reorder(g.from, to);
              });
              tileGesture.current = null;
            }} onPointerCancel={() => { tileGesture.current = null; suppressTileClick.current = true; }} onLostPointerCapture={() => { tileGesture.current = null; }}
            onKeyDown={event => { if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); reorder(i, i + (event.key === "ArrowLeft" ? -1 : 1)); }}
            onClick={() => { if (suppressTileClick.current) { suppressTileClick.current = false; return; } void arrange(answers.filter((_, at) => at !== i)); }}>{face}</button> : face}</li>;
        })}</ol>
      </div>
      {clues.length > 0 && <div className="game-clue"><strong>Your clues — read them aloud</strong><ul>{clues.map((clue, i) => <li key={i}>{clue}</li>)}</ul></div>}
      {pattern && <p className="skill-reading">{watching ? "Watch and listen to the pattern…" : "Rebuild the tune. Your friends can help."}</p>}
      {!pattern && !playerId && <p className="skill-caption">Share the clues. Test a few steps before crossing.</p>}
      {!pattern && editable && answers.length > 0 && <small className="skill-caption">Drag stones to rearrange. Tap to remove. Keyboard: Alt + arrow keys.</small>}
      {editable && !watching && <>
        <div className="skill-pads">{spec.options.map(o => <button type="button" className="kad-focusable" key={o.id} disabled={busy || answers.length >= spec.answer.length} onClick={() => void arrange([...answers, o.id])}><PaintedGlyph label={o.label} /><Icon name={o.icon} /><strong>{o.label}</strong></button>)}</div>
        <div className="skill-edit-row">{action("Change last step", () => void arrange(answers.slice(0, -1)), !answers.length, true)}
          {!pattern && action("Test these steps", () => void commit({ answer: answers, testOnly: true }), !answers.length, true)}</div>
        {action(spec.actionLabel, () => void commit({ answer: answers }), answers.length !== spec.answer.length)}
      </>}
    </>;
  } else return null;
  return <div className={`skill-game skill-game--${spec.kind}`} data-round={game.round}>
    {body}
    {game.feedback && <p className="skill-feedback" role="status" key={game.round}>{game.feedback}</p>}
    {game.strain > 0 && <div className="skill-strain"><span>{spec.kind === "cooperate" ? "Support straining" : spec.kind === "memory" ? "Tune fading" : "Footing slipping"}</span><meter min="0" max="1" value={game.strain} aria-label="Accumulated strain" /></div>}
    {error && <p role="alert">That move did not arrive. Try once more.</p>}
  </div>;
}
