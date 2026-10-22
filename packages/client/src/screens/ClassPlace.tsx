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
 * The Exchange's fitting stall (#312, §1) is the same two pieces with a
 * different gate: only a new hero answers, and may put on any class but the
 * one worn, once. The TV says the stall's own words above the roll call.
 *
 * On screen a class token is always its own name ("your thorn bracer",
 * §4); "token" is only the word in code and docs.
 */

import { useState } from "react";
import type { ReactElement } from "react";
import { classPlaceWaitingOn, maySwitchAt, owesClassAnswer } from "@kad/shared";
import type { ClassId, ClassPlaceState, PartyMember, RulesContent } from "@kad/shared";
import { useMe, useParty, useRules, useRunState, useSend, useSynced } from "../store";
import { Button } from "../ui/Button";
import { ClassToken, tokenName } from "./ClassToken";
import { Icon } from "./icons";
import "./ClassPlace.css";

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
 * the tests, which read it as a kid would. At the fitting stall, `keeper` is
 * the tailor, and the kid hears that this is their one fitting.
 */
export function switchLines(from: ClassId, to: ClassId, keeper?: string): string[] {
  return [
    `You take off your ${tokenName(from)} and put on the ${tokenName(to)}.`,
    `Your ${tokenName(from)} goes in your pack.`,
    "It keeps everything you earned.",
    // At the stall, said plainly: this is the only free swap, and it does
    // not come back.
    ...(keeper ? ["This is your one free swap.", `${keeper} will not offer it again.`] : []),
    `You can switch back at ${CLASS_PLACE_NAME[from]}.`,
  ];
}

/** The classes this hero may put on here: the room's, or at the stall any other. */
function classesOn(place: ClassPlaceState, wearing: ClassId): ClassId[] {
  return place.stall ? (Object.keys(CLASS_PLACE_NAME) as ClassId[]).filter((id) => id !== wearing) : [place.class];
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
  // The class a "Be a …" tap picked, or "keep", until the "are you sure?" is answered.
  const [picked, setPicked] = useState<ClassId | "keep" | null>(null);
  const [busy, setBusy] = useState(false);
  // Held while catching up after a drop, like every answer (#413).
  const synced = useSynced();

  const place = state?.phase === "scene" ? state.classPlace : undefined;
  if (!place || me === null) return null;

  const stall = place.stall === true;
  const keeper = stall ? (rules?.fittingStall?.keeper ?? "The tailor") : undefined;
  const from = me.character.class;
  const fromName = className(rules, from);
  const options = classesOn(place, from);
  const owes = owesClassAnswer(place, me);
  const waitingOn = classPlaceWaitingOn({ classPlace: place, party }).filter((m) => m.playerId !== me.playerId);

  const answer = async (to: ClassId | "keep"): Promise<void> => {
    setBusy(true);
    try {
      const at = stall ? { stall: true as const } : {};
      await send(
        to === "keep"
          ? { type: "KEEP_CLASS", classId: stall ? from : (options[0] ?? from), ...at }
          : { type: "SWITCH_CLASS", classId: to, ...at },
      );
    } finally {
      setBusy(false);
      setPicked(null);
    }
  };

  const beButtons = options.map((to) => (
    <li key={to}>
      <button type="button" className="choice kad-tap kad-focusable" onClick={() => setPicked(to)}>
        <span className="choice__icon">
          <Icon name={to} size="1.8em" />
        </span>
        <span className="choice__label">{`Be a ${className(rules, to)}`}</span>
      </button>
    </li>
  ));

  // The "are you sure?", for whichever answer was tapped.
  const sure =
    picked === null ? null : (
      <div
        className="class-place__sure"
        role="alertdialog"
        aria-label={picked === "keep" ? `Stay a ${fromName}?` : `Become a ${className(rules, picked)}?`}
      >
        <p className="class-place__ask">{picked === "keep" ? `Keep your ${tokenName(from)}?` : "Are you sure?"}</p>
        {picked !== "keep" ? (
          /* The two tokens, notches and all (#314): the one coming off keeps
             every notch it has, in the pack. */
          <p className="class-place__tokens">
            <ClassToken classId={from} rank={me.character.rank} owner="your" holdable={false} />
            <Icon name="forward" />
            <ClassToken classId={picked} rank={me.character.spares?.find((s) => s.class === picked)?.rank} holdable={false} />
          </p>
        ) : null}
        {picked !== "keep" ? (
          <ul className="class-place__lines">
            {switchLines(from, picked, keeper).map((line) => (
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
            icon={<Icon name={picked === "keep" ? "check" : picked} />}
            disabled={busy || !synced}
            onClick={() => void answer(picked)}
          >
            {picked === "keep" ? "Yes, keep it" : "Yes, switch!"}
          </Button>
        </div>
      </div>
    );

  if (!owes) {
    // Answered, or nothing to decide here: say where things stand, and who
    // the way on is waiting for, if anybody.
    const mine = place.answers[me.playerId];
    // A kid who said "stay" may still change their mind while the room is
    // open, as the server allows.
    const mayStillSwitch = mine?.switched === false && maySwitchAt(place, me);
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
        {mayStillSwitch ? (picked === null ? <ul className="prompt__options">{beButtons}</ul> : sure) : null}
      </div>
    );
  }

  return (
    <div className="prompt class-place" data-testid="class-place">
      <h3 className="prompt__title">
        <Icon name={stall ? "hand" : (options[0] ?? from)} />
        <span>{stall ? "Try on a new class?" : `Become a ${className(rules, options[0] ?? from)}?`}</span>
      </h3>
      <p className="prompt__sub kad-muted">
        <Icon name="hand" />
        <span>{stall ? "Only you decide this one. It is free, but only this one time." : "Only you decide this one."}</span>
      </p>

      {picked === null ? (
        <ul className="prompt__options">
          {beButtons}
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

/**
 * The TV's line for each hero at a class place, or nothing outside one. At
 * the fitting stall the stall's own words come first, which is where the
 * tailor is introduced before any phone names her.
 */
export function ClassPlaceRoll(): ReactElement | null {
  const state = useRunState();
  const party = useParty();
  const rules = useRules();
  const place = state?.phase === "scene" ? state.classPlace : undefined;
  if (!place) return null;
  const words = place.stall ? rules?.fittingStall?.narration : undefined;

  const roll = (
    <ul className="class-roll" data-testid="class-roll" aria-label="Who is switching">
      {party.map((member) => {
        const answer = place.answers[member.playerId];
        const wearing = className(rules, member.character.class);
        const line = answer?.switched
          ? `${member.character.name} put on the ${tokenName(member.character.class)}!`
          : answer
            ? `${member.character.name} kept the ${tokenName(member.character.class)}.`
            : !maySwitchAt(place, member)
              ? `${member.character.name} is a ${wearing}.`
              : member.connected
                ? `${member.character.name} is deciding…`
                : `${member.character.name} stepped away.`;
        return (
          <li key={member.playerId} className={`class-roll__hero${answer?.switched ? " class-roll__hero--switched" : ""}`}>
            <ClassToken classId={member.character.class} rank={member.character.rank} size="sm" owner={`${member.character.name}'s`} holdable={false} />
            <span>{line}</span>
          </li>
        );
      })}
    </ul>
  );
  if (!words) return roll;
  return (
    <div className="class-stall" data-testid="fitting-stall">
      <p className="class-stall__words">{words}</p>
      {roll}
    </div>
  );
}
