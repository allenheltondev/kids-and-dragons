import { useState } from "react";
import { useChapter, useRunState } from "../store";
import { sceneArtFor, sceneBackdropUrl } from "../world/art-paths";

/** Keep the story's location behind the playable objects, without adding a second prop. */
export function GameScenery() {
  const chapter = useChapter();
  const state = useRunState();
  const art = sceneArtFor(chapter?.scenes ? chapter : null, state);
  const url = art ? sceneBackdropUrl(art) : null;
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return null;
  return <div className="game-scenery" aria-hidden="true">
    <img key={url} src={url} alt="" draggable={false} decoding="async" onError={() => setFailed(url)} />
    <span className="game-scenery__light" />
  </div>;
}
