/**
 * The board for a screen with no WebGL (#264): still art and a plain row of
 * figures. Where `PixiStage` fails to start, this is what the table sees
 * instead of an empty stage, so a chapter still plays end to end.
 *
 * Deliberately no animation, camera or Rive. A backdrop picture, the party
 * standing in a row, and during a fight the enemies and everyone's hit points.
 * Every control and every word of the story is still in the panels over it.
 * It reads the same state the renderer does and imports no renderer.
 */

import { useSyncExternalStore } from "react";
import { enemyArtId, type Chapter, type Combatant, type PartyMember } from "@kad/shared";
import { useChapter, useRunState } from "../store";
import { useEnsureChapter } from "../screens/content";
import { biomeBackdropUrl, characterWorldArtUrl, enemyArtUrl, sceneArtFor, sceneBackdropUrl } from "./art-paths";

import { castFor } from "./cast";
import { campFamilyFor, campLayoutFor, campShownFor, campStage, indoorRest, outdoorRest } from "./lobby-camp";
import { campBeatShown, onCampBeat } from "./camp-beat";
import { StillCamp } from "./StillCamp";
import { CampBedroll } from "./CampBedroll";
import { packedFriends, packedKits, type PackedFriend } from "./packed-camp";
import { figureSize } from "./figure-scale";
import { onStageCoverTop, onStageInset, stageCoverTop, stageInsetBottom } from "./stage-inset";
import { sceneRiftFor, STILL_FRAME } from "./scene-rift";
import { RIFT_NEUTRAL_EFFECT, RIFT_SHEET, riftSheetUrl } from "../screens/riftlight";

import "./StaticStage.css";

/** Enemy art for the chapter's encounter scene, by spec id (the same lookup the board makes). */
function enemyArtBySpec(chapter: Chapter | null, sceneId: string | null): Record<string, string> {
  const scene = chapter && sceneId ? chapter.scenes[sceneId] : undefined;
  if (!scene || scene.type !== "encounter") return {};
  const out: Record<string, string> = {};
  for (const spec of scene.enemies) {
    const art = enemyArtId(spec);
    if (art) out[spec.id] = art;
  }
  return out;
}

export function StaticStage(): React.JSX.Element {
  useEnsureChapter();
  const chapter = useChapter();
  const state = useRunState();
  const party: readonly PartyMember[] = state?.party ?? [];
  const encounter = state?.encounter ?? null;

  const sceneArt = sceneArtFor(chapter, state);
  const backdrop = (sceneArt ? sceneBackdropUrl(sceneArt) : null)
    ?? (chapter?.biome ? biomeBackdropUrl(chapter.biome) : null);
  const rift = sceneRiftFor(chapter, state);
  const guests = castFor(chapter, state);
  const enemyArt = enemyArtBySpec(chapter, state?.sceneId ?? null);
  const enemies: readonly Combatant[] = encounter?.combatants.filter((c) => c.side !== "party" && !c.down) ?? [];

  // The lobby's picture is the crew's camp (#614), still here as everything is.
  // And the chapter end's camp beat (#620), at the crew's own frame stage, and
  // an outdoor rest (#625), above the narration plate; each pitched in the
  // chapter's terrain (camp-backdrop.ts).
  const beat = useSyncExternalStore(onCampBeat, campBeatShown, campBeatShown);
  const plate = useSyncExternalStore(onStageInset, stageInsetBottom, stageInsetBottom);
  // What the head draws, the goal card's own foot, not its padded box (#625).
  const plateTop = useSyncExternalStore(onStageCoverTop, stageCoverTop, stageCoverTop);
  const camp = state && campShownFor(state, beat) ? campLayoutFor(campStage(state), campFamilyFor(state, chapter)) : null;
  if (state && camp) {
    return (
      <div className="kad-static-stage" data-testid="static-stage" aria-hidden="true">
        <StillCamp layout={camp} state={state} {...(outdoorRest(state) ? { insets: { top: plateTop, bottom: plate } } : {})} />
      </div>
    );
  }
  // An indoor rest keeps its picture, with each hero's bedroll and pack beside her (§3.2).
  const packed = indoorRest(state) ? new Map(packedKits(state).map((kit) => [kit.id, kit])) : null;
  // And the friends out at the row's two ends (#624), alternating, left first,
  // each as tall beside the heroes as it truly is.
  const friends = packed ? packedFriends(state) : [];
  const tallest = Math.max(1, ...party.map((m) => figureSize(`characters/${m.character.species}`).heightCm));
  const friendItem = (friend: PackedFriend, index: number): React.JSX.Element => (
    <li key={`friend:${friend.id}`} className={`kad-static-stage__figure kad-static-stage__friend${index % 2 === 0 ? " is-turned" : ""}`} data-testid="packed-friend">
      <img src={friend.url!} alt="" style={{ maxBlockSize: `calc(26cqh * ${Math.min(1, friend.heightCm / tallest).toFixed(3)})` }} />
    </li>
  );
  const shownFriends = friends.filter((f) => f.url !== null);
  const leftFriends = shownFriends.filter((_, i) => i % 2 === 0).reverse();
  const rightFriends = shownFriends.filter((_, i) => i % 2 === 1);

  return (
    <div className="kad-static-stage" data-testid="static-stage" aria-hidden="true">
      {backdrop ? <img className="kad-static-stage__backdrop" src={backdrop} alt="" /> : null}
      {(rift === "steady" || rift === "open") && <span className="kad-static-stage__rift" style={{
        backgroundImage: `url("${riftSheetUrl(RIFT_NEUTRAL_EFFECT)}")`,
        backgroundSize: `${RIFT_SHEET.columns * 100}% ${Math.ceil(RIFT_SHEET.frames / RIFT_SHEET.columns) * 100}%`,
        backgroundPosition: `${(STILL_FRAME % RIFT_SHEET.columns) / (RIFT_SHEET.columns - 1) * 100}% ${Math.floor(STILL_FRAME / RIFT_SHEET.columns) / (Math.ceil(RIFT_SHEET.frames / RIFT_SHEET.columns) - 1) * 100}%`,
      }} />}
      <ul className="kad-static-stage__row kad-static-stage__row--enemies">
        {guests.map((guest) => (
          <li key={guest.key} className="kad-static-stage__figure">
            <img src={guest.url} alt="" />
            {guest.name ? <span>{guest.name}</span> : null}
          </li>
        ))}
        {enemies.map((enemy) => {
          const art = enemyArt[enemy.id.split("#")[0] ?? enemy.id];
          return (
            <li key={enemy.id} className="kad-static-stage__figure">
              {art ? <img src={enemyArtUrl(art)} alt="" /> : null}
              <span>{enemy.name}</span>
              <meter min={0} max={enemy.maxHp} value={enemy.hp} />
            </li>
          );
        })}
      </ul>
      <ul className="kad-static-stage__row kad-static-stage__row--party">
        {leftFriends.map((friend) => friendItem(friend, shownFriends.indexOf(friend)))}
        {party.map((member) => {
          const hero = member.character;
          const live = encounter?.combatants.find((c) => c.id === hero.id);
          const kit = packed?.get(hero.id);
          return (
            <li key={hero.id} className={`kad-static-stage__figure${member.down || live?.down ? " is-down" : ""}${kit ? " is-packed" : ""}`}>
              <img src={characterWorldArtUrl(hero.species, hero.tier, hero.class)} alt="" />
              {kit ? (
                <span className="kad-static-stage__bedroll" data-testid="packed-bedroll">
                  <CampBedroll style={kit.style} accent={kit.accent} />
                </span>
              ) : null}
              <span>{hero.name}</span>
              {live ? <meter min={0} max={live.maxHp} value={live.hp} /> : null}
            </li>
          );
        })}
        {rightFriends.map((friend) => friendItem(friend, shownFriends.indexOf(friend)))}
      </ul>
    </div>
  );
}
