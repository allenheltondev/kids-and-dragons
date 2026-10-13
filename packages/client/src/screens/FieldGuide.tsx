import { useEffect, useState } from "react";
import type { FieldGuide as FieldGuideData } from "@kad/shared";
import { setPlayerSection, usePlayerNavigation } from "../store/player-navigation";
import { useFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import { loadFieldGuide } from "./content";
import "./FieldGuide.css";

/**
 * Field Guide shell (#107). Local navigation only: nothing here sends an
 * intent. #108 fills the index grid, #109 the detail screen for `guideEntry`.
 */
export function FieldGuide() {
  const guideEntry = usePlayerNavigation((n) => n.guideEntry);
  const discoveries = useFieldGuideDiscoveries();
  const [guide, setGuide] = useState<FieldGuideData | null>(null);

  useEffect(() => {
    let live = true;
    loadFieldGuide().then((g) => { if (live) setGuide(g); }, () => { /* shell stays empty */ });
    return () => { live = false; };
  }, []);

  return (
    <section className="field-guide" aria-label="Field Guide" data-entry={guideEntry ?? undefined}>
      <h2 className="field-guide__title">Field Guide</h2>
      <div className="field-guide__body kad-scroll">
        <p className="field-guide__summary">
          {guide === null
            ? "Opening the guide…"
            : `${Object.keys(discoveries).length} of ${Object.keys(guide.entries).length} found`}
        </p>
      </div>
      <Button className="field-guide__back" variant="secondary" size="md" block
        icon={<Icon name="back" />} onClick={() => setPlayerSection("bag")}>
        Back to your bag
      </Button>
    </section>
  );
}
