/**
 * "Me" — a kid's own page in the adventure book (#299).
 *
 * Her heroes with their level and stats, the adventures she has finished, how
 * many things she has found in the Field Guide, and her badges, each a drawn
 * medal in a carousel. A page to look at, and a page to change: it opens to
 * look at, and "Edit my page" turns it into the editor, where what she picks
 * (a color, a frame for each hero, a title from the badges she has earned)
 * shows in the preview pinned above the choices. Presets only; nothing typed
 * and nothing uploaded.
 *
 * Everything shown is derived on the server from what the game already keeps
 * (`JournalResponse.profile`), and nothing is ranked against anybody. The page
 * is only ever reached from her own device, through the journal (the Hero
 * page's "My page"); it has no address of its own and nothing here can be shared.
 *
 * Lazy: JournalScreen loads this chunk the first time the page is opened, so
 * none of it is in the first paint.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  HERO_FRAMES,
  PROFILE_COLORS,
  STAT_IDS,
  type Badge,
  type FieldGuide,
  type FlairChoice,
  type HeroFrameId,
  type JournalResponse,
  type KidProfileView,
  type ProfileFlair,
  type ResolvedCharacter,
} from "@kad/shared";
import { useBackStep } from "../store/back-steps";
import { useGameStore } from "../store";
import { Button } from "../ui/Button";
import { BadgeArt } from "./BadgeArt";
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
  const [editing, setEditing] = useState(false);
  // Back out of the editor before it backs out of the page.
  useBackStep(editing ? () => { setEditing(false); return true; } : null);

  const frameOf = (hero: ResolvedCharacter): HeroFrameId => flair.frames?.[hero.id] ?? "plain";
  const pickFrame = (hero: ResolvedCharacter, id: HeroFrameId): void =>
    pick((was) => {
      const frames = { ...was.frames, [hero.id]: id };
      if (id === "plain") delete frames[hero.id];
      const { frames: _was, ...rest } = was;
      return Object.keys(frames).length > 0 ? { ...rest, frames } : rest;
    });

  return (
    <div className="kad-surface kad-surface--player" data-surface="player">
      <div className="profile kad-scroll" data-profile-color={color} data-mode={editing ? "edit" : "view"}>
        {/* In the editor this stays pinned, so every pick shows in it without a scroll. */}
        <div className="profile__top">
          <header className="profile__banner">
            <div className="profile__banner-words">
              <h2 className="profile__name">{profile.displayName}</h2>
              <p className="profile__title">{title}</p>
            </div>
            <Button className="profile__mode" variant={editing ? "primary" : "secondary"} size="md"
              icon={<Icon name={editing ? "check" : "name"} />} onClick={() => setEditing(!editing)}>
              {editing ? "Done" : "Edit my page"}
            </Button>
          </header>
          {editing && journal.heroes.length > 0 ? (
            <ul className="profile__faces" aria-label="Your heroes, as they will look">
              {journal.heroes.map((hero) => (
                <li key={hero.id}>
                  <HeroFrame hero={hero} frame={frameOf(hero)} small />
                </li>
              ))}
            </ul>
          ) : null}
          <p className="profile__notice" role="status">
            {notice === "saved" ? "Saved. It will look like this on all your devices." : ""}
            {notice === "failed" ? "We could not save that just now. Try again in a moment." : ""}
          </p>
        </div>

        {editing ? (
          <>
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
            {journal.heroes.length > 0 ? (
              <section className="profile__section" aria-labelledby="profile-frames">
                <h3 id="profile-frames" className="profile__heading"><Icon name="party" /> <span>Frames for your heroes</span></h3>
                <ul className="profile__editors">
                  {journal.heroes.map((hero) => (
                    <li key={hero.id} className="profile__editor">
                      <HeroFrame hero={hero} frame={frameOf(hero)} small />
                      <Choices label={`Frame for ${hero.name}`} options={HERO_FRAMES} value={frameOf(hero)}
                        onPick={(id) => pickFrame(hero, id)} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <>
            <section className="profile__section" aria-labelledby="profile-heroes">
              <h3 id="profile-heroes" className="profile__heading"><Icon name="party" /> <span>Your heroes</span></h3>
              {journal.heroes.length === 0 ? (
                <p className="profile__hint">No hero yet. Make one in your next game and it will stand here.</p>
              ) : (
                <ul className="profile__heroes">
                  {journal.heroes.map((hero) => (
                    <li key={hero.id} className="profile__hero">
                      <HeroFrame hero={hero} frame={frameOf(hero)} />
                      <div className="profile__hero-text">
                        <h4 className="profile__hero-name">{hero.name}</h4>
                        <p className="profile__level">
                          <Icon name="star" /> <span>Level {hero.level}</span>
                        </p>
                        <p className="profile__kind kad-muted">{hero.species} {hero.class}</p>
                        <ul className="profile__stats" aria-label={`${hero.name}'s stats`}>
                          {STAT_IDS.map((stat) => (
                            <li key={stat} className="profile__stat">
                              <Icon name={stat} />
                              <b>{hero.stats[stat]}</b>
                              <span>{stat}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="profile__section" aria-labelledby="profile-badges">
              <h3 id="profile-badges" className="profile__heading"><Icon name="levelup" /> <span>Your badges</span></h3>
              {profile.badges.length === 0 ? (
                <p className="profile__hint">No badges yet. The first one is hiding behind a bush.</p>
              ) : (
                <BadgeCarousel badges={profile.badges} />
              )}
            </section>

            <section className="profile__section" aria-labelledby="profile-finished">
              <h3 id="profile-finished" className="profile__heading"><Icon name="check" /> <span>Adventures finished</span></h3>
              {campaigns.length === 0 ? (
                <p className="profile__hint">None yet. The first ending is waiting for you.</p>
              ) : (
                <ul className="profile__list">
                  {campaigns.map((c) => <li key={c.campaignId}><Icon name="check" /> <span>{c.title}</span></li>)}
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
                    {profile.finds.recent.map((id) => <li key={id}><Icon name="eye" /> <span>{guide?.entries[id]?.title ?? "A new find"}</span></li>)}
                  </ul>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A hero in the frame she chose. The portrait fills the frame (the art is a
 * square, so the frame is nearly one), and the frame differs in line as well as
 * color, so no frame is told apart by color alone (spec §11).
 */
function HeroFrame({ hero, frame, small = false }: { hero: ResolvedCharacter; frame: HeroFrameId; small?: boolean }): ReactElement {
  return (
    <div className={`profile__frame profile__frame--${frame}${small ? " profile__frame--small" : ""}`} data-frame={frame}>
      <CharacterPortrait backdrop lit size="100%" species={hero.species} accent={hero.appearance.accent}
        tier={hero.tier} characterClass={hero.class} />
    </div>
  );
}

/**
 * Her badges, one medal at a time with the next one peeking in: swipe along, or
 * use the arrows. Every badge is in the page whether it is in view or not.
 */
function BadgeCarousel({ badges }: { badges: readonly Badge[] }): ReactElement {
  const track = useRef<HTMLUListElement | null>(null);
  const [at, setAt] = useState(0);
  const slides = (): HTMLElement[] => [...(track.current?.children ?? [])] as HTMLElement[];

  // Whichever medal is nearest the middle of the track is the one she is looking at.
  const onScroll = (): void => {
    const el = track.current;
    if (!el) return;
    const middle = el.scrollLeft + el.clientWidth / 2;
    let nearest = 0;
    let gap = Infinity;
    slides().forEach((slide, i) => {
      const away = Math.abs(slide.offsetLeft + slide.offsetWidth / 2 - middle);
      if (away < gap) { gap = away; nearest = i; }
    });
    setAt(nearest);
  };

  const go = (to: number): void => {
    const el = track.current;
    const slide = slides()[to];
    if (!el || !slide) return;
    setAt(to);
    if (typeof el.scrollTo !== "function") return;
    const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: slide.offsetLeft - (el.clientWidth - slide.offsetWidth) / 2, behavior: calm ? "auto" : "smooth" });
  };

  return (
    <div className="profile__carousel" role="group" aria-roledescription="carousel" aria-label="Your badges">
      <ul className="profile__badges kad-scroll" ref={track} onScroll={onScroll} tabIndex={0}
        aria-label="Swipe to see more badges">
        {badges.map((badge, i) => (
          <li key={badge.id} className="profile__badge" role="group" aria-roledescription="slide"
            aria-label={`${String(i + 1)} of ${String(badges.length)}`}>
            <BadgeArt id={badge.id} className="profile__badge-art" />
            <b className="profile__badge-name">{badge.name}</b>
            <span className="profile__badge-blurb">{badge.blurb}</span>
          </li>
        ))}
      </ul>
      {badges.length > 1 ? (
        <div className="profile__carousel-bar">
          <button type="button" className="profile__arrow kad-tap kad-focusable" aria-label="Previous badge"
            disabled={at === 0} onClick={() => go(at - 1)}>
            <Icon name="back" />
          </button>
          <span className="profile__dots" aria-hidden="true">
            {badges.map((badge, i) => <span key={badge.id} className={`profile__dot${i === at ? " profile__dot--on" : ""}`} />)}
          </span>
          <button type="button" className="profile__arrow kad-tap kad-focusable" aria-label="Next badge"
            disabled={at === badges.length - 1} onClick={() => go(at + 1)}>
            <Icon name="forward" />
          </button>
        </div>
      ) : null}
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
