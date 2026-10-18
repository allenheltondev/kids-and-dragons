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

import { enemyArtId, type Chapter, type Combatant, type PartyMember } from "@kad/shared";
import { useChapter, useRunState } from "../store";
import { useEnsureChapter } from "../screens/content";
import { biomeBackdropUrl, characterWorldArtUrl, enemyArtUrl, sceneArtFor, sceneBackdropUrl } from "./art-paths";

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
  const enemyArt = enemyArtBySpec(chapter, state?.sceneId ?? null);
  const enemies: readonly Combatant[] = encounter?.combatants.filter((c) => c.side !== "party" && !c.down) ?? [];

  return (
    <div className="kad-static-stage" data-testid="static-stage" aria-hidden="true">
      {backdrop ? <img className="kad-static-stage__backdrop" src={backdrop} alt="" /> : null}
      <ul className="kad-static-stage__row kad-static-stage__row--enemies">
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
        {party.map((member) => {
          const hero = member.character;
          const live = encounter?.combatants.find((c) => c.id === hero.id);
          return (
            <li key={hero.id} className={`kad-static-stage__figure${member.down || live?.down ? " is-down" : ""}`}>
              <img src={characterWorldArtUrl(hero.species, hero.tier, hero.class)} alt="" />
              <span>{hero.name}</span>
              {live ? <meter min={0} max={live.maxHp} value={live.hp} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
