/**
 * The camp's beat at a chapter's end (docs/camp.md §5.2, §5.3, §6.2; #619):
 * the chapter's Dash Cash counted in, any lucky drops, and the shop's offer
 * and vote. Kept to the tally and the vote: placing pieces and the camp scene
 * itself are #620's.
 *
 *   - `CampTally`, on the TV's summary (ChapterCompletePanel): read-only, as
 *     the shared screen always is (docs/tv-read-only-audit.md). The shop's
 *     options and who has voted for each, never a control.
 *   - `CampShopVote`, on a phone: the vote, built like a choice point (spec
 *     §6.1): pick, then confirm, the seats ticking as friends vote.
 *   - `DashCashSparkle`: the little "Dash Cash!" a lucky drop gets, on the TV
 *     and echoed on the phones. Only for a drop that paid; nothing for one
 *     that did not, and never a meter or the odds (§5.2).
 *
 * Dash Cash is never shown beside the story's coins (§5.2): none of this
 * names coins, and the summary does not show the purse.
 */

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { SAVE_DASH_CASH } from "@kad/shared";
import type { CampShopView, CampTally, PartyMember } from "@kad/shared";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import { VoteTicks } from "./VoteTicks";
import { ackDashCash, useDashCashNews } from "../store/dash-cash-news";
import "./CampChapterEnd.css";

const dash = (n: number): string => `${String(n)} Dash Cash`;

/** The tally's lines, as the TV shows and says them. */
export function tallyLines(tally: CampTally): string[] {
  if (tally.replay) return ["You earned this chapter's Dash Cash before."];
  const lines = [`+${String(tally.finished)} for finishing the chapter`];
  if (tally.objectives > 0) {
    lines.push(tally.objectives === 1 ? "+1 for something extra you did" : `+${String(tally.objectives)} for the extra things you did`);
  }
  return lines;
}

/** What the chapter itself paid, lucky drops aside. */
export const tallyEarned = (tally: CampTally): number => (tally.replay ? 0 : tally.finished + tally.objectives);

/** One line about the shop: what it decided, what it offers, or when it opens. */
export function shopLine(tally: CampTally, shop: CampShopView | undefined): string | null {
  if (!tally.shopOpen) return "The camp shop opens after the next chapter.";
  if (!shop) return null;
  if (shop.result?.kind === "bought") return `You bought the ${shop.result.label.toLowerCase()}!`;
  if (shop.result?.kind === "saved") return "You are saving your Dash Cash.";
  if (shop.options.length === 0) return "Nothing in the camp shop fits yet. Keep saving!";
  if (shop.refreshed) return "Another table spent some Dash Cash first. Here is what is left.";
  return "Vote on your phones: buy something, or save it.";
}

/** The TV's camp beat on the chapter summary. Read-only. */
export function CampTally({
  tally,
  shop,
  party,
}: {
  tally: CampTally;
  shop?: CampShopView | undefined;
  party: readonly PartyMember[];
}): ReactElement {
  const voting = shop !== undefined && shop.result === undefined && shop.options.length > 0;
  const voterIds = party.map((m) => m.playerId);
  const votedFor = (option: string) =>
    Object.entries(shop?.votes ?? {})
      .filter(([, vote]) => vote === option)
      .map(([playerId]) => playerId);
  const line = shopLine(tally, shop);
  return (
    <section className="camp-tally" aria-labelledby="camp-tally-heading" data-testid="camp-tally">
      <h3 className="camp-tally__heading" id="camp-tally-heading">
        <Icon name="dash_cash" />
        <span>Dash Cash for the camp</span>
      </h3>
      <ul className="camp-tally__lines">
        {tallyLines(tally).map((text) => (
          <li key={text}>{text}</li>
        ))}
        {tally.drops > 0 ? <li>{tally.drops === 1 ? "+1 lucky Dash Cash on the way" : `+${String(tally.drops)} lucky Dash Cash on the way`}</li> : null}
      </ul>
      <p className="camp-tally__balance" data-testid="camp-balance">
        <Icon name="dash_cash" />
        <span>
          Your crew has <b>{dash(tally.balance)}</b>
        </span>
      </p>
      {voting ? (
        <ul className="camp-tally__shop" aria-label="The camp shop">
          {[...shop.options.map((o) => ({ id: o.pieceId, label: o.label, sub: `${dash(o.price)}, leaves ${String(o.after)}` })), { id: SAVE_DASH_CASH, label: "Save our Dash Cash", sub: "Free" }].map((option) => (
            <li className="camp-tally__option" key={option.id}>
              <span className="camp-tally__option-label">{option.label}</span>
              <span className="camp-tally__option-sub kad-muted">{option.sub}</span>
              <VoteTicks voterIds={voterIds} votedIds={votedFor(option.id)} party={[...party]} />
            </li>
          ))}
        </ul>
      ) : null}
      {line === null ? null : (
        <p className="camp-tally__shop-line" data-testid="camp-shop-line">
          <Icon name={shop?.result?.kind === "bought" ? "star" : "vote"} />
          <span>{line}</span>
        </p>
      )}
    </section>
  );
}

/** A phone's vote in the chapter-end shop, like a choice point: pick, then confirm. */
export function CampShopVote({
  shop,
  party,
  playerId,
  held,
  onVote,
}: {
  shop: CampShopView;
  party: readonly PartyMember[];
  playerId: string;
  held: boolean;
  onVote: (option: string) => void;
}): ReactElement | null {
  const [pending, setPending] = useState<string | null>(null);
  const myVote = shop.votes[playerId] ?? null;
  // A refreshed offer, or a vote that landed, starts the pick over.
  useEffect(() => { setPending(null); }, [shop.options, myVote]);
  if (shop.result !== undefined) {
    return (
      <p className="camp-vote__done" role="status" data-testid="camp-vote-done">
        <Icon name={shop.result.kind === "bought" ? "star" : "dash_cash"} />
        <span>{shop.result.kind === "bought" ? `You bought the ${shop.result.label.toLowerCase()}!` : "You are saving your Dash Cash."}</span>
      </p>
    );
  }
  if (shop.options.length === 0) {
    return (
      <p className="camp-vote__done kad-muted" data-testid="camp-vote-none">
        <Icon name="dash_cash" />
        <span>{`Your crew has ${dash(shop.balance)}. Nothing in the camp shop fits yet.`}</span>
      </p>
    );
  }
  const options = [
    ...shop.options.map((o) => ({ id: o.pieceId, label: o.label, sub: `${dash(o.price)}, leaves ${String(o.after)}` })),
    { id: SAVE_DASH_CASH, label: "Save our Dash Cash", sub: "Free" },
  ];
  const voterIds = party.map((m) => m.playerId);
  const chosen = options.find((o) => o.id === pending && o.id !== myVote) ?? null;
  return (
    <div className="camp-vote" data-testid="camp-vote">
      <h3 className="prompt__title">
        <Icon name="vote" />
        <span>The camp shop</span>
      </h3>
      <p className="prompt__sub kad-muted">
        {shop.refreshed ? "Another table spent some first. " : ""}
        {`Your crew has ${dash(shop.balance)}. Everyone votes.`}
      </p>
      <ul className="camp-vote__options">
        {options.map((option) => {
          const selected = pending === option.id || myVote === option.id;
          const votedIds = Object.entries(shop.votes)
            .filter(([, vote]) => vote === option.id)
            .map(([id]) => id);
          return (
            <li key={option.id}>
              <button
                type="button"
                className={`choice kad-tap kad-focusable${selected ? " choice--on" : ""}`}
                aria-pressed={selected}
                disabled={held}
                onClick={() => setPending(option.id)}
              >
                <span className="choice__icon">
                  <Icon name={option.id === SAVE_DASH_CASH ? "dash_cash" : "rest"} size="1.8em" />
                </span>
                <span className="choice__label">
                  {option.label}
                  <span className="choice__ahead">{option.sub}</span>
                </span>
                <span className="choice__trail">
                  <span className="choice__mark">{myVote === option.id ? <Icon name="check" label="Your vote" /> : null}</span>
                  <VoteTicks voterIds={voterIds} votedIds={votedIds} party={[...party]} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {chosen === null ? null : (
        <div className="camp-vote__confirm">
          <Button variant="ghost" size="md" icon={<Icon name="back" />} onClick={() => setPending(null)}>
            Change
          </Button>
          <Button variant="primary" size="md" icon={<Icon name="check" />} disabled={held} onClick={() => onVote(chosen.id)}>
            {`Vote: ${chosen.label}`}
          </Button>
        </div>
      )}
    </div>
  );
}

/** How long a sparkle stays up. Short: it is a treat, not an event. */
export const SPARKLE_MS = 2600;

/** "Dash Cash!" for a lucky drop that paid, on the TV and echoed on the phones. */
export function DashCashSparkle({ place }: { place: "tv" | "phone" }): ReactElement | null {
  const news = useDashCashNews();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown || news.length === 0) return;
    setShown(true);
    ackDashCash();
  }, [news, shown]);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => { setShown(false); }, SPARKLE_MS);
    return () => { clearTimeout(timer); };
  }, [shown]);
  if (!shown) return null;
  return (
    <div className={`dash-sparkle dash-sparkle--${place}`} role="status" aria-live="polite" data-testid="dash-cash-sparkle">
      <Icon name="dash_cash" size="1.6em" />
      <span>Dash Cash!</span>
    </div>
  );
}
