import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { kitAccent, kitDecorationChoices, type HeroKitView, type ResolvedCharacter } from "@kad/shared";
import { CampBedroll } from "../world/CampBedroll";
import { campKitStyle } from "../world/camp-kit-art";
import { DECORATION_ART, KIT_RULES, kitName } from "../world/camp-scene";
import { campPaint } from "../world/camp-paint";
import { Icon } from "./icons";
import "./TentInterior.css";

/** Slot one is the same keepsake inside and outside, so the book's existing offline edits apply. */
export function shelfSlots(slots: readonly (string | null)[], favorite: string | null): (string | null)[] {
  const next = slots.length ? [...slots] : [null, null];
  const previous = next[0] ?? null;
  const other = favorite === null ? -1 : next.indexOf(favorite, 1);
  if (other > 0) next[other] = previous;
  next[0] = favorite;
  return next;
}
function Decoration({ piece }: { piece: string }): ReactElement {
  const [failed, setFailed] = useState<string | null>(null);
  const art = DECORATION_ART.find(a => a.id === piece);
  const box = art ? campPaint(art.path) : null;
  if (!art || failed === art.path) return <Icon name="star" size="2em" />;
  const viewBox = box ? `${box.left * 1024} ${box.top * 1024} ${(box.right - box.left) * 1024} ${(box.bottom - box.top) * 1024}` : "0 0 1024 1024";
  return <svg viewBox={viewBox} aria-hidden="true"><image href={`/assets/${art.path}`} width="1024" height="1024" onError={() => setFailed(art.path)} /></svg>;
}

export function TentInterior({ hero, kit, covered = true, held = false, autoFocus = false, family = "open_plains", edit }: {
  hero: ResolvedCharacter;
  kit: HeroKitView;
  covered?: boolean;
  held?: boolean;
  autoFocus?: boolean;
  family?: string;
  edit: (change: { slots: (string | null)[] }) => void;
}): ReactElement {
  const id = useId();
  const [dim, setDim] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest(".camp-play__visit")?.scrollIntoView?.({ block: "start" });
  }, [autoFocus]);
  const style = campKitStyle(hero.id, kit.style);
  const accent = kitAccent(kit.color, hero.appearance.accent);
  const favorite = kit.slots[0] ?? null;
  const choices = kitDecorationChoices(KIT_RULES, kit.unlocked);
  return <section className="tent-room" aria-labelledby={`${id}-title`} style={{ "--tent-color": accent } as CSSProperties}>
    <h3 ref={heading} tabIndex={-1} id={`${id}-title`}>{`${hero.name}'s ${covered ? "tent" : "bedroll nook"}`}</h3>
    <div className={`tent-room__scene${dim ? " is-dim" : ""}${covered ? "" : " is-open"}`} role="group" aria-label={covered ? "Inside your tent" : "Your spot under the stars"}>
      <svg className="tent-room__walls" viewBox="0 0 600 460" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-cloth`} x2="0" y2="1"><stop stopColor="var(--tent-color)" /><stop offset="1" stopColor="#6f4c36" /></linearGradient>
          <radialGradient id={`${id}-glow`}><stop stopColor="#ffefb4" stopOpacity=".65" /><stop offset="1" stopColor="#f8bf65" stopOpacity="0" /></radialGradient>
          <clipPath id={`${id}-door`}><path d="M300 45L180 335H420Z" /></clipPath>
          <pattern id={`${id}-weave`} width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 1H8M1 0V8" stroke="#fff" strokeOpacity=".025" /></pattern>
        </defs>
        <path className="tent-room__cloth" d="M0 0H600V460H0Z" fill={`url(#${id}-cloth)`} />
        <path d="M0 0H600V460H0Z" fill={`url(#${id}-weave)`} />
        <path className="tent-room__cloth" d="M300 20L130 335H470Z" fill="#342d30" />
        <image href={`/assets/camp/backdrops/${family}.webp`} x="175" y="45" width="250" height="290" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id}-door)`} />
        <path className="tent-room__cloth" d="M300 20L230 318L130 335ZM300 20L370 318L470 335Z" fill="var(--tent-color)" stroke="#f8df9b" strokeOpacity=".45" strokeWidth="3" />
        <path d="M0 335Q300 295 600 335V460H0Z" fill="#9f7850" />
        <path d="M0 380Q300 340 600 380M0 425Q300 385 600 425" fill="none" stroke="#704a32" strokeWidth="3" opacity=".5" />
        <path className="tent-room__cloth" d="M0 0L300 20L600 0M300 20V0M0 0L130 335M600 0L470 335" fill="none" stroke="#ffebbc" strokeOpacity=".45" strokeWidth="3" />
        <ellipse cx="440" cy="180" rx="230" ry="220" fill={`url(#${id}-glow)`} className="tent-room__glow" />
      </svg>
      <span className="tent-room__bedroll" aria-hidden="true"><CampBedroll style={style} accent={accent} cropped /></span>
      <span className="tent-room__shelf" aria-hidden="true">{favorite ? <Decoration piece={favorite} /> : <span className="tent-room__empty">A place for a treasure</span>}</span>
      <button className="tent-room__lamp kad-focusable" type="button" onClick={() => setDim(d => !d)} aria-label={dim ? "Light the lantern" : "Dim the lantern"} aria-pressed={dim}><Decoration piece="deco_lantern" /></button>
      <span className="tent-room__light-note" aria-hidden="true">{dim ? "Cozy and quiet" : "Tap the lantern"}</span>
    </div>
    <p className="tent-room__favorite" role="status">{favorite ? `${kitName(favorite, "decoration")} has pride of place on your shelf.` : "Your own little corner of camp."}</p>
    <details className="tent-room__picker">
      <summary className="kad-focusable">Choose your shelf treasure</summary>
      <p>This is your first tent decoration. You can change it whenever you like.</p>
      <div className="tent-room__choices" aria-label="Shelf treasures">
        <button type="button" className="camp-option kad-focusable" aria-pressed={favorite === null} disabled={held} onClick={() => edit({ slots: shelfSlots(kit.slots, null) })}>Nothing for now</button>
        {choices.map(piece => <button type="button" className="camp-option kad-focusable" aria-pressed={favorite === piece} disabled={held} key={piece} onClick={() => edit({ slots: shelfSlots(kit.slots, piece) })}><span className="tent-room__choice-art"><Decoration piece={piece} /></span><span>{kitName(piece, "decoration")}</span></button>)}
      </div>
    </details>
  </section>;
}
