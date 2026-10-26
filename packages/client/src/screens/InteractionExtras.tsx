import { useRunState } from "../store";
import { interactionAppearance } from "../world/riftlight-art";
import { PaintedInteraction, PaintedCover, PaintedGlyph } from "./InteractionArt";
import { balanceReady, playbackMs, playReady, precisionPosition, precisionSuccess, relayHolder, trackedCover } from "@kad/shared";
import type { InteractionAction, InteractionPrompt, PartyMember } from "@kad/shared";
import { reducedMotion } from "../a11y/prefs";
import { Icon } from "./icons";

/** The same observation surface on TV and phone; it never sends an intent. */
function InteractionShowBase({ prompt, party, now, painted, bells }: { prompt: InteractionPrompt; party: PartyMember[]; now: number; painted?: boolean; bells?: boolean }) {
  const spec = prompt.spec;
  const connected = party.filter((member) => member.connected).map((member) => member.playerId);
  const name = (id: string) => party.find((member) => member.playerId === id)?.character.name ?? "Your friend";
  const elapsed = Math.max(0, now - Date.parse(prompt.startedAt ?? new Date(now).toISOString()));
  const still = reducedMotion();
  switch (spec.kind) {
    case "tracking": {
      const step = spec.stepMs * (prompt.relaxed ? 2 : 1);
      const progress = still || prompt.relaxed ? spec.swaps.length : Math.max(0, (elapsed - step) / step);
      const done = Math.min(spec.swaps.length, Math.floor(progress));
      const positions = spec.covers.map((_, index) => index);
      for (const [a, b] of spec.swaps.slice(0, done)) {
        for (let i = 0; i < positions.length; i++) positions[i] = positions[i] === a ? b : positions[i] === b ? a : positions[i]!;
      }
      const swap = spec.swaps[done];
      return <div className={"story-interaction__covers"+(painted?" story-interaction__covers--painted":"")} role="img" aria-label={elapsed < step && !still ? "Watch the glowing object before the covers move" : "Follow the moving covers"}>
        {spec.covers.map((label, index) => {
          const at = positions[index]!;
          const destination = swap ? at === swap[0] ? swap[1] : at === swap[1] ? swap[0] : at : at;
          const position = at + (destination - at) * (progress - done);
          return <span className="story-interaction__cover" key={index} style={{ left: `${(position + 0.5) / spec.covers.length * 100}%` }}>
            {painted ? <PaintedCover bells={bells ?? false} diving={elapsed>step*.5&&elapsed<step} reveal={(!prompt.relaxed && !still && elapsed < step && index === spec.start) || ((still || prompt.relaxed) && at === trackedCover(spec))} /> : <span aria-hidden="true">{(!prompt.relaxed && !still && elapsed < step && index === spec.start) || ((still || prompt.relaxed) && at === trackedCover(spec)) ? "✦" : "▰"}</span>}
          </span>;
        })}
        {spec.covers.map((label, index) => <span className="story-interaction__cover story-interaction__cover-label" key={`label:${index}`} style={{ left: `${(index + 0.5) / spec.covers.length * 100}%` }}><small>{label}</small></span>)}
        {(still || prompt.relaxed) && <span className="story-interaction__tracking-help">The glow waits under: {spec.covers[trackedCover(spec)]}.</span>}
      </div>;
    }
    case "memory": {
      const step = spec.stepMs * (prompt.relaxed ? 2 : 1);
      const index = Math.floor(elapsed / step);
      const visible = prompt.relaxed || still;
      return <div className="story-interaction__memory" aria-label="Magic pattern">
        {visible ? <p>{spec.answer.map((id) => spec.options.find((option) => option.id === id)?.label).join(" → ")}</p> :
          <p>{index < spec.answer.length ? <><PaintedGlyph label={spec.options.find((option) => option.id === spec.answer[index])?.label ?? ""} /> <Icon name={spec.options.find((option) => option.id === spec.answer[index])?.icon ?? "star"} /> {spec.options.find((option) => option.id === spec.answer[index])?.label}<small> · {index + 1} of {spec.answer.length}</small></> : "Now echo the magic!"}</p>}
      </div>;
    }
    case "timing": {
      const safe = precisionSuccess(spec, precisionPosition(elapsed, spec.periodMs), prompt.relaxed);
      return <div className="story-interaction__signal" data-safe={safe}><Icon name={safe ? "boot" : "eye"} /><strong>{safe ? "Now!" : "Wait…"}</strong></div>;
    }
    case "balance": {
      const levels = connected.map((id) => prompt.levels?.[id] ?? 0);
      const tilt = levels.length > 1 ? (levels[levels.length - 1]! - levels[0]!) * 20 : 0;
      return <div>
        <div className="story-interaction__balance" style={{ transform: still ? undefined : `rotate(${tilt}deg)` }}>{spec.objectLabel}</div>
        <ul>{connected.map((id) => <li key={id}>{name(id)}: {Math.round((prompt.levels?.[id] ?? 0) * 100)}% lifted</li>)}</ul>
        <p role="status">{balanceReady(prompt, connected) ? "Steady together!" : "Bring everyone’s side to the middle."}</p>
      </div>;
    }
    case "relay": {
      const holder = relayHolder(prompt, connected);
      return <div className="story-interaction__spark"><Icon name="star" /> <strong>{holder ? `${spec.objectLabel}: ${name(holder)} ${prompt.caughtBy === holder ? "has it!" : "can catch it"}` : "The magic reaches its destination!"}</strong>
        <p>{(prompt.passed ?? []).map(name).join(" → ") || "Everyone gets a turn."}</p>
      </div>;
    }
    case "play":
      return <div className="story-interaction__reactions" aria-live="polite">
        {(prompt.reactions ?? []).slice(-3).map((reaction, index) => <p key={`${prompt.taps}:${index}`}><strong>{name(reaction.playerId)}:</strong> {reaction.text}</p>)}
        {spec.participation === "everyone" && <ul>{connected.map((id) => <li key={id}>{name(id)}: {spec.options.find((option) => option.id === prompt.contributions?.[id])?.label ?? "choosing something"}</li>)}</ul>}
        {spec.participation === "everyone" && <p>{connected.filter((id) => prompt.contributions?.[id] !== undefined).length} of {connected.length} friends have added something.</p>}
      </div>;
    default: return null;
  }
}

export function ExtraControls({ prompt, playerId, connected, mine, now, busy, send }: {
  prompt: InteractionPrompt; playerId: string; connected: string[]; mine: boolean;
  now: number; busy: boolean; send: (action: InteractionAction) => void;
}) {
  const spec = prompt.spec;
  const button = (label: string, action: InteractionAction, disabled = false) => <button className="story-interaction__button kad-focusable" disabled={busy || disabled} onClick={() => send(action)}>{label}</button>;
  switch (spec.kind) {
    case "tracking": {
      const ready = prompt.relaxed || now - Date.parse(prompt.startedAt ?? "") >= playbackMs(spec, prompt.relaxed) + 250;
      return mine ? <>{!ready ? <p>Keep your eyes on the covers…</p> : spec.covers.map((label, index) => <span key={index}>{button(`${spec.actionLabel}: ${label}`, { action: "answer", answer: [String(index)] })}</span>)}</> : null;
    }
    case "timing":
      return mine ? reducedMotion() ? <p>Take a helping hand for an untimed crossing.</p> : button(spec.actionLabel, { action: "stop", position: precisionPosition(now - Date.parse(prompt.startedAt ?? ""), spec.periodMs) }) : null;
    case "balance":
      return <>{button("Lift my side", { action: "adjust", direction: "up" }, (prompt.levels?.[playerId] ?? 0) >= 1)}{button("Lower my side", { action: "adjust", direction: "down" }, (prompt.levels?.[playerId] ?? 0) <= 0)}{mine && button(spec.actionLabel, { action: "complete" }, !balanceReady(prompt, connected))}</>;
    case "relay":
      return !relayHolder(prompt, connected) ? mine ? button(spec.actionLabel, { action: "complete" }) : null : relayHolder(prompt, connected) === playerId ? button(prompt.caughtBy === playerId ? spec.actionLabel : `Catch ${spec.objectLabel}`, { action: prompt.caughtBy === playerId ? "pass" : "catch" }) : <p>Watch the spark travel to your friend!</p>;
    case "play":
      return <>{spec.options.map((option) => <span key={option.id}>{button(option.label, { action: "play", optionId: option.id })}</span>)}{mine && button(spec.actionLabel, { action: "complete" }, !playReady(prompt, connected))}</>;
    default: return null;
  }
}

export function InteractionShow(props: { prompt: InteractionPrompt; party: PartyMember[]; now: number }) {
 const state=useRunState();
 const painted=interactionAppearance(state?.chapterId,state?.sceneId)!==null;
 return <><PaintedInteraction {...props} />{props.prompt.phase==="active"&&<InteractionShowBase {...props} painted={painted} bells={state?.sceneId==="song_track"} />}</>;
}
