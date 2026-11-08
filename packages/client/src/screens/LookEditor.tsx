/**
 * Her look's shelves (docs/hero-looks.md §8; #664, #666; two parts and
 * specials, owner 2026-11-07): her two colours, her special, the Nameplate
 * and the Title a kid picks for her hero, as tiles that show her own hero (or
 * her own name) wearing each one.
 *
 *   - `BookLook`: the adventure book's dressing room (LookPane.tsx), the same
 *     experience as the kit's (BookKit.tsx): her hero standing on the same
 *     little stage her pitch stands on, full size, wearing the look the moment
 *     she taps (with the pitch's little bounce), her nameplate and title under
 *     her as the pitch's caption, then one shelf at a time of the same tiles.
 *     Every tap is a save, behind the scenes; nothing says "saving".
 *   - `LookEditor`: the compact editor in her phone's camp panel at the table,
 *     during downtime (the lobby and rests), next to the kit's. Each tap is a
 *     `LOOK_EDIT` naming the look's revision; the TV shows it at once.
 *
 * Only what she holds is offered (hero-name.ts `lookChoices`): a starter, or
 * one she has earned, and for a colour only her species' own for that part.
 * Earned looks she has not got yet are not shown; nothing is a locked tease.
 * The chosen tile is marked by more than colour (a check and `aria-pressed`).
 *
 * **Her colours** are two shelves, named for her species' two parts
 * (coat-masks.ts `coatPartLabel`): "Coat" and "Mane" for a unicorn, "Fur"
 * and "Skin" for a Bigfoot. Each tile shows her hero wearing it, her other
 * colour kept, so she sees the pair. Any pair is hers: nothing is ruled out
 * for clashing. Both are offered only once one of her paintings has a coat
 * mask (coat-masks.ts): before that every tile would show her exactly as
 * painted, which is no choice at all.
 *
 * **Special** (sparkles, gold) shows only once she has earned one. Gold
 * hides her colours while she wears it; the colour tiles still show them.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { PLAIN_NAMEPLATE } from "@kad/shared";
import type { ClientIntent, CoatPart, HeroLookView, LookEdit, PartyMember, ResolvedCharacter } from "@kad/shared";
import { Icon } from "./icons";
import { HeroName } from "./HeroName";
import { CharacterPortrait, portraitTintsOf } from "./CharacterPortrait";
import { LOOKS, heroNameStyle, lookChoices } from "../world/hero-name";
import { HERO_ART_PLACES, heroPaintingUrl, type HeroArtSubject } from "../world/hero-art";
import { HeroImage, useCoatsReady } from "../world/hero-art-dom";
import { coatPartLabel, hasCoatMask } from "../world/coat-masks";
import "./LookEditor.css";

/** One tap on a shelf: the one field it changes. */
export type LookChange = LookEdit;

/** A shelf, named for the look field it changes. */
export type LookShelf = "coat" | "accent" | "special" | "nameplate" | "title";

interface ShelfDef {
  id: LookShelf;
  label: string;
  icon: string;
  legend: string;
}

/** The colour shelves' part, by shelf. */
const PART_OF: Partial<Record<LookShelf, CoatPart>> = { coat: "main", accent: "accent" };

/** Every shelf a hero of this species may have, in order, labelled for her parts. */
function allShelves(hero: Pick<HeroArtSubject, "species">): ShelfDef[] {
  const part = (part: CoatPart): { label: string; legend: string } => {
    const label = coatPartLabel(hero.species, part);
    return { label, legend: `Your ${label.toLowerCase()} color` };
  };
  return [
    { id: "coat", icon: "gem", ...part("main") },
    { id: "accent", icon: "spark", ...part("accent") },
    { id: "special", label: "Special", icon: "surprise", legend: "Your special" },
    { id: "nameplate", label: "Nameplate", icon: "scroll", legend: "Your nameplate" },
    { id: "title", label: "Title", icon: "star", legend: "Your title" },
  ];
}

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
 * Whether her colour shelves have anything to show her: a painting of her
 * (her world figure or her portrait) with a mask to show a colour on. Each
 * shelf also needs colours of her species' own for its part.
 */
export function colorShelfShows(hero: HeroArtSubject, look: HeroLookView, field: "coat" | "accent" = "coat"): boolean {
  if (lookChoices(field, look, hero.species).length === 0) return false;
  return HERO_ART_PLACES.some((place) => hasCoatMask(heroPaintingUrl(hero, place)));
}

/** The shelves she has, in order: colours once masked, a special once earned. */
function shelvesFor(hero: HeroArtSubject, look: HeroLookView): ShelfDef[] {
  return allShelves(hero).filter((s) => {
    if (s.id === "coat" || s.id === "accent") return colorShelfShows(hero, look, s.id);
    if (s.id === "special") return lookChoices("special", look).length > 0;
    return true;
  });
}

type Tile = (props: { on: boolean; label: string; onTap: () => void; data: Record<string, string>; preview: ReactElement; swatch?: string | null; source?: string | undefined; pending?: boolean }) => ReactElement;

/** What a colour tile shows: her colours, not gold over them: the pair is what she is picking. */
function colourChange(shelf: "coat" | "accent", look: HeroLookView, id: string | null): LookChange {
  return { [shelf]: id, special: look.special && LOOKS.specials.find((x) => x.id === look.special)?.effect.kind === "gilded" ? null : look.special };
}

/** The changes a shelf's painted tiles try on her hero, in order (none for a shelf of names). */
function paintedChanges(shelf: LookShelf, look: HeroLookView, species: HeroArtSubject["species"]): LookChange[] {
  if (shelf === "coat" || shelf === "accent") {
    return [colourChange(shelf, look, null), ...lookChoices(shelf, look, species).map((c) => colourChange(shelf, look, c.id))];
  }
  if (shelf === "special") return [{ special: null }, ...lookChoices("special", look).map((c): LookChange => ({ special: c.id }))];
  return [];
}

/**
 * The tiles of one shelf: each her hero, or her name, wearing that choice.
 *
 * A tile of her hero is a tinting pass of its own, and passes run one at a
 * time, so left alone the tiles would repaint one by one while she watches.
 * Instead the shelf makes all of its tints first and shows them together: the
 * tiles wait (`pending`), then every one appears at once. When her look
 * changes, the tiles keep what they show until the new set is all ready, then
 * swap together. Give the shelf a `key` per shelf, so each reveals afresh.
 */
function ShelfTiles({ shelf, hero, look, edit, tile }: {
  shelf: LookShelf;
  hero: HeroArtSubject & { name: string; appearance: { accent: string } };
  look: HeroLookView;
  edit: (change: LookChange) => void;
  tile: Tile;
}): ReactElement {
  const name = hero.name;
  // Each tile's colour and, for a sparkle special, the figure its sparkles are clipped by.
  const requests = paintedChanges(shelf, look, hero.species).flatMap((change) =>
    portraitTintsOf({ ...hero, look: { coat: look.coat, accent: look.accent, special: look.special, ...change } }),
  );
  const setKey = requests.map((r) => r?.key ?? "").join("\n");
  const readyFor = useCoatsReady(requests);
  const [shown, setShown] = useState(look);
  const [revealed, setRevealed] = useState(requests.length === 0);
  const worn = `${look.coat ?? ""}|${look.accent ?? ""}|${look.special ?? ""}`;
  useEffect(() => {
    if (readyFor !== setKey) return;
    setShown(look);
    setRevealed(true);
    // `look` is read through `worn` (what the previews wear), not its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyFor, setKey, worn]);
  const pending = !revealed;
  const wearing = (change: LookChange): ReactElement => (
    <CharacterPortrait hero={{ ...hero, look: { coat: shown.coat, accent: shown.accent, special: shown.special, ...change } }} accent={hero.appearance.accent} size="100%" />
  );
  const part = PART_OF[shelf];
  if (shelf === "coat" || shelf === "accent") {
    const colour = (id: string | null): LookChange => colourChange(shelf, shown, id);
    const attr = `data-${shelf}`;
    return (
      <>
        {tile({
          on: look[shelf] === null,
          label: "Normal",
          onTap: () => edit({ [shelf]: null }),
          data: { [attr]: "", "data-part": part! },
          preview: wearing(colour(null)),
          swatch: null,
          pending,
        })}
        {lookChoices(shelf, look, hero.species).map((choice) => (
          <span key={choice.id} style={{ display: "contents" }}>
            {tile({
              on: look[shelf] === choice.id,
              label: choice.name,
              onTap: () => edit({ [shelf]: choice.id }),
              data: { [attr]: choice.id, "data-part": part! },
              preview: wearing(colour(choice.id)),
              swatch: LOOKS.coats.find((c) => c.id === choice.id)?.color ?? null,
              source: look.sources?.[choice.id],
              pending,
            })}
          </span>
        ))}
      </>
    );
  }
  if (shelf === "special") {
    return (
      <>
        {tile({
          on: look.special === null,
          label: "None",
          onTap: () => edit({ special: null }),
          data: { "data-special": "" },
          preview: wearing({ special: null }),
          pending,
        })}
        {lookChoices("special", look).map((choice) => (
          <span key={choice.id} style={{ display: "contents" }}>
            {tile({
              on: look.special === choice.id,
              label: choice.name,
              onTap: () => edit({ special: choice.id }),
              data: { "data-special": choice.id },
              preview: wearing({ special: choice.id }),
              source: look.sources?.[choice.id],
              pending,
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
                preview: <NamePreview><HeroName name={name} look={trying(look, change)} style={{ ...heroNameStyle(trying(look, change)), title: null }} /></NamePreview>,
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
        preview: <NamePreview><HeroName name={name} look={trying(look, { title: null })} /></NamePreview>,
      })}
      {lookChoices("title", look).map((choice) => (
        <span key={choice.id} style={{ display: "contents" }}>
          {tile({
            on: look.title === choice.id,
            label: choice.name,
            onTap: () => edit({ title: choice.id }),
            data: { "data-title": choice.id },
            preview: <NamePreview><HeroName name={name} look={trying(look, { title: choice.id })} /></NamePreview>,
            source: look.sources?.[choice.id],
          })}
        </span>
      ))}
    </>
  );
}

/**
 * A name on a tile, plain or styled: one wrapper whatever HeroName returns (a
 * bare name has no frame and no title, and so no element of its own), so the
 * tile's one-line, shrink-to-fit rule (LookEditor.css) reaches every one.
 */
function NamePreview({ children }: { children: ReactNode }): ReactElement {
  return <span className="look-name-preview" data-testid="look-name-preview">{children}</span>;
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
  // Her stage gives the pitch's little bounce whenever her look changes (not with reduced motion: BookKit.css).
  const worn = `${look.coat ?? ""}|${look.accent ?? ""}|${look.special ?? ""}|${look.nameplate ?? ""}|${look.title ?? ""}`;
  const [bounce, setBounce] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setBounce((n) => n + 1);
  }, [worn]);
  return (
    <section className="book-kit book-look" aria-label={`${hero.name}'s look`} data-testid="look-editor">
      <div className="book-kit__pitch book-look__pitch" data-testid="book-look-hero">
        <div key={bounce} className={`book-kit__stage book-look__stage${bounce > 0 ? " is-bouncing" : ""}`} aria-hidden="true">
          <HeroImage hero={{ ...hero, look }} place="world" holdUntilTinted className="book-look__figure" alt="" data-testid="book-look-figure" />
        </div>
        <p className="book-kit__caption book-look__caption" data-testid="book-look-name">
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
          <legend className="book-kit__legend">{shelves.find((s) => s.id === shelf)!.legend}</legend>
          <div className="book-kit__tiles">
            <ShelfTiles
              key={shelf}
              shelf={shelf}
              hero={hero}
              look={look}
              edit={edit}
              tile={({ on, label, onTap, data, preview, swatch, source, pending }) => (
                <button type="button" className={`book-kit__tile book-look__tile kad-focusable${shelf === "coat" || shelf === "accent" || shelf === "special" ? " book-look__tile--color" : ""}`} aria-pressed={on} onClick={onTap} {...data}>
                  <span className={`book-kit__tile-art book-look__tile-art${pending ? " look-art--pending" : ""}`} aria-hidden="true" style={{ ["--name-len" as string]: String(Math.max(hero.name.length, 6)) }}>
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
  return member.character.look ?? { revision: 0, coat: null, accent: null, special: null, nameplate: null, title: null, unlocked: [] };
}

/** Her look at the table (§8.2): the compact editor in the phone's camp panel, downtime only, no limit. */
export function LookEditor({ member, held, dispatch }: { member: PartyMember; held: boolean; dispatch: (intent: ClientIntent) => void }): ReactElement {
  const hero = member.character;
  const look = tableLook(member);
  const base = useId();
  const edit = (change: LookChange): void => dispatch({ type: "LOOK_EDIT", characterId: hero.id, revision: look.revision, ...change });
  const tile: Tile = ({ on, label, onTap, data, preview, swatch, pending }) => (
    <button type="button" className="camp-option look-option kad-focusable" aria-pressed={on} disabled={held} onClick={onTap} {...data}>
      <span className={`camp-option__art look-option__art${pending ? " look-art--pending" : ""}${"data-coat" in data || "data-accent" in data || "data-special" in data ? " look-option__art--color" : ""}`} aria-hidden="true">
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
      <p className="camp-panel__note kad-muted">{shelves.some((s) => s.id === "coat" || s.id === "accent" || s.id === "special") ? "Your hero and your name on the TV, as often as you like." : "Your name on the TV, as often as you like."}</p>
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
