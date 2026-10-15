/**
 * JourneyPanel - where a graph campaign's party chooses where to go (#195).
 *
 * An ordered campaign has one road, so the lobby only ever needs a "Begin"
 * button. A graph campaign has a map: the party stands somewhere, has been
 * some places, and has several ways on. This is that map as a phone draws it,
 * from `CampaignView.journey` and nothing else - the server already decided
 * which ways exist, which are open and what each would find
 * (`journeyView`), and this only draws it and reports the tap.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DISTINGUISHES, AND WHY EACH IS A WORD AND NOT A COLOUR
 *
 *   - **A way you can take** is a button, with whether the place is
 *     "Unexplored", somewhere you've "Been", or somewhere "It has changed".
 *   - **A way that is blocked but drawn** (the author's locked door) is text,
 *     not a disabled button: a dead control is a control a child keeps tapping.
 *     It says why in plain words and never what would open it.
 *   - **A way that cannot be undone** ("One way") or can only be done once
 *     ("One time") asks first. The confirmation is a step of its own, in the
 *     panel: focus lands on its question, then "Stay here" (the safe answer)
 *     comes before "Yes, go" in reading and tab order, and Escape stays - so a
 *     double tap on the exit cannot also be a double tap on "Yes".
 *
 * Status is always icon + word (spec 11), never colour alone.
 *
 * **Things the party can try** (#197) - a rift's actions, `journey.riftActions`:
 * search for a hidden way, open a rift, steady it, turn it, close it. Each is
 * a button under the ways on, sent as `RIFT_ACTION` by the parent
 * (`onAction`); a close nothing can undo asks first, through the same
 * confirmation as a one-way crossing. A party with nowhere to go and nothing
 * to try (`journey.stuck`) is told so plainly instead of shown an empty list.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT KNOW
 *
 * Nothing about chapters, variants or rifts. The view carries only what a
 * player may see; later views add optional fields (a rift's summary on an
 * exit, a visible world fact) and this draws what it recognises and ignores
 * what it does not. Moving the party is the parent's job (`onChoose`,
 * `onContinue`), which is also what lets the same panel serve a phone in the
 * lobby and, read-only, anywhere else the map is worth showing.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import type { CampaignView, JourneyExitView, JourneyRiftActionView, JourneyView } from "@kad/shared";
import { Button } from "../ui/Button";
import { ScreenReaderOnly } from "../ui/ScreenReaderOnly";
import {
  exitArrivalChip,
  exitBlockedLine,
  exitKindLabel,
  exitNeedsConfirm,
  exitWarning,
  journeyBeginLabel,
  journeyStuckLine,
  riftActionIcon,
  riftActionNeedsConfirm,
  riftActionWarning,
} from "./campaign-copy";
import { Icon } from "./icons";
import "./shared.css";
import "./JourneyPanel.css";

export interface JourneyPanelProps {
  journey: JourneyView;
  /** `CampaignView.ended`, for the room that just finished the campaign. */
  ended?: CampaignView["ended"];
  /** A tap is in flight: nothing can be tapped twice. */
  busy?: boolean;
  /** The party takes this way (after the confirmation, where there is one). */
  onChoose: (exit: JourneyExitView) => void | Promise<void>;
  /** The party plays where the journey stands (or starts again, once it has ended). */
  onContinue: () => void | Promise<void>;
  /**
   * The party tries a rift action (#197), after the confirmation where there
   * is one. Absent: the panel draws no actions (a read-only map).
   */
  onAction?: (action: JourneyRiftActionView) => void | Promise<void>;
}

/** A rift action's key in `pending` - never an edge id, which has no colon. */
const actionKey = (action: JourneyRiftActionView): string =>
  `action:${action.action}:${action.edge}:${action.to ?? ""}`;

const KIND_ICON: Record<JourneyExitView["kind"], string> = {
  forward: "forward",
  sideways: "travel",
  return: "back",
};

function headingFor(journey: JourneyView): string {
  if (journey.status === "ended") return "You found an ending!";
  if (journey.status === "choosing") return "Where to next?";
  return (journey.places ?? []).some((place) => place.completed) ? "Ready to go on?" : "Your adventure";
}

export function JourneyPanel({
  journey,
  ended,
  busy = false,
  onChoose,
  onContinue,
  onAction,
}: JourneyPanelProps): ReactElement {
  const ids = useId();
  const headingId = `${ids}-heading`;
  const confirmId = `${ids}-confirm`;
  const [pending, setPending] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const exitButtons = useRef(new Map<string, HTMLButtonElement>());

  const pendingExit = journey.exits.find((exit) => exit.edge === pending && exit.available) ?? null;
  const actions = onAction ? (journey.riftActions ?? []) : [];
  const pendingAction = actions.find((action) => actionKey(action) === pending) ?? null;
  // One "are you sure?" for both: a crossing that cannot be undone, and a rift
  // action that cannot (#197).
  const confirm =
    pendingExit !== null
      ? {
          title: `Go to ${pendingExit.label}?`,
          warning: exitWarning(pendingExit),
          yes: "Yes, go",
          go: () => onChoose(pendingExit),
        }
      : pendingAction !== null
        ? {
            title: `${pendingAction.label}?`,
            warning: riftActionWarning(pendingAction),
            yes: "Yes, do it",
            go: () => onAction?.(pendingAction),
          }
        : null;
  const confirming = confirm !== null;

  // The party has moved (or the screen was refreshed under a half-made
  // choice): forget any confirmation, and - when it is a move, not the first
  // draw - bring the new place to the front of the screen reader's attention.
  const placeKey = `${journey.node}:${String(journey.visit)}:${journey.status}`;
  const lastPlace = useRef(placeKey);
  useEffect(() => {
    setPending(null);
    if (lastPlace.current !== placeKey) headingRef.current?.focus();
    lastPlace.current = placeKey;
  }, [placeKey]);

  // The confirmation owns focus the moment it opens, on the safe question.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming, pending]);

  const cancel = (): void => {
    const edge = pending;
    setPending(null);
    // Back to the way they were deciding about, so keyboard and switch users
    // do not start again from the top of the page.
    if (edge !== null) queueMicrotask(() => exitButtons.current.get(edge)?.focus());
  };

  const choose = (exit: JourneyExitView): void => {
    if (exitNeedsConfirm(exit)) {
      setPending(exit.edge);
      return;
    }
    void onChoose(exit);
  };

  const tryAction = (action: JourneyRiftActionView): void => {
    if (riftActionNeedsConfirm(action)) {
      setPending(actionKey(action));
      return;
    }
    void onAction?.(action);
  };

  const onConfirmKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      cancel();
    }
  };

  const places = journey.places ?? [];

  return (
    <section className="journey" aria-labelledby={headingId}>
      <h3 className="journey__heading" id={headingId} ref={headingRef} tabIndex={-1}>
        <Icon name={journey.status === "ended" ? "crown" : "map"} />
        <span>{headingFor(journey)}</span>
      </h3>
      {/* Where the party is now, announced politely when it moves. */}
      <ScreenReaderOnly live="polite">
        {journey.status === "ended" && journey.reachedEnding
          ? `You found the ending: ${journey.reachedEnding.title}.`
          : `The party is at ${journey.title}.`}
      </ScreenReaderOnly>

      {journey.status === "ended" ? (
        <>
          <p className="journey__here">
            <Icon name="star" />
            <span>
              {journey.reachedEnding ? (
                <>
                  The ending: <b>{journey.reachedEnding.title}</b>
                </>
              ) : (
                "The adventure is over."
              )}
            </span>
          </p>
          <Button
            variant="primary"
            size="lg"
            icon={<Icon name="forward" />}
            disabled={busy}
            onClick={() => void onContinue()}
          >
            {journeyBeginLabel(journey, ended)}
          </Button>
        </>
      ) : journey.status === "playing" ? (
        <>
          <p className="journey__here">
            <Icon name="map" />
            <span>
              Next stop: <b>{journey.title}</b>
            </span>
          </p>
          <Button
            variant="primary"
            size="lg"
            icon={<Icon name="forward" />}
            disabled={busy}
            onClick={() => void onContinue()}
          >
            {journeyBeginLabel(journey, ended)}
          </Button>
        </>
      ) : (
        <>
          <p className="journey__here">
            <Icon name="map" />
            <span>
              You are at <b>{journey.title}</b>. Pick a way to go.
            </span>
          </p>

          {journey.stuck ? (
            <p className="journey__stuck" role="status">
              <Icon name="waiting" />
              <span>{journeyStuckLine()}</span>
            </p>
          ) : null}

          {confirm !== null ? (
            <div
              className="journey-confirm"
              role="group"
              aria-labelledby={confirmId}
              onKeyDown={onConfirmKeyDown}
            >
              <h4 className="journey-confirm__title" id={confirmId} ref={confirmRef} tabIndex={-1}>
                <Icon name="scroll" />
                <span>{confirm.title}</span>
              </h4>
              <p className="journey-confirm__warning" role="alert">
                {confirm.warning}
              </p>
              <div className="journey-confirm__actions">
                <Button variant="secondary" size="lg" icon={<Icon name="back" />} disabled={busy} onClick={cancel}>
                  Stay here
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  icon={<Icon name="forward" />}
                  disabled={busy}
                  onClick={() => void confirm.go()}
                >
                  {confirm.yes}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <ul className="journey__exits" aria-label={`Ways on from ${journey.title}`}>
                {journey.exits.map((exit) => (
                  <li key={exit.edge}>
                    <ExitRow
                      exit={exit}
                      busy={busy}
                      onTap={() => choose(exit)}
                      register={(node) => {
                        if (node) exitButtons.current.set(exit.edge, node);
                        else exitButtons.current.delete(exit.edge);
                      }}
                    />
                  </li>
                ))}
              </ul>
              {actions.length === 0 ? null : (
                <ul className="journey__actions" aria-label="Things you can try">
                  {actions.map((action) => (
                    <li key={actionKey(action)}>
                      <button
                        type="button"
                        className="journey-exit journey-exit--open journey-exit--action kad-tap kad-focusable"
                        disabled={busy}
                        ref={(node) => {
                          if (node) exitButtons.current.set(actionKey(action), node);
                          else exitButtons.current.delete(actionKey(action));
                        }}
                        onClick={() => tryAction(action)}
                      >
                        <span className="journey-exit__icon" aria-hidden="true">
                          <Icon name={riftActionIcon(action.action)} size="1.6em" />
                        </span>
                        <span className="journey-exit__text">
                          <b className="journey-exit__label">{action.label}</b>
                          {action.irreversible ? (
                            <span className="journey-exit__chips">
                              <span className="kad-chip kad-chip--warn">
                                <Icon name="close" />
                                <span>Can't be undone</span>
                              </span>
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      {places.length === 0 ? null : (
        <details className="journey__places">
          <summary className="journey__places-summary kad-tap kad-focusable">
            <Icon name="scroll" />
            <span>Places you've been ({places.length})</span>
          </summary>
          <ul className="journey__places-list">
            {places.map((place) => (
              <li className="journey-place" key={place.node}>
                <span className="journey-place__name">{place.title}</span>
                {place.here ? (
                  <span className="kad-chip kad-chip--ok">
                    <Icon name="ready" />
                    <span>You are here</span>
                  </span>
                ) : null}
                {place.visits > 1 ? (
                  <span className="kad-chip">
                    <Icon name="back" />
                    <span>Visited {place.visits} times</span>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

interface ExitRowProps {
  exit: JourneyExitView;
  busy: boolean;
  onTap: () => void;
  register: (node: HTMLButtonElement | null) => void;
}

/** One way on: a button when it can be taken, plain words when it cannot. */
function ExitRow({ exit, busy, onTap, register }: ExitRowProps): ReactElement {
  const arrival = exitArrivalChip(exit);
  const chips = (
    <span className="journey-exit__chips">
      <span className="kad-chip">
        <Icon name={KIND_ICON[exit.kind]} />
        <span>{exitKindLabel(exit.kind)}</span>
      </span>
      {arrival === null ? null : (
        <span className={`kad-chip${exit.changed ? " kad-chip--warn" : ""}`}>
          <Icon name={arrival.icon} />
          <span>{arrival.text}</span>
        </span>
      )}
      {exit.irreversible ? (
        <span className="kad-chip kad-chip--warn">
          <Icon name="close" />
          <span>One way</span>
        </span>
      ) : exit.once ? (
        <span className="kad-chip kad-chip--warn">
          <Icon name="waiting" />
          <span>One time</span>
        </span>
      ) : null}
    </span>
  );

  if (!exit.available) {
    return (
      <div className="journey-exit journey-exit--blocked">
        <span className="journey-exit__icon" aria-hidden="true">
          <Icon name="close" size="1.6em" />
        </span>
        <span className="journey-exit__text">
          <b className="journey-exit__label">{exit.label}</b>
          <span className="journey-exit__why">
            <b>Blocked.</b> {exitBlockedLine(exit.reason)}
          </span>
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`journey-exit journey-exit--open kad-tap kad-focusable${exit.changed ? " journey-exit--changed" : ""}`}
      disabled={busy}
      ref={register}
      onClick={onTap}
    >
      <span className="journey-exit__icon" aria-hidden="true">
        <Icon name={KIND_ICON[exit.kind]} size="1.6em" />
      </span>
      <span className="journey-exit__text">
        <b className="journey-exit__label">{exit.label}</b>
        {chips}
      </span>
    </button>
  );
}
