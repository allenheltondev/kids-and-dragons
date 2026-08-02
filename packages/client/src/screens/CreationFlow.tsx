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
 *
 * spec §5.1 asks for "six large animated portraits", and the portraits exist —
 * `assets/characters/<species>/fledgling/` has been delivered for all six. So
 * species are chosen by their picture, and from the moment one is picked the
 * hero stands at the top of every remaining screen: this is a phone held by an
 * 8-year-old, and "who am I making?" has to be answerable by looking, not by
 * remembering. The animated half is still the rigs' job (world/scene.ts header).
 */

import { useCallback, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { STAT_IDS } from "@kad/shared";
import type { ClassDef, ClassId, SpeciesDef, SpeciesId, StatId, Stats } from "@kad/shared";
import { useRules, useSend } from "../store";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { CharacterPortrait } from "./CharacterPortrait";
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
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      className={`creation-card kad-tap kad-focusable${selected ? " creation-card--on" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="creation-card__icon">{icon}</span>
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

/**
 * The picture is the button. A species card is a portrait first and a card
 * second — it does not reuse OptionCard because that layout leads with a 3.2em
 * icon well, and the whole point here is that the creature is the biggest thing
 * on the screen. Everything else about it is the same: a check glyph carries
 * selection, and the name is still text (spec §11).
 */
export function SpeciesStep({
  species,
  chosen,
  onChoose,
}: {
  species: SpeciesDef[];
  chosen: SpeciesId | null;
  onChoose: (id: SpeciesId) => void;
}): ReactElement {
  return (
    <div className="creation-species-grid">
      {species.map((def) => {
        const selected = chosen === def.id;
        return (
          <button
            key={def.id}
            type="button"
            className={`creation-species kad-tap kad-focusable${selected ? " creation-species--on" : ""}`}
            aria-pressed={selected}
            onClick={() => onChoose(def.id)}
          >
            <CharacterPortrait
              species={def.id}
              className="creation-species__art"
              stand="centre"
              lit={selected}
              float={selected}
            />
            <span className="creation-species__text">
              <span className="creation-card__title">
                {def.name}
                {selected ? <Icon name="check" label="Chosen" /> : null}
              </span>
              <span className="creation-card__blurb kad-muted">{def.blurb}</span>
              <span className="creation-card__line">
                <Icon name={def.worldAbility.icon} />
                <span>
                  <b>{def.worldAbility.name}</b>{" "}
                  <span className="kad-muted">{def.worldAbility.text}</span>
                </span>
              </span>
              <span className="creation-card__line kad-muted">
                <Icon name={def.passive.stat ?? "heart"} />
                <span>{def.passive.text}</span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The hero so far, pinned above every screen after the species is chosen.
 *
 * It is the only thing on the phone that answers "who am I making?" without
 * going back a step, and it is where the appearance choices land: the accent
 * colour is the light the figure is standing in, so tapping a swatch changes
 * something visible about *the character* rather than only a swatch border.
 */
export function HeroStrip({
  species,
  klass,
  name,
  accent,
}: {
  species: SpeciesDef;
  klass: ClassDef | null;
  name: string;
  accent: string;
}): ReactElement {
  const trimmed = name.trim();
  return (
    <p className="creation-hero">
      <CharacterPortrait
        species={species.id}
        className="creation-hero__art"
        accent={accent}
        lit
        float
      />
      <span className="creation-hero__text">
        {/* Before there is a name the species *is* the name, so the second line
            drops it rather than saying "Unicorn / Unicorn Thornguard". */}
        <span className="creation-hero__name">{trimmed === "" ? species.name : trimmed}</span>
        <span className="creation-hero__meta kad-muted">
          {klass === null ? (
            <span>{species.blurb}</span>
          ) : (
            <>
              <Icon name={klass.id} />
              <span>{trimmed === "" ? klass.name : `${species.name} ${klass.name}`}</span>
            </>
          )}
        </span>
      </span>
    </p>
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
            <span>
              <b>{def.signature.name}</b> <span className="kad-muted">{def.signature.text}</span>
            </span>
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
      <p className={`creation-stats__budget${remaining === 0 ? " creation-stats__budget--done" : ""}`}>
        <Icon name={remaining === 0 ? "check" : "star"} />
        <span>
          {remaining === 0 ? "All points spent" : `${String(remaining)} point${remaining === 1 ? "" : "s"} to spend`}
        </span>
      </p>

      {/*
       * Every row is the same five columns — icon, name, free-point chip,
       * total, controls — and each column is the same width in every row, so
       * the numbers read down the page as a column instead of landing wherever
       * the row before them happened to end.
       */}
      <ul className="creation-stats__list">
        {STAT_IDS.map((stat) => {
          const total = base[stat] + bonus[stat] + assigned[stat];
          return (
            <li className="creation-stat" key={stat}>
              <span className="creation-stat__icon">
                <Icon name={stat} size="1.8em" />
              </span>
              <span className="creation-stat__name">{stat}</span>
              <span className="creation-stat__bonus">
                {bonus[stat] > 0 ? (
                  <span className="kad-chip">
                    <Icon name="star" />
                    <span>+{bonus[stat]} free</span>
                  </span>
                ) : null}
              </span>
              <span className="creation-stat__value" aria-label={`${stat} ${String(total)}`}>
                {total}
              </span>
              {/*
               * The tray keeps its width whether or not there is anything in
               * it. Controls still appear only when they are legal — nothing is
               * greyed out (spec §11) — but spending your last point no longer
               * makes four rows change shape underneath your finger.
               */}
              <span className="creation-stat__controls">
                {assigned[stat] > 0 ? (
                  <button
                    type="button"
                    className="creation-step-btn creation-step-btn--take kad-tap kad-focusable"
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
// Small choices — colours, cosmetics, name suggestions (spec §5.4, §5.5)
//
// One shape for all of them, because they are all the same question: pick one
// of a handful of equal things. Two rules do most of the work:
//
//   - **They are a grid, not a wrap.** Content-width pills broke into rows of
//     2, then 3, then 1, differently in every group, and the result read as
//     scattered rather than as a set of choices.
//   - **The check has a seat whether or not anybody is sitting in it.** The
//     mark used to be added to the chosen chip, which made it wider and
//     reflowed the row — tapping a colour moved the other colours. The slot is
//     always there; only the glyph inside it comes and goes.
// ---------------------------------------------------------------------------

function OptionRow({
  legend,
  children,
}: {
  legend: string;
  children: ReactNode;
}): ReactElement {
  return (
    <fieldset className="creation-fieldset">
      <legend className="creation-legend kad-label">{legend}</legend>
      <div className="creation-options">{children}</div>
    </fieldset>
  );
}

function OptionButton({
  selected,
  onSelect,
  media,
  label,
  className = "",
}: {
  selected: boolean;
  onSelect: () => void;
  media: ReactNode;
  label: string;
  className?: string;
}): ReactElement {
  const classes = ["creation-option", className, "kad-tap", "kad-focusable"];
  if (selected) classes.push("creation-option--on");
  return (
    <button
      type="button"
      className={classes.filter(Boolean).join(" ")}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="creation-option__media">{media}</span>
      <span className="creation-option__label">{label}</span>
      <span className="creation-option__mark">
        {selected ? <Icon name="check" label="Chosen" /> : null}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — appearance (spec §5.4)
// ---------------------------------------------------------------------------

export function CosmeticRow({
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
    <OptionRow legend={legend}>
      {options.map((option) => (
        <OptionButton
          key={option.id}
          selected={chosen === option.id}
          onSelect={() => {
            onChoose(option.id);
          }}
          media={<Icon name={option.icon} size="1.5em" />}
          label={option.name}
        />
      ))}
    </OptionRow>
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
      const accepted = await send({
        type: "CREATE_CHARACTER",
        name: draft.name.trim(),
        species: draft.species,
        class: draft.klass,
        // Assigned points only. Base stats and the species bonus are applied
        // server-side by resolveCharacter() (domain.ts, CharacterProgress.stats).
        stats: draft.assigned,
        appearance: draft.appearance,
      });
      // Only throw the draft away once the character actually exists. A
      // rejected intent resolves normally, so resetting unconditionally would
      // wipe five screens of choices because the phone blinked.
      if (!accepted) {
        patchCreationDraft({ submitting: false });
        setError("That didn't send. Try again?");
        return;
      }
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

        {/* Not on the species screen: there, the six portraits below *are* the
            hero, and a seventh copy of the one you just tapped is noise. */}
        {speciesDef === null || draft.step === "species" ? null : (
          <HeroStrip
            species={speciesDef}
            klass={classDef}
            name={draft.name}
            accent={draft.appearance.accent}
          />
        )}
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
            {/* `creation-swatch` carries no styling of its own — it names the
                kind of option this is, for the e2e that picks a colour and an
                accent by role rather than by position. */}
            <OptionRow legend="Colours">
              {PALETTES.map((palette) => (
                <OptionButton
                  key={palette.id}
                  className="creation-swatch"
                  selected={draft.appearance.palette === palette.id}
                  onSelect={() => {
                    patchCreationDraft({
                      appearance: { ...draft.appearance, palette: palette.id },
                    });
                  }}
                  media={
                    /* Mane in the middle, coat as the ring: the chip shows the
                       colour that actually changes on the figure, not the one
                       that stays as painted (creationContent PALETTES). */
                    <span
                      className="creation-swatch__chip"
                      style={{ background: palette.mane, borderColor: palette.coat }}
                    />
                  }
                  label={palette.name}
                />
              ))}
            </OptionRow>

            <OptionRow legend="Accent">
              {ACCENTS.map((accent) => (
                <OptionButton
                  key={accent.id}
                  className="creation-swatch"
                  selected={draft.appearance.accent === accent.hex}
                  onSelect={() => {
                    patchCreationDraft({ appearance: { ...draft.appearance, accent: accent.hex } });
                  }}
                  media={
                    <span
                      className="creation-swatch__chip"
                      style={{ background: accent.hex, borderColor: accent.hex }}
                    />
                  }
                  label={accent.name}
                />
              ))}
            </OptionRow>

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
                the keyboard is there for anyone who wants it (spec §1.1) — so
                the suggestions are a labelled choice like every other step,
                not three loose chips above a text field. */}
            {/* "Surprise me" is part of the same question as the suggestions,
                so it sits with them rather than floating between two groups. */}
            <div className="creation-name__pick">
              <OptionRow legend="Pick a name">
                {suggestions.map((suggestion) => (
                  <OptionButton
                    key={suggestion}
                    selected={draft.name === suggestion}
                    onSelect={() => {
                      patchCreationDraft({ name: suggestion });
                    }}
                    media={<Icon name="star" size="1.5em" />}
                    label={suggestion}
                  />
                ))}
              </OptionRow>

              <Button
                variant="secondary"
                size="md"
                block
                icon={<Icon name="shuffle" />}
                onClick={() => {
                  const fresh = randomNames(3);
                  setSuggestions(fresh);
                  patchCreationDraft({ name: fresh[0] ?? draft.name });
                }}
              >
                Surprise me
              </Button>
            </div>

            <label className="creation-name__field">
              <span className="creation-legend kad-label">Or type one</span>
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
            {/* No summary line: the hero strip in the head says the same
                sentence with the picture attached, and said it two screens
                earlier. */}
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
