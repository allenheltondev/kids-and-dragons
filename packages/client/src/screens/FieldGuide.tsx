import { useEffect, useState } from "react";
import type { FieldGuide as FieldGuideData, FieldGuideCategory, FieldGuideEntry } from "@kad/shared";
import { selectGuideEntry, setPlayerSection, usePlayerNavigation } from "../store/player-navigation";
import { useFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { markFieldGuideSeen, useFieldGuideSeen } from "../store/field-guide-seen";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import { FieldGuideDetail } from "./FieldGuideDetail";
import { loadFieldGuide } from "./content";
import "./FieldGuide.css";

/** Kid-friendly labels; `one` is for "Undiscovered creature". */
const SECTIONS: ReadonlyArray<{ id: FieldGuideCategory; label: string; one: string; icon: string }> = [
  { id: "creatures", label: "Creatures", one: "creature", icon: "flame" },
  { id: "peoples", label: "Peoples", one: "people", icon: "party" },
  { id: "folk", label: "Folk", one: "folk", icon: "heart" },
  { id: "places", label: "Places", one: "place", icon: "leaf" },
  { id: "factions", label: "Factions", one: "faction", icon: "shield" },
];

/**
 * Field Guide (#107 shell, #108 index). Local navigation only: nothing here
 * sends an intent. #109 replaces `FieldGuideDetailPlaceholder` with the real
 * detail screen for `guideEntry`.
 */
export function FieldGuide() {
  const guideEntry = usePlayerNavigation((n) => n.guideEntry);
  const [guide, setGuide] = useState<FieldGuideData | null>(null);

  useEffect(() => {
    let live = true;
    loadFieldGuide().then((g) => { if (live) setGuide(g); }, () => { /* shell stays empty */ });
    return () => { live = false; };
  }, []);

  // A deep link to something undiscovered (or unknown) falls back to the index.
  const discoveries = useFieldGuideDiscoveries();
  const open = guideEntry !== null && guide !== null && discoveries[guideEntry] ? guide.entries[guideEntry] : undefined;

  return (
    <section className="field-guide" aria-label="Field Guide" data-entry={open?.id}>
      <h2 className="field-guide__title">Field Guide</h2>
      {open ? (
        <FieldGuideDetail guide={guide as FieldGuideData} entryId={open.id} />
      ) : (
        <>
          <FieldGuideIndex guide={guide} />
          <Button className="field-guide__back" variant="secondary" size="md" block
            icon={<Icon name="back" />} onClick={() => setPlayerSection("bag")}>
            Back to your bag
          </Button>
        </>
      )}
    </section>
  );
}

/** Tabs by category, a progress line, and a grid of cards. */
export function FieldGuideIndex({ guide }: { guide: FieldGuideData | null }) {
  const discoveries = useFieldGuideDiscoveries();
  const seen = useFieldGuideSeen();
  const [picked, setPicked] = useState<FieldGuideCategory | null>(null);

  if (guide === null) {
    return <div className="field-guide__body kad-scroll"><p className="field-guide__summary">Opening the guide…</p></div>;
  }

  const all = Object.values(guide.entries);
  const sections = SECTIONS.filter((s) => all.some((e) => e.category === s.id));
  const section = sections.find((s) => s.id === picked) ?? sections[0];
  const found = Object.keys(guide.entries).filter((id) => discoveries[id]).length;
  const items = section ? all.filter((e) => e.category === section.id) : [];
  const foundHere = items.filter((e) => discoveries[e.id]).length;

  return (
    <>
      <p className="field-guide__summary">{found} of {all.length} found</p>
      {section && (
        <div className="field-guide__tabs" role="tablist" aria-label="Field Guide sections">
          {sections.map((s) => (
            <button key={s.id} type="button" role="tab" id={`fg-tab-${s.id}`}
              aria-selected={s.id === section.id} aria-controls="fg-panel"
              className="field-guide__tab" onClick={() => setPicked(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className="field-guide__body kad-scroll" role="tabpanel" id="fg-panel"
        aria-labelledby={section ? `fg-tab-${section.id}` : undefined}>
        {section && (
          <>
            <p className="field-guide__progress">{foundHere} of {items.length} {section.label.toLowerCase()} found</p>
            <ul className="field-guide__grid">
              {items.map((entry) => (
                <li key={entry.id}>
                  {discoveries[entry.id] ? (
                    <FoundCard entry={entry} icon={section.icon} isNew={!seen.has(entry.id)} />
                  ) : (
                    <button type="button" className="field-guide__card field-guide__card--hidden" disabled
                      aria-label={`Undiscovered ${section.one}`}>
                      <span className="field-guide__art" aria-hidden="true">?</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

function FoundCard({ entry, icon, isNew }: { entry: FieldGuideEntry; icon: string; isNew: boolean }) {
  return (
    <button type="button" className="field-guide__card"
      onClick={() => { markFieldGuideSeen(entry.id); selectGuideEntry(entry.id); }}>
      <span className="field-guide__art" aria-hidden="true">
        {entry.art ? <img src={entry.art} alt="" loading="lazy" /> : <Icon name={icon} />}
      </span>
      <span className="field-guide__name">{entry.title}</span>
      {isNew && <span className="field-guide__new" data-testid="guide-new">New</span>}
    </button>
  );
}
