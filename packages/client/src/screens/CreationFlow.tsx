/**
 * CreationFlow — PlayerView during `phase === "creation"`.
 *
 * spec §5: one decision per screen, in order — species, class, stats,
 * appearance, name — with the character drawing itself on WorldView as the
 * choices are made (see `creationDraft.ts` for how the preview is fed).
 *
 * Three rules shape every screen here:
 *   - spec §1.1 she taps, she doesn't type. The only text field in the game is
 *     the name, and "Surprise me" makes even that optional.
 *   - spec §11 undo on non-committal taps. Tapping a species selects it;
 *     nothing is sent until the final confirm, and Back always works.
 *   - roadmap "content as data". Species, classes and stat rules are read from
 *     `useRules()` (content/rules.json). Nothing about them is written here.
 */

import { useCallback, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { STAT_IDS } from "@kad/shared";
import type { ClassDef, ClassId, SpeciesDef, SpeciesId, StatId, Stats } from "@kad/shared";
import { useRules, useSend } from "../store";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Icon } from "./icons";
import { useEnsureContent } from "./content";
import {
  CREATION_STEPS,
  NO_POINTS,
  patchCreationDraft,
  resetCreationDraft,
  useCreationDraft,
} from "./creationDraft";
import type { CreationStep } from "./creationDraft";
import {
  ACCENTS,
  MARKINGS,
  NAME_MAX_LENGTH,
  PALETTES,
  defaultAppearance,
  hornStylesFor,
  randomNames,
  sanitizeName,
  wingStylesFor,
} from "./creationContent";
import type { CosmeticOption } from "./creationContent";
import "./shared.css";
import "./CreationFlow.css";

const STEP_TITLE: Record<CreationStep, string> = {
  species: "Who are you?",
  class: "How do you fight?",
  stats: "What are you best at?",
  appearance: "What do you look like?",
  name: "What's your name?",
};

const STEP_ICON: Record<CreationStep, string> = {
  species: "unicorn",
  class: "swords",
  stats: "star",
  appearance: "palette",
  name: "name",
};

function sumStats(stats: Stats): number {
  return STAT_IDS.reduce((total, stat) => total + stats[stat], 0);
}

/** A big tappable card. Selection shows as a check glyph, never colour alone. */
function OptionCard({
  selected,
  onSelect,
  icon,
  title,
  children,
  swatch,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  swatch?: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      className={`creation-card kad-tap kad-focusable${selected ? " creation-card--on" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="creation-card__icon">{swatch ?? icon}</span>
      <span className="creation-card__text">
        <span className="creation-card__title">
          {title}
          {selected ? <Icon name="check" label="Chosen" /> : null}
        </span>
        {children}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — species (spec §5.1)
// ---------------------------------------------------------------------------

function SpeciesStep({
  species,
  chosen,
  onChoose,
}: {
  species: SpeciesDef[];
  chosen: SpeciesId | null;
  onChoose: (id: SpeciesId) => void;
}): ReactElement {
  return (
    <div className="creation-grid">
      {species.map((def) => (
        <OptionCard
          key={def.id}
          selected={chosen === def.id}
          onSelect={() => onChoose(def.id)}
          icon={<Icon name={def.id} size="2.2em" />}
          title={def.name}
        >
          <span className="creation-card__blurb kad-muted">{def.blurb}</span>
          <span className="creation-card__line">
            <Icon name={def.worldAbility.icon} />
            <b>{def.worldAbility.name}</b>
            <span className="kad-muted">{def.worldAbility.text}</span>
          </span>
          <span className="creation-card__line kad-muted">
            <Icon name={def.passive.stat ?? "heart"} />
            <span>{def.passive.text}</span>
          </span>
        </OptionCard>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — class (spec §5.2)
// ---------------------------------------------------------------------------

function ClassStep({
  classes,
  chosen,
  onChoose,
}: {
  classes: ClassDef[];
  chosen: ClassId | null;
  onChoose: (id: ClassId) => void;
}): ReactElement {
  return (
    <div className="creation-grid">
      {classes.map((def) => (
        <OptionCard
          key={def.id}
          selected={chosen === def.id}
          onSelect={() => onChoose(def.id)}
          icon={<Icon name={def.id} size="2.2em" />}
          title={def.name}
        >
          <span className="creation-card__line kad-muted">
            <Icon name={def.stat} />
            <span>{def.role}</span>
          </span>
          <span className="creation-card__blurb kad-muted">{def.blurb}</span>
          <span className="creation-card__line">
            <Icon name={def.signature.icon} />
            <b>{def.signature.name}</b>
            <span className="kad-muted">{def.signature.text}</span>
          </span>
        </OptionCard>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — stats (spec §5.3): tap to increment, never any arithmetic
// ---------------------------------------------------------------------------

function StatsStep({
  base,
  bonus,
  assigned,
  remaining,
  onAdd,
  onRemove,
  onReset,
}: {
  base: Stats;
  bonus: Stats;
  assigned: Stats;
  remaining: number;
  onAdd: (stat: StatId) => void;
  onRemove: (stat: StatId) => void;
  onReset: () => void;
}): ReactElement {
  return (
    <div className="creation-stats">
      <p className="creation-stats__budget">
        <Icon name="star" />
        <span>
          {remaining === 0 ? "All points spent" : `${String(remaining)} point${remaining === 1 ? "" : "s"} to spend`}
        </span>
      </p>

      <ul className="creation-stats__list">
        {STAT_IDS.map((stat) => {
          const total = base[stat] + bonus[stat] + assigned[stat];
          return (
            <li className="creation-stat" key={stat}>
              <span className="creation-stat__icon">
                <Icon name={stat} size="1.8em" />
              </span>
              <span className="creation-stat__name">{stat}</span>
              <span className="creation-stat__value" aria-label={`${stat} ${String(total)}`}>
                {total}
              </span>
              {bonus[stat] > 0 ? (
                <span className="creation-stat__bonus kad-chip">
                  <Icon name="star" />
                  <span>+{bonus[stat]} free</span>
                </span>
              ) : null}
              <span className="creation-stat__controls">
                {/* Controls appear only when they are legal — nothing greyed out. */}
                {assigned[stat] > 0 ? (
                  <button
                    type="button"
                    className="creation-step-btn kad-tap kad-focusable"
                    onClick={() => onRemove(stat)}
                  >
                    <Icon name="minus" size="1.4em" label={`Take a point off ${stat}`} />
                  </button>
                ) : null}
                {remaining > 0 ? (
                  <button
                    type="button"
                    className="creation-step-btn creation-step-btn--add kad-tap kad-focusable"
                    onClick={() => onAdd(stat)}
                  >
                    <Icon name="plus" size="1.4em" label={`Add a point to ${stat}`} />
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      {sumStats(assigned) > 0 ? (
        <Button variant="ghost" size="md" icon={<Icon name="shuffle" />} onClick={onReset}>
          Start the points over
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — appearance (spec §5.4)
// ---------------------------------------------------------------------------

function CosmeticRow({
  legend,
  options,
  chosen,
  onChoose,
}: {
  legend: string;
  options: readonly CosmeticOption[];
  chosen: string | undefined;
  onChoose: (id: string) => void;
}): ReactElement | null {
  if (options.length === 0) return null;
  return (
    <fieldset className="creation-fieldset">
      <legend className="creation-legend">{legend}</legend>
      <div className="creation-chips">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`creation-chip kad-tap kad-focusable${chosen === option.id ? " creation-chip--on" : ""}`}
            aria-pressed={chosen === option.id}
            onClick={() => onChoose(option.id)}
          >
            <Icon name={option.icon} />
            <span>{option.name}</span>
            {chosen === option.id ? <Icon name="check" label="Chosen" /> : null}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------

export function CreationFlow(): ReactElement {
  useEnsureContent();
  const rules = useRules();
  const send = useSend();
  const draft = useCreationDraft();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>(() => randomNames(3));

  const speciesList = useMemo(() => (rules === null ? [] : Object.values(rules.species)), [rules]);
  const classList = useMemo(() => (rules === null ? [] : Object.values(rules.classes)), [rules]);

  const speciesDef: SpeciesDef | null =
    rules === null || draft.species === null ? null : rules.species[draft.species];
  const classDef: ClassDef | null =
    rules === null || draft.klass === null ? null : rules.classes[draft.klass];

  /** Species passives are a stat bonus or extra HP (spec §4.2); only the stat
   *  half belongs in the stat line. */
  const speciesBonus: Stats = useMemo(() => {
    const bonus: Stats = { ...NO_POINTS };
    const stat = speciesDef?.passive.stat;
    if (stat !== undefined) bonus[stat] = speciesDef?.passive.amount ?? 0;
    return bonus;
  }, [speciesDef]);

  const spent = sumStats(draft.assigned);
  const remaining = (rules?.creationPoints ?? 0) - spent;

  const stepIndex = CREATION_STEPS.indexOf(draft.step);

  const chooseSpecies = useCallback((id: SpeciesId) => {
    // A species change resets cosmetics: a bigfoot has no horn to style.
    patchCreationDraft({ species: id, appearance: defaultAppearance(id) });
  }, []);

  const addPoint = useCallback(
    (stat: StatId) => {
      patchCreationDraft({ assigned: { ...draft.assigned, [stat]: draft.assigned[stat] + 1 } });
    },
    [draft.assigned],
  );

  const removePoint = useCallback(
    (stat: StatId) => {
      patchCreationDraft({
        assigned: { ...draft.assigned, [stat]: Math.max(0, draft.assigned[stat] - 1) },
      });
    },
    [draft.assigned],
  );

  const stepDone = ((): boolean => {
    switch (draft.step) {
      case "species":
        return draft.species !== null;
      case "class":
        return draft.klass !== null;
      case "stats":
        return remaining === 0;
      case "appearance":
        return draft.appearance.palette !== "" && draft.appearance.accent !== "";
      case "name":
        return draft.name.trim().length > 0;
    }
  })();

  const goBack = useCallback(() => {
    const previous = CREATION_STEPS[stepIndex - 1];
    if (previous !== undefined) patchCreationDraft({ step: previous });
  }, [stepIndex]);

  const goNext = useCallback(() => {
    const next = CREATION_STEPS[stepIndex + 1];
    if (next !== undefined) patchCreationDraft({ step: next });
  }, [stepIndex]);

  const submit = useCallback(async () => {
    if (draft.species === null || draft.klass === null) return;
    setError(null);
    setSubmitting(true);
    patchCreationDraft({ submitting: true });
    try {
      await send({
        type: "CREATE_CHARACTER",
        name: draft.name.trim(),
        species: draft.species,
        class: draft.klass,
        // Assigned points only. Base stats and the species bonus are applied
        // server-side by resolveCharacter() (domain.ts, CharacterProgress.stats).
        stats: draft.assigned,
        appearance: draft.appearance,
      });
      resetCreationDraft();
    } catch (err) {
      patchCreationDraft({ submitting: false });
      setError(err instanceof Error ? err.message : "That didn't send. Try again?");
    } finally {
      setSubmitting(false);
    }
  }, [draft, send]);

  if (rules === null) {
    return (
      <div className="creation creation--loading" role="status">
        <Spinner />
        <span>Getting the character sheet ready…</span>
      </div>
    );
  }

  return (
    <section className="creation" aria-labelledby="creation-title">
      <header className="creation__head">
        <p className="creation__progress" aria-label={`Step ${String(stepIndex + 1)} of ${String(CREATION_STEPS.length)}`}>
          {CREATION_STEPS.map((step, i) => (
            <span
              key={step}
              className={`creation__pip${i === stepIndex ? " creation__pip--on" : ""}${i < stepIndex ? " creation__pip--done" : ""}`}
              aria-hidden="true"
            >
              {i < stepIndex ? <Icon name="check" /> : <Icon name={STEP_ICON[step]} />}
            </span>
          ))}
        </p>
        <h2 className="creation__title" id="creation-title">
          <Icon name={STEP_ICON[draft.step]} />
          <span>{STEP_TITLE[draft.step]}</span>
        </h2>
      </header>

      <div className="creation__body kad-scroll">
        {draft.step === "species" ? (
          <SpeciesStep species={speciesList} chosen={draft.species} onChoose={chooseSpecies} />
        ) : null}

        {draft.step === "class" ? (
          <ClassStep
            classes={classList}
            chosen={draft.klass}
            onChoose={(id) => patchCreationDraft({ klass: id })}
          />
        ) : null}

        {draft.step === "stats" ? (
          <StatsStep
            base={rules.baseStats}
            bonus={speciesBonus}
            assigned={draft.assigned}
            remaining={remaining}
            onAdd={addPoint}
            onRemove={removePoint}
            onReset={() => patchCreationDraft({ assigned: NO_POINTS })}
          />
        ) : null}

        {draft.step === "appearance" && draft.species !== null ? (
          <div className="creation-appearance">
            <fieldset className="creation-fieldset">
              <legend className="creation-legend">Colours</legend>
              <div className="creation-swatches">
                {PALETTES.map((palette) => (
                  <button
                    key={palette.id}
                    type="button"
                    className={`creation-swatch kad-tap kad-focusable${draft.appearance.palette === palette.id ? " creation-swatch--on" : ""}`}
                    aria-pressed={draft.appearance.palette === palette.id}
                    onClick={() =>
                      patchCreationDraft({
                        appearance: { ...draft.appearance, palette: palette.id },
                      })
                    }
                  >
                    <span
                      className="creation-swatch__chip"
                      style={{ background: palette.coat, borderColor: palette.mane }}
                      aria-hidden="true"
                    />
                    <span>{palette.name}</span>
                    {draft.appearance.palette === palette.id ? <Icon name="check" label="Chosen" /> : null}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="creation-fieldset">
              <legend className="creation-legend">Accent</legend>
              <div className="creation-swatches">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.id}
                    type="button"
                    className={`creation-swatch kad-tap kad-focusable${draft.appearance.accent === accent.hex ? " creation-swatch--on" : ""}`}
                    aria-pressed={draft.appearance.accent === accent.hex}
                    onClick={() =>
                      patchCreationDraft({ appearance: { ...draft.appearance, accent: accent.hex } })
                    }
                  >
                    <span
                      className="creation-swatch__chip"
                      style={{ background: accent.hex, borderColor: accent.hex }}
                      aria-hidden="true"
                    />
                    <span>{accent.name}</span>
                    {draft.appearance.accent === accent.hex ? <Icon name="check" label="Chosen" /> : null}
                  </button>
                ))}
              </div>
            </fieldset>

            <CosmeticRow
              legend="Horn"
              options={hornStylesFor(draft.species)}
              chosen={draft.appearance.hornStyle}
              onChoose={(id) =>
                patchCreationDraft({ appearance: { ...draft.appearance, hornStyle: id } })
              }
            />
            <CosmeticRow
              legend="Wings"
              options={wingStylesFor(draft.species)}
              chosen={draft.appearance.wingStyle}
              onChoose={(id) =>
                patchCreationDraft({ appearance: { ...draft.appearance, wingStyle: id } })
              }
            />
            <CosmeticRow
              legend="Markings"
              options={MARKINGS}
              chosen={draft.appearance.markings}
              onChoose={(id) =>
                patchCreationDraft({ appearance: { ...draft.appearance, markings: id } })
              }
            />
          </div>
        ) : null}

        {draft.step === "name" ? (
          <div className="creation-name">
            {/* Tapping a suggestion is a complete path through this screen —
                the keyboard is there for anyone who wants it (spec §1.1). */}
            <div className="creation-chips">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={`creation-chip kad-tap kad-focusable${draft.name === suggestion ? " creation-chip--on" : ""}`}
                  aria-pressed={draft.name === suggestion}
                  onClick={() => patchCreationDraft({ name: suggestion })}
                >
                  <Icon name="star" />
                  <span>{suggestion}</span>
                  {draft.name === suggestion ? <Icon name="check" label="Chosen" /> : null}
                </button>
              ))}
            </div>

            <Button
              variant="secondary"
              size="md"
              icon={<Icon name="shuffle" />}
              onClick={() => {
                const fresh = randomNames(3);
                setSuggestions(fresh);
                patchCreationDraft({ name: fresh[0] ?? draft.name });
              }}
            >
              Surprise me
            </Button>

            <label className="creation-name__field">
              <span className="creation-legend">
                <Icon name="name" />
                <span>Or type one</span>
              </span>
              <input
                className="creation-name__input kad-focusable"
                type="text"
                value={draft.name}
                onChange={(e) => patchCreationDraft({ name: sanitizeName(e.target.value) })}
                maxLength={NAME_MAX_LENGTH}
                autoComplete="off"
                enterKeyHint="done"
                placeholder="Tap to type"
              />
            </label>

            <p className="creation-name__summary kad-muted">
              {speciesDef === null || classDef === null ? null : (
                <>
                  <Icon name={speciesDef.id} />
                  <span>
                    {draft.name.trim() === "" ? "Your hero" : draft.name} the {speciesDef.name}{" "}
                    {classDef.name}
                  </span>
                </>
              )}
            </p>
          </div>
        ) : null}

        {error === null ? null : (
          <p className="kad-chip kad-chip--bad" role="alert">
            <Icon name="close" />
            <span>{error}</span>
          </p>
        )}
      </div>

      <footer className="creation__foot">
        {stepIndex > 0 ? (
          <Button variant="ghost" size="lg" icon={<Icon name="back" />} onClick={goBack}>
            Back
          </Button>
        ) : null}

        {draft.step === "name" ? (
          <Button
            variant="primary"
            size="lg"
            icon={<Icon name="check" />}
            disabled={!stepDone || submitting}
            onClick={() => void submit()}
          >
            {submitting ? "Making…" : "That's me!"}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            icon={<Icon name="forward" />}
            disabled={!stepDone}
            onClick={goNext}
          >
            Next
          </Button>
        )}
      </footer>
    </section>
  );
}
