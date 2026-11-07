/**
 * Her own kit, dressed in the adventure book (docs/camp.md §7; CampPane.tsx).
 *
 * A dressing room rather than a form: her pitch up top (her tent in her
 * colour, its decorations hung on it, her bedroll and pack beside it and her
 * buddy at her feet) changes the moment she taps, and one shelf at a time
 * below it (Tent, Bedroll, Colour, Decorations, Buddy, as gold pills the way
 * the Field Guide's sections are) holds big painted tiles to tap. Every tap
 * saves itself, behind the scenes (store/book-kit-sync.ts): nothing here says
 * "saving".
 *
 * The table's phone panel keeps its own compact editor (CampPanel.tsx
 * `KitEditor`), fitted to a minute between scenes; this one has room to play.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { KIT_COLORS, kitAccent, kitDecorationChoices, kitTentChoices } from "@kad/shared";
import type { CampFriendCard, ClientIntent, HeroKitView, ResolvedCharacter } from "@kad/shared";
import { Icon } from "./icons";
import { COLOR_NAMES, FriendArt } from "./CampPanel";
import { CampBedroll, CampTent } from "../world/CampBedroll";
import { TentStandIn } from "../world/StillCamp";
import { CAMP_KIT_STYLES, campKitStyle, type CampKitStyle } from "../world/camp-kit-art";
import { DECORATION_ART, KIT_RULES, kitName, tentArt } from "../world/camp-scene";
import "./BookKit.css";

type KitChange = Omit<Extract<ClientIntent, { type: "KIT_EDIT" }>, "type" | "characterId" | "revision">;

export type KitShelf = "tent" | "bedroll" | "color" | "decor" | "buddy";

const SHELVES: readonly { id: KitShelf; label: string; icon: string }[] = [
  { id: "tent", label: "Tent", icon: "rest" },
  { id: "bedroll", label: "Bedroll", icon: "bag" },
  { id: "color", label: "Color", icon: "gem" },
  { id: "decor", label: "Decorate", icon: "charm" },
  { id: "buddy", label: "Buddy", icon: "heart" },
];

/** The shelf open, for the life of the page, as the Field Guide keeps its section. */
let openShelf: KitShelf = "tent";

/** A decoration's painting, by id. */
function decorationUrl(id: string): string | null {
  const art = DECORATION_ART.find((d) => d.id === id);
  return art?.path ? `/assets/${art.path}` : null;
}

export function BookKit({ hero, kit, friends, edit }: { hero: ResolvedCharacter; kit: HeroKitView; friends: readonly CampFriendCard[]; edit: (change: KitChange) => void }): ReactElement {
  const [shelf, setShelf] = useState<KitShelf>(openShelf);
  const choose = (next: KitShelf): void => {
    openShelf = next;
    setShelf(next);
  };
  const shelves = SHELVES.filter((s) => s.id !== "buddy" || friends.length > 0);
  const shown = shelves.some((s) => s.id === shelf) ? shelf : "tent";

  const style = campKitStyle(hero.id, kit.style);
  const accent = kitAccent(kit.color, hero.appearance.accent);
  const tent = tentArt(kit.tent, style)?.id ?? null;
  const slots = kit.slots.length > 0 ? kit.slots : [null, null];
  const buddy = friends.find((f) => f.id === kit.buddy) ?? null;

  // The pitch gives a little bounce whenever something on it changes (not with reduced motion: BookKit.css).
  const look = `${tent ?? ""}|${style}|${accent}|${slots.join(",")}|${buddy?.id ?? ""}`;
  const [bounce, setBounce] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setBounce((n) => n + 1);
  }, [look]);

  return (
    <section className="book-kit" aria-label={`${hero.name}'s kit`} data-testid="kit-editor">
      <div className="book-kit__pitch" data-testid="book-kit-pitch" style={{ ["--kit-accent" as string]: accent }}>
        <div key={bounce} className={`book-kit__stage${bounce > 0 ? " is-bouncing" : ""}`} aria-hidden="true">
          <div className="book-kit__tent">
            {tent ? <CampTent tent={tent} accent={accent} fallback={<TentStandIn accent={accent} decorations={0} />} /> : <TentStandIn accent={accent} decorations={0} />}
            {slots.map((slot, i) => {
              const url = slot ? decorationUrl(slot) : null;
              return url ? <img key={i} className={`book-kit__hung book-kit__hung--${String(i)}`} src={url} alt="" /> : null;
            })}
          </div>
          <div className="book-kit__bedroll">{Object.hasOwn(CAMP_KIT_STYLES, style) ? <CampBedroll style={style} accent={accent} /> : null}</div>
          {buddy ? (
            <div className="book-kit__buddy">
              <FriendArt card={buddy} />
            </div>
          ) : null}
        </div>
        <p className="book-kit__caption">{`${hero.name}'s pitch`}</p>
      </div>

      <div className="book-kit__shelves" role="tablist" aria-label={`Change ${hero.name}'s kit`}>
        {shelves.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`book-kit-tab-${s.id}`}
            aria-selected={s.id === shown}
            aria-controls="book-kit-shelf"
            className="book-kit__shelf-tab kad-focusable"
            onClick={() => choose(s.id)}
            data-shelf={s.id}
          >
            <Icon name={s.icon} />
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <div className="book-kit__shelf" role="tabpanel" id="book-kit-shelf" aria-labelledby={`book-kit-tab-${shown}`}>
        {shown === "tent" ? (
          <Tiles legend="Your tent">
            {kitTentChoices(KIT_RULES, kit.unlocked).map((id) => (
              <Tile key={id} on={tent === id} label={kitName(id, "tent")} onTap={() => edit({ tent: id })} data={{ "data-tent": id }}>
                <CampTent tent={id} accent={accent} fallback={<TentStandIn accent={accent} decorations={0} />} />
              </Tile>
            ))}
          </Tiles>
        ) : null}

        {shown === "bedroll" ? (
          <Tiles legend="Your bedroll and pack">
            {KIT_RULES.styles.map(({ id }) => (
              <Tile key={id} on={style === id} label={kitName(id, "style")} onTap={() => edit({ style: id })} data={{ "data-style": id }}>
                {Object.hasOwn(CAMP_KIT_STYLES, id) ? <CampBedroll style={id as CampKitStyle} accent={accent} /> : null}
              </Tile>
            ))}
          </Tiles>
        ) : null}

        {shown === "color" ? (
          <fieldset className="book-kit__group">
            <legend className="book-kit__legend">Your color</legend>
            <div className="book-kit__swatches">
              {[null, ...KIT_COLORS].map((c) => {
                const name = c === null ? "My color" : (COLOR_NAMES[c] ?? c);
                return (
                  <button
                    key={c ?? "own"}
                    type="button"
                    className="book-kit__swatch kad-focusable"
                    aria-pressed={kit.color === c}
                    aria-label={name}
                    style={{ ["--swatch" as string]: kitAccent(c, hero.appearance.accent) }}
                    onClick={() => edit({ color: c })}
                  >
                    <span className="book-kit__swatch-dot" aria-hidden="true">
                      {c === null ? <Icon name="star" /> : null}
                    </span>
                    <span className="book-kit__swatch-name" aria-hidden="true">
                      {name}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {shown === "decor" ? <Decorate slots={slots} choices={kitDecorationChoices(KIT_RULES, kit.unlocked)} edit={edit} /> : null}

        {shown === "buddy" ? (
          <Tiles legend={`Out at camp with ${hero.name}`}>
            <Tile on={!buddy} label="Everyone takes turns" onTap={() => edit({ buddy: null })} data={{ "data-buddy": "" }}>
              <Icon name="crew" size="2.2em" />
            </Tile>
            {friends.map((card) => (
              <Tile key={card.id} on={buddy?.id === card.id} label={card.name} onTap={() => edit({ buddy: card.id })} data={{ "data-buddy": card.id }}>
                <FriendArt card={card} />
              </Tile>
            ))}
          </Tiles>
        ) : null}
      </div>
    </section>
  );
}

function Tiles({ legend, children }: { legend: string; children: React.ReactNode }): ReactElement {
  return (
    <fieldset className="book-kit__group">
      <legend className="book-kit__legend">{legend}</legend>
      <div className="book-kit__tiles">{children}</div>
    </fieldset>
  );
}

function Tile({ on, label, onTap, data, children }: { on: boolean; label: string; onTap: () => void; data?: Record<string, string>; children: React.ReactNode }): ReactElement {
  return (
    <button type="button" className="book-kit__tile kad-focusable" aria-pressed={on} onClick={onTap} {...data}>
      <span className="book-kit__tile-art" aria-hidden="true">
        {children}
      </span>
      <span className="book-kit__tile-name">{label}</span>
      {on ? (
        <span className="book-kit__tile-check" aria-hidden="true">
          <Icon name="check" />
        </span>
      ) : null}
    </button>
  );
}

/**
 * Her tent's two spots, and the decorations to hang there: tap a spot, then
 * a decoration. One decoration hangs in one spot, so hanging it here takes it
 * from the other, and the next empty spot is picked for the next tap.
 */
function Decorate({ slots, choices, edit }: { slots: readonly (string | null)[]; choices: readonly string[]; edit: (change: KitChange) => void }): ReactElement {
  const [spot, setSpot] = useState(() => Math.max(0, slots.indexOf(null)));
  const at = Math.min(spot, slots.length - 1);
  const hang = (id: string | null): void => {
    const next = [...slots];
    next[at] = id;
    for (let j = 0; j < next.length; j++) if (j !== at && id !== null && next[j] === id) next[j] = null;
    edit({ slots: next });
    const empty = next.indexOf(null);
    if (id !== null && empty >= 0) setSpot(empty);
  };
  return (
    <div className="book-kit__decorate">
      <div className="book-kit__spots" role="radiogroup" aria-label="Which spot on your tent">
        {slots.map((slot, i) => {
          const url = slot ? decorationUrl(slot) : null;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={i === at}
              className="book-kit__spot kad-focusable"
              onClick={() => setSpot(i)}
              data-spot={String(i)}
            >
              <span className="book-kit__spot-art" aria-hidden="true">
                {url ? <img src={url} alt="" /> : <Icon name="plus" />}
              </span>
              <span className="book-kit__spot-name">{slot ? kitName(slot, "decoration") : `Spot ${String(i + 1)}`}</span>
            </button>
          );
        })}
      </div>
      <Tiles legend={`Hang something in spot ${String(at + 1)}`}>
        <Tile on={slots[at] === null} label="Nothing" onTap={() => hang(null)} data={{ "data-decoration": "" }}>
          <Icon name="close" size="1.8em" />
        </Tile>
        {choices.map((id) => {
          const url = decorationUrl(id);
          return (
            <Tile key={id} on={slots[at] === id} label={kitName(id, "decoration")} onTap={() => hang(id)} data={{ "data-decoration": id }}>
              {url ? <img src={url} alt="" /> : <Icon name="charm" size="2em" />}
            </Tile>
          );
        })}
      </Tiles>
    </div>
  );
}
