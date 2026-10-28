/**
 * The board (what a game looks like, read-only, the same on the TV and every phone) and the
 * per-kind controls a phone adds under it. StoryInteraction.tsx frames these; nothing here sends
 * an intent on its own, the frame hands `send` down.
 */
import { useChapter, useRunState } from "../store";
import { interactionAppearance } from "../world/riftlight-art";
import { characterWorldArtUrl } from "../world/art-paths";
import { PaintedCover, PaintedGlyph, propUrl } from "./InteractionArt";
import { balanceReady, interactionActor, interactionClues, playbackMs, playReady, precisionPosition, precisionSuccess, relayHolder, supportPlayers, supportsReady, trackedCover } from "@kad/shared";
import type { InteractionAction, InteractionOption, InteractionPrompt, PartyMember } from "@kad/shared";
import { reducedMotion } from "../a11y/prefs";
import { Icon } from "./icons";
import { Button } from "../ui/Button";
import { showing } from "./interaction-copy";

/** Answers are slot indices; distinct moving paintings must not name those slots. */
function trackingLabels(covers: string[], icons?: string[]): string[] {
  if (icons?.length !== covers.length || new Set(icons).size < 2) return covers;
  const positions = covers.length === 3 ? ["Left", "Middle", "Right"] : covers.length === 2 ? ["Left", "Right"] : [];
  return covers.map((_, index) => positions[index] ?? `Position ${index + 1}`);
}

export interface BoardProps {
  prompt: InteractionPrompt;
  party: PartyMember[];
  now: number;
  /** The lead phone's half-built answer, for the slots on a sequence or memory board. */
  answer?: string[];
  /** Whose phone this is; the TV passes nothing. */
  playerId?: string;
}

function HeroChip({ member, state, tone, mark, token }: { member: PartyMember; state?: string; tone?: "on" | "done" | "off"; mark?: string; token?: string }) {
  return <li className={`game-hero${tone ? ` game-hero--${tone}` : ""}`}>
    <span className="game-hero__face">
      <img src={characterWorldArtUrl(member.character.species, member.character.tier, member.character.class)} alt="" decoding="async" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
      {mark ? <span className="game-hero__mark" key={mark}><Icon name={mark} /></span> : null}
      {token ? <img className="game-hero__token" src={token} alt="" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
    </span>
    <span className="game-hero__name">{member.character.name}</span>
    {state ? <span className="game-hero__state">{state}</span> : null}
  </li>;
}

/** Which colour an option wears, by its place in the authored list, the same on every screen. */
export function toneOf(options: readonly InteractionOption[], id: string): number {
  return Math.max(0, options.findIndex((option) => option.id === id)) % 4;
}

function Tile({ option, size, index, muted, tone }: { option: InteractionOption; size?: "lg"; index?: number; muted?: boolean; tone?: number }) {
  return <span className={`game-tile${size ? ` game-tile--${size}` : ""}${muted ? " game-tile--muted" : ""}`} data-tone={tone}>
    {index !== undefined ? <span className="game-tile__index">{index}</span> : null}
    <span className="game-tile__icon"><PaintedGlyph label={option.label} /><Icon name={option.icon} /></span>
    <span className="game-tile__label">{option.label}</span>
  </span>;
}

/** The sliding marker and its gold stretch, for precision aiming. */
export function Meter({ prompt, now, prop }: { prompt: InteractionPrompt; now: number; prop?: string }) {
  if (prompt.spec.kind !== "precision") return null;
  const width = Math.min(1, prompt.spec.width * (prompt.relaxed ? 2 : 1));
  const left = Math.max(0, prompt.spec.target - width / 2);
  const right = Math.min(1, prompt.spec.target + width / 2);
  const position = precisionPosition(now - Date.parse(prompt.startedAt ?? new Date(now).toISOString()), prompt.spec.periodMs);
  const inGold = precisionSuccess(prompt.spec, position, prompt.relaxed);
  return <div className="story-interaction__track game-track" role="img" aria-label="Moving marker with a gold target" data-gold={inGold}>
    <span className="story-interaction__target game-track__gold" style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}><Icon name="star" /></span>
    <span className={`story-interaction__marker game-track__marker${prop ? " game-track__marker--prop" : ""}`} style={{ left: `${position * 100}%` }}>
      {prop ? <img src={propUrl(prop)} alt="" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
    </span>
  </div>;
}

/**
 * How close a wait/now marker is to its window, 0 (far) to 1 (at the edge), so the lamp can fill
 * as NOW comes instead of switching from nothing. Pure, and tested beside the copy.
 */
export function approach(position: number, target: number, width: number): number {
  const gap = Math.abs(position - target) - width / 2;
  if (gap <= 0) return 1;
  const far = Math.max(target, 1 - target) - width / 2;
  return far <= 0 ? 1 : Math.max(0, Math.min(1, 1 - gap / far));
}

/** The numbered boxes the lead's answer fills, one tile popping in at a time. */
function Slots({ answer, length, options }: { answer: string[]; length: number; options: InteractionOption[] }) {
  return <ol className="game-row game-row--slots" aria-label="The order so far">{Array.from({ length }, (_, i) => {
    const o = answer[i] ? options.find((option) => option.id === answer[i]) : undefined;
    return <li key={i} className={o ? "game-slot game-slot--full" : "game-slot"}>{o ? <Tile key={o.id} option={o} index={i + 1} tone={toneOf(options, o.id)} /> : <span className="game-slot__number">{i + 1}</span>}</li>;
  })}</ol>;
}

/** The choices on a screen that is not building the answer: what the lead is picking from. */
function Choices({ options, note }: { options: InteractionOption[]; note: string }) {
  return <>
    <ul className="game-row game-row--legend" aria-label="The pictures to choose from">{options.map((option, i) => <li key={option.id}><Tile option={option} tone={i % 4} /></li>)}</ul>
    <p className="game-note game-note--dim">{note}</p>
  </>;
}

/** The same observation surface on TV and phone; it never sends an intent. */
export function Board({ prompt, party, now, answer = [], playerId }: BoardProps) {
  const chapter = useChapter();
  const state = useRunState();
  const appearance = interactionAppearance(chapter?.id === state?.chapterId ? chapter : null, state?.sceneId);
  const spec = prompt.spec;
  const connectedMembers = party.filter((member) => member.connected);
  const connected = connectedMembers.map((member) => member.playerId);
  const member = (id: string) => party.find((m) => m.playerId === id);
  const name = (id: string) => member(id)?.character.name ?? "Your friend";
  const elapsed = Math.max(0, now - Date.parse(prompt.startedAt ?? new Date(now).toISOString()));
  const still = reducedMotion();
  const active = prompt.phase === "active";
  const bells = state?.sceneId === "song_track";
  const painted = appearance !== null;
  const view = { prompt, party, connected, now };
  const leadId = interactionActor(prompt, connected);
  const lead = name(leadId ?? "");
  /** This screen builds the answer: the lead's phone. The TV and the other phones see the choices instead. */
  const building = playerId !== undefined && playerId === leadId;
  const object = appearance?.props?.find((id) => !id.startsWith("note-"));
  switch (spec.kind) {
    case "precision":
      if (!active) return null;
      return still
        ? <p className="game-note"><Icon name="hand" /> Moving parts are switched off. Take a helping hand to get past this one.</p>
        : <><Meter prompt={prompt} now={now} prop={object} /><p className="game-note">Tap when the marker is in the gold.</p></>;
    case "timing": {
      if (!active) return null;
      if (still) return <p className="game-note"><Icon name="hand" /> Moving parts are switched off. Take a helping hand to get past this one.</p>;
      const position = precisionPosition(elapsed, spec.periodMs);
      const safe = precisionSuccess(spec, position, prompt.relaxed);
      const fill = approach(position, spec.target, Math.min(1, spec.width * (prompt.relaxed ? 2 : 1)));
      const soon = !safe && fill > 0.6;
      return <div className="story-interaction__signal game-lamp" data-safe={safe} data-soon={soon} role="img" aria-label={safe ? "Now!" : "Wait"}
        style={{ "--fill": `${Math.round((safe ? 1 : fill) * 360)}deg` } as React.CSSProperties}>
        <span className="game-lamp__light"><span className="game-lamp__ring" aria-hidden="true" /><Icon name={safe ? "boot" : "eye"} /></span>
        <strong className="game-lamp__word">{safe ? "NOW!" : soon ? "Get ready…" : "Wait…"}</strong>
      </div>;
    }
    case "tracking": {
      if (!active) return null;
      const labels = trackingLabels(spec.covers, appearance?.coverIcons);
      const step = spec.stepMs * (prompt.relaxed ? 2 : 1);
      const progress = still || prompt.relaxed ? spec.swaps.length : Math.max(0, (elapsed - step) / step);
      const done = Math.min(spec.swaps.length, Math.floor(progress));
      const positions = spec.covers.map((_, index) => index);
      for (const [a, b] of spec.swaps.slice(0, done)) {
        for (let i = 0; i < positions.length; i++) positions[i] = positions[i] === a ? b : positions[i] === b ? a : positions[i]!;
      }
      const swap = spec.swaps[done];
      return <div className={"story-interaction__covers" + (painted ? " story-interaction__covers--painted" : "")} role="img" aria-label={elapsed < step && !still ? "Watch the glowing object before the covers move" : "Follow the moving covers"}>
        {spec.covers.map((label, index) => {
          const at = positions[index]!;
          const destination = swap ? at === swap[0] ? swap[1] : at === swap[1] ? swap[0] : at : at;
          const position = at + (destination - at) * (progress - done);
          const reveal = (!prompt.relaxed && !still && elapsed < step && index === spec.start) || ((still || prompt.relaxed) && at === trackedCover(spec));
          return <span className="story-interaction__cover" key={index} style={{ left: `${(position + 0.5) / spec.covers.length * 100}%` }}>
            {painted ? <PaintedCover bells={bells} icon={appearance?.coverIcons?.[index]} target={appearance?.props?.[0]} diving={elapsed > step * .5 && elapsed < step} reveal={reveal} /> : <span aria-hidden="true" className={reveal ? "game-cover game-cover--glow" : "game-cover"}>{reveal ? "✦" : "▰"}</span>}
          </span>;
        })}
        {labels.map((label, index) => <span className="story-interaction__cover story-interaction__cover-label" key={`label:${index}`} style={{ left: `${(index + 0.5) / spec.covers.length * 100}%` }}><small>{label}</small></span>)}
        {(still || prompt.relaxed) && <span className="story-interaction__tracking-help">The glow waits under: {labels[trackedCover(spec)]}.</span>}
      </div>;
    }
    case "memory": {
      if (!active) return null;
      const step = spec.stepMs * (prompt.relaxed ? 2 : 1);
      const index = Math.floor(elapsed / step);
      const visible = prompt.relaxed || still;
      const option = (id: string) => spec.options.find((o) => o.id === id);
      if (visible) {
        return <div className="story-interaction__memory game-memory" aria-label="Magic pattern">
          <p className="game-note">The pattern stays on screen. Copy it in this order:</p>
          <ol className="game-row">{spec.answer.map((id, i) => { const o = option(id); return o ? <li key={i}><Tile option={o} index={i + 1} tone={toneOf(spec.options, id)} /></li> : null; })}</ol>
          {answer.length > 0 && <p className="game-note" aria-live="polite">So far: {answer.map((id) => option(id)?.label).join(", ")}</p>}
        </div>;
      }
      if (index < spec.answer.length) {
        const current = option(spec.answer[index] ?? "");
        return <div className="story-interaction__memory game-memory" aria-label="Magic pattern">
          <p className="game-note">Watch and remember…</p>
          {current ? <Tile key={index} option={current} size="lg" tone={toneOf(spec.options, current.id)} /> : null}
          <p className="game-dots" aria-label={`${index + 1} of ${spec.answer.length}`}>{spec.answer.map((_, i) => <span key={i} className={i <= index ? "game-dots__dot game-dots__dot--on" : "game-dots__dot"} />)}<small> {index + 1} of {spec.answer.length}</small></p>
        </div>;
      }
      return <div className="story-interaction__memory game-memory" aria-label="Magic pattern">
        <p className="game-note game-note--big">{building ? "Now copy it!" : `Now ${lead} copies it!`}</p>
        {building ? <Slots answer={answer} length={spec.answer.length} options={spec.options} />
          : <Choices options={spec.options} note={`${lead} taps the ${spec.answer.length} pictures on their phone. Say the order out loud to help!`} />}
      </div>;
    }
    case "sequence": {
      if (!active) return null;
      const mine = playerId ? interactionClues(prompt, playerId, connected) : [];
      return <div className="game-sequence">
        {playerId ? (mine.length > 0 && <div className="game-clue"><span className="game-clue__eyebrow"><Icon name="scroll" /> Your clue{mine.length > 1 ? "s" : ""}. Read {mine.length > 1 ? "them" : "it"} out loud!</span><ul>{mine.map((clue, i) => <li key={i}>{clue}</li>)}</ul></div>)
          : <p className="game-note"><Icon name="phone" /> Every phone holds a clue. Put them together to find the order.</p>}
        {building ? <Slots answer={answer} length={spec.answer.length} options={spec.options} />
          : <Choices options={spec.options} note={`${lead} puts the ${spec.answer.length} steps in order on their phone.`} />}
      </div>;
    }
    case "balance": {
      if (!active) return null;
      const levels = connected.map((id) => prompt.levels?.[id] ?? 0);
      const tilt = levels.length > 1 ? (levels[levels.length - 1]! - levels[0]!) * 20 : 0;
      const ready = balanceReady(prompt, connected);
      const window = prompt.relaxed ? 0.25 : 0.125;
      return <div className="game-balance" data-ready={ready}>
        <div className="story-interaction__balance game-beam" style={{ transform: still ? undefined : `rotate(${tilt}deg)` }}><Icon name="hand" /> {spec.objectLabel}</div>
        <ul className="game-gauges">{connectedMembers.map((m) => {
          const level = prompt.levels?.[m.playerId] ?? 0;
          const word = Math.abs(level - 0.5) <= window ? "Just right" : level < 0.5 ? "Too low" : "Too high";
          return <li key={m.playerId} className={`game-gauge${Math.abs(level - 0.5) <= window ? " game-gauge--ok" : ""}`}>
            <span className="game-gauge__well"><span className="game-gauge__middle" /><span className="game-gauge__fill" style={{ height: `${Math.round(level * 100)}%` }} /></span>
            <span className="game-gauge__name">{m.character.name}</span>
            <span className="game-gauge__word">{word}</span>
          </li>;
        })}</ul>
        <p role="status" className="game-note">{ready ? "Steady together!" : "Bring everyone’s side to the middle."}</p>
      </div>;
    }
    case "relay": {
      if (!active) return null;
      const holder = relayHolder(prompt, connected);
      const order = [...prompt.playerIds, ...connected.filter((id) => !prompt.playerIds.includes(id))].filter((id) => connected.includes(id));
      return <div className="story-interaction__spark game-relay">
        <ul className="game-heroes">{order.map((id) => { const m = member(id); if (!m) return null;
          const passed = prompt.passed?.includes(id);
          const has = holder === id && prompt.caughtBy === id;
          return <HeroChip key={id} member={m} tone={passed ? "done" : holder === id ? "on" : "off"} mark={passed ? "check" : holder === id && !has ? "hand" : undefined}
            token={has && object ? propUrl(object) : undefined} state={passed ? "passed it" : holder === id ? (has ? "has it!" : "catch it!") : "waiting"} />; })}
          <li className={`game-hero game-hero--goal${holder ? " game-hero--off" : " game-hero--on"}`}><span className="game-hero__face game-hero__face--goal">{!holder && object ? <img className="game-hero__token game-hero__token--home" src={propUrl(object)} alt="" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <Icon name="quest" />}</span><span className="game-hero__name">Finish</span></li>
        </ul>
        <p className="game-note" role="status"><Icon name="star" /> {holder ? `${spec.objectLabel}: ${name(holder)} ${prompt.caughtBy === holder ? "has it!" : "can catch it"}` : "It made it all the way!"}</p>
        <p className="game-note game-note--dim">{(prompt.passed ?? []).map(name).join(" → ") || "Everyone gets a turn."}</p>
      </div>;
    }
    case "cooperate": {
      if (!active) return null;
      const supporters = supportPlayers(prompt, connected);
      const nowIso = new Date(now).toISOString();
      const ready = supportsReady(prompt, connected, nowIso);
      const lead = view.connected.includes(prompt.actorId) ? prompt.actorId : view.connected[0];
      return <div className="game-cooperate" data-ready={ready}>
        <ul className="game-heroes">{connectedMembers.map((m) => {
          const supporting = supporters.includes(m.playerId);
          const lease = prompt.supports[m.playerId];
          const holding = supporting && (lease === null || (typeof lease === "string" && Date.parse(lease) > now));
          const isLead = m.playerId === lead;
          return <HeroChip key={m.playerId} member={m} tone={holding ? "done" : supporting ? "off" : "on"} mark={holding ? "check" : isLead && !supporting ? "star" : undefined}
            state={supporting ? (holding ? (lease === null ? "propped" : "holding!") : "not yet") : "ready to go"} />;
        })}</ul>
        <p role="status" className="game-note">{ready ? "Holding steady!" : "Everyone hold on…"}</p>
      </div>;
    }
    case "play": {
      if (!active) return null;
      const chosen = (id: string) => spec.options.find((o) => o.id === prompt.contributions?.[id]);
      const count = connected.filter((id) => prompt.contributions?.[id] !== undefined).length;
      return <div className="story-interaction__reactions game-play" aria-live="polite">
        <ul className="game-bubbles">{(prompt.reactions ?? []).slice(-3).map((reaction, index, shown) => <li key={(prompt.taps ?? 0) - shown.length + index} className="game-bubble"><strong>{name(reaction.playerId)}:</strong> {reaction.text}</li>)}</ul>
        {(prompt.reactions ?? []).length === 0 && <p className="game-note game-note--dim">What you pick shows up here.</p>}
        {spec.participation === "everyone" && <>
          <ul className="game-heroes">{connectedMembers.map((m) => { const o = chosen(m.playerId); return <HeroChip key={m.playerId} member={m} tone={o ? "done" : "off"} mark={o ? "check" : undefined} state={o?.label ?? "choosing something"} />; })}</ul>
          <p className="game-note">{count} of {connected.length} friends have added something.</p>
        </>}
        {spec.participation === "any" && playReady(prompt, connected) && <p className="game-note">Everyone who wants a turn can have one.</p>}
      </div>;
    }
    default: return null;
  }
}

export interface KindControlsProps {
  prompt: InteractionPrompt; playerId: string; connected: readonly string[]; mine: boolean;
  now: number; busy: boolean; send: (action: InteractionAction) => void;
  answer: string[]; setAnswer: (update: (current: string[]) => string[]) => void;
  holding: boolean; setHolding: (holding: boolean) => void;
}

/** The phone's buttons for one kind of game, lead and helper alike. */
export function KindControls({ prompt, playerId, connected, mine, now, busy, send, answer, setAnswer, holding, setHolding }: KindControlsProps) {
  const chapter = useChapter();
  const state = useRunState();
  const appearance = interactionAppearance(chapter?.id === state?.chapterId ? chapter : null, state?.sceneId);
  const spec = prompt.spec;
  const still = reducedMotion();
  const primary = (label: string, action: InteractionAction, icon: string, disabled = false) =>
    <Button variant="primary" size="lg" block icon={<Icon name={icon} />} className="story-interaction__button game-action" disabled={busy || disabled} onClick={() => send(action)}>{label}</Button>;
  const secondary = (label: string, action: InteractionAction, icon: string, disabled = false) =>
    <Button variant="secondary" size="lg" block icon={<Icon name={icon} />} className="story-interaction__button game-action" disabled={busy || disabled} onClick={() => send(action)}>{label}</Button>;
  switch (spec.kind) {
    case "precision":
      if (!mine) return null;
      return still ? null : primary(spec.actionLabel, { action: "stop", position: precisionPosition(now - Date.parse(prompt.startedAt ?? ""), spec.periodMs) }, "star");
    case "timing":
      if (!mine) return null;
      return still ? null : primary(spec.actionLabel, { action: "stop", position: precisionPosition(now - Date.parse(prompt.startedAt ?? ""), spec.periodMs) }, "boot");
    case "tracking": {
      if (!mine) return null;
      const view = { prompt, party: [], connected, now };
      if (showing(view)) return <p className="game-note"><Icon name="tv" /> Keep your eyes on the covers…</p>;
      return <div className="game-options">{trackingLabels(spec.covers, appearance?.coverIcons).map((label, index) =>
        <Button key={index} variant="secondary" size="lg" block icon={<Icon name="eye" />} className="story-interaction__button game-action" disabled={busy} onClick={() => send({ action: "answer", answer: [String(index)] })}>{`${spec.actionLabel}: ${label}`}</Button>)}</div>;
    }
    case "memory":
    case "sequence": {
      if (!mine) return null;
      const view = { prompt, party: [], connected, now };
      const locked = spec.kind === "memory" && showing(view);
      const full = answer.length >= spec.answer.length;
      if (locked) return <p className="game-note"><Icon name="tv" /> Watch the TV first…</p>;
      return <>
        <div className="game-options game-options--grid">
          {spec.options.map((option, i) => <button key={option.id} type="button" className="story-interaction__button game-option kad-focusable" data-tone={i % 4} disabled={busy || full} onClick={() => setAnswer((current) => [...current, option.id])}>
            <span className="game-option__icon"><PaintedGlyph label={option.label} /><Icon name={option.icon} /></span>
            <span className="game-option__label">{option.label}</span>
          </button>)}
        </div>
        <div className="game-actions-row">
          <Button variant="ghost" icon={<Icon name="back" />} className="story-interaction__button" disabled={busy || !answer.length} onClick={() => setAnswer((current) => current.slice(0, -1))}>Change last step</Button>
        </div>
        {primary(spec.actionLabel, { action: "answer", answer }, "check", answer.length !== spec.answer.length)}
      </>;
    }
    case "balance": {
      const level = prompt.levels?.[playerId] ?? 0;
      return <>
        <div className="game-actions-row game-actions-row--pair">
          {secondary("Lift my side", { action: "adjust", direction: "up" }, "forward", level >= 1)}
          {secondary("Lower my side", { action: "adjust", direction: "down" }, "back", level <= 0)}
        </div>
        {mine && primary(spec.actionLabel, { action: "complete" }, "check", !balanceReady(prompt, connected))}
      </>;
    }
    case "relay": {
      const holder = relayHolder(prompt, connected);
      if (!holder) return mine ? primary(spec.actionLabel, { action: "complete" }, "check") : null;
      if (holder !== playerId) return null;
      return prompt.caughtBy === playerId
        ? primary(spec.actionLabel, { action: "pass" }, "forward")
        : primary(`Catch ${spec.objectLabel}`, { action: "catch" }, "hand");
    }
    case "cooperate": {
      const supporter = supportPlayers(prompt, connected).includes(playerId);
      const propped = prompt.supports[playerId] === null;
      const nowIso = new Date(now).toISOString();
      return <>
        {supporter && (prompt.relaxed || connected.length === 1
          ? secondary(propped ? "Remove support" : spec.supportLabel, { action: "support", mode: propped ? "release" : "prop" }, propped ? "close" : "hand")
          : <button type="button" className="kad-button kad-button--secondary kad-button--lg kad-button--block story-interaction__button story-interaction__hold game-action game-hold kad-focusable" aria-pressed={holding}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setHolding(true); }}
            onPointerUp={() => setHolding(false)} onPointerCancel={() => setHolding(false)} onLostPointerCapture={() => setHolding(false)} onBlur={() => setHolding(false)}
            onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); setHolding(true); } }}
            onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); setHolding(false); } }}>
            <span className="kad-button__icon" aria-hidden="true"><Icon name="hand" /></span>
            <span className="kad-button__label">{holding ? "I’ve got it!" : spec.supportLabel}</span>
            <span className="game-hold__hint" aria-hidden="true">{holding ? "keep holding" : "press and hold"}</span>
          </button>)}
        {supporter && !prompt.relaxed && connected.length > 1 && <div className="game-actions-row">
          <Button variant="ghost" icon={<Icon name="hand" />} className="story-interaction__button" disabled={busy || holding || propped} onClick={() => send({ action: "support", mode: "prop" })}>Use a prop instead</Button>
        </div>}
        {mine && primary(spec.actionLabel, { action: "complete" }, "check", !supportsReady(prompt, connected, nowIso))}
      </>;
    }
    case "play":
      return <>
        <div className="game-options game-options--grid">{spec.options.map((option) => <button key={option.id} type="button" className="story-interaction__button game-option kad-focusable" disabled={busy} onClick={() => send({ action: "play", optionId: option.id })}>
          <span className="game-option__icon"><Icon name={option.icon} /></span>
          <span className="game-option__label">{option.label}</span>
        </button>)}</div>
        {mine && primary(spec.actionLabel, { action: "complete" }, "check", !playReady(prompt, connected))}
      </>;
    default: return null;
  }
}
