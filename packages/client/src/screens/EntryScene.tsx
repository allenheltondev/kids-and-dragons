import { useState } from "react";
import type { ReactElement } from "react";
import "./EntryScene.css";

export const ENTRY_SCENES = ["home-market", "creation-species", "creation-class", "creation-stats", "creation-appearance", "creation-name", "lobby-waiting", "lobby-ready"] as const;
export type EntrySceneId = (typeof ENTRY_SCENES)[number];

export function lobbySceneFor(party: readonly { ready: boolean }[]): EntrySceneId {
  return party.length > 0 && party.every((member) => member.ready) ? "lobby-ready" : "lobby-waiting";
}

/** Decoration only: controls remain usable even when a scene cannot load. */
export function EntryScene({ scene }: { scene: EntrySceneId }): ReactElement {
  const [failed, setFailed] = useState<string | null>(null);
  const [portraitFailed, setPortraitFailed] = useState<string | null>(null);
  return <div className="entry-scene" aria-hidden="true" data-entry-scene={scene}>
    {failed === scene ? null : <picture key={scene}>
      {portraitFailed === scene ? null : <source media="(max-aspect-ratio: 1/1)" srcSet={`/assets/scenes/entry/${scene}-portrait.webp`} />}
      <img className="entry-scene__image" src={`/assets/scenes/entry/${scene}.webp`} alt="" onError={(event) => {
        if (event.currentTarget.currentSrc.endsWith("-portrait.webp")) setPortraitFailed(scene);
        else setFailed(scene);
      }} decoding="async" />
    </picture>}
  </div>;
}
