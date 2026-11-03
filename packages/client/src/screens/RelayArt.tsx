import { useState } from "react";
import { useChapter, useRunState } from "../store";
import { biomeBackdropUrl, sceneArtFor, sceneBackdropUrl } from "../world/art-paths";

/** Use the story's painting, with the chapter's landscape as the fallback. */
export function RelayLandscape() {
  const chapter = useChapter();
  const state = useRunState();
  const art = sceneArtFor(chapter?.scenes ? chapter : null, state);
  const scene = art ? sceneBackdropUrl(art) : null;
  const biome = chapter?.id === state?.chapterId && chapter?.biome ? biomeBackdropUrl(chapter.biome) : null;
  const [failed, setFailed] = useState<string[]>([]);
  const url = [scene, biome].find((candidate): candidate is string => !!candidate && !failed.includes(candidate));
  return <span className="relay-landscape" aria-hidden="true">
    {url && <img key={url} src={url} alt="" draggable={false} decoding="async" onError={() => setFailed(current => [...current, url])} />}
    <span className="relay-landscape__wash" />
    <span className="relay-landscape__motes">{[0, 1, 2, 3, 4, 5].map(i => <i key={i} style={{ left: `${12 + i * 15}%`, top: `${40 + i % 3 * 18}%`, animationDelay: `${-i * 0.7}s` }} />)}</span>
  </span>;
}
