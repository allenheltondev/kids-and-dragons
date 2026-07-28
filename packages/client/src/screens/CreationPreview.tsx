/**
 * CreationPreview — WorldView during `phase === "creation"`.
 *
 * spec §5: the character renders live on the shared screen as the choices are
 * made on the phone. The *sprite* is the Pixi stage's job (`world/`); this is
 * the frame around it — who you are, what you can do out in the world, what
 * your class does in a fight, and the stat line. Everything the sprite cannot
 * say out loud.
 *
 * The centre of this panel is deliberately empty: it is the hole the character
 * is drawn into, reserved with `aria-hidden` so a screen reader is not told
 * about a box with nothing in it.
 */

import type { ReactElement } from "react";
import { STAT_IDS } from "@kad/shared";
import type { Stats } from "@kad/shared";
import { useParty, useRules } from "../store";
import { Spinner } from "../ui/Spinner";
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

  return (
    <section className="preview" aria-labelledby="preview-heading">
      <header className="preview__head">
        <h2 className="preview__heading" id="preview-heading">
          <Icon name="party" />
          <span>Making heroes</span>
        </h2>
        <p className="preview__hint kad-muted" role="status">
          {draft.submitting ? <Spinner /> : null}
          <span>{draft.submitting ? "Bringing them to life…" : STEP_HINT[draft.step]}</span>
        </p>
      </header>

      <div className="preview__body">
        <div className="preview__stage" aria-hidden="true">
          {/* Reserved for the Pixi/Rive rig. Empty on purpose. */}
          {draft.species === null ? <Icon name="unknown" size="30%" className="preview__stage-ghost" /> : null}
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
              <span
                className="preview__palette-chip"
                style={{ background: palette.coat, borderColor: draft.appearance.accent }}
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
              <Icon name={member.character.species} />
              <span>{member.character.name}</span>
              <Icon name="check" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
