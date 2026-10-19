/**
 * "Me" — a kid's own page in the adventure book (#299).
 *
 * Her heroes with their level and stats, the adventures she has finished, how
 * many things she has found in the Field Guide, and her badges, with a little
 * she can make her own: a color, a frame for each hero, a title from the badges
 * she has earned. Presets only; nothing typed and nothing uploaded.
 *
 * Everything shown is derived on the server from what the game already keeps
 * (`JournalResponse.profile`), and nothing is ranked against anybody. The page
 * is only ever reached from her own device, through the journal; it has no
 * address of its own and nothing here can be shared.
 *
 * Lazy: JournalScreen loads this chunk the first time "Me" is opened, so none
 * of it is in the first paint.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  HERO_FRAMES,
  PROFILE_COLORS,
  STAT_IDS,
  type FieldGuide,
  type FlairChoice,
  type JournalResponse,
  type KidProfileView,
  type ProfileFlair,
} from "@kad/shared";
import { useGameStore } from "../store";
import { CharacterPortrait } from "./CharacterPortrait";
import { Icon } from "./icons";
import { loadFieldGuide } from "./content";
import "./ProfilePane.css";

/** The same choice, however its keys happen to be ordered (the server's order is not the page's). */
function sameChoice(a: ProfileFlair, b: ProfileFlair): boolean {
  const canon = (flair: ProfileFlair): string =>
    JSON.stringify([flair.color ?? null, flair.title ?? null, Object.entries(flair.frames ?? {}).sort(([x], [y]) => x.localeCompare(y))]);
  return canon(a) === canon(b);
}

/** What the saved flair means for a save: the whole choice, so a pick replaces and never merges. */
function choiceOf(flair: ProfileFlair): FlairChoice {
  return { color: flair.color ?? null, frames: flair.frames ?? null, title: flair.title ?? null };
}

export default function ProfilePane({ journal }: { journal: JournalResponse }): ReactElement {
  const profile = journal.profile;
  if (!profile) return <Unavailable />;
  return <Page journal={journal} profile={profile} />;
}

function Unavailable(): ReactElement {
  return (
    <div className="kad-surface kad-surface--player" data-surface="player">
      <section className="profile__empty">
        <Icon name="scroll" size="2.4em" />
        <p>Your page is not ready on this phone yet. Open the book again when you have a signal.</p>
      </section>
    </div>
  );
}

function Page({ journal, profile }: { journal: JournalResponse; profile: KidProfileView }): ReactElement {
  const saveFlair = useGameStore((s) => s.saveFlair);
  const [flair, setFlair] = useState<ProfileFlair>(profile.flair);
  const [notice, setNotice] = useState<"" | "saved" | "failed">("");
  const guide = useFieldGuide();

  /*
   * A save replaces her whole choice, so two in flight at once could land in
   * either order and the older one would win. One goes at a time: a pick made
   * meanwhile only changes what is `wanted`, and when the save in flight comes
   * back the latest wanted choice is sent next, so the server's last write is
   * always her last pick. If a save fails, she is back to what the server last
   * confirmed, and the picks made after it are dropped with it.
   */
  const wanted = useRef(profile.flair);
  const confirmed = useRef(profile.flair);
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (!sameChoice(wanted.current, confirmed.current)) {
        const asked = wanted.current;
        let saved: KidProfileView;
        try {
          saved = await saveFlair(choiceOf(asked));
        } catch {
          wanted.current = confirmed.current;
          if (mounted.current) { setFlair(confirmed.current); setNotice("failed"); }
          return;
        }
        confirmed.current = saved.flair;
        // Nothing newer was picked while it was out: show what the server holds.
        if (wanted.current === asked) wanted.current = saved.flair;
      }
      if (mounted.current) { setFlair(wanted.current); setNotice("saved"); }
    } finally {
      sending.current = false;
    }
  }, [saveFlair]);

  const pick = useCallback(
    (change: (was: ProfileFlair) => ProfileFlair) => {
      const next = change(wanted.current);
      wanted.current = next;
      setFlair(next);
      setNotice("");
      void flush();
    },
    [flush],
  );

  const color = flair.color ?? "meadow";
  const title = profile.badges.find((b) => b.id === flair.title)?.name ?? "Adventurer";
  const finished = Object.values(journal.finished ?? {}).flat();
  const campaigns = [...new Map(finished.map((f) => [f.campaignId, f])).values()];

  return (
    <div className="kad-surface kad-surface--player" data-surface="player">
      <div className="profile kad-scroll" data-profile-color={color}>
        <header className="profile__banner">
          <h2 className="profile__name">{profile.displayName}</h2>
          <p className="profile__title">{title}</p>
        </header>

        <p className="profile__notice" role="status">
          {notice === "saved" ? "Saved. It will look like this on all your devices." : ""}
          {notice === "failed" ? "We could not save that just now. Try again in a moment." : ""}
        </p>

        <section className="profile__section" aria-labelledby="profile-heroes">
          <h3 id="profile-heroes" className="profile__heading"><Icon name="party" /> <span>Your heroes</span></h3>
          {journal.heroes.length === 0 ? (
            <p className="profile__hint">No hero yet. Make one in your next game and it will stand here.</p>
          ) : (
            <ul className="profile__heroes">
              {journal.heroes.map((hero) => {
                const frame = flair.frames?.[hero.id] ?? "plain";
                return (
                  <li key={hero.id} className="profile__hero">
                    <div className={`profile__frame profile__frame--${frame}`} data-frame={frame}>
                      <CharacterPortrait backdrop species={hero.species} accent={hero.appearance.accent}
                        tier={hero.tier} characterClass={hero.class} lit />
                    </div>
                    <div className="profile__hero-text">
                      <h4 className="profile__hero-name">{hero.name}</h4>
                      <p className="profile__level"><Icon name="star" /> Level {hero.level}</p>
                      <ul className="profile__stats" aria-label={`${hero.name}'s stats`}>
                        {STAT_IDS.map((stat) => (
                          <li key={stat} className="profile__stat">
                            <Icon name={stat} />
                            <b>{hero.stats[stat]}</b>
                            <span>{stat}</span>
                          </li>
                        ))}
                      </ul>
                      <Choices label={`Frame for ${hero.name}`}
                        options={HERO_FRAMES} value={frame}
                        onPick={(id) => pick((was) => {
                          const frames = { ...was.frames, [hero.id]: id };
                          if (id === "plain") delete frames[hero.id];
                          const { frames: _was, ...rest } = was;
                          return Object.keys(frames).length > 0 ? { ...rest, frames } : rest;
                        })} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="profile__section" aria-labelledby="profile-badges">
          <h3 id="profile-badges" className="profile__heading"><Icon name="levelup" /> <span>Your badges</span></h3>
          {profile.badges.length === 0 ? (
            <p className="profile__hint">No badges yet. The first one is hiding behind a bush.</p>
          ) : (
            <ul className="profile__badges">
              {profile.badges.map((badge) => (
                <li key={badge.id} className="profile__badge">
                  <Icon name="star" />
                  <span>
                    <b className="profile__badge-name">{badge.name}</b>
                    <span className="profile__badge-blurb">{badge.blurb}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="profile__section" aria-labelledby="profile-finished">
          <h3 id="profile-finished" className="profile__heading"><Icon name="check" /> <span>Adventures finished</span></h3>
          {campaigns.length === 0 ? (
            <p className="profile__hint">None yet. The first ending is waiting for you.</p>
          ) : (
            <ul className="profile__list">
              {campaigns.map((c) => <li key={c.campaignId}>{c.title}</li>)}
            </ul>
          )}
        </section>

        <section className="profile__section" aria-labelledby="profile-finds">
          <h3 id="profile-finds" className="profile__heading"><Icon name="eye" /> <span>Field Guide finds</span></h3>
          {profile.finds.count === 0 ? (
            <p className="profile__hint">Nothing yet. Keep your eyes open, something odd is out there.</p>
          ) : (
            <>
              <p className="profile__count">
                You found <b>{profile.finds.count}</b> {profile.finds.count === 1 ? "thing" : "things"} for the Field Guide.
              </p>
              <ul className="profile__list" aria-label="Your newest finds">
                {profile.finds.recent.map((id) => <li key={id}>{guide?.entries[id]?.title ?? "A new find"}</li>)}
              </ul>
            </>
          )}
        </section>

        <section className="profile__section" aria-labelledby="profile-yours">
          <h3 id="profile-yours" className="profile__heading"><Icon name="spark" /> <span>Make it yours</span></h3>
          <Choices label="Pick a color" options={PROFILE_COLORS} value={flair.color ?? ""} swatch
            onPick={(id) => pick((was) => ({ ...was, color: id }))} />
          {profile.badges.length === 0 ? (
            <p className="profile__hint">Earn a badge and you can wear its name as a title.</p>
          ) : (
            <Choices label="Pick a title"
              options={[{ id: "", label: "No title" }, ...profile.badges.map((b) => ({ id: b.id, label: b.name }))]}
              value={flair.title ?? ""}
              onPick={(id) => pick((was) => {
                const { title: _was, ...rest } = was;
                return id === "" ? rest : { ...rest, title: id };
              })} />
          )}
        </section>
      </div>
    </div>
  );
}

/** A short list of presets as one group of radio buttons, chosen by a check and a rim and never by color alone. */
function Choices<T extends string>({ label, options, value, onPick, swatch = false }: {
  label: string;
  options: readonly { id: T | ""; label: string }[];
  value: string;
  onPick: (id: T) => void;
  swatch?: boolean;
}): ReactElement {
  const name = `profile-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="profile__choices" role="radiogroup" aria-label={label}>
      <span className="profile__choices-label" aria-hidden="true">{label}</span>
      <div className="profile__choice-row">
        {options.map((option) => {
          const on = option.id === value;
          return (
            <label key={option.id || "none"} className={`profile__choice kad-tap${on ? " profile__choice--on" : ""}`}>
              <input className="profile__choice-radio" type="radio" name={name} value={option.id} checked={on}
                onChange={() => onPick(option.id as T)} />
              {swatch ? <span className={`profile__swatch profile__swatch--${option.id}`} aria-hidden="true" /> : null}
              <span>{option.label}</span>
              {on ? <Icon name="check" label="Selected" /> : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** The Field Guide's words for a find, once they arrive. The page reads fine without them. */
function useFieldGuide(): FieldGuide | null {
  const [guide, setGuide] = useState<FieldGuide | null>(null);
  useEffect(() => {
    let live = true;
    loadFieldGuide().then((g) => { if (live) setGuide(g); }, () => undefined);
    return () => { live = false; };
  }, []);
  return guide;
}
