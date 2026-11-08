/**
 * "New tent unlocked!" on the hero's own phone (docs/camp.md §5.4, #621): a
 * new appearance tier unlocks a tent in that tier's look, and a class
 * distinction a decoration in that class's colors. The piece is already on her
 * kit when this shows (the server wrote it when it landed); this only tells
 * her kid.
 *
 * **After the moment, never during it.** A tier's tent waits for the whole
 * transformation cutscene (one `TRANSFORM_BEAT_MS` beat per hero who crossed a
 * tier on the same step), and a decoration for the rank-up moment
 * (`DISTINCTION_HOLD_MS`, the shared screen's `RANK_UP_MS`), plus a breath.
 * Like the Field Guide's toast it also waits while the kid owes the table an
 * answer, so it never covers a choice. The TV shows nothing.
 *
 * Only this phone's own heroes are told. The picture is the piece's art from
 * the manifest; until that art is painted, or if it fails to load, the words
 * stand alone.
 *
 * Her earned looks are told here too (docs/hero-looks.md §6; #669): "New
 * title for you: the Tracker". A look earned by a tier or a rank waits for
 * that moment as a tent or a decoration does; one from a find, a finished
 * campaign or the camp is told after a breath. The look is already hers.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { MILESTONE_KIT_PIECES, TIER_IDS, campMomentKind, lookTitleText } from "@kad/shared";
import type { ClassId, ClassRank, TierId } from "@kad/shared";
import { camp as campManifest } from "../../../../assets/manifest.json";
import { useParty, useRunState, useSession } from "../store";
import { ackKitNews, isLookNews, useKitNews, type KitNewsItem } from "../store/kit-news";
import { LOOKS } from "../world/hero-name";
import { noticeMs } from "../ui/notice-timing";
import { useBelowHeroCard, useHasPendingTurn } from "./FieldGuideNews";
import { TRANSFORM_BEAT_MS } from "./TransformCutscene";
import { openCampPanel, type CampFocus } from "./camp-panel";
import "./FieldGuideNews.css";
import "./KitNews.css";

/**
 * How long a decoration waits for the rank-up moment: the shared screen's
 * `RANK_UP_MS` (RankUpMoment.tsx, loaded lazily, so not imported here; a test
 * keeps the two equal).
 */
export const DISTINCTION_HOLD_MS = 4000;
/** A breath after the moment before the notice arrives. */
export const KIT_NEWS_GAP_MS = 400;

/** When an item may be told: once the moment it belongs to has played. */
export function kitNewsReadyAt(item: Pick<KitNewsItem, "kind" | "arrivedAt" | "crossings"> & { cause?: KitNewsItem["cause"] }): number {
  // A look waits for the moment that earned it (#669): a tier's transformation,
  // a rank's moment; a find, a campaign or the camp is told after a breath.
  const after = isLookNews(item) ? (item.cause === "tier" ? "tier" : item.cause === "rank" ? "rank" : null) : item.kind === "tent" ? "tier" : "rank";
  const hold = after === "tier" ? Math.max(1, item.crossings) * TRANSFORM_BEAT_MS : after === "rank" ? DISTINCTION_HOLD_MS : 0;
  return item.arrivedAt + hold + KIT_NEWS_GAP_MS;
}

const capital = (word: string): string => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;

/** How each look kind is said on the phone. */
const LOOK_KIND_WORD: Record<string, string> = { coat: "color", special: "special", nameplate: "nameplate", title: "title" };

/** What a piece is called on the phone: "Sworn tent", "Thornguard Apprentice"; a look by its catalog name. */
export function kitPieceName(item: Pick<KitNewsItem, "kind" | "pieceId">): string {
  if (isLookNews(item)) {
    const entry =
      item.kind === "coat"
        ? LOOKS.coats.find((c) => c.id === item.pieceId)
        : item.kind === "special"
          ? LOOKS.specials.find((x) => x.id === item.pieceId)
          : item.kind === "nameplate"
            ? LOOKS.nameplates.find((n) => n.id === item.pieceId)
            : null;
    if (entry) return entry.name;
    return lookTitleText(LOOKS, item.pieceId) ?? capital(item.pieceId.replace(/_/g, " "));
  }
  if (item.kind === "tent") {
    const tier = (Object.entries(MILESTONE_KIT_PIECES.tiers) as [TierId, string][]).find(([, id]) => id === item.pieceId)?.[0];
    return `${capital(tier && TIER_IDS.includes(tier) ? tier : item.pieceId)} tent`;
  }
  for (const [classId, ranks] of Object.entries(MILESTONE_KIT_PIECES.distinctions) as [ClassId, Record<Exclude<ClassRank, "none">, string>][]) {
    const rank = (Object.entries(ranks) as [ClassRank, string][]).find(([, id]) => id === item.pieceId)?.[0];
    if (rank) return `${capital(classId)} ${capital(rank)}`;
  }
  return capital(item.pieceId.replace(/^deco_/, "").replace(/_/g, " "));
}

/** The whole line, for reading time and for the screen reader. */
export function kitNewsWords(items: readonly Pick<KitNewsItem, "kind" | "pieceId">[]): string {
  if (items.length === 0) return "";
  return `${kitNewsLead(items)}: ${items.map(kitPieceName).join(", ")}`;
}

/** The notice's first words: what kind of thing is new. */
export function kitNewsLead(items: readonly Pick<KitNewsItem, "kind">[]): string {
  const first = items[0];
  if (!first) return "";
  const looks = items.filter(isLookNews).length;
  if (looks === 0) {
    if (items.length > 1) return "New for your tent";
    return first.kind === "tent" ? "New tent unlocked" : "New decoration for your tent";
  }
  if (looks < items.length) return "New for you";
  const kinds = new Set(items.map((i) => i.kind));
  if (kinds.size > 1) return "New looks for you";
  return `New ${LOOK_KIND_WORD[first.kind] ?? "look"}${items.length > 1 ? "s" : ""} for you`;
}

/** The piece's painted art, from assets/manifest.json → `camp`, if it declares any. A look has none of its own. */
function artOf(item: Pick<KitNewsItem, "kind" | "pieceId">): string | null {
  if (isLookNews(item)) return null;
  const list: readonly { id: string; path?: string }[] =
    (item.kind === "tent" ? campManifest.tentStyles : campManifest.decorations) ?? [];
  const path = list.find((entry) => entry.id === item.pieceId)?.path;
  return path ? `/assets/${path}` : null;
}

/** This phone's heroes' items that are ready to tell, re-checked when the next one comes due. */
function useReadyItems(): KitNewsItem[] {
  const news = useKitNews();
  const party = useParty();
  const playerId = useSession()?.playerId ?? null;
  const mine = new Set(party.filter((m) => m.playerId === playerId).map((m) => m.character.id));
  const own = news.filter((item) => mine.has(item.characterId));
  const [now, setNow] = useState(() => Date.now());
  const next = own.map(kitNewsReadyAt).filter((at) => at > now).sort((a, b) => a - b)[0];
  useEffect(() => {
    if (next === undefined) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [next]);
  return own.filter((item) => kitNewsReadyAt(item) <= now);
}

/** Where in Camp a piece or a look is tried on. */
export function campFocusOf(item: Pick<KitNewsItem, "kind">): CampFocus {
  return isLookNews(item) ? "look" : item.kind === "tent" ? "tent" : "decor";
}

export function KitNewsToast(): ReactElement | null {
  const toast = useRef<HTMLDivElement | null>(null);
  const state = useRunState();
  // In downtime Camp is open to try it on at once; in a scene, a check or a fight it waits for the next rest.
  const downtime = state !== null && campMomentKind(state) !== null;
  const busy = useHasPendingTurn();
  const ready = useReadyItems();
  const [shown, setShown] = useState<KitNewsItem[] | null>(null);
  const [artFailed, setArtFailed] = useState(false);
  useEffect(() => {
    if (shown || busy || ready.length === 0) return;
    setShown(ready);
    setArtFailed(false);
    ackKitNews(ready);
  }, [ready, busy, shown]);
  useEffect(() => {
    if (!shown) return undefined;
    const timer = setTimeout(() => setShown(null), noticeMs(kitNewsWords(shown)));
    return () => clearTimeout(timer);
  }, [shown]);
  useBelowHeroCard(toast, shown !== null && shown.length > 0);
  if (!shown || shown.length === 0) return null;
  const first = shown[0]!;
  const art = shown.length === 1 && !artFailed ? artOf(first) : null;
  const lead = kitNewsLead(shown);
  return (
    <div className="guide-news guide-news--phone kit-news" role="status" aria-live="polite" data-testid="kit-news" ref={toast}>
      <div className="guide-news__body">
        {art
          ? <img className="guide-news__art" src={art} alt="" onError={() => setArtFailed(true)} />
          : <span className="guide-news__art guide-news__art--star" aria-hidden="true">★</span>}
        <span className="guide-news__text">
          <span className="guide-news__lead">{lead}</span>
          <span className="guide-news__title">{shown.map(kitPieceName).join(", ")}</span>
          {downtime ? null : <span className="kit-news__later">Try it on at your next rest!</span>}
        </span>
        {downtime ? (
          <button
            type="button"
            className="kit-news__try kad-focusable"
            onClick={() => {
              openCampPanel(campFocusOf(first));
              setShown(null);
            }}
            data-testid="kit-news-try"
          >
            Try it on
          </button>
        ) : null}
      </div>
    </div>
  );
}
