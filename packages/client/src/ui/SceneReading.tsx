import { ReadingPages } from "./ReadingPages";
import "./PagedOptions.css";
import { useEffect, useRef, useState } from "react";
import "./SceneReading.css";

export function SceneReading({ text }: { text: string }) {
  const [reading, setReading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (reading) dialog.current?.showModal(); }, [reading]);
  return <div className="scene-reading">
    <p className="player__echo" aria-hidden="true">{text}</p>
    <button className="scene-reading__open" type="button" onClick={() => setReading(true)}>Read the scene</button>
    <dialog onClose={() => setReading(false)} ref={dialog} className="scene-reading__dialog" aria-label="The scene">
      {reading && <ReadingPages key={text} text={text} />}
      <button type="button" onClick={() => dialog.current?.close()}>Back to choices</button>
    </dialog>
  </div>;
}
