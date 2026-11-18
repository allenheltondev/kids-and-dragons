import { GameSubjectImage, GamePropImage, type GameSubject, type GamePropShape } from "./GameSubject";
import { GameLoad } from "./GameLoad";
import { gameFigureStageStyle, gameFigureStyle } from "./game-figure";
import { useRef, useState, type CSSProperties } from "react";
import { haulNeeded, haulWindow, haulTarget, haulWeight, interactionActor, skillSteps, steadyReading, type InteractionAction, type InteractionPrompt, type PartyMember } from "@kad/shared";
import { HeroImage } from "../world/hero-art-dom";
import { propUrl } from "./InteractionArt";
import { Button } from "../ui/Button";
import "./GemfallSkillGame.css";

/** Deliberate physical work, with the authored subject kept between the heroes. */
export function GemfallSkillGame({ prompt, party, playerId, object, subject, busy, send }: {
  prompt: InteractionPrompt; party: PartyMember[]; playerId?: string; object?: string; subject?: GameSubject; busy?: boolean;
  send?: (action: InteractionAction) => Promise<boolean>;
}) {
  const game = prompt.challenge!;
  const active = prompt.phase === "active";
  const ids = party.filter(m => m.connected).map(m => m.playerId);
  const members = party.filter(m => m.connected || !active && m.playerId === prompt.resolvedActorId);
  const actor = active ? interactionActor(prompt, ids) : prompt.resolvedActorId ?? interactionActor(prompt, ids);
  const precision = prompt.spec.kind === "precision";
  const handling = prompt.spec.kind === "precision" ? prompt.spec.handling ?? "lift" : "haul";
  const positionLabel = handling === "hum" ? "Note position" : "Support position";
  const effortLabel = handling === "hum" ? "Voice strength" : "Effort";
  const [propShape,setPropShape]=useState<GamePropShape>();
  const [grip, setGrip] = useState(game.lastAngle ?? .2), [effort, setEffort] = useState(playerId ? game.pulls[playerId] ?? .2 : .2);
  const [error, setError] = useState(false), [failed, setFailed] = useState(false);
  const sending = useRef(false);
  const mine = actor === playerId;
  const ready = playerId ? game.pulls[playerId] !== undefined : false;
  const allSet = ids.length > 0 && ids.every(id => game.pulls[id] !== undefined);
  const unchanged = ready && effort === game.pulls[playerId!];
  const preview = active && mine && !!send;
  const shownGrip = preview ? grip : game.lastAngle ?? grip;
  const reading = precision ? steadyReading(prompt, shownGrip, preview ? effort : prompt.stopPosition ?? effort) : null;
  const target = reading?.load ?? (playerId ? haulNeeded(prompt, ids, playerId) : haulTarget(prompt));
  const haul = !precision && playerId ? haulWindow(prompt, ids, playerId) : null;
  const tolerance = reading?.tolerance ?? haul?.tolerance ?? (prompt.relaxed ? .2 : .12);
  const share = haul?.effort ?? target;
  const zeroPulls = precision ? [] : members.filter(m => m.playerId !== playerId && game.pulls[m.playerId] === 0);
  const canCompensate = zeroPulls.length === 0 && share >= -tolerance && share <= 1 + tolerance;
  const revision = zeroPulls.length ? `${zeroPulls.map(m => m.character.name).join(" and ")} must revise their 0% effort so everyone helps.`
    : !precision && !canCompensate ? "No safe share yet. Ask a friend to revise their effort." : undefined;
  const safeStart = Math.max(precision ? 0 : .01, share - tolerance), safeEnd = Math.min(1, share + tolerance);
  const shown = precision ? reading!.lift : playerId ? effort : ids.reduce((sum, id) => sum + (game.pulls[id] ?? 0) * haulWeight(prompt, id), 0) / Math.max(1, ids.reduce((sum, id) => sum + haulWeight(prompt, id), 0));
  const outcome = prompt.outcome === "success" ? "Safely in place." : prompt.outcome === "assisted" ? "A helping hand makes a way." : "Set down safely. See where the story goes.";
  const post = async () => {
    if (!send || busy || sending.current) return;
    sending.current = true; setError(false);
    try { setError(!await send({ action: "commit", round: game.round, position: effort, ...(precision ? { angle: grip } : {}) })); }
    catch { setError(true); } finally { sending.current = false; }
  };
  const crew = members.map((m,i)=>({member:m,x:members.length<=2?22+i*56:i<Math.ceil(members.length/2)?13+i*15:87-(members.length-1-i)*15}));
  return <div className={`gem-game gem-game--${prompt.spec.kind} gem-game--${handling}`} data-round={game.round}>
    <div className="rift-progress" aria-label={`${game.progress} of ${skillSteps(prompt, ids)} safe moves`}>{Array.from({ length: skillSteps(prompt, ids) }, (_, i) => <span key={i} data-done={i < game.progress} data-current={i === game.progress}>{i < game.progress ? "✓" : i + 1}</span>)}</div>
    <p className="gem-reading">{!active ? outcome : precision ? reading!.safe ? "Supported. Just enough effort." : !reading!.supported ? handling === "hum" ? "Find the steady note first." : "Find the support point first." : shown < target ? handling === "hum" ? "Give the note a little more voice." : "Add a little effort." : "Ease the pressure." : ["Take the weight", "The slope gets steeper", "Set it down gently"][Math.min(2, game.progress)]}</p>
    <div className="gem-field game-figure-stage" style={gameFigureStageStyle(members.length)} data-supported={reading?.supported} data-safe={reading?.safe}>
      <div className="gem-ground" />
      {members.map((m, i) => <HeroImage key={m.playerId} className="gem-hero game-figure" hero={m.character} place="world" alt="" style={{ ...gameFigureStyle(m.character), left: `${members.length <= 2 ? 22 + i * 56 : i < Math.ceil(members.length / 2) ? 13 + i * 15 : 87 - (members.length - 1 - i) * 15}%` }} />)}
      <GameLoad shape={object==="calf-sling"?undefined:propShape} className={`gem-load${object==="calf-sling"?" gem-load--sling":""}`} attachmentRise={object==="calf-sling"?.12:0} attachmentInset={object==="calf-sling"?.018:0} crew={crew} cameraWidth={members.length>=3?32:55} left={object==="calf-sling"?32.5:25} rise={Math.min(.04,shown*.05)} tilt={(shown-target)*.04} enabled={handling==="lift"||handling==="haul"}>
        {object && !failed ? object==="calf-sling"?<img className="gem-object" src={propUrl(object)} alt="" draggable={false} onError={()=>setFailed(true)} />:<GamePropImage className="gem-object" url={propUrl(object)} onShape={setPropShape} onError={()=>setFailed(true)} /> : <span className="gem-object gem-object--fallback" aria-hidden="true">✦</span>}
        {object==="calf-sling"&&!failed&&<img className="gem-sling-front" src={propUrl(object)} alt="" draggable={false} />}
        {subject && <GameSubjectImage className="gem-subject" subject={subject} />}
        {handling === "lift" || handling === "haul" ? <span className="gem-cradle" aria-hidden="true" /> : <span className="gem-contact-effect" aria-hidden="true" />}
      </GameLoad>
      {precision && <div className="gem-contact" aria-label="Support point and your grip">
        <span className="gem-contact__safe" style={{ left: `${(reading!.support - tolerance) * 100}%`, width: `${tolerance * 200}%` }} />
        <span className="gem-contact__grip" style={{ left: `${shownGrip * 100}%` }} />
      </div>}
      {!precision && <div className="gem-team">{members.map(m => <span key={m.playerId} data-ready={game.pulls[m.playerId] !== undefined}>{m.character.name}: {game.pulls[m.playerId] !== undefined ? `${Math.round(game.pulls[m.playerId]! * 100)}% set` : haulWeight(prompt, m.playerId) > 1 ? "near rope" : "far rope"}</span>)}</div>}
    </div>
    {active && <><div className="gem-force" role="img" aria-label={canCompensate ? `Effort ${Math.round(shown * 100)} percent; safe effort ${Math.round(target * 100)} percent` : `Effort ${Math.round(shown * 100)} percent; no safe effort until the team revises its pulls`}>
      {canCompensate && <span className="gem-force__safe" style={{ left: `${safeStart * 100}%`, width: `${Math.max(0, safeEnd - safeStart) * 100}%` }} />}
      <span className="gem-force__needle" style={{ left: `${Math.min(1, shown) * 100}%` }} />
    </div><p className="gem-caption">{precision ? "Position and effort: match both gold bands." : !canCompensate ? "No safe share yet. Ask a friend to revise their effort." : "The near rope has more leverage. You can revise your effort before everyone sets theirs."}</p></>}
    {active && send && playerId && (!precision || mine) && <>
      <div className="gem-inputs">
        {precision && <label>{positionLabel} <output>{Math.round(grip * 100)}%</output><input aria-label={positionLabel} type="range" min="0" max="100" value={Math.round(grip * 100)} disabled={busy} onChange={e => setGrip(Number(e.target.value) / 100)} /></label>}
        <label>{effortLabel} <output>{Math.round(effort * 100)}%</output><input aria-label={effortLabel} type="range" min="0" max="100" value={Math.round(effort * 100)} disabled={busy} onChange={e => setEffort(Number(e.target.value) / 100)} /></label>
      </div>
      <Button block disabled={busy || unchanged && !allSet} onClick={() => void post()}>{allSet ? "Move with the remaining crew" : ready ? unchanged ? "Your effort is set" : "Revise my effort" : precision ? prompt.spec.actionLabel : "Set my effort"}</Button>
    </>}
    {(revision || game.feedback) && active && <p className="rift-feedback" role="status">{revision ?? game.feedback}</p>}
    {active && game.strain > 0 && <label className="rift-strain">Support strain<meter aria-label="Accumulated strain" min="0" max="1" value={game.strain} /></label>}
    {error && <p role="alert">That move did not arrive. Try again.</p>}
  </div>;
}
