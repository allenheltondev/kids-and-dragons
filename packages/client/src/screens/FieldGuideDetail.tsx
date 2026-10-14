import type { ReactNode } from "react";
import { speak } from "@kad/shared";
import type { FieldGuide as FieldGuideData, FieldGuideEntry } from "@kad/shared";
import { selectGuideEntry } from "../store/player-navigation";
import { useFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import type { FieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { markFieldGuideSeen } from "../store/field-guide-seen";
import { useParty } from "../store";
import { Button } from "../ui/Button";
import { Icon } from "./icons";

/** Canon `scale` values in kid words (canon/creatures.yaml controlled_values). */
export const SCALE_LABELS: Readonly<Record<string, string>> = {
  tiny: "Fits in cupped hands",
  tiny_to_small: "Between hands and knee height",
  small: "Knee height",
  small_to_medium: "Between knee and waist height",
  medium: "About as big as a person",
  medium_to_large: "Between a person and a horse",
  large: "As big as a horse or a wagon",
  very_large: "Fills a whole clearing",
  colossal: "As big as the landscape",
  variable: "Size changes",
};

/** Canon `danger_level` values in kid words. */
export const DANGER_LABELS: Readonly<Record<string, string>> = {
  none: "Not dangerous",
  low: "Mostly harmless",
  moderate: "Be careful",
  high: "Very dangerous",
  legendary: "Legendary",
  unknown: "A mystery",
};

/** Friendly names for tip kinds (encounter resolutions); unknown kinds are tidied. */
export const TIP_LABELS: Readonly<Record<string, string>> = {
  calm: "Calm it",
  distract: "Distract it",
  distraction: "Distract it",
  escape: "Slip away",
  befriend: "Make friends",
  trade: "Trade",
  bargain: "Bargain",
  sneak: "Sneak past",
};

const CATEGORY_ICON: Readonly<Record<string, string>> = {
  creatures: "flame", peoples: "party", folk: "heart", places: "leaf", factions: "shield",
};

const prettify = (kind: string) => {
  const s = kind.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** The detail screen for one discovered entry. Renders nothing about an undiscovered one. */
export function FieldGuideDetail({ guide, entryId }: { guide: FieldGuideData; entryId: string }) {
  const discoveries = useFieldGuideDiscoveries();
  const party = useParty();
  const entry = guide.entries[entryId];
  const find = discoveries[entryId];
  if (!entry || !find) return null;

  const finder = party.find((m) => m.playerId === find.firstFoundBy)?.character.name;
  const lore = entry.lore;
  const place = entry.place;
  const danger = entry.danger_level ? (DANGER_LABELS[entry.danger_level] ?? prettify(entry.danger_level)) : undefined;
  const size = entry.scale ? (SCALE_LABELS[entry.scale] ?? prettify(entry.scale)) : undefined;
  const link = (id: string, title: string): ReactNode => (
    <EntryLink guide={guide} discoveries={discoveries} id={id} title={title} />
  );

  const spoken = [
    entry.title, lore?.hook, entry.short_description, lore?.story, place?.origin, place?.recorded_history,
    place?.cultural_significance,
  ].filter((s): s is string => !!s).join(". ");

  return (
    <>
      <div className="field-guide__body kad-scroll field-guide__detail" data-testid="guide-detail">
        <header className="fgd__header">
          <span className="fgd__art" aria-hidden="true">
            {entry.art ? <img src={entry.art} alt="" /> : <Icon name={CATEGORY_ICON[entry.category] ?? "leaf"} />}
          </span>
          <h3 className="field-guide__detail-title">{entry.title}</h3>
          {lore?.hook && <p className="fgd__hook">{lore.hook}</p>}
          {entry.short_description && <p className="fgd__short">{entry.short_description}</p>}
          {(danger || size) && (
            <ul className="fgd__badges" aria-label="At a glance">
              {danger && <li className="fgd__badge" data-danger={entry.danger_level}>{danger}</li>}
              {size && <li className="fgd__badge">{size}</li>}
            </ul>
          )}
          <Button variant="secondary" size="md" icon={<Icon name="sound" />}
            onClick={() => speak(spoken, { source: "ui", interrupt: true })}>
            Read aloud
          </Button>
        </header>

        {lore && (
          <>
            <Text title="Story" text={lore.story} />
            <List title="What they do for fun" items={lore.pastimes} />
            <Text title="With others" text={lore.social} />
            <Opinions title="Likes" items={lore.likes} link={link} />
            <Opinions title="Dislikes" items={lore.dislikes} link={link} />
          </>
        )}
        <Opinions title="Who likes them" items={entry.likedBy} link={link} />
        <Opinions title="Who doesn't" items={entry.dislikedBy} link={link} />

        {place && (
          <>
            <Text title="Where it came from" text={place.origin} />
            <Text title="History" text={place.recorded_history} />
            <Text title="What it means to people" text={place.cultural_significance} />
            <List title="Folk say…" items={place.common_beliefs} />
            <List title="Some say… others don't" items={place.disputed_beliefs} />
            <Section title="Neighbours" show={place.regional_relationships.length > 0}>
              <ul className="fgd__list">
                {place.regional_relationships.map((r) => (
                  <li key={r.place}><strong>{link(r.place, r.title)}</strong> {r.relationship}</li>
                ))}
              </ul>
            </Section>
          </>
        )}

        <Section title="Tips" show={!!entry.tips && entry.tips.length > 0}>
          <ul className="fgd__list">
            {entry.tips?.map((t, i) => (
              <li key={`${t.kind}-${String(i)}`}><strong>{TIP_LABELS[t.kind] ?? prettify(t.kind)}.</strong> {t.text}</li>
            ))}
          </ul>
        </Section>

        <p className="fgd__found">
          {finder ? `First found by ${finder}` : "First found by someone in your household"}
        </p>
      </div>
      <Button className="field-guide__back" variant="secondary" size="md" block
        icon={<Icon name="back" />} onClick={() => selectGuideEntry(null)}>
        Back to the guide
      </Button>
    </>
  );
}

function Section({ title, show, children }: { title: string; show: boolean; children: ReactNode }) {
  if (!show) return null;
  return <section className="fgd__section"><h4>{title}</h4>{children}</section>;
}

function Text({ title, text }: { title: string; text?: string }) {
  return <Section title={title} show={!!text}><p>{text}</p></Section>;
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <Section title={title} show={items.length > 0}>
      <ul className="fgd__list">{items.map((s, i) => <li key={String(i)}>{s}</li>)}</ul>
    </Section>
  );
}

function Opinions({ title, items, link }: {
  title: string;
  items?: ReadonlyArray<{ of: string; title: string; because: string }>;
  link: (id: string, title: string) => ReactNode;
}) {
  return (
    <Section title={title} show={!!items && items.length > 0}>
      <ul className="fgd__list">
        {items?.map((o) => <li key={o.of}><strong>{link(o.of, o.title)}</strong> {o.because}</li>)}
      </ul>
    </Section>
  );
}

/**
 * A cross-link. Discovered: opens that entry. In the guide but undiscovered:
 * "???" (the real title is never rendered). Not in the guide: plain text.
 */
function EntryLink({ guide, discoveries, id, title }: {
  guide: FieldGuideData; discoveries: FieldGuideDiscoveries; id: string; title: string;
}) {
  const target: FieldGuideEntry | undefined = guide.entries[id];
  if (!target) return <>{title}</>;
  if (!discoveries[id]) return <span className="fgd__unknown">???</span>;
  return (
    <button type="button" className="fgd__link"
      onClick={() => { markFieldGuideSeen(id); selectGuideEntry(id); }}>
      {target.title}
    </button>
  );
}
