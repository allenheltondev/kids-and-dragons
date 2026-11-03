import { useState } from "react";
import { useChapter, useRunState } from "../store";
import { biomeBackdropUrl, sceneArtFor, sceneBackdropUrl } from "../world/art-paths";

/** Keep the story's location behind the playable objects, without adding a second prop. */
export function GameScenery() {
  const chapter = useChapter();
  const state = useRunState();
  const art = sceneArtFor(chapter?.scenes ? chapter : null, state);
  const biome = chapter?.id === state?.chapterId && chapter?.biome ? biomeBackdropUrl(chapter.biome) : null;
  const [failed, setFailed] = useState<string[]>([]);
  const url = [art ? sceneBackdropUrl(art) : null, biome].find((candidate): candidate is string => !!candidate && !failed.includes(candidate));
  if (!url) return null;
  return <div className="game-scenery" aria-hidden="true">
    <img key={url} src={url} alt="" draggable={false} decoding="async" onError={() => setFailed(current => [...current, url])} />
    <span className="game-scenery__light" />
  </div>;
}
