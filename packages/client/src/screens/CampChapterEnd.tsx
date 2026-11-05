/**
 * The camp's beat at a chapter's end (docs/camp.md §5.2, §5.3, §6.2; #619):
 * the chapter's Dash Cash counted in, any lucky drops, and the shop's offer
 * and vote; then (#620) the camp itself.
 *
 *   - `CampTally`, on the TV's summary (ChapterCompletePanel): read-only, as
 *     the shared screen always is (docs/tv-read-only-audit.md). The shop's
 *     pieces, a piece the crew cannot afford yet with what it still needs,
 *     and who has voted for each, never a control.
 *   - `CampShopVote`, on a phone: the vote, built like a choice point (spec
 *     §6.1): pick, then confirm, the seats ticking as friends vote. A piece
 *     out of reach is shown, disabled, with what it needs (§6.2); with
 *     nothing affordable the pieces show and no vote starts.
 *   - `CampBeat`, on the TV once the tally has been up a while and no vote is
 *     running (§3, §8.5): the full camp, the crew's pieces placed, the
 *     heroes in it, and what was found or bought this chapter beside the
 *     campfire with its hotspot lit for placing. Never put up on its own
 *     (§12.5): a kid places it from her phone. When a full campaign grew the
 *     frame, the heroes pitch the new camp first (§4.1). Read-only, and
 *     nothing waits on it: back to the lobby works throughout.
 *   - `DashCashSparkle`: the little "Dash Cash!" a lucky drop gets, on the TV
 *     and echoed on the phones. Only for a drop that paid; nothing for one
 *     that did not, and never a meter or the odds (§5.2).
 *
 * Dash Cash is never shown beside the story's coins (§5.2): none of this
 * names coins, and the summary does not show the purse.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { SAVE_DASH_CASH, shopOptionVotable, shopVoting, speak } from "@kad/shared";
import type { CampShopOption, CampShopView, CampTally, PartyMember, RunState } from "@kad/shared";
import { useLobbyInset } from "./LobbyContent";
import { CrewIdentity } from "./CrewIdentity";
import { campLayoutFor, campStage } from "../world/lobby-camp";
import { campBeside, crewName, hotspotName, layoutHotspots, type CampBesideView } from "../world/camp-scene";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import { VoteTicks } from "./VoteTicks";
import { ackDashCash, useDashCashNews } from "../store/dash-cash-news";
import "./CampChapterEnd.css";

const dash = (n: number): string => `${String(n)} Dash Cash`;

/** What a shop piece's line under its name says: what buying it leaves, or what it still needs. */
export function shopOptionSub(option: Pick<CampShopOption, "price" | "after" | "needs">): string {
  return shopOptionVotable(option)
    ? `${dash(option.price)}, leaves ${String(option.after)}`
    : `${dash(option.price)}. Needs ${String(option.needs ?? 0)} more`;
}

/** When the shop opens, for a crew that is not there yet (§5.3). The Practice Meadow does not count. */
export function shopOpensLine(tally: Pick<CampTally, "shopIn" | "uncounted">): string {
  const n = tally.shopIn ?? 1;
  const when = n <= 1 ? "after the next chapter" : "after two adventure chapters";
  if (tally.uncounted) return `Practice doesn't count toward the camp shop. It opens ${n <= 1 ? "after the next adventure chapter" : when}.`;
  return `The camp shop opens ${when}.`;
}

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
  if (!tally.shopOpen) return shopOpensLine(tally);
  if (!shop) return null;
  if (shop.result?.kind === "bought") return `You bought the ${shop.result.label.toLowerCase()}!`;
  if (shop.result?.kind === "saved") return "You are saving your Dash Cash.";
  if (shop.options.length === 0) return "Nothing in the camp shop fits yet. Keep saving!";
  if (!shopVoting(shop)) return "You can't buy any of these yet. Keep saving, and they'll be here!";
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
  const voting = shopVoting(shop);
  // The pieces show while nothing is decided, affordable or not; "Save" only while there is a vote.
  const listed = shop !== undefined && shop.result === undefined && shop.options.length > 0;
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
          {/* After a purchase the shop holds the balance as it now stands. */}
          Your crew has <b>{dash(shop?.balance ?? tally.balance)}</b>
        </span>
      </p>
      {listed ? (
        <ul className="camp-tally__shop" aria-label="The camp shop">
          {[
            ...shop.options.map((o) => ({ id: o.pieceId, label: o.label, sub: shopOptionSub(o), later: !shopOptionVotable(o) })),
            ...(voting ? [{ id: SAVE_DASH_CASH, label: "Save our Dash Cash", sub: "Free", later: false }] : []),
          ].map((option) => (
            <li
              className={`camp-tally__option${option.later ? " camp-tally__option--later" : ""}`}
              key={option.id}
              data-option={option.id}
              {...(option.later ? { "data-later": "" } : {})}
            >
              <span className="camp-tally__option-label">{option.label}</span>
              <span className="camp-tally__option-sub kad-muted">{option.sub}</span>
              {voting && !option.later ? <VoteTicks voterIds={voterIds} votedIds={votedFor(option.id)} party={[...party]} /> : null}
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
  const voting = shopVoting(shop);
  if (shop.options.length === 0) {
    return (
      <p className="camp-vote__done kad-muted" data-testid="camp-vote-none">
        <Icon name="dash_cash" />
        <span>{`Your crew has ${dash(shop.balance)}. Nothing in the camp shop fits yet.`}</span>
      </p>
    );
  }
  const options = [
    ...shop.options.map((o) => ({ id: o.pieceId, label: o.label, sub: shopOptionSub(o), later: !shopOptionVotable(o) })),
    ...(voting ? [{ id: SAVE_DASH_CASH, label: "Save our Dash Cash", sub: "Free", later: false }] : []),
  ];
  const voterIds = party.map((m) => m.playerId);
  const chosen = options.find((o) => o.id === pending && o.id !== myVote && !o.later) ?? null;
  return (
    <div className="camp-vote" data-testid="camp-vote">
      <h3 className="prompt__title">
        <Icon name="vote" />
        <span>The camp shop</span>
      </h3>
      <p className="prompt__sub kad-muted" {...(voting ? {} : { "data-testid": "camp-vote-none" })}>
        {shop.refreshed ? "Another table spent some first. " : ""}
        {voting
          ? `Your crew has ${dash(shop.balance)}. Everyone votes.`
          : `Your crew has ${dash(shop.balance)}. You can't buy any of these yet. Keep saving, and they'll be here!`}
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
                className={`choice kad-tap kad-focusable${selected ? " choice--on" : ""}${option.later ? " choice--later" : ""}`}
                aria-pressed={selected}
                disabled={held || option.later}
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
                  {option.later ? null : <VoteTicks voterIds={voterIds} votedIds={votedIds} party={[...party]} />}
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

/**
 * How long the tally holds the summary before the camp beat turns the page
 * (§3): long enough to hear the XP and the Dash Cash. A vote under way holds
 * it on the tally, where its ticks are; nothing else does, and the phones'
 * "back to the lobby" never waits for it.
 */
export const CAMP_BEAT_AFTER_MS = 9000;

/** Whether the summary should be showing the camp beat now. */
export function campBeatDue(state: Pick<RunState, "camp" | "campShop" | "endingRead">, held: boolean, elapsed: boolean): boolean {
  if (!state.camp || state.endingRead === false || held || !elapsed) return false;
  return !shopVoting(state.campShop);
}

/** What the TV says of a piece beside the campfire. */
export function besideLine(piece: CampBesideView, kindOf: (hotspotId: string) => string | undefined): string {
  if (piece.hotspotId) {
    return `${piece.label}: it goes on the ${hotspotName(kindOf(piece.hotspotId) ?? piece.hotspotId).toLowerCase()}. Put it up with Camp on a phone.`;
  }
  return `${piece.label}: it goes up when your camp grows.`;
}

/**
 * The chapter end's camp beat on the TV: a header, the camp in the window
 * between it and the foot (told to the stage as the lobby tells it), and in
 * the foot what waits beside the fire.
 */
export function CampBeat({ state }: { state: RunState }): ReactElement {
  const section = useRef<HTMLElement | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  useLobbyInset(section, windowRef);
  const layout = campLayoutFor(campStage(state));
  const beside = layout ? campBeside(state, layout) : [];
  const kinds = new Map((layout ? layoutHotspots(layout) : []).map((h) => [h.id, h.kind]));
  const grew = state.camp?.grew === true;
  const name = crewName(state);
  const balance = state.campShop?.balance ?? state.campTally?.balance ?? state.camp?.dashCash ?? 0;
  const lines = beside.map((piece) => besideLine(piece, (id) => kinds.get(id)));
  const spoken = useRef(false);
  useEffect(() => {
    if (spoken.current) return;
    spoken.current = true;
    const said = [grew ? "Your camp grew! A tent for every hero." : "Here is your camp.", ...lines].join(" ");
    speak(said, { source: "narration" });
  }, [grew, lines]);
  return (
    <section className="camp-beat" aria-labelledby="camp-beat-heading" ref={section} data-testid="camp-beat">
      <header className="camp-beat__head">
        <h2 className="camp-beat__heading" id="camp-beat-heading">
          <Icon name="rest" />
          <span>{grew ? "Your camp grew!" : "Back at camp"}</span>
        </h2>
        <div className="camp-beat__crew">
          <CrewIdentity name={name} compact />
          <span className="camp-beat__balance">
            <Icon name="dash_cash" />
            <span>{dash(balance)}</span>
          </span>
        </div>
        {grew ? <p className="camp-beat__grew">A tent for every hero, and a cookfire.</p> : null}
      </header>
      <div className="camp-beat__window" ref={windowRef} aria-hidden="true" />
      <footer className="camp-beat__foot">
        {beside.length > 0 ? (
          <div className="camp-beat__beside" data-testid="camp-beside">
            <h3 className="camp-beat__beside-heading">
              <Icon name="star" />
              <span>New beside the campfire</span>
            </h3>
            <ul>
              {lines.map((line, i) => (
                <li key={beside[i]!.pieceId} data-beside={beside[i]!.pieceId}>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="camp-beat__hint kad-muted">Change the camp and your own tent with Camp on your phones.</p>
        )}
        <p className="complete__next kad-muted">
          <Icon name="travel" />
          <span>Tap &ldquo;Back to the lobby&rdquo; on your phone when you&rsquo;re done.</span>
        </p>
      </footer>
    </section>
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
