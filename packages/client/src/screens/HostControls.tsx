/**
 * Running the room (#263): the host's view of who is in it, and the levers.
 *
 * Only on the screen that opened the room (`ClientSession.host`): the TV in
 * Party Mode, the host's phone in Travel Mode, or a family tablet (#250). Its
 * controls are the low-stakes, recoverable ones, which is why the host can be
 * a TV or a kid's phone:
 *
 *   - take a player out, in one tap (#267)
 *   - lock the room to new joins, and open it again
 *   - quiet mode for every device in the room, and back (#260)
 *   - stop for today (#259): save the chapter and close the room, to pick it
 *     up another day, and offered by itself at a Rest scene
 *   - close the room for everyone, after one "are you sure?"
 *   - in the lobby, play as another crew: a new group of players at the same
 *     TV starts its own adventure, and everyone else's save stays as it was
 *
 * And one that is not the host's alone: opening the room to visitors (#249),
 * which lowers the barrier to joining, so a grown-up who runs the game signs
 * in to turn it on (`VisitorSwitch`). The host's view is where it lives,
 * because that is where somebody running the evening looks.
 *
 * The roster is read from the run (`RunState.seats`, with `party` for heroes
 * and who is connected), so unlike the arrival notices it survives a refresh
 * of the host's screen, and shows a kid still making their hero.
 *
 * Two placements, as `ArrivalNotices` has: `inline` in a host's PlayerView,
 * folded away until opened; `float`, a corner button on the shared display.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { RunState } from "@kad/shared";
import { useGameStore, useRunState, useSession } from "../store";
import { useKeepsakeStore } from "../store/keepsake";
import { Button } from "../ui";
import { inviteData, joinUrl, shareInvite, type ShareOutcome } from "../ui/share-invite";
import { Icon } from "./icons";
import { SignInFlow } from "./SignInFlow";
import { LET_GO_NOTE, STOP_CONFIRM, STOP_OFFER } from "./save-copy";
import { crewChoices } from "./crew-copy";
import { CrewIdentity } from "./CrewIdentity";
import "./HostControls.css";

export type RosterStatus = "here" | "away" | "creating" | "out";

export interface RosterRow {
  playerId: string;
  /** The hero's name once there is one, else the profile's. */
  name: string;
  color: string;
  device: "phone" | "tablet" | null;
  status: RosterStatus;
  /** The host's own seat: listed, but never offered for removal. */
  me: boolean;
  /** From another household, in a room open to visitors (#249). */
  visitor: boolean;
  /** The host handed this phone the keeper role (`RunState.keeperPlayerId`, #272). */
  keeper: boolean;
}

/**
 * Everybody in the room, in the order they joined, from the run alone. A
 * party member with no roster entry (a run from before the roster) is still
 * listed, so nobody seated is ever missing from the host's view.
 */
export function rosterOf(state: Pick<RunState, "seats" | "party" | "removed" | "keeperPlayerId">, me: string): RosterRow[] {
  const seats = state.seats ?? {};
  const ids = [...Object.keys(seats)];
  for (const member of state.party) if (!ids.includes(member.playerId)) ids.push(member.playerId);
  return ids.map((playerId) => {
    const seat = seats[playerId];
    const member = state.party.find((m) => m.playerId === playerId);
    const status: RosterStatus = state.removed?.includes(playerId)
      ? "out"
      : member
        ? member.connected
          ? "here"
          : "away"
        : "creating";
    return {
      playerId,
      name: member?.character.name || seat?.name || "Somebody",
      color: seat?.color ?? member?.character.appearance.accent ?? "#888",
      device: seat?.device ?? null,
      status,
      me: playerId === me,
      visitor: (seat?.homeHouseholdId ?? member?.homeHouseholdId) !== undefined,
      keeper: state.keeperPlayerId === playerId,
    };
  });
}

const STATUS: Record<RosterStatus, string> = {
  here: "Here",
  away: "Away",
  creating: "Making a hero",
  out: "Taken out",
};

/** A chapter is under way: there is something to save (#259). */
export function canStop(state: Pick<RunState, "phase" | "campaignId">): boolean {
  return state.campaignId !== null && (state.phase === "scene" || state.phase === "check" || state.phase === "encounter");
}

/** Between games, where the lobby may change crews: no chapter started, none to finish. */
export function canSwitchCrew(state: Pick<RunState, "phase" | "chapterId" | "campaignId">): boolean {
  return state.chapterId === null && state.phase !== "chapter_complete" && !canStop(state);
}

/** How long the shared screen offers to stop at a Rest before it keeps playing by itself. */
export const STOP_OFFER_MS = 15_000;

/**
 * "Stop here for today?" at a Rest scene (#259): the natural place to stop,
 * offered to the host without opening the panel. "Keep playing" puts it away
 * until the next rest.
 *
 * On the shared screen (`timeoutMs`) nobody has to answer it: a remote is a
 * clumsy mouse, so after STOP_OFFER_MS it does exactly what Keep playing does,
 * with a thin bar running down meanwhile. Either button still works before
 * then, and Stop for today stays in the Room panel. Keep playing is this
 * screen's own business (nothing is sent), so the time running out is too, and
 * it happens once: the offer is put away, and the clock with it.
 */
function StopOffer({ state, timeoutMs }: { state: RunState; timeoutMs?: number }): React.JSX.Element | null {
  const stopForToday = useGameStore((store) => store.stopForToday);
  const [busy, setBusy] = useState(false);
  const [putAway, setPutAway] = useState<string | null>(null);
  const shown = state.sceneType === "rest" && canStop(state) && putAway !== state.sceneId;
  const sceneId = state.sceneId;
  useEffect(() => {
    // Not while a stop is on its way: that is the host's answer.
    if (!shown || timeoutMs === undefined || busy) return;
    const timer = setTimeout(() => setPutAway(sceneId), timeoutMs);
    return () => clearTimeout(timer);
  }, [shown, sceneId, timeoutMs, busy]);
  if (!shown) return null;
  return (
    <div className="kad-host__offer" role="status">
      <p>{STOP_OFFER}</p>
      <Button
        variant="primary"
        size="md"
        block
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void stopForToday().finally(() => setBusy(false));
        }}
      >
        Stop here for today
      </Button>
      <Button variant="ghost" size="md" block disabled={busy} onClick={() => setPutAway(sceneId)}>
        Keep playing
      </Button>
      {timeoutMs === undefined ? null : (
        <div className="kad-host__offer-clock" data-testid="stop-offer-clock">
          <span className="kad-host__offer-bar" aria-hidden="true">
            <span style={{ animationDuration: `${String(timeoutMs)}ms` }} />
          </span>
          <span className="kad-host__offer-wait">Keeping going…</span>
        </div>
      )}
    </div>
  );
}

/**
 * On the screen that stopped the game (#259): let a hero go from it. Her
 * gains from the adventure are dropped and she is free to join any game at
 * once; a resume leaves her out unless she sits down again as she is now.
 */
export function LetHeroGo(): React.JSX.Element | null {
  const state = useRunState();
  const release = useGameStore((store) => store.releaseSavedHero);
  const [asking, setAsking] = useState<string | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (!state || state.party.length === 0) return null;
  return (
    <details className="kad-host__letgo">
      <summary className="kad-focusable">Let a hero go</summary>
      <ul>
        {state.party.map((member) => {
          const name = member.character.name;
          const id = member.character.id;
          if (gone.includes(id)) return <li key={id}>{name} is free.</li>;
          return (
            <li key={id}>
              {asking === id ? (
                <span role="group" aria-label={`Let ${name} go`}>
                  <span className="kad-muted">{LET_GO_NOTE}</span>
                  <Button
                    variant="danger"
                    size="md"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void release(id, member.homeHouseholdId)
                        .then((done) => {
                          if (done) setGone([...gone, id]);
                          setAsking(null);
                        })
                        .finally(() => setBusy(false));
                    }}
                  >
                    {`Yes, let ${name} go`}
                  </Button>
                  <Button variant="ghost" size="md" disabled={busy} onClick={() => setAsking(null)}>
                    Keep {name} in the game
                  </Button>
                </span>
              ) : (
                <Button variant="secondary" size="md" onClick={() => setAsking(id)}>
                  {`Let ${name} go`}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/*
 * Whether the shared screen's room panel is open. The Room button that opens it
 * sits in the corner row (`RoomButton`, drawn there by App.tsx) and the panel
 * in the column under it, so the two share it here.
 */
let roomOpen = false;
const roomListeners = new Set<() => void>();
function setRoomOpen(next: boolean): void {
  roomOpen = next;
  for (const listener of roomListeners) listener();
}
function useRoomOpen(): boolean {
  return useSyncExternalStore(
    (listener) => { roomListeners.add(listener); return () => { roomListeners.delete(listener); }; },
    () => roomOpen,
    () => roomOpen,
  );
}

/** The shared screen's Room button, in its corner row (#257); the panel drops below it. */
export function RoomButton({ inCorner = true }: { inCorner?: boolean } = {}): React.JSX.Element | null {
  const session = useSession();
  const state = useRunState();
  const open = useRoomOpen();
  if (!session?.host || !state || state.closed) return null;
  const button = (
    <Button
      variant="secondary"
      size="md"
      className="kad-host__room"
      icon={<Icon name="players" />}
      aria-expanded={open}
      onClick={() => setRoomOpen(!open)}
    >
      {state.locked ? "Room (locked)" : "Room"}
    </Button>
  );
  return inCorner ? <div className="kad-host__room-slot">{button}</div> : button;
}

/**
 * `button={false}` on the shared screen, where App draws the Room button in the
 * corner row instead; rendered on its own, the float draws its own.
 */
export function HostControls({ placement, button = true }: { placement: "inline" | "float"; button?: boolean }): React.JSX.Element | null {
  const session = useSession();
  const state = useRunState();
  const open = useRoomOpen();
  // Each shared screen starts with its panel closed.
  useEffect(() => {
    if (placement === "float") setRoomOpen(false);
  }, [placement]);
  if (!session?.host || !state || state.closed) return null;

  const panel = <HostPanel state={state} me={session.playerId} code={session.roomCode} invite={placement === "inline"} />;
  if (placement === "inline") {
    return (
      <>
        <div className="kad-host--inline-offer">
          <StopOffer state={state} />
        </div>
        <details className="kad-host kad-host--inline">
          <summary className="kad-host__summary kad-focusable">
            <Icon name="players" />
            <span>Running this room</span>
            {state.locked ? <span className="kad-host__badge">Locked</span> : null}
          </summary>
          {panel}
        </details>
      </>
    );
  }
  return (
    <div className="kad-host kad-host--float">
      {/* On the shared screen the Room button sits in the corner row (App.tsx); in the
          bottom corner it lay over the story's last choice (#257). What it opens drops below. */}
      {button ? <RoomButton inCorner={false} /> : null}
      <StopOffer state={state} timeoutMs={STOP_OFFER_MS} />
      {open ? panel : null}
      {/* The grown-up's sign-in for the visitor switch. A phone's view
          already has one (layout/PlayerView); the shared display does not. */}
      <SignInFlow />
    </div>
  );
}

/**
 * Share the join link from the host's own phone or tablet (#462). Only the
 * inline placement draws it: the TV and the shared display show the QR instead.
 */
function ShareInvite({ code }: { code: string }): React.JSX.Element {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const url = joinUrl(code);
  useEffect(() => {
    if (outcome !== "copied") return;
    const timer = setTimeout(() => setOutcome(null), 2500);
    return () => clearTimeout(timer);
  }, [outcome]);
  const onShare = (): void => {
    const env = typeof navigator === "undefined" ? {} : navigator;
    void shareInvite(env, inviteData(url)).then(setOutcome);
  };
  return (
    <div className="kad-host__invite">
      <p className="kad-host__hint">
        Room code <strong>{code}</strong>
      </p>
      <Button variant="secondary" size="md" block icon={<Icon name="envelope" />} onClick={onShare}>
        {outcome === "copied" ? "Copied" : "Share invite"}
      </Button>
      {outcome === "shown" ? (
        <input
          className="kad-host__invite-link"
          readOnly
          aria-label="Invite link"
          value={url}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
    </div>
  );
}

function HostPanel({ state, me, code, invite = false }: { state: RunState; me: string; code: string; invite?: boolean }): React.JSX.Element {
  const removePlayer = useGameStore((store) => store.removePlayer);
  const handKeeper = useGameStore((store) => store.handKeeper);
  const lockRoom = useGameStore((store) => store.lockRoom);
  const closeRoom = useGameStore((store) => store.closeRoom);
  const stopForToday = useGameStore((store) => store.stopForToday);
  const quietRoom = useGameStore((store) => store.quietRoom);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const rows = rosterOf(state, me);
  const locked = state.locked === true;
  const quiet = state.quiet === true;
  const dismiss = (): void => {
    setRoomOpen(false);
    document.querySelector<HTMLButtonElement>(".kad-host__room")?.focus();
  };

  const run = async (task: () => Promise<boolean>): Promise<void> => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kad-host__panel" onKeyDown={event => {
      if (!invite && event.key === "Escape") { event.stopPropagation(); dismiss(); }
    }}>
      <header className="kad-host__panel-head">
        <div><strong>Room {code}</strong><p className="kad-host__hint">Look after the group</p></div>
        {!invite ? <Button variant="ghost" size="md" icon={<Icon name="close" />} aria-label="Dismiss room controls" onClick={dismiss}>Done</Button> : null}
      </header>
      <details className="kad-host__people" open={invite}>
      <summary className="kad-focusable">Players <span className="kad-host__hint">{rows.length} in this room</span></summary>
      {rows.length === 0 ? (
        <p className="kad-host__empty">Nobody has joined yet.</p>
      ) : (
        <ul className="kad-host__roster" aria-label="Who is in this room">
          {rows.map((row) => (
            <li key={row.playerId} className={`kad-host__row kad-host__row--${row.status}`}>
              <span className="kad-host__dot" style={{ background: row.color }} aria-hidden="true" />
              <span className="kad-host__who">
                <strong>{row.name}</strong>
                {row.me ? " (you)" : null}
                <span className="kad-host__meta">
                  {STATUS[row.status]}
                  {row.device === "tablet" ? " · family tablet" : row.device === "phone" ? " · own phone" : ""}
                  {row.visitor ? " · visiting" : ""}
                  {row.keeper ? " · keeps the game" : ""}
                </span>
              </span>
              {row.me || row.keeper || row.visitor || row.device !== "phone" || row.status === "out" ? null : (
                <Button
                  variant="ghost"
                  size="md"
                  aria-label={`Let ${row.name} keep this game`}
                  disabled={busy}
                  onClick={() => void run(() => handKeeper(row.playerId))}
                >
                  Make keeper
                </Button>
              )}
              {row.me || row.status === "out" ? null : (
                <Button
                  variant="ghost"
                  size="md"
                  icon={<Icon name="close" />}
                  aria-label={`Remove ${row.name} from this game`}
                  disabled={busy}
                  onClick={() => void run(() => removePlayer(row.playerId))}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      </details>
      <div className="kad-host__actions">
        {invite ? <ShareInvite code={code} /> : null}
        <VisitorSwitch state={state} code={code} busy={busy} />

        <div className="kad-host__quick-settings">
        <div className="kad-host__setting">
        <Button
          variant="secondary"
          size="md"
          block
          disabled={busy}
          aria-pressed={locked}
          icon={<Icon name={locked ? "close" : "players"} />}
          onClick={() => void run(() => lockRoom(!locked))}
        >
          {locked ? "Let new players join again" : "Lock the room"}
        </Button>
        <p className="kad-host__hint">
          {locked
            ? "Only players already here can return."
            : "Stop more players joining once everyone is here."}
        </p>
        </div>

        <div className="kad-host__setting">
        <Button
          variant="secondary"
          size="md"
          block
          disabled={busy}
          aria-pressed={quiet}
          icon={<Icon name="moon" />}
          onClick={() => void run(() => quietRoom(!quiet))}
        >
          {quiet ? "Turn quiet mode off" : "Quiet mode"}
        </Button>
        <p className="kad-host__hint">
          {quiet
            ? "On: softer sound, less motion and dimmer screens."
            : "Softer sound, less motion and dimmer screens for everyone."}
        </p>
        </div>
        </div>

        {rows.length > 0 && canSwitchCrew(state) ? (
          <details className="kad-host__crew-menu">
            <summary className="kad-focusable"><Icon name="crew" /> Crews <span className="kad-host__hint">Change who is playing</span></summary>
            <CrewSwitch state={state} busy={busy} run={run} />
          </details>
        ) : null}

        {canStop(state) ? (
          stopping ? (
            <div className="kad-host__confirm" role="alertdialog" aria-label="Stop for today?">
              <p>{STOP_CONFIRM}</p>
              <Button
                variant="primary"
                size="md"
                block
                disabled={busy}
                onClick={() => void run(stopForToday).then(() => setStopping(false))}
              >
                Save and stop
              </Button>
              <Button variant="ghost" size="md" block disabled={busy} onClick={() => setStopping(false)}>
                Keep playing
              </Button>
            </div>
          ) : (
            <Button icon={<Icon name="rest" />} variant="secondary" size="md" block disabled={busy} onClick={() => setStopping(true)}>
              Stop for today
            </Button>
          )
        ) : null}

        {closing ? (
          <div className="kad-host__confirm" role="alertdialog" aria-label="Close the room?">
            <p>Close the room for everyone? Heroes and what they earned are kept.</p>
            <Button
              variant="danger"
              size="md"
              block
              disabled={busy}
              onClick={() => void run(closeRoom).then(() => setClosing(false))}
            >
              Close it
            </Button>
            <Button variant="ghost" size="md" block disabled={busy} onClick={() => setClosing(false)}>
              Keep playing
            </Button>
          </div>
        ) : (
          <Button className="kad-host__close" icon={<Icon name="close" />} variant="ghost" size="md" block disabled={busy} onClick={() => setClosing(true)}>
            Close the room
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * New players at the same TV (architecture §4.5, "Crews"). Quiet and last of
 * the lobby's levers: most evenings it is the same kids. A new crew has its
 * own saves, from the first chapter; switching only changes which saves this
 * lobby offers, so nothing here needs an "are you sure?".
 */
function CrewSwitch({
  state,
  busy,
  run,
}: {
  state: RunState;
  busy: boolean;
  run: (task: () => Promise<boolean>) => Promise<void>;
}): React.JSX.Element {
  const switchCrew = useGameStore((store) => store.switchCrew);
  const { current, others } = crewChoices(state);
  const chooseCrew = async (crew: string | null | "new"): Promise<boolean> => {
    const changed = await switchCrew(crew);
    if (changed) setRoomOpen(false);
    return changed;
  };
  return (
    <div className="kad-host__crew" role="group" aria-label="Which crew is playing">
      <CrewIdentity name={current} />
      <p className="kad-host__hint">Your other crew&rsquo;s adventure stays saved. Existing heroes are kept.</p>
      {others.map((crew) => (
        <Button
          key={crew.id ?? "first"}
          icon={<Icon name="crew" />}
          variant="ghost"
          size="md"
          block
          disabled={busy}
          onClick={() => void run(() => chooseCrew(crew.id))}
        >
          Play as {crew.name}
        </Button>
      ))}
      <Button icon={<Icon name="plus" />} variant="secondary" size="md" block disabled={busy} onClick={() => void run(() => chooseCrew("new"))}>
        New players? Start a new crew
      </Button>
      <p className="kad-host__hint">
        Start fresh with new heroes on everyone&rsquo;s phones and separate adventure saves.
      </p>
    </div>
  );
}

/**
 * Open to visitors, or not (#249). Either way round, the tap opens the sign-in
 * for a grown-up who runs the game; the server refuses anybody else. Once it
 * is open, the visitor code is said here as well as on the room's screens.
 */
function VisitorSwitch({ state, code, busy }: { state: RunState; code: string; busy: boolean }): React.JSX.Element | null {
  const available = useKeepsakeStore((s) => s.available);
  const check = useKeepsakeStore((s) => s.check);
  const openVisitors = useKeepsakeStore((s) => s.openVisitors);
  useEffect(() => {
    void check();
  }, [check]);
  // No sign-in on this deployment, so nobody could turn it on.
  if (available === false && state.visitorCode === undefined) return null;

  const open = state.visitorCode !== undefined;
  return (
    <>
      <Button
        variant="secondary"
        size="md"
        block
        disabled={busy || available !== true}
        aria-pressed={open}
        onClick={() => openVisitors(code, !open)}
      >
        {open ? "Stop new visitors" : "Let visitors join"}
      </Button>
      <p className="kad-host__hint">
        {open ? (
          <>
            Kids from other families join with <strong className="kad-host__code">{state.visitorCode}</strong>.
            A grown-up signs in to change this.
          </>
        ) : (
          "Kids from other families can join with their own heroes. A grown-up who runs this game signs in to turn it on."
        )}
      </p>
    </>
  );
}
