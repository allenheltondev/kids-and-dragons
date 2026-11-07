/**
 * Her look's shelves (docs/hero-looks.md §8; #664, #666): the Color,
 * Nameplate and Title a kid picks for her hero, as tiles that show her own
 * hero (or her own name) wearing each one.
 *
 *   - `BookLook`: the adventure book's dressing room (LookPane.tsx), built
 *     like the kit's (BookKit.tsx): her hero at the top, large, wearing the
 *     look as she taps, then one shelf at a time. Every tap is a save, behind
 *     the scenes; nothing says "saving".
 *   - `LookEditor`: the compact editor in her phone's camp panel at the table,
 *     during downtime (the lobby and rests), next to the kit's. Each tap is a
 *     `LOOK_EDIT` naming the look's revision; the TV shows it at once.
 *
 * Only what she holds is offered (hero-name.ts `lookChoices`): a starter, or
 * one she has earned, and for Color only her species' own. Earned looks she
 * has not got yet are not shown; nothing is a locked tease. The chosen tile is
 * marked by more than colour (a check and `aria-pressed`).
 *
 * **Color** (`coat`, #666) shows her hero tinted on every tile, so she sees
 * which part of her it changes (her coat, her mane, her scales). It is offered
 * only once one of her paintings has a coat mask (coat-masks.ts): before that
 * every tile would show her exactly as painted, which is no choice at all.
 */

import { useId, useState } from "react";
import type { ReactElement } from "react";
import { PLAIN_NAMEPLATE } from "@kad/shared";
import type { ClientIntent, HeroLookView, LookEdit, PartyMember, ResolvedCharacter } from "@kad/shared";
import { Icon } from "./icons";
import { HeroName } from "./HeroName";
import { CharacterPortrait } from "./CharacterPortrait";
import { LOOKS, heroNameStyle, lookChoices } from "../world/hero-name";
import { HERO_ART_PLACES, heroPaintingUrl, type HeroArtSubject } from "../world/hero-art";
import { hasCoatMask } from "../world/coat-masks";
import "./LookEditor.css";

/** One tap on a shelf: the one field it changes. */
export type LookChange = LookEdit;

export type LookShelf = "coat" | "nameplate" | "title";

const SHELVES: readonly { id: LookShelf; label: string; icon: string; legend: string }[] = [
  { id: "coat", label: "Color", icon: "gem", legend: "Your color" },
  { id: "nameplate", label: "Nameplate", icon: "scroll", legend: "Your nameplate" },
  { id: "title", label: "Title", icon: "star", legend: "Your title" },
];

/** The shelf open, for the life of the page, as the kit's dressing room keeps its own. */
let openShelf: LookShelf = "coat";

/** The frame she wears: plain when she has chosen none. */
function frameOf(look: HeroLookView): string {
  return look.nameplate ?? PLAIN_NAMEPLATE;
}

/** Her look with one field changed, for a tile's preview of it. */
function trying(look: HeroLookView, change: LookChange): HeroLookView {
  return { ...look, ...change };
}

/**
 * Whether the Color shelf has anything to show her: colours of her species'
 * own, and a painting of her (her world figure or her portrait) with a mask
 * to show one on.
 */
export function colorShelfShows(hero: HeroArtSubject, look: HeroLookView): boolean {
  if (lookChoices("coat", look, hero.species).length === 0) return false;
  return HERO_ART_PLACES.some((place) => hasCoatMask(heroPaintingUrl(hero, place)));
}

/** The shelves she has, in order. */
function shelvesFor(hero: HeroArtSubject, look: HeroLookView): typeof SHELVES {
  return colorShelfShows(hero, look) ? SHELVES : SHELVES.filter((s) => s.id !== "coat");
}

type Tile = (props: { on: boolean; label: string; onTap: () => void; data: Record<string, string>; preview: ReactElement; swatch?: string | null; source?: string | undefined }) => ReactElement;

/** The tiles of one shelf: each her hero, or her name, wearing that choice. */
function ShelfTiles({ shelf, hero, look, edit, tile }: {
  shelf: LookShelf;
  hero: HeroArtSubject & { name: string; appearance: { accent: string } };
  look: HeroLookView;
  edit: (change: LookChange) => void;
  tile: Tile;
}): ReactElement {
  const name = hero.name;
  if (shelf === "coat") {
    const wearing = (coat: string | null): ReactElement => (
      <CharacterPortrait hero={{ ...hero, look: { coat } }} accent={hero.appearance.accent} size="100%" />
    );
    return (
      <>
        {tile({
          on: look.coat === null,
          label: "As painted",
          onTap: () => edit({ coat: null }),
          data: { "data-coat": "" },
          preview: wearing(null),
          swatch: null,
        })}
        {lookChoices("coat", look, hero.species).map((choice) => (
          <span key={choice.id} style={{ display: "contents" }}>
            {tile({
              on: look.coat === choice.id,
              label: choice.name,
              onTap: () => edit({ coat: choice.id }),
              data: { "data-coat": choice.id },
              preview: wearing(choice.id),
              swatch: LOOKS.coats.find((c) => c.id === choice.id)?.color ?? null,
              source: look.sources?.[choice.id],
            })}
          </span>
        ))}
      </>
    );
  }
  if (shelf === "nameplate") {
    return (
      <>
        {lookChoices("nameplate", look).map((choice) => {
          const change = { nameplate: choice.id };
          return (
            <span key={choice.id} style={{ display: "contents" }}>
              {tile({
                on: frameOf(look) === choice.id,
                label: choice.name,
                onTap: () => edit(change),
                data: { "data-nameplate": choice.id },
                preview: <HeroName name={name} look={trying(look, change)} style={{ ...heroNameStyle(trying(look, change)), title: null }} />,
                source: look.sources?.[choice.id],
              })}
            </span>
          );
        })}
      </>
    );
  }
  return (
    <>
      {tile({
        on: look.title === null,
        label: "No title",
        onTap: () => edit({ title: null }),
        data: { "data-title": "" },
        preview: <span>{name}</span>,
      })}
      {lookChoices("title", look).map((choice) => (
        <span key={choice.id} style={{ display: "contents" }}>
          {tile({
            on: look.title === choice.id,
            label: choice.name,
            onTap: () => edit({ title: choice.id }),
            data: { "data-title": choice.id },
            preview: <HeroName name={name} look={trying(look, { title: choice.id })} />,
            source: look.sources?.[choice.id],
          })}
        </span>
      ))}
    </>
  );
}

/** A colour's dot beside its name: the tile's hero shows it, this names it at a glance. */
function Swatch({ color }: { color: string | null | undefined }): ReactElement | null {
  return color ? <span className="look-swatch" aria-hidden="true" style={{ background: color }} /> : null;
}

/** Her look in the adventure book: her hero up top wearing it, then one shelf at a time. */
export function BookLook({ hero, look, edit }: { hero: ResolvedCharacter; look: HeroLookView; edit: (change: LookChange) => void }): ReactElement {
  const shelves = shelvesFor(hero, look);
  const [chosen, setShelf] = useState<LookShelf>(openShelf);
  const shelf = shelves.some((s) => s.id === chosen) ? chosen : shelves[0]!.id;
  const choose = (next: LookShelf): void => {
    openShelf = next;
    setShelf(next);
  };
  return (
    <section className="book-kit book-look" aria-label={`${hero.name}'s look`} data-testid="look-editor">
      <div className="book-kit__pitch book-look__hero" data-testid="book-look-hero">
        <div className="book-look__portrait" aria-hidden="true">
          <CharacterPortrait backdrop hero={{ ...hero, look }} accent={hero.appearance.accent} lit />
        </div>
        <p className="book-look__name" data-testid="book-look-name">
          <HeroName name={hero.name} look={look} />
        </p>
      </div>

      <div className="book-kit__shelves" role="tablist" aria-label={`Change ${hero.name}'s look`}>
        {shelves.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`book-look-tab-${s.id}`}
            aria-selected={s.id === shelf}
            aria-controls="book-look-shelf"
            className="book-kit__shelf-tab kad-focusable"
            onClick={() => choose(s.id)}
            data-shelf={s.id}
          >
            <Icon name={s.icon} />
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <div className="book-kit__shelf" role="tabpanel" id="book-look-shelf" aria-labelledby={`book-look-tab-${shelf}`}>
        <fieldset className="book-kit__group">
          <legend className="book-kit__legend">{SHELVES.find((s) => s.id === shelf)!.legend}</legend>
          <div className="book-kit__tiles">
            <ShelfTiles
              shelf={shelf}
              hero={hero}
              look={look}
              edit={edit}
              tile={({ on, label, onTap, data, preview, swatch, source }) => (
                <button type="button" className={`book-kit__tile book-look__tile kad-focusable${shelf === "coat" ? " book-look__tile--color" : ""}`} aria-pressed={on} onClick={onTap} {...data}>
                  <span className="book-kit__tile-art book-look__tile-art" aria-hidden="true">
                    {preview}
                  </span>
                  <span className="book-kit__tile-name">
                    <Swatch color={swatch} />
                    {label}
                  </span>
                  {source ? <span className="book-look__source" data-testid="book-look-source">{source}</span> : null}
                  {on ? (
                    <span className="book-kit__tile-check" aria-hidden="true">
                      <Icon name="check" />
                    </span>
                  ) : null}
                </button>
              )}
            />
          </div>
        </fieldset>
      </div>
    </section>
  );
}

/** A look as the table shows it: what she carries, or nothing chosen yet. */
export function tableLook(member: PartyMember): HeroLookView {
  return member.character.look ?? { revision: 0, coat: null, nameplate: null, title: null, unlocked: [] };
}

/** Her look at the table (§8.2): the compact editor in the phone's camp panel, downtime only, no limit. */
export function LookEditor({ member, held, dispatch }: { member: PartyMember; held: boolean; dispatch: (intent: ClientIntent) => void }): ReactElement {
  const hero = member.character;
  const look = tableLook(member);
  const base = useId();
  const edit = (change: LookChange): void => dispatch({ type: "LOOK_EDIT", characterId: hero.id, revision: look.revision, ...change });
  const tile: Tile = ({ on, label, onTap, data, preview, swatch }) => (
    <button type="button" className="camp-option look-option kad-focusable" aria-pressed={on} disabled={held} onClick={onTap} {...data}>
      <span className={`camp-option__art look-option__art${"data-coat" in data ? " look-option__art--color" : ""}`} aria-hidden="true">
        {preview}
      </span>
      <span className="camp-option__label">
        <Swatch color={swatch} />
        {label}
      </span>
    </button>
  );
  const shelves = shelvesFor(hero, look);
  return (
    <section className="camp-panel__section" aria-labelledby={`${base}-look`} data-testid="look-editor">
      <h3 className="camp-panel__heading" id={`${base}-look`}>
        <Icon name="star" />
        <span>{`${hero.name}'s look`}</span>
      </h3>
      <p className="camp-panel__note kad-muted">{shelves.some((s) => s.id === "coat") ? "Your hero and your name on the TV, as often as you like." : "Your name on the TV, as often as you like."}</p>
      {shelves.map((s) => (
        <fieldset key={s.id} className="camp-panel__group">
          <legend>{s.label}</legend>
          <div className="camp-panel__options">
            <ShelfTiles shelf={s.id} hero={hero} look={look} edit={edit} tile={tile} />
          </div>
        </fieldset>
      ))}
    </section>
  );
}
