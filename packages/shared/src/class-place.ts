/**
 * Class places (docs/class-mastery.md §2, §3, #311): the Dojo, the Academy,
 * the Rookery and the Conservatory, each a scene marked `classPlace`.
 *
 * While one is open (`RunState.classPlace`), every seated hero not already its
 * class may switch to it, and each kid decides alone on their phone. There is
 * no vote. The way on waits until every connected hero who could switch has
 * answered, so the TV can show who switched and no kid is still reading their
 * "are you sure?" when the room closes around them. A disconnected phone is
 * not waited on, the same tolerance a vote has.
 *
 * Pure, and shared: the engine gates the way out on it, the server checks a
 * switch against it, and both screens read it to draw the room.
 */

import type { Scene } from "./types/chapter.js";
import type { ClassId } from "./types/domain.js";
import type { ClassPlaceState, PartyMember, RunState } from "./types/state.js";

/** The class a scene teaches, or undefined for every scene that is not a class place. */
export function classPlaceOf(scene: Scene): ClassId | undefined {
  return scene.type === "story" || scene.type === "choice_point" ? scene.classPlace : undefined;
}

/** The fresh state for a scene being entered: a closed room is absent. */
export function openClassPlace(scene: Scene): ClassPlaceState | undefined {
  const taught = classPlaceOf(scene);
  return taught === undefined ? undefined : { class: taught, answers: {} };
}

/**
 * Whether this member still owes an answer: they could switch (they are not
 * wearing the place's class) and have not said yes or no. Connected or not;
 * `classPlaceWaitingOn` is the one that forgives an absent phone.
 */
export function owesClassAnswer(place: ClassPlaceState, member: PartyMember): boolean {
  return member.character.class !== place.class && place.answers[member.playerId] === undefined;
}

/** The connected heroes the way on is waiting for, in seat order. Empty outside a class place. */
export function classPlaceWaitingOn(state: Pick<RunState, "classPlace" | "party">): PartyMember[] {
  const place = state.classPlace;
  if (!place) return [];
  return state.party.filter((member) => member.connected && owesClassAnswer(place, member));
}

/**
 * Why this player may not answer at this place, or null when they may. The
 * server's check and the engine's, so a tap the phone should never have drawn
 * gets the same words from either.
 */
export function classAnswerRefusal(
  state: Pick<RunState, "classPlace" | "party" | "phase">,
  playerId: string,
  classId: unknown,
  wantsSwitch: boolean,
): string | null {
  const place = state.classPlace;
  if (state.phase !== "scene" || !place) return "there is no class place here";
  if (classId !== place.class) return `this is not the ${String(classId)} place`;
  const member = state.party.find((m) => m.playerId === playerId);
  if (!member) return `player ${playerId} has no hero in this run`;
  if (member.character.class === place.class) {
    return wantsSwitch ? `${member.character.name} is already a ${place.class}` : `${member.character.name} has nothing to decide here`;
  }
  return null;
}
