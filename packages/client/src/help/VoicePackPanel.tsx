/**
 * "Keep this chapter's voices" (#547): a grown-up's button under Help that saves the chapter's
 * recorded narration on this device, so it plays with no signal (speech/voice-pack.ts). Loaded
 * only when the sheet opens, so it adds nothing to the first paint.
 *
 * Draws nothing where there is nothing to keep: no chapter on screen, or a chapter nobody has
 * recorded. A phone in Travel Mode is both the screen and the controller and speaks for itself,
 * so this is where it is asked; the shared screen in Party Mode has it too.
 */

import { useEffect, useState } from "react";
import { useChapter } from "../store";
import { keepVoices, keptPaths, loadVoicePack, type KeepResult, type VoicePack } from "../speech/voice-pack";

import "./VoicePackPanel.css";

const MB = 1024 * 1024;

type Load = { state: "checking" } | { state: "none" } | { state: "ready"; pack: VoicePack; kept: number };

export default function VoicePackPanel(): React.JSX.Element | null {
  const chapterId = useChapter()?.id ?? null;
  const [load, setLoad] = useState<Load>({ state: "checking" });
  const [run, setRun] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<KeepResult | null>(null);

  useEffect(() => {
    let live = true;
    setLoad({ state: "checking" });
    setRun(null);
    setResult(null);
    if (chapterId === null) {
      setLoad({ state: "none" });
      return;
    }
    void (async () => {
      const pack = await loadVoicePack(chapterId);
      if (!live) return;
      if (pack === null) return setLoad({ state: "none" });
      const kept = (await keptPaths(pack.paths)).size;
      if (live) setLoad({ state: "ready", pack, kept });
    })();
    return () => { live = false; };
  }, [chapterId]);

  if (load.state !== "ready") return null;
  const { pack } = load;
  const total = pack.paths.length;
  const megabytes = Math.max(1, Math.round(pack.bytes / MB));

  const keep = (): void => {
    setResult(null);
    setRun({ done: load.kept, total });
    void keepVoices(pack.paths, (done, all) => { setRun({ done, total: all }); }).then(async (outcome) => {
      // The worker saves a clip behind its answer, so a run that got every one is counted as kept now.
      const kept = outcome === "kept" ? total : (await keptPaths(pack.paths)).size;
      setLoad({ state: "ready", pack, kept });
      setResult(outcome);
      setRun(null);
    });
  };

  return (
    <section className="kad-voicepack" aria-label="Keep this chapter's voices">
      {run ? (
        <>
          <progress className="kad-voicepack__bar" max={run.total} value={run.done} aria-label="Keeping the voices" />
          <p role="status" className="kad-voicepack__note">Keeping voices… {run.done} of {run.total}</p>
        </>
      ) : load.kept >= total ? (
        <p role="status" className="kad-voicepack__note">This chapter's voices are kept on this device. They play with no signal.</p>
      ) : (
        <>
          <button type="button" className="kad-voicepack__keep kad-focusable" onClick={keep}>
            Keep this chapter's voices
          </button>
          <p className="kad-voicepack__note">
            About {megabytes} MB, saved on this device so they play with no signal.
          </p>
          <p role="status" className="kad-voicepack__note">
            {result === "partial" ? "Some voices could not be kept. Check the signal and try again." : ""}
            {result === "unavailable" ? "Voices can be kept once the app has finished getting ready. Try again in a moment." : ""}
          </p>
        </>
      )}
    </section>
  );
}
