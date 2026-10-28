import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { relayHolder, type InteractionPrompt, type PartyMember } from "@kad/shared";
import { characterWorldArtUrl } from "../world/art-paths";
import { reducedMotion } from "../a11y/prefs";
import { Icon } from "./icons";
import { propUrl } from "./InteractionArt";
import { Button } from "../ui/Button";
import { buzz } from "./game-feel";
import "./RelayGame.css";

/** Give the final flight time to land before showing the reward or Continue. */
export function useRelayArrival(prompt: InteractionPrompt | null): boolean {
  const key = prompt?.spec.kind === "relay" && prompt.phase === "result" ? `${prompt.openedSeq}:${prompt.attempt}` : null;
  const [arrived, setArrived] = useState<string | null>(null);
  useEffect(() => {
    if (key === null || key === arrived || reducedMotion()) return;
    const timer = window.setTimeout(() => setArrived(key), 650);
    return () => window.clearTimeout(timer);
  }, [key, arrived]);
  return key === null || reducedMotion() || key === arrived;
}

/** One representation everywhere, including a useful fallback if a painting fails. */
function RelayObject({ object, label }: { object?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [object]);
  return object && !failed
    ? <img className="relay-object" src={propUrl(object)} alt="" draggable={false} decoding="async" onError={() => setFailed(true)} />
    : <span className="relay-object relay-object--fallback"><Icon name="star" /><span>{label}</span></span>;
}

export function relaySeats(prompt: InteractionPrompt, party: PartyMember[]): string[] {
  const connected = party.filter((m) => m.connected).map((m) => m.playerId);
  return [...prompt.playerIds, ...connected.filter((id) => !prompt.playerIds.includes(id))].filter((id) => connected.includes(id));
}

/** A single object follows a continuous route between the heroes' actual hand positions. */
export function RelayWorld({ prompt, party, object, settled = true }: { prompt: InteractionPrompt; party: PartyMember[]; object?: string; settled?: boolean }) {
  if (prompt.spec.kind !== "relay") return null;
  const order = relaySeats(prompt, party);
  const delivered = prompt.phase === "result" && prompt.outcome !== "failure";
  const ready = prompt.phase === "ready";
  const holder = delivered ? undefined : relayHolder(prompt, order);
  const caught = !!holder && prompt.caughtBy === holder;
  const passed = prompt.passed ?? [];
  const last = [...passed].reverse().find((id) => order.includes(id));
  const x = (id?: string) => id ? 10 + order.indexOf(id) * 80 / Math.max(1, order.length) : 90;
  const parked = !order.length && !delivered;
  const target = parked ? 50 : delivered ? 90 : x(holder);
  const label = prompt.spec.objectLabel;
  const name = party.find((m) => m.playerId === holder)?.character.name;
  const from = last ? x(last) : -12;
  const pose = { "--from-x": `${from}%`, "--to-x": `${target}%`, "--from-y": last ? "64%" : "20%", "--to-y": caught || delivered || ready ? "64%" : "32%" } as CSSProperties;
  return <div className="relay-world" data-caught={caught} data-delivered={delivered} data-phase={parked ? "ready" : prompt.phase}>
    <p className="relay-world__caption" role="status">{parked ? "Waiting for a friend to reconnect" : ready ? "From hand to hand, all the way home" : delivered ? settled ? "Delivered together!" : "On its way home!" : caught ? `${name} has ${label}!` : `${name}, catch ${label}!`}</p>
    <div className="relay-world__stage" aria-label={`The journey of ${label}`}>
      <span className="relay-world__path" aria-hidden="true" />
      <ol className="relay-world__heroes">{order.map((id) => {
        const m = party.find((member) => member.playerId === id)!;
        const done = passed.includes(id);
        return <li key={id} className="relay-world__hero" data-active={id === holder} data-done={done} style={{ left: `${x(id)}%` }}>
          <img src={characterWorldArtUrl(m.character.species, m.character.tier, m.character.class)} alt="" draggable={false} onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
          <span className="relay-world__hands" aria-hidden="true"><Icon name="hand" /></span>
          <strong>{m.character.name}</strong><small>{done ? "Passed!" : id === holder ? caught ? "Got it!" : "Your turn!" : "Next"}</small>
        </li>;
      })}</ol>
      <div className="relay-world__home" data-delivered={delivered && settled}><Icon name={delivered && settled ? "check" : "quest"} /><strong>Home</strong></div>
      <span key={`${passed.join(":")}:${holder ?? "home"}`} className="relay-world__flight" data-caught={caught} data-delivered={delivered} style={pose}>
        <span className="relay-world__shadow" aria-hidden="true" />
        <RelayObject object={object} label={label} />
      </span>
    </div>
    <p className="game-note">{parked ? "The object is safe here. Reconnect a phone to carry on." : ready ? "Catch the object on your phone, then slide it up to send it on." : delivered ? prompt.outcome === "assisted" ? "A helping hand brings it home." : "Every hand helped it get here." : caught ? "Send it on to the next pair of hands." : "Tap the arriving object on your phone."}</p>
  </div>;
}

/** The phone is the child's pair of hands. The object itself is the large touch target. */
export function RelayCatcher({ object, caught, label, catchLabel, nextName, busy, onCatch, onPass }: {
  object?: string; caught: boolean; label: string; catchLabel: string; nextName: string; busy: boolean;
  onCatch: () => Promise<boolean>; onPass: () => Promise<boolean>;
}) {
  const [thrown, setThrown] = useState(false);
  const [drag, setDrag] = useState(0);
  const [error, setError] = useState<"catch" | "pass" | null>(null);
  const catching = useRef(false);
  const gesture = useRef<{ id: number; x: number; y: number; lift: number; distance: number } | null>(null);
  const suppressClick = useRef(false);
  const timer = useRef<number | null>(null);
  const gone = useRef(false);
  useEffect(() => { gone.current = false; return () => { gone.current = true; if (timer.current !== null) window.clearTimeout(timer.current); }; }, []);
  const pass = () => {
    if (timer.current !== null || thrown || busy || !caught) return;
    setError(null); setThrown(true); buzz([10, 30, 20]);
    timer.current = window.setTimeout(async () => {
      try { if (!await onPass() && !gone.current) { setThrown(false); setDrag(0); setError("pass"); } }
      catch { if (!gone.current) { setThrown(false); setDrag(0); setError("pass"); } }
      finally { timer.current = null; }
    }, reducedMotion() ? 0 : 280);
  };
  const catchObject = async () => {
    if (busy || caught || catching.current) return;
    catching.current = true; setError(null); buzz(25);
    try { if (!await onCatch() && !gone.current) setError("catch"); }
    catch { if (!gone.current) setError("catch"); }
    finally { catching.current = false; }
  };
  const reset = () => { gesture.current = null; setDrag(0); };
  const release = (event: PointerEvent<HTMLButtonElement>) => {
    if (gesture.current?.id !== event.pointerId) return;
    const g = gesture.current;
    const lift = Math.max(0, Math.min(160, g.y - event.clientY));
    const sideways = Math.abs(event.clientX - g.x);
    gesture.current = null; suppressClick.current = Math.max(g.distance, lift, sideways) >= 7;
    if (lift >= 55 && sideways <= lift * 1.5 && caught && !busy) { setDrag(lift); pass(); }
    else setDrag(0);
  };
  return <div className="game-catcher relay-hands" data-caught={caught} data-thrown={thrown} data-dragging={drag > 0}
    style={{ "--drag": `${reducedMotion() ? 0 : drag}px` } as CSSProperties}>
    <p className="relay-hands__destination"><Icon name="forward" /> To {nextName}</p>
    <button type="button" className="game-catcher__stage relay-hands__stage kad-focusable" disabled={busy || thrown} aria-label={caught ? label : catchLabel}
      onClick={(event) => { if (gesture.current) return; if (suppressClick.current && event.detail > 0) { suppressClick.current = false; return; } suppressClick.current = false; if (caught) pass(); else catchObject(); }}
      onPointerDown={(event) => {
        if (busy || thrown || event.button > 0 || gesture.current) return;
        suppressClick.current = false;
        if (!caught) { suppressClick.current = true; catchObject(); return; }
        buzz(8);
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lift: 0, distance: 0 };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const g = gesture.current;
        if (!g || g.id !== event.pointerId) return;
        g.lift = Math.max(0, Math.min(160, g.y - event.clientY));
        g.distance = Math.max(g.distance, Math.abs(g.y - event.clientY), Math.abs(g.x - event.clientX));
        setDrag(g.lift);
      }}
      onPointerUp={release} onPointerCancel={(event) => { if (gesture.current && gesture.current.id !== event.pointerId) return; reset(); suppressClick.current = true; }}
      onLostPointerCapture={(event) => { if (gesture.current?.id === event.pointerId) { reset(); suppressClick.current = true; } }}
      onBlur={() => { if (gesture.current) { reset(); suppressClick.current = true; } }}>
      <span className="relay-hands__guide" aria-hidden="true"><Icon name="forward" /><span>{caught ? "Slide up" : "Catch!"}</span></span>
      <span className="relay-hands__cradle" aria-hidden="true"><Icon name="hand" /><Icon name="hand" /></span>
      <span className="relay-hands__object" style={{ "--drag": `${reducedMotion() ? 0 : drag}px`, "--turn": `${reducedMotion() ? 0 : -drag / 15}deg` } as CSSProperties}>
        <RelayObject object={object} label={catchLabel.replace(/^Catch /, "")} />
      </span>
      <span className="relay-hands__instruction">{thrown ? "On its way!" : caught ? `Slide up to ${nextName}, or tap to send` : "Touch the object to catch it"}</span>
    </button>
    {error && <p role="status" className="game-note">{error === "pass" ? "Still in your hands. Try that pass again." : "It's still here. Touch it again."}</p>}
    <details className="relay-hands__buttons"><summary>Use a button instead</summary>
      {caught ? <Button variant="secondary" block disabled={busy || thrown} onClick={pass}>Send to {nextName}</Button>
        : <Button variant="secondary" block disabled={busy} onClick={catchObject}>Catch with a button</Button>}
    </details>
  </div>;
}
