/**
 * CreationPreview — WorldView during `phase === "creation"`.
 *
 * spec §5: the character renders live on the shared screen as the choices are
 * made on the phone. This panel is both halves of that — the figure, and the
 * frame around it: who you are, what you can do out in the world, what your
 * class does in a fight, and the stat line.
 *
 * The draft figure is a DOM portrait so it stays inside this panel's frame.
 * It uses the same finished illustration as the world, with a gentle breath.
 */

import type { CSSProperties, ReactElement } from "react";
import { STAT_IDS } from "@kad/shared";
import type { Stats } from "@kad/shared";
import { useChapter, useParty, useRules } from "../store";
import { Spinner } from "../ui/Spinner";
import { CREATION_BIOME, biomeBackdropUrl } from "../world/art-paths";
import { CharacterPortrait } from "./CharacterPortrait";
import { Icon } from "./icons";
import { useEnsureContent } from "./content";
import { useCreationDraft } from "./creationDraft";
import type { CreationStep } from "./creationDraft";
import "./shared.css";
import "./CreationPreview.css";
import { EntryScene } from "./EntryScene";

const STEP_HINT: Record<CreationStep, string> = {
  species: "Choosing who they are…",
  class: "Choosing how they fight…",
  stats: "Deciding what they're best at…",
  name: "Thinking of a name…",
};

export function CreationPreview(): ReactElement {
  useEnsureContent();
  const rules = useRules();
  const party = useParty();
  const draft = useCreationDraft();

  const speciesDef = rules === null || draft.species === null ? null : rules.species[draft.species];
  const classDef = rules === null || draft.klass === null ? null : rules.classes[draft.klass];

  const stats: Stats | null = (() => {
    if (rules === null) return null;
    const out: Stats = { ...rules.baseStats };
    for (const stat of STAT_IDS) out[stat] += draft.assigned[stat];
    const bonusStat = speciesDef?.passive.stat;
    if (bonusStat !== undefined) out[bonusStat] += speciesDef?.passive.amount ?? 0;
    return out;
  })();


  /*
   * Somewhere to stand. The run's own biome once a chapter is loaded, and the
   * reference chapter's glade before that — creation happens in the lobby,
   * where there is no chapter yet (art-paths.ts, CREATION_BIOME).
   */
  const biome = useChapter()?.biome ?? CREATION_BIOME;
  const stageStyle: CSSProperties & Record<string, string> = {
    "--stage-backdrop": `url("${biomeBackdropUrl(biome)}")`,
  };

  return (
    <section className="preview entry-scene-host" aria-labelledby="preview-heading">
      <EntryScene scene={`creation-${draft.step}`} />
      <header className="preview__head">
        <h2 className="preview__heading" id="preview-heading">
          <Icon name="party" />
          <span>Making heroes</span>
        </h2>
        {/* A div, not a p — Spinner renders a block, invalid inside a <p>.
            The spinner has a seat whether or not it is spinning, and the
            words are one line, so stepping through creation never rewraps
            the header and nudges the hero down. */}
        <div className="preview__hint kad-muted" role="status">
          <span className="preview__hint-spin">{draft.submitting ? <Spinner /> : null}</span>
          <span className="preview__hint-text">
            {draft.submitting ? "Bringing them to life…" : STEP_HINT[draft.step]}
          </span>
        </div>
      </header>

      <div className="preview__body">
        {/* aria-hidden: everything here is also said in words in the facts
            column beside it, so a screen reader gets the character once. */}
        <div className="preview__stage" style={stageStyle} aria-hidden="true">
          {draft.species === null ? (
            <Icon name="unknown" size="30%" className="preview__stage-ghost" />
          ) : (
            /* Keyed by species so switching from unicorn to griffin replays the
               arrival rather than swapping one texture for another mid-float —
               changing your mind should look like a different creature walking
               on, which is most of the charm of this screen. */
            <CharacterPortrait
              key={draft.species}
              className="preview__hero"
              stand="floor"
              species={draft.species}
              lit
              float
            />
          )}
        </div>

        <div className="preview__facts">
          {speciesDef === null ? (
            <p className="preview__waiting kad-muted">Pick a species to see them appear.</p>
          ) : (
            <div className="preview__fact">
              <p className="preview__fact-title">
                <Icon name={speciesDef.id} />
                <span>{speciesDef.name}</span>
              </p>
              <p className="preview__fact-line">
                <Icon name={speciesDef.worldAbility.icon} />
                <b>{speciesDef.worldAbility.name}</b>
                <span className="kad-muted">{speciesDef.worldAbility.text}</span>
              </p>
            </div>
          )}

          {classDef === null ? null : (
            <div className="preview__fact">
              <p className="preview__fact-title">
                <Icon name={classDef.id} />
                <span>{classDef.name}</span>
              </p>
              <p className="preview__fact-line">
                <Icon name={classDef.signature.icon} />
                <b>{classDef.signature.name}</b>
                <span className="kad-muted">{classDef.signature.text}</span>
              </p>
            </div>
          )}

          {stats === null ? null : (
            <ul className="preview__stats">
              {STAT_IDS.map((stat) => (
                <li className="preview__stat" key={stat}>
                  <Icon name={stat} />
                  <span className="preview__stat-name">{stat}</span>
                  <b className="preview__stat-value">{stats[stat]}</b>
                </li>
              ))}
            </ul>
          )}

          {draft.name.trim() === "" ? null : (
            <p className="preview__name">
              <Icon name="name" />
              <span>{draft.name}</span>
            </p>
          )}
        </div>
      </div>

      {/* Who has finished. The row is here from the start, held open by an
          empty seat until the first hero is done, and never wraps: somebody
          else finishing used to grow it and shrink the stage under the hero
          you were still making. */}
      <ul className="preview__done">
        {party.length === 0 ? (
          <li className="kad-chip preview__done-seat" aria-hidden="true">
            <span className="preview__done-art" />
            <span>{"\u00a0"}</span>
          </li>
        ) : (
          party.map((member) => (
            <li className="kad-chip kad-chip--ok" key={member.playerId}>
              <CharacterPortrait
                species={member.character.species}
                tier={member.character.tier}
                characterClass={member.character.class}
                className="preview__done-art"
              />
              <span className="preview__done-name">{member.character.name}</span>
              <Icon name="check" />
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
