import type { ReactNode } from "react";
import type { FieldGuideEntry, GuideMatchupLine } from "@kad/shared";
import type { RulesContent } from "@kad/shared";
import { creatureMatchups, speciesMatchups, classMatchups, matchupsOn } from "@kad/shared";
import { useGameStore, useRules } from "../store";
import { Icon } from "./icons";
import { useEnsureContent } from "./content";
import "./FieldGuideMatchups.css";

function Lines({ title, icon, items }: { title: string; icon: string; items: GuideMatchupLine[] }) {
  if (items.length === 0) return null;
  return (
    <div className="fgm__group">
      <h5 className="fgm__title"><Icon name={icon} /> {title}</h5>
      <ul className="fgd__list">
        {items.map((l) => <li key={l.id}>{l.text}</li>)}
      </ul>
    </div>
  );
}

/**
 * The rules, only when the run being played has matchups. A campaign that is
 * exempt (Gemfall) never applies them, so its guide must not advise them; ordinary
 * canon lore is not touched by this. Outside a run there is no campaign, so the
 * guide shows them: it describes the world, and most campaigns have them on.
 */
export function useMatchupRules(): RulesContent | null {
  const rules = useRules();
  const campaignId = useGameStore((s) => s.state?.campaignId ?? null);
  return rules && matchupsOn(rules, campaignId) ? rules : null;
}

const joinNames = (names: string[]) =>
  names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)!}`;

/**
 * "Fighting it" on a creature page, "Good at" and "Watch out" on a species
 * page. Rendered only inside the detail of a discovered entry, so a trait is
 * never on screen before its page is unlocked. Words carry every meaning; the
 * icons only sit beside them.
 */
export function FieldGuideMatchups({ entry }: { entry: FieldGuideEntry }): ReactNode {
  useEnsureContent();
  const rules = useMatchupRules();
  const fight = creatureMatchups(rules, entry);
  if (fight) {
    return (
      <section className="fgd__section fgm" aria-labelledby="fgm-fight">
        <h4 id="fgm-fight">Fighting it</h4>
        {fight.traits.length > 0 && (
          <ul className="fgm__traits" aria-label="Its traits">
            {fight.traits.map((t) => (
              <li key={t.id} className="fgm__trait">
                <strong className="fgm__trait-name"><Icon name={t.icon} /> {t.name}</strong>
                <span>{t.text}</span>
              </li>
            ))}
          </ul>
        )}
        {fight.likes.length > 0 && (
          <p className="fgm__opinion"><strong>Goes easy on:</strong> {joinNames(fight.likes)}. It holds back around them.</p>
        )}
        {fight.dislikes.length > 0 && (
          <p className="fgm__opinion"><strong>Picks on:</strong> {joinNames(fight.dislikes)}. It singles them out.</p>
        )}
        <Lines title="Good against it" icon="heart" items={fight.good} />
        <Lines title="Careful" icon="shield" items={fight.careful} />
        <p className="fgm__gentle">Not every fight has to be a fight.{entry.tips?.length ? " See the tips below for other ways past." : ""}</p>
      </section>
    );
  }
  const hero = speciesMatchups(rules, entry.id) ?? classMatchups(rules, entry.id);
  if (!hero) return null;
  return (
    <section className="fgd__section fgm" aria-labelledby="fgm-hero">
      <h4 id="fgm-hero">What they are good at</h4>
      <Lines title="Good at" icon="heart" items={hero.good} />
      <Lines title="Watch out" icon="shield" items={hero.watch} />
    </section>
  );
}
