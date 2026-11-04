import type { EncounterState } from "@kad/shared";
import { wagonDefense } from "./wagon-defense";
import "./WagonDefense.css";

export function WagonDefense({ encounter }: { encounter: EncounterState }) {
  const wagon = wagonDefense(encounter);
  if (!wagon) return null;
  return <section className="wagon-defense" aria-label="The sausage wagon" aria-live="polite" data-progress={wagon.progress}>
    <div className="wagon-defense__route" aria-hidden="true">
      <span className="wagon-defense__cart" style={{ left: `${10 + 60 * wagon.progress / wagon.target}%` }}> 
        <img src="/assets/story-props/sausage-wagon.webp" alt="" />
      </span>
      {Array.from({ length: wagon.target }, (_, i) => <span key={i} className="wagon-defense__stop" data-done={i < wagon.progress} style={{ left: `${25 + 60 * i / wagon.target}%` }}>{i < wagon.progress ? "✓" : "○"}</span>)}
      <span className="wagon-defense__finish">↗</span>
    </div>
    <p>{wagon.label} · {wagon.progress}/{wagon.target} safe rounds<span className="wagon-defense__deadline"> · {wagon.roundsLeft} left</span></p>
    <p>{wagon.instruction}</p>
  </section>;
}
