import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FieldGuide as FieldGuideData, FieldGuideCategory, FieldGuideEntry } from "@kad/shared";
import {
  guideIndexScroll,
  rememberGuideIndexScroll,
  selectGuideEntry,
  selectGuideTab,
  setPlayerSection,
  usePlayerNavigation,
} from "../store/player-navigation";
import { DETAIL_STEP, useBackStep } from "../store/back-steps";
import { useFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { markFieldGuideSeen, useFieldGuideSeen } from "../store/field-guide-seen";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import { motionProps } from "./guide-motion";
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
export function FieldGuide({ backToBag = true }: {
  /** In play the guide sits beside the bag; the journal has its own way back. */
  backToBag?: boolean;
} = {}) {
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

  // Back is the entry first, then (in play) the bag the guide sits beside; in the journal the book's own trail takes over.
  useBackStep(open ? () => { selectGuideEntry(null); return true; } : null, DETAIL_STEP);
  useBackStep(!open && backToBag ? () => { setPlayerSection("bag"); return true; } : null);

  return (
    <section className="field-guide" aria-label="Field Guide" data-entry={open?.id}>
      <h2 className="field-guide__title">Field Guide</h2>
      {open ? (
        <FieldGuideDetail guide={guide as FieldGuideData} entryId={open.id} />
      ) : (
        <>
          <FieldGuideIndex guide={guide} />
          {backToBag ? (
            <Button className="field-guide__back" variant="secondary" size="md" block
              icon={<Icon name="back" />} onClick={() => setPlayerSection("bag")}>
              Back to your bag
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Tabs by category, a progress line, and a grid of cards. */
export function FieldGuideIndex({ guide }: { guide: FieldGuideData | null }) {
  const discoveries = useFieldGuideDiscoveries();
  const seen = useFieldGuideSeen();
  // In the navigation store, not local state: opening a card unmounts this
  // index, and coming back should find the tab and the scroll you left.
  const picked = usePlayerNavigation((n) => n.guideTab);
  const body = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = guideIndexScroll();
  }, [guide, picked]);

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
      <div className="field-guide__meter" aria-hidden="true"><span style={{ inlineSize: `${String(all.length === 0 ? 0 : (found / all.length) * 100)}%` }} /></div>
      {section && (
        <div className="field-guide__tabs" role="tablist" aria-label="Field Guide sections">
          {sections.map((s) => (
            <button key={s.id} type="button" role="tab" id={`fg-tab-${s.id}`}
              aria-selected={s.id === section.id} aria-controls="fg-panel"
              className="field-guide__tab" onClick={() => selectGuideTab(s.id)}>
              <Icon name={s.icon} />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="field-guide__body kad-scroll" role="tabpanel" id="fg-panel" ref={body}
        aria-labelledby={section ? `fg-tab-${section.id}` : undefined}
        onScroll={(e) => rememberGuideIndexScroll(e.currentTarget.scrollTop)}>
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
      <span className="field-guide__art" aria-hidden="true" {...motionProps(entry.art, entry.id)}>
        {entry.art ? <img src={entry.art} alt="" loading="lazy" /> : <Icon name={icon} />}
      </span>
      <span className="field-guide__name">{entry.title}</span>
      {isNew && <span className="field-guide__new" data-testid="guide-new">New</span>}
    </button>
  );
}
