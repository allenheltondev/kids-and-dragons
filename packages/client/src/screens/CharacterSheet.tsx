/**
 * CharacterSheet — who somebody is, and who they have been.
 *
 * The last of roadmap chapter 5, and it is mostly a screen for facts the game
 * has always tracked and never shown:
 *
 *   - **Souvenirs.** spec §8.3 calls the souvenir "the point" — a failed
 *     campaign still leaves a visible mark, "so the time spent produced
 *     something", and it "displays on their sheet and in the world". They are
 *     on `ResolvedCharacter`, they survive every revert, and nothing in the
 *     client has ever drawn one.
 *
 *   - **The commitment rule.** `isProvisional` and `committedLevel` are the
 *     visible half of §8.3, and were also unrendered. A child who levelled to 5
 *     this evening should be able to find out that 4 is the number she keeps if
 *     the campaign goes wrong — before it does, not after.
 *
 *   - **Tier history**, which is those two things together. The tiers below
 *     your level are ones you climbed and kept; a tier-flavoured souvenir names
 *     one you reached and lost. §8.3: "she goes back to Fledgling and keeps
 *     something visible that says she was Sworn once."
 *
 * Openable for *anybody* in the party, not only yourself — spec §6.1 lists
 * "look at each other's characters" beside healing and trading as a thing a
 * Rest scene is for.
 */

import type { ReactElement } from "react";
import { INVENTORY_SLOTS, STAT_IDS, TIER_IDS } from "@kad/shared";
import type { ItemCatalog, PartyMember, TierId } from "@kad/shared";
import { Button } from "../ui/Button";
import { CharacterPortrait } from "./CharacterPortrait";
import { Icon } from "./icons";
import "./shared.css";
import "./CharacterSheet.css";

/** Tier ids are lowercase on the wire and Titled in a sentence. */
const TIER_WORD: Record<TierId, string> = {
  fledgling: "Fledgling",
  sworn: "Sworn",
  radiant: "Radiant",
  mythic: "Mythic",
};

/**
 * Reads a souvenir id back into the two things it encodes.
 *
 * `failCampaign` is handed `campaignId` or `campaignId#tier` — the second when
 * the attempt reached a tier it then lost (progression.ts, spec §8.3). The id
 * is a display key rather than a structured field, so this is the one place
 * that knows the shape, and it is exported so the parse is testable without a
 * DOM the way `previousTier` is.
 *
 * A `#` fragment that is not a known tier is treated as no tier rather than
 * shown raw: souvenir ids are written by a server that may be newer than this
 * bundle, and "was ??? once" is worse than saying nothing.
 */
export function readSouvenir(id: string): { campaignId: string; tier: TierId | null } {
  const hash = id.indexOf("#");
  if (hash === -1) return { campaignId: id, tier: null };
  const tier = id.slice(hash + 1);
  return {
    campaignId: id.slice(0, hash),
    tier: (TIER_IDS as readonly string[]).includes(tier) ? (tier as TierId) : null,
  };
}

/** "the-hollow-crown" → "The Hollow Crown". Campaign titles live in campaign
 *  JSON, which a souvenir does not carry; the id is the honest fallback. */
export function prettyCampaign(campaignId: string): string {
  return campaignId
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** How a tier stands relative to the character looking at it. */
export type TierStanding = "reached" | "lost" | "ahead";

/**
 * The ladder, annotated — the tier history, derived rather than stored.
 *
 * There is no record of which tiers a character has *been*, and there does not
 * need to be: tier follows level, so every tier at or below the current one was
 * climbed, and the only tier you can have reached without still holding it is
 * one a failed campaign took back — which is exactly what a tier-flavoured
 * souvenir records. The two halves of §8.3 answer the whole question between
 * them.
 *
 * Read off `character.tier` rather than recomputed from level and
 * `rules.tierLevels`, and that matters for more than brevity. Content is
 * fetched separately from the bundle, so a sheet can open before the rules
 * land — and a ladder that needs them would spend that moment claiming the tier
 * she is *standing in* is "still to come". `resolveCharacter` already ran
 * `tierForLevel` server-side and stamped the answer ("Derived, never trusted
 * from storage"), so this is the same derivation by the same authority, minus a
 * dependency that can be missing.
 *
 * Pure and exported so the derivation is testable without a WebGL context or a
 * DOM, the same way `storyFocusTiles` and `previousTier` are.
 */
export function tierHistory(member: PartyMember): { tier: TierId; standing: TierStanding }[] {
  const now = TIER_IDS.indexOf(member.character.tier);
  const lost = new Set(
    member.character.souvenirs
      .map((souvenir) => readSouvenir(souvenir.id).tier)
      .filter((tier): tier is TierId => tier !== null),
  );

  return TIER_IDS.map((tier, index) => ({
    tier,
    // `indexOf` is -1 only for a tier id this bundle does not know, which
    // leaves every rung "ahead" — the one case where nothing is claimed.
    standing: index <= now ? "reached" : lost.has(tier) ? "lost" : "ahead",
  }));
}

export interface CharacterSheetProps {
  member: PartyMember;
  /** Whose sheet this is, which changes the words rather than the facts. */
  isMe: boolean;
  items: ItemCatalog | null;
  onClose: () => void;
}

export function CharacterSheet({ member, isMe, items, onClose }: CharacterSheetProps): ReactElement {
  const { character } = member;
  const they = isMe ? "You" : character.name;
  const ladder = tierHistory(member);
  const slots = Array.from({ length: INVENTORY_SLOTS }, (_, i) => character.inventory[i] ?? null);

  return (
    <section className="sheetview" aria-label={`${character.name}'s character sheet`}>
      <header className="sheetview__head">
        <span className="sheetview__portrait" aria-hidden="true">
          <CharacterPortrait
            species={character.species}
            characterClass={character.class}
            tier={character.tier}
            accent={character.appearance.accent}
            size="100%"
            lit
            stand="floor"
          />
        </span>
        <span className="sheetview__id">
          <h3 className="sheetview__name">{character.name}</h3>
          <p className="sheetview__kind kad-muted">
            <Icon name={character.species} />
            <span className="sheetview__word">{character.species}</span>
            <Icon name={character.class} />
            <span className="sheetview__word">{character.class}</span>
          </p>
          <p className="sheetview__level">
            <Icon name="levelup" />
            <span>Level {character.level}</span>
            <span aria-hidden="true">·</span>
            <span className="sheetview__word">{character.tier}</span>
          </p>
          {/*
           * spec §8.3 made visible. Provisional gains are the whole commitment
           * rule, and a player who cannot see which half of her level is still
           * on loan only finds out at the moment it is taken away.
           */}
          {character.isProvisional && character.committedLevel !== character.level ? (
            <p className="sheetview__provisional">
              <Icon name="waiting" />
              <span>
                Level {character.committedLevel} is what {isMe ? "you keep" : "they keep"} if this
                adventure goes wrong.
              </span>
            </p>
          ) : null}
        </span>
      </header>

      <ul className="sheetview__stats">
        {STAT_IDS.map((stat) => (
          <li className="sheetview__stat" key={stat}>
            <Icon name={stat} />
            <span className="sheetview__word">{stat}</span>
            <b>{character.stats[stat]}</b>
          </li>
        ))}
        <li className="sheetview__stat">
          <Icon name="heart" />
          <span>health</span>
          <b>
            {member.hp}/{character.maxHp}
          </b>
        </li>
        <li className="sheetview__stat">
          <Icon name="guard" />
          <span>guard</span>
          <b>{character.guard}</b>
        </li>
        <li className="sheetview__stat">
          <Icon name="steps" />
          <span>steps</span>
          <b>{character.steps}</b>
        </li>
      </ul>

      {/* The tier ladder — where they have got to, and where they are going. */}
      <div className="sheetview__block">
        <h4 className="sheetview__heading">
          <Icon name="star" />
          <span>How far {isMe ? "you have" : "they have"} come</span>
        </h4>
        <ol className="sheetview__ladder">
          {ladder.map(({ tier, standing }) => (
            <li className={`sheetview__rung sheetview__rung--${standing}`} key={tier}>
              {/* Icon and word, never colour alone (spec §11). */}
              <Icon
                name={standing === "reached" ? "check" : standing === "lost" ? "scroll" : "waiting"}
              />
              <span className="sheetview__word">{TIER_WORD[tier]}</span>
              <span className="sheetview__rung-note kad-muted">
                {standing === "reached"
                  ? "reached"
                  : standing === "lost"
                    ? "was this once"
                    : "still to come"}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/*
       * spec §8.3 — "The souvenir is the point. A failed campaign still leaves
       * a visible mark, so the time spent produced something." It is the one
       * thing on this sheet that a *bad* evening put there, and it is drawn no
       * differently from the good ones: cosmetic, permanent, and never a
       * consolation prize with a number on it.
       */}
      {character.souvenirs.length === 0 ? null : (
        <div className="sheetview__block">
          <h4 className="sheetview__heading">
            <Icon name="ribbon" />
            <span>Things {isMe ? "you have" : "they have"} kept</span>
          </h4>
          <ul className="sheetview__souvenirs">
            {character.souvenirs.map((souvenir) => {
              const { campaignId, tier } = readSouvenir(souvenir.id);
              return (
                <li className="sheetview__souvenir" key={`${souvenir.id}-${souvenir.fromRun}`}>
                  <Icon name="ribbon" />
                  <span>
                    <b>{prettyCampaign(campaignId)}</b>
                    {tier === null ? null : <> — was {TIER_WORD[tier]} once</>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="sheetview__block">
        <h4 className="sheetview__heading">
          <Icon name="bag" />
          <span>{isMe ? "Your things" : `${character.name}'s things`}</span>
        </h4>
        <ul className="sheetview__bag">
          {slots.map((entry, index) =>
            entry === null ? (
              <li className="sheetview__slot sheetview__slot--empty" key={`empty-${String(index)}`}>
                <span className="kad-muted">Empty</span>
              </li>
            ) : (
              <li className="sheetview__slot" key={`${entry.itemId}-${String(index)}`}>
                <Icon name={items?.[entry.itemId]?.icon ?? entry.kind} />
                <span>{items?.[entry.itemId]?.name ?? entry.itemId}</span>
              </li>
            ),
          )}
        </ul>
        {character.questItems.length === 0 ? null : (
          <ul className="sheetview__quest">
            {character.questItems.map((itemId) => (
              <li className="kad-chip" key={itemId}>
                <Icon name={items?.[itemId]?.icon ?? "quest"} />
                <span>{items?.[itemId]?.name ?? itemId}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button variant="primary" size="lg" icon={<Icon name="back" />} onClick={onClose}>
        {they === "You" ? "Close" : `Done looking at ${character.name}`}
      </Button>
    </section>
  );
}
