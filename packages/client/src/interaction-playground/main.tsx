import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { bridgeSolved, cluesForSeat, gateReady, landsShot, markerAt, symbols, type SymbolName } from "./rules";
import "./style.css";

type Game = "shot" | "gate" | "clues";

function Playground() {
  const [game, setGame] = useState<Game>("shot");
  const [players, setPlayers] = useState(3);
  const [relaxed, setRelaxed] = useState(false);
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState(0);
  const started = useRef(0);
  const [holding, setHolding] = useState<number[]>([]);
  const [revealed, setRevealed] = useState<number[]>([]);
  const [steps, setSteps] = useState<SymbolName[]>([]);
  const [result, setResult] = useState("");
  const [hint, setHint] = useState("");

  function reset() {
    setRunning(false); setPosition(0); setHolding([]); setRevealed([]); setSteps([]); setResult(""); setHint("");
  }

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = () => {
      setPosition(markerAt(performance.now() - started.current));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  useEffect(() => {
    const release = () => { setHolding([]); setRunning(false); };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", release);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", release);
    };
  }, []);

  const ready = gateReady(players, holding);
  const finished = result !== "";
  function grip(seat: number, down: boolean) {
    setHolding((current) => down ? [...new Set([...current, seat])] : current.filter((value) => value !== seat));
  }

  return <main>
    <header><p className="eyebrow">Kids & Dragons · #493 · design playground</p>
      <h1>Little actions. Big adventures.</h1>
      <p>Local prototype: the shared world and simulated phones are on this screen. No room or saved heroes are involved.</p>
    </header>
    <nav aria-label="Interaction prototypes">
      {([["shot", "Land the shot"], ["gate", "Hold the way open"], ["clues", "Everybody has a clue"]] as const).map(([id, label]) =>
        <button key={id} aria-pressed={game === id} onClick={() => { reset(); setGame(id); }}>{label}</button>)}
    </nav>
    <div className="settings">
      <label>Players <select value={players} onChange={(event) => { reset(); setPlayers(Number(event.target.value)); }}>
        {[1, 2, 3, 4].map((count) => <option key={count}>{count}</option>)}
      </select></label>
      <label><input type="checkbox" checked={relaxed} onChange={(event) => { reset(); setRelaxed(event.target.checked); }} /> Relaxed play</label>
      <button onClick={reset}>Start again</button>
    </div>
    <section className="world" aria-label="Shared world">
      <p className="eyebrow">Shared world · TV / Travel view</p>
      <h2>{game === "shot" ? "The moss giant’s key" : game === "gate" ? "A friend behind the roots" : "The animal bridge"}</h2>
      <p>{game === "shot" ? "A key dangles from the sleeping giant’s belt. Tap when your hook reaches the gold." : game === "gate" ? "Hold the roots apart so your friend can rescue the little fox." : "Share your clues, then cross the three stones in the right order."}</p>
      {game === "shot" && <>
        <div className="track" role="img" aria-label="Hook aiming track, with a gold target in the middle">
          <span className="target" style={{ left: relaxed ? "20%" : "35%", width: relaxed ? "60%" : "30%" }} />
          <span className="marker" style={{ left: `${position * 100}%` }} />
        </div>
        <p>{running ? "Watch the hook… there’s no countdown." : "Get comfortable. Start aiming when you’re ready."}</p>
      </>}
      {game === "gate" && <div className="gate-picture" aria-label={ready ? "The way is open" : "Roots block the way"}>
        <span>{ready ? "🌿          🦊          🌿" : "🌿🌿 🦊 🌿🌿"}</span>
        <p>{ready ? "The way is open!" : `${holding.length} of ${Math.max(1, players - 1)} roots supported`}</p>
      </div>}
      {game === "clues" && <div className="stones" aria-label="Chosen bridge steps">{steps.length ? steps.join(" → ") : "? → ? → ?"}</div>}
      <p className="result" role="status">{result}</p>
      <p role="status">{hint}</p>
    </section>
    <section className="phones" aria-label="Simulated phone controllers">
      {Array.from({ length: game === "shot" ? 1 : players }, (_, seat) => <article className="phone" key={seat}>
        <p className="eyebrow">{players === 1 ? "Your phone" : `Hero ${seat + 1}’s phone`}</p>
        {game === "shot" && <>
          <h3>Hook the key</h3>
          <button disabled={finished} onClick={() => {
            if (!running) { started.current = performance.now(); setPosition(0); setRunning(true); }
            else {
              const stopped = markerAt(performance.now() - started.current);
              setPosition(stopped); setRunning(false);
              setResult(landsShot(stopped, relaxed) ? "The key lands in your hand. The giant snores on." : "The hook tickles his beard. ‘Who’s there?’ asks the giant. You explain—and he offers the key for a joke.");
            }
          }}>{running ? "Throw!" : "Start aiming"}</button>
          {!running && !finished && <button onClick={() => setResult("Your friend steadies the hook. Together you lift the key free.")}>Ask a friend to steady it</button>}
          <p>Prototype: take turns using this controller. Family timing and network fairness still need testing.</p>
        </>}
        {game === "gate" && <>
          <h3>{players === 1 ? "Prop the roots, then rescue" : seat === players - 1 ? "Rescue the fox" : "Hold a root"}</h3>
          {(seat < players - 1 || players === 1) && <>
            {relaxed || players === 1 ? <button disabled={finished} aria-pressed={holding.includes(seat)} onClick={() => grip(seat, !holding.includes(seat))}>{holding.includes(seat) ? "Remove the prop" : "Prop this root open"}</button> :
              <button className="hold" disabled={finished}
                onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); grip(seat, true); }}
                onPointerUp={() => grip(seat, false)} onPointerCancel={() => grip(seat, false)} onLostPointerCapture={() => grip(seat, false)}
                onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); grip(seat, true); } }}
                onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); grip(seat, false); } }}
                onBlur={() => grip(seat, false)}>{holding.includes(seat) ? "I’ve got it!" : "Hold the root"}</button>}
          </>}
          {(seat === players - 1 || players === 1) && <button disabled={!ready || finished} onClick={() => setResult("The fox bounds into your arms. Everyone helped make a way!")}>Bring the fox through</button>}
          <p>{relaxed || players === 1 ? "The prop stays put until you remove it." : "Keep pressing while your friend brings the fox through. Use relaxed play to prop the roots instead."}</p>
        </>}
        {game === "clues" && <>
          <h3>Your part of the puzzle</h3>
          <button aria-expanded={revealed.includes(seat)} onClick={() => setRevealed((current) => current.includes(seat) ? current.filter((value) => value !== seat) : [...current, seat])}>{revealed.includes(seat) ? "Cover my clue" : "Show my clue"}</button>
          {revealed.includes(seat) && <p>{cluesForSeat(seat, players).join(" ") || "Listen to your friends, then help choose the path."}</p>}
          {seat === players - 1 && <>
            <p>Agree together, then choose three stones.</p>
            {symbols.map((symbol) => <button key={symbol} disabled={finished || steps.length === 3} onClick={() => setSteps((current) => [...current, symbol])}>{symbol}</button>)}
            <button disabled={!steps.length || finished} onClick={() => setSteps((current) => current.slice(0, -1))}>Change last stone</button>
            <button disabled={steps.length !== 3 || finished} onClick={() => {
              if (bridgeSolved(steps)) setResult("The stones bloom beneath your feet. Across you go, together!");
              else { setSteps([]); setHint("The stones bob gently back to the bank. Share your clues and try another path."); }
            }}>Try the path</button>
            <p>{steps.length === 0 ? "If a path is wrong, the stones gently return you to the bank to try again." : "You can change your mind before trying."}</p>
          </>}
        </>}
      </article>)}
    </section>
    <footer>Exploration build · no campaign integration yet · abstract visuals for testing the interactions</footer>
  </main>;
}

const host = document.getElementById("root");
if (!host) throw new Error("Missing playground root");
// This entry is intentionally absent from the production HTML build inputs.
if (import.meta.env.DEV) createRoot(host).render(<Playground />);
