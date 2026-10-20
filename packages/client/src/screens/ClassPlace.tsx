/**
 * A class place, on both screens (#311, docs/class-mastery.md §3).
 *
 * The phone (`ClassPlaceChoice`) asks this kid alone: put on the room's
 * class, or keep the one you wear. There is no vote, and switching asks
 * "are you sure?" in words an eight-year-old can follow: what comes off,
 * what goes on, that nothing earned is lost, and where to switch back. The
 * way on waits for every kid's answer (shared `classPlaceWaitingOn`), so
 * until then the phone shows who the room is waiting for instead of the
 * choices.
 *
 * The TV (`ClassPlaceRoll`) shows who switched, who kept, and who is still
 * deciding.
 *
 * On screen a class token is always its own name ("your thorn bracer",
 * §4); "token" is only the word in code and docs.
 */

import { useState } from "react";
import type { ReactElement } from "react";
import { classPlaceWaitingOn, owesClassAnswer } from "@kad/shared";
import type { ClassId, PartyMember, RulesContent } from "@kad/shared";
import { useMe, useParty, useRules, useRunState, useSend } from "../store";
import { Button } from "../ui/Button";
import { Icon } from "./icons";
import "./ClassPlace.css";

/** The worn token, by class (docs/class-mastery.md §4). */
export const CLASS_GEAR: Record<ClassId, string> = {
  thornguard: "thorn bracer",
  duskrunner: "dusk hood",
  starweaver: "star circlet",
  songkeeper: "song bell",
};

/** Where each class is taught (docs/class-mastery.md §2). */
export const CLASS_PLACE_NAME: Record<ClassId, string> = {
  thornguard: "the Dojo",
  starweaver: "the Academy",
  duskrunner: "the Rookery",
  songkeeper: "the Conservatory",
};

function className(rules: RulesContent | null, id: ClassId): string {
  return rules?.classes[id]?.name ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** "Moss", "Moss and Wren", "Moss, Wren and Pip". */
function names(members: readonly PartyMember[]): string {
  const all = members.map((m) => m.character.name);
  return all.length <= 1 ? (all[0] ?? "") : `${all.slice(0, -1).join(", ")} and ${all.at(-1) ?? ""}`;
}

/**
 * The "are you sure?" for a switch, one short sentence a line. Exported for
 * the tests, which read it as a kid would.
 */
export function switchLines(from: ClassId, to: ClassId): string[] {
  return [
    `You take off your ${CLASS_GEAR[from]} and put on the ${CLASS_GEAR[to]}.`,
    `Your ${CLASS_GEAR[from]} goes in your pack.`,
    "It keeps everything you earned.",
    `You can switch back at ${CLASS_PLACE_NAME[from]}.`,
  ];
}

/**
 * This phone's part in a class place, or nothing outside one. Drawn by
 * PlayerPanel in place of the scene's choices while the room is waiting.
 */
export function ClassPlaceChoice(): ReactElement | null {
  const state = useRunState();
  const me = useMe();
  const party = useParty();
  const rules = useRules();
  const send = useSend();
  const [picked, setPicked] = useState<"switch" | "keep" | null>(null);
  const [busy, setBusy] = useState(false);

  const place = state?.phase === "scene" ? state.classPlace : undefined;
  if (!place || me === null) return null;

  const to = place.class;
  const from = me.character.class;
  const toName = className(rules, to);
  const fromName = className(rules, from);
  const owes = owesClassAnswer(place, me);
  const waitingOn = classPlaceWaitingOn({ classPlace: place, party }).filter((m) => m.playerId !== me.playerId);

  const answer = async (wantsSwitch: boolean): Promise<void> => {
    setBusy(true);
    try {
      await send(wantsSwitch ? { type: "SWITCH_CLASS", classId: to } : { type: "KEEP_CLASS", classId: to });
    } finally {
      setBusy(false);
      setPicked(null);
    }
  };

  const beButton = (
    <li>
      <button type="button" className="choice kad-tap kad-focusable" onClick={() => setPicked("switch")}>
        <span className="choice__icon">
          <Icon name={to} size="1.8em" />
        </span>
        <span className="choice__label">{`Be a ${toName}`}</span>
      </button>
    </li>
  );

  // The "are you sure?", for whichever answer was tapped.
  const sure =
    picked === null ? null : (
      <div
        className="class-place__sure"
        role="alertdialog"
        aria-label={picked === "switch" ? `Become a ${toName}?` : `Stay a ${fromName}?`}
      >
        <p className="class-place__ask">{picked === "switch" ? "Are you sure?" : `Keep your ${CLASS_GEAR[from]}?`}</p>
        {picked === "switch" ? (
          <ul className="class-place__lines">
            {switchLines(from, to).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <div className="confirm__actions">
          <Button variant="ghost" size="md" icon={<Icon name="back" />} onClick={() => setPicked(null)}>
            No, wait
          </Button>
          <Button
            variant="primary"
            size="md"
            icon={<Icon name={picked === "switch" ? to : "check"} />}
            disabled={busy}
            onClick={() => void answer(picked === "switch")}
          >
            {picked === "switch" ? "Yes, switch!" : "Yes, keep it"}
          </Button>
        </div>
      </div>
    );

  if (!owes) {
    // Answered, or already this class: say where things stand, and who the
    // way on is waiting for, if anybody.
    const mine = place.answers[me.playerId];
    // A kid who said "stay" may still change their mind while the room is
    // open, as the server allows.
    const mayStillSwitch = mine?.switched === false && from !== to;
    return (
      <div className="prompt class-place" data-testid="class-place">
        <h3 className="prompt__title">
          <Icon name={from} />
          <span>{mine?.switched ? `You are a ${fromName} now!` : `You are a ${fromName}.`}</span>
        </h3>
        {waitingOn.length > 0 ? (
          <p className="prompt__sub kad-muted" role="status">
            <Icon name="waiting" />
            <span>{`Waiting for ${names(waitingOn)} to decide.`}</span>
          </p>
        ) : null}
        {mayStillSwitch ? (picked === null ? <ul className="prompt__options">{beButton}</ul> : sure) : null}
      </div>
    );
  }

  return (
    <div className="prompt class-place" data-testid="class-place">
      <h3 className="prompt__title">
        <Icon name={to} />
        <span>{`Become a ${toName}?`}</span>
      </h3>
      <p className="prompt__sub kad-muted">
        <Icon name="hand" />
        <span>Only you decide this one.</span>
      </p>

      {picked === null ? (
        <ul className="prompt__options">
          {beButton}
          <li>
            <button
              type="button"
              className="choice kad-tap kad-focusable"
              onClick={() => setPicked("keep")}
            >
              <span className="choice__icon">
                <Icon name={from} size="1.8em" />
              </span>
              <span className="choice__label">{`Stay a ${fromName}`}</span>
            </button>
          </li>
        </ul>
      ) : (
        sure
      )}
    </div>
  );
}

/** The TV's line for each hero at a class place, or nothing outside one. */
export function ClassPlaceRoll(): ReactElement | null {
  const state = useRunState();
  const party = useParty();
  const rules = useRules();
  const place = state?.phase === "scene" ? state.classPlace : undefined;
  if (!place) return null;

  return (
    <ul className="class-roll" data-testid="class-roll" aria-label="Who is switching">
      {party.map((member) => {
        const answer = place.answers[member.playerId];
        const wearing = className(rules, member.character.class);
        const line = answer?.switched
          ? `${member.character.name} put on the ${CLASS_GEAR[place.class]}!`
          : answer
            ? `${member.character.name} kept the ${CLASS_GEAR[member.character.class]}.`
            : member.character.class === place.class
              ? `${member.character.name} is a ${wearing}.`
              : member.connected
                ? `${member.character.name} is deciding…`
                : `${member.character.name} stepped away.`;
        return (
          <li key={member.playerId} className={`class-roll__hero${answer?.switched ? " class-roll__hero--switched" : ""}`}>
            <Icon name={member.character.class} />
            <span>{line}</span>
          </li>
        );
      })}
    </ul>
  );
}
