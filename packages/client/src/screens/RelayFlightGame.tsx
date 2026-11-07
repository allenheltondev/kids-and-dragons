import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { relayCatchWindow, relayPosition, relayTarget, relayThrowQuality, type InteractionPrompt, type PartyMember, type RelayCatchInput, type RelayThrowInput } from "@kad/shared";
import { HeroImage } from "../world/hero-art-dom";
import { reducedMotion } from "../a11y/prefs";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import { RelayObject, RelayScore } from "./RelayGame";
import { buzz } from "./game-feel";
import { propUrl } from "./InteractionArt";
import { RelayLandscape } from "./RelayArt";

const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
/** A throw's direction and distance determine the receiving phone's actual flight. */
export function RelayFlightCatcher({ prompt, playerId, object, nextName, nextMember, now, busy, onCatch, onPass }: {
  prompt: InteractionPrompt; playerId: string; object?: string; nextName: string; nextMember?: PartyMember; now: number; busy: boolean;
  onCatch: (input: RelayCatchInput) => Promise<boolean>; onPass: (input: RelayThrowInput) => Promise<boolean>;
}) {
  const relay = prompt.relay!;
  const flight = relay.flight;
  const caught = prompt.caughtBy === playerId;
  const still = reducedMotion();
  const gesture = useRef<{ id: number; x: number; y: number; width: number; height: number; dx: number; dy: number } | null>(null);
  const suppress = useRef(false);
  const sending = useRef(false);
  const mounted = useRef(true);
  const stage = useRef<HTMLButtonElement>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [aim, setAim] = useState(0);
  const [power, setPower] = useState(0.5);
  const [throwing, setThrowing] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Starting a catch must reveal the whole flight on short phones. Do this once
  // when the receiver's surface arrives, never while a child is aiming a swipe.
  useEffect(() => { stage.current?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" }); }, []);
  useEffect(() => { gesture.current = null; setDrag({ x: 0, y: 0 }); setThrowing(false); }, [flight.id, caught]);
  const target = relayTarget(prompt.passed?.length ?? 0);
  const position = still ? 0.82 : relayPosition(flight, now);
  const window = relayCatchWindow(flight, prompt.relaxed);
  const onGround = flight.dropped || (!prompt.relaxed && position > window.end);
  const ready = still || prompt.relaxed && position >= window.start || position >= window.start && position <= window.end;
  const quality = relayThrowQuality(aim, power, prompt.passed?.length ?? 0, prompt.relaxed);
  const submit = async (action: () => Promise<boolean>, throwing = false) => {
    if (sending.current || busy) return;
    sending.current = true; setError(false);
    if (throwing) setThrowing(true);
    try {
      const ok = await action();
      if (mounted.current && !ok) { setError(true); setThrowing(false); setDrag({ x: 0, y: 0 }); }
      if (ok) buzz(throwing ? [10, 30, 20] : 20);
    } catch { if (mounted.current) { setError(true); setThrowing(false); setDrag({ x: 0, y: 0 }); } }
    finally { sending.current = false; }
  };
  const catchIt = (reach = flight.landing) => submit(() => onCatch({ flightId: flight.id, position, reach }));
  const throwIt = (direction = aim, strength = power) => submit(() => onPass({ flightId: flight.id, aim: direction, power: strength }), true);
  const reset = () => { gesture.current = null; setDrag({ x: 0, y: 0 }); suppress.current = true; };
  const release = (event: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null; suppress.current = true;
    const dx = event.clientX - g.x, dy = g.y - event.clientY;
    if (dy < 24) { setDrag({ x: 0, y: 0 }); return; }
    void throwIt(clamp(dx / (g.width * 0.5), -1, 1), clamp(dy / (g.height * 0.7)));
  };
  const progress = Math.min(1, position / window.start);
  const objectX = caught ? 50 : still || onGround ? flight.landing * 100 : 50 + (flight.landing * 100 - 50) * progress;
  const objectY = caught ? 68 : onGround ? 82 : still ? 68 : position < window.start ? 10 + 53 * progress : 63 + 10 * (position - window.start) / (window.end - window.start);
  const status = caught ? `Aim for ${nextName}` : onGround ? "Save it! Touch the fallen object" : ready ? "CATCH NOW!" : flight.quality === "wild" ? "Wild throw — watch where it lands!" : "Incoming… wait for the gold";
  const objectLabel = prompt.spec.kind === "relay" ? prompt.spec.objectLabel : "the object";
  return <div className="relay-skill" data-caught={caught} data-ready={ready && !caught} data-ground={onGround && !caught} data-dragging={!!gesture.current}>
    <RelayScore prompt={prompt} />
    <p className="relay-hands__destination"><Icon name="forward" /> {caught ? `To ${nextName}` : `Catch ${objectLabel}`}</p>
    <button ref={stage} type="button" className="relay-skill__stage kad-focusable" aria-label={caught ? `Throw ${objectLabel}` : `Catch ${objectLabel}`} disabled={busy || throwing}
      onPointerDown={(event) => {
        if (busy || sending.current || event.button > 0 || gesture.current) return;
        suppress.current = true;
        const box = event.currentTarget.getBoundingClientRect();
        if (!caught) { void catchIt(clamp((event.clientX - box.left) / Math.max(1, box.width))); return; }
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: Math.max(1, box.width), height: Math.max(1, box.height), dx: 0, dy: 0 };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const g = gesture.current;
        if (!g || g.id !== event.pointerId) return;
        g.dx = event.clientX - g.x; g.dy = Math.max(0, g.y - event.clientY);
        setDrag({ x: g.dx, y: g.dy }); setAim(clamp(g.dx / (g.width * 0.5), -1, 1)); setPower(clamp(g.dy / (g.height * 0.7)));
      }} onPointerUp={release}
      onPointerCancel={(event) => { if (gesture.current?.id === event.pointerId) reset(); }}
      onLostPointerCapture={(event) => { if (gesture.current?.id === event.pointerId) reset(); }} onBlur={reset}
      onClick={(event) => {
        if (suppress.current && event.detail > 0) { suppress.current = false; return; }
        // Tapping cannot silently make a perfect throw. Use the explicit aim controls with a keyboard.
        if (!caught) void catchIt();
      }}>
      <RelayLandscape />
      <span className="relay-skill__target" data-throw={caught} style={{ left: `${caught ? 50 + target.aim * 50 : flight.landing * 100}%`, top: `${caught ? 68 - target.power * 70 : 68}%` }} aria-hidden="true">
        <span className="relay-skill__target-ring" />
        {caught && (nextMember
          ? <HeroImage className="relay-skill__recipient" hero={nextMember.character} place="world" alt="" draggable={false} onError={event => { event.currentTarget.style.visibility = "hidden"; }} />
          : <img className="relay-skill__recipient" src={propUrl("rope-basket")} alt="" draggable={false} onError={event => { event.currentTarget.style.visibility = "hidden"; }} />)}
        <span className="relay-skill__target-label">{caught ? nextName : "Catch here"}</span>
      </span>
      {caught && <svg className="relay-skill__trajectory" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={`M50 68 Q${50 + aim * 25} ${40 - power * 40} ${50 + aim * 50} ${68 - power * 70}`} data-quality={quality} /><circle cx={50 + aim * 50} cy={68 - power * 70} r="2" /></svg>}
      <span className="relay-skill__object" data-thrown={throwing} style={{ left: `${objectX}%`, top: `${objectY}%`, "--dx": `${still ? 0 : drag.x}px`, "--dy": `${still ? 0 : -drag.y}px`, "--spin": `${still || caught ? 0 : Math.sin(position * Math.PI) * (flight.quality === "wild" ? 140 : 20)}deg` } as CSSProperties}>
        <RelayObject object={object} label={objectLabel} />
      </span>
      <span className="relay-skill__grip" data-holding={caught} style={{ left: `${caught ? 50 : flight.landing * 100}%` }} aria-hidden="true"><img src="/assets/ui/relay/catching-hands.webp" alt="" draggable={false} onError={event => { event.currentTarget.style.visibility = "hidden"; }} /></span>
      <span className="relay-skill__status">{throwing ? "On its way!" : status}</span>
    </button>
    <p className="game-note">{caught ? "Drag the object toward the gold hands. Your direction and distance shape the throw." : "Touch the landing circle as the object reaches it. An early grab or a drop costs one chance."}</p>
    {error && <p role="status" className="game-note">That move did not arrive. Try again.</p>}
    <details className="relay-hands__buttons" open={still || undefined}><summary>Use aim controls and buttons</summary>
      {caught ? <>
        <label className="relay-skill__slider">Direction <input type="range" min="-1" max="1" step="0.02" value={aim} disabled={busy || throwing} onChange={event => setAim(Number(event.target.value))} /></label>
        <label className="relay-skill__slider">Strength <input type="range" min="0" max="1" step="0.02" value={power} disabled={busy || throwing} onChange={event => setPower(Number(event.target.value))} /></label>
        <p className="game-note">{quality === "clean" ? "Lined up with the hands!" : aim < target.aim - 0.22 ? "Aim farther right." : aim > target.aim + 0.22 ? "Aim farther left." : power < target.power ? "A little more strength." : "A little less strength."}</p>
        <Button variant="secondary" block disabled={busy || throwing} onClick={() => void throwIt()}>Throw to {nextName}</Button>
      </> : <><p className="game-note" role="status">{onGround ? "Pick it up to save the relay." : ready ? "Catch now!" : "Wait for the object."}</p><Button variant="secondary" block disabled={busy} onClick={() => void catchIt()}>{onGround ? "Pick it up" : "Catch with a button"}</Button></>}
    </details>
  </div>;
}
