/**
 * CreationPreview — WorldView during `phase === "creation"`.
 *
 * spec §5: the character renders live on the shared screen as the choices are
 * made on the phone. This panel is both halves of that — the figure, and the
 * frame around it: who you are, what you can do out in the world, what your
 * class does in a fight, and the stat line.
 *
 * WHY THE FIGURE IS ITS OWN CANVAS AND NOT THE PIXI STAGE
 *
 * The middle of this panel used to be a transparent hole reserved for the rig
 * to draw through, and that never worked: the Pixi scene draws the *committed*
 * party (world/scene.ts), and a draft is deliberately not on the wire
 * (creationDraft.ts header), so nothing was ever drawn into it. It then drew a
 * tier PNG itself, which was honest about being a stand-in and dishonest about
 * colour — a PNG cannot show the palette the player just picked, so this
 * screen promised choices it could not display.
 *
 * It now draws the *rig* (RigFigure), which is the seam that note was waiting
 * for: the same `.riv` the scene draws, in a canvas of its own, with the
 * draft's palette bound live. The PNG portrait stays underneath as the
 * fallback for the moments — and the species/tiers — where a rig will not
 * load.
 *
 * Its own canvas rather than the shared stage, still, for the reason the
 * transparent hole failed: the figure lands *exactly* in the frame reserved
 * for it. The scene's actors are centred in the whole pane, and this panel's
 * stage is a 45% column of it on a wide surface; drawing through the hole
 * would have put the hero behind the fact cards.
 */

import type { CSSProperties, ReactElement } from "react";
import { STAT_IDS } from "@kad/shared";
import type { Stats } from "@kad/shared";
import { useChapter, useParty, useRules } from "../store";
import { Spinner } from "../ui/Spinner";
import { CREATION_BIOME, STARTING_TIER, biomeBackdropUrl } from "../world/art-paths";
import { CharacterPortrait } from "./CharacterPortrait";
import { RigFigure } from "./RigFigure";
import { Icon } from "./icons";
import { useEnsureContent } from "./content";
import { useCreationDraft } from "./creationDraft";
import type { CreationStep } from "./creationDraft";
import { PALETTES } from "./creationContent";
import "./shared.css";
import "./CreationPreview.css";

const STEP_HINT: Record<CreationStep, string> = {
  species: "Choosing who they are…",
  class: "Choosing how they fight…",
  stats: "Deciding what they're best at…",
  appearance: "Picking colours…",
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

  const palette = PALETTES.find((p) => p.id === draft.appearance.palette) ?? null;

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
    <section className="preview" aria-labelledby="preview-heading">
      <header className="preview__head">
        <h2 className="preview__heading" id="preview-heading">
          <Icon name="party" />
          <span>Making heroes</span>
        </h2>
        {/* A div, not a p — Spinner renders a block, invalid inside a <p>. */}
        <div className="preview__hint kad-muted" role="status">
          {draft.submitting ? <Spinner /> : null}
          <span>{draft.submitting ? "Bringing them to life…" : STEP_HINT[draft.step]}</span>
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
            <RigFigure
              key={draft.species}
              species={draft.species}
              tier={STARTING_TIER}
              appearance={draft.appearance}
              className="preview__hero"
              fallback={
                <CharacterPortrait
                  species={draft.species}
                  accent={draft.appearance.accent}
                  lit
                  float
                />
              }
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

          {palette === null ? null : (
            <p className="preview__palette kad-muted">
              {/* Mane inside, accent as the ring — the two colours the rig
                  actually binds. See creationContent PALETTES. */}
              <span
                className="preview__palette-chip"
                style={{ background: palette.mane, borderColor: draft.appearance.accent }}
                aria-hidden="true"
              />
              <Icon name="palette" />
              <span>{palette.name}</span>
            </p>
          )}

          {draft.name.trim() === "" ? null : (
            <p className="preview__name">
              <Icon name="name" />
              <span>{draft.name}</span>
            </p>
          )}
        </div>
      </div>

      {party.length === 0 ? null : (
        <ul className="preview__done">
          {party.map((member) => (
            <li className="kad-chip kad-chip--ok" key={member.playerId}>
              <CharacterPortrait
                species={member.character.species}
                tier={member.character.tier}
                className="preview__done-art"
              />
              <span>{member.character.name}</span>
              <Icon name="check" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
