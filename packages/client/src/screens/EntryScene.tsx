import { useState } from "react";
import type { ReactElement } from "react";
import { Campfire } from "../world/Campfire";
import { CAMP_ART } from "../world/art-paths";
import type { PartyMember } from "@kad/shared";
import { CampBedroll } from "../world/CampBedroll";
import { campKitStyle } from "../world/camp-kit-art";
import "./EntryScene.css";

export const ENTRY_SCENES = ["home-market", "creation-species", "creation-class", "creation-stats", "creation-appearance", "creation-name", "lobby-waiting", "lobby-ready"] as const;
export type EntrySceneId = (typeof ENTRY_SCENES)[number];

export function lobbySceneFor(party: readonly { ready: boolean }[]): EntrySceneId {
  return party.length > 0 && party.every((member) => member.ready) ? "lobby-ready" : "lobby-waiting";
}

/** Decoration only: controls remain usable even when a scene cannot load. */
export function EntryScene({ scene, campParty = [] }: { scene: EntrySceneId; campParty?: readonly PartyMember[] }): ReactElement {
  const [failed, setFailed] = useState<string | null>(null);
  const [portraitFailed, setPortraitFailed] = useState<string | null>(null);
  const [campFailed, setCampFailed] = useState(false);
  const camp = !campFailed && (scene === "lobby-waiting" || scene === "lobby-ready");
  return <div className="entry-scene" aria-hidden="true" data-entry-scene={scene}>
    {camp ? <svg className="entry-scene__image" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
      <image href={CAMP_ART.backdrop} width="1920" height="1080" onError={() => setCampFailed(true)} />
      {campParty.slice(0, 2).map((member, seat) => <svg key={member.character.id}
        x={seat === 0 ? 668 : 1052} y="472" width="200" height="200" viewBox="0 0 1024 1024">
        <CampBedroll style={campKitStyle(member.character.id)} accent={member.character.appearance.accent} />
      </svg>)}
      <svg x="840" y="523" width="240" height="240" viewBox="0 0 1024 1024">
        <Campfire />
      </svg>
      {campParty.slice(2, 4).map((member, seat) => <svg key={member.character.id}
        x={seat === 0 ? 610 : 1070} y="610" width="240" height="240" viewBox="0 0 1024 1024">
        <CampBedroll style={campKitStyle(member.character.id)} accent={member.character.appearance.accent} />
      </svg>)}
    </svg> : failed === scene ? null : <picture key={scene}>
      {portraitFailed === scene ? null : <source media="(max-aspect-ratio: 1/1)" srcSet={`/assets/scenes/entry/${scene}-portrait.webp`} />}
      <img className="entry-scene__image" src={`/assets/scenes/entry/${scene}.webp`} alt="" onError={(event) => {
        if (event.currentTarget.currentSrc.endsWith("-portrait.webp")) setPortraitFailed(scene);
        else setFailed(scene);
      }} decoding="async" />
    </picture>}
  </div>;
}
