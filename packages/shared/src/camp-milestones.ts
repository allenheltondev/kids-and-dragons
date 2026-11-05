/**
 * The kit pieces a hero's own milestones unlock (docs/camp.md §5.4): a tent
 * style per appearance tier reached, a decoration per class distinction
 * earned. The ids are the camp catalog's (`content/camp.json` → `milestones`,
 * #618), whose art is `assets/manifest.json` → `camp.tentStyles` and
 * `camp.decorations`.
 *
 * Written out here as well as in the catalog because the character ladder
 * (migrate.ts) needs it synchronously, with no content loaded, and a hero's
 * stored milestones must never depend on which content a server happened to
 * load. `npm run content:validate` fails when the two disagree, so the
 * catalog stays the authored source and this stays its copy.
 *
 * Only tiers whose art is painted are listed (spec §8.1 draws Ascendant and
 * above as Mythic until it is). A tier added here later is granted to every
 * hero who holds it at her next kit read (`readKit`), so nobody misses one for
 * being early.
 *
 * Type imports only: tools/content/validate.mjs loads this file directly.
 */

import type { ClassId, ClassRank, TierId } from "./types/domain.js";
import type { KitPieceId } from "./types/camp.js";

export interface MilestoneKitPieces {
  /** Tier → the milestone tent style it unlocks. */
  tiers: Partial<Record<TierId, KitPieceId>>;
  /** Class → distinction → the decoration it unlocks. */
  distinctions: Record<ClassId, Record<Exclude<ClassRank, "none">, KitPieceId>>;
}

export const MILESTONE_KIT_PIECES: MilestoneKitPieces = {
  tiers: {
    sworn: "sworn",
    radiant: "radiant",
    mythic: "mythic",
  },
  distinctions: {
    thornguard: { apprentice: "deco_thornguard_apprentice", expert: "deco_thornguard_expert", master: "deco_thornguard_master" },
    duskrunner: { apprentice: "deco_duskrunner_apprentice", expert: "deco_duskrunner_expert", master: "deco_duskrunner_master" },
    starweaver: { apprentice: "deco_starweaver_apprentice", expert: "deco_starweaver_expert", master: "deco_starweaver_master" },
    songkeeper: { apprentice: "deco_songkeeper_apprentice", expert: "deco_songkeeper_expert", master: "deco_songkeeper_master" },
  },
};

/**
 * #617's placeholder ids, before the catalog existed, and what each became.
 * Never shipped (#617 and #618 land together on the camp branch), so no
 * stored row should hold one; the kit ladder's v1 → v2 step renames any that
 * a development table wrote, so none can survive a read.
 */
export const PLACEHOLDER_KIT_PIECES: Readonly<Record<string, KitPieceId>> = {
  kit_tent_sworn: "sworn",
  kit_tent_radiant: "radiant",
  kit_tent_mythic: "mythic",
  ...Object.fromEntries(
    Object.values(MILESTONE_KIT_PIECES.distinctions)
      .flatMap((ranks) => Object.values(ranks))
      .map((id) => [`kit_${id}`, id]),
  ),
};
