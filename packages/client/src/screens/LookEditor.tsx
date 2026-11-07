/**
 * Her look's shelves (docs/hero-looks.md §8; #664): the Nameplate and Title a
 * kid picks for her hero, as tiles that show her own name wearing each one.
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
 * one she has earned. Earned looks she has not got yet are not shown; nothing
 * is a locked tease. The chosen tile is marked by more than colour (a check
 * and `aria-pressed`).
 *
 * The Color shelf (`coat`) arrives with phase 2 (#666): add it to `SHELVES`
 * with `lookChoices("coat", look, species)`, and `LookChange` already carries
 * `coat`.
 */

import { useId, useState } from "react";
import type { ReactElement } from "react";
import { PLAIN_NAMEPLATE } from "@kad/shared";
import type { ClientIntent, HeroLookView, LookEdit, PartyMember, ResolvedCharacter } from "@kad/shared";
import { Icon } from "./icons";
import { HeroName } from "./HeroName";
import { CharacterPortrait } from "./CharacterPortrait";
import { heroNameStyle, lookChoices } from "../world/hero-name";
import "./LookEditor.css";

/** One tap on a shelf: the one field it changes. */
export type LookChange = LookEdit;

export type LookShelf = "nameplate" | "title";

const SHELVES: readonly { id: LookShelf; label: string; icon: string }[] = [
  { id: "nameplate", label: "Nameplate", icon: "scroll" },
  { id: "title", label: "Title", icon: "star" },
];

/** The shelf open, for the life of the page, as the kit's dressing room keeps its own. */
let openShelf: LookShelf = "nameplate";

/** The frame she wears: plain when she has chosen none. */
function frameOf(look: HeroLookView): string {
  return look.nameplate ?? PLAIN_NAMEPLATE;
}

/** Her look with one field changed, for a tile's preview of it. */
function trying(look: HeroLookView, change: LookChange): HeroLookView {
  return { ...look, ...change };
}

/** The tiles of one shelf: each her name wearing that choice. */
function ShelfTiles({ shelf, name, look, edit, tile }: {
  shelf: LookShelf;
  name: string;
  look: HeroLookView;
  edit: (change: LookChange) => void;
  tile: (props: { on: boolean; label: string; onTap: () => void; data: Record<string, string>; preview: ReactElement }) => ReactElement;
}): ReactElement {
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
          })}
        </span>
      ))}
    </>
  );
}

/** Her look in the adventure book: her hero up top wearing it, then one shelf at a time. */
export function BookLook({ hero, look, edit }: { hero: ResolvedCharacter; look: HeroLookView; edit: (change: LookChange) => void }): ReactElement {
  const [shelf, setShelf] = useState<LookShelf>(openShelf);
  const choose = (next: LookShelf): void => {
    openShelf = next;
    setShelf(next);
  };
  return (
    <section className="book-kit book-look" aria-label={`${hero.name}'s look`} data-testid="look-editor">
      <div className="book-kit__pitch book-look__hero" data-testid="book-look-hero">
        <div className="book-look__portrait" aria-hidden="true">
          <CharacterPortrait backdrop species={hero.species} accent={hero.appearance.accent} tier={hero.tier} characterClass={hero.class} lit />
        </div>
        <p className="book-look__name" data-testid="book-look-name">
          <HeroName name={hero.name} look={look} />
        </p>
      </div>

      <div className="book-kit__shelves" role="tablist" aria-label={`Change ${hero.name}'s look`}>
        {SHELVES.map((s) => (
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
          <legend className="book-kit__legend">{shelf === "nameplate" ? "Your nameplate" : "Your title"}</legend>
          <div className="book-kit__tiles">
            <ShelfTiles
              shelf={shelf}
              name={hero.name}
              look={look}
              edit={edit}
              tile={({ on, label, onTap, data, preview }) => (
                <button type="button" className="book-kit__tile book-look__tile kad-focusable" aria-pressed={on} onClick={onTap} {...data}>
                  <span className="book-kit__tile-art book-look__tile-art" aria-hidden="true">
                    {preview}
                  </span>
                  <span className="book-kit__tile-name">{label}</span>
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
  const tile = ({ on, label, onTap, data, preview }: { on: boolean; label: string; onTap: () => void; data: Record<string, string>; preview: ReactElement }): ReactElement => (
    <button type="button" className="camp-option look-option kad-focusable" aria-pressed={on} disabled={held} onClick={onTap} {...data}>
      <span className="camp-option__art look-option__art" aria-hidden="true">
        {preview}
      </span>
      <span className="camp-option__label">{label}</span>
    </button>
  );
  return (
    <section className="camp-panel__section" aria-labelledby={`${base}-look`} data-testid="look-editor">
      <h3 className="camp-panel__heading" id={`${base}-look`}>
        <Icon name="star" />
        <span>{`${hero.name}'s look`}</span>
      </h3>
      <p className="camp-panel__note kad-muted">Your name on the TV, as often as you like.</p>
      {SHELVES.map((s) => (
        <fieldset key={s.id} className="camp-panel__group">
          <legend>{s.label}</legend>
          <div className="camp-panel__options">
            <ShelfTiles shelf={s.id} name={hero.name} look={look} edit={edit} tile={tile} />
          </div>
        </fieldset>
      ))}
    </section>
  );
}
