/**
 * Class places (docs/class-mastery.md §2, §3, #311): the Dojo, the Academy,
 * the Rookery and the Conservatory, each a scene marked `classPlace`; and the
 * Exchange's fitting stall (§1, #312), which stands in the scenes
 * `rules.fittingStall` names and runs the same way with a different gate: a
 * new hero, any class, once.
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
import type { ClassId, ResolvedCharacter, RulesContent } from "./types/domain.js";
import type { ClientIntent } from "./types/protocol.js";
import type { ClassPlaceState, PartyMember, RunState } from "./types/state.js";

/** The class a scene teaches, or undefined for every scene that is not a class place. */
export function classPlaceOf(scene: Scene): ClassId | undefined {
  return scene.type === "story" || scene.type === "choice_point" ? scene.classPlace : undefined;
}

/**
 * Whether the fitting stall stands in this scene (`rules.fittingStall`). The
 * engine opens it on arrival and the server checks a swap against it, both
 * from the rules, never from the run's mirror alone.
 */
export function fittingStallAt(rules: Pick<RulesContent, "fittingStall">, chapterId: string, sceneId: string): boolean {
  return (rules.fittingStall?.stands ?? []).some((s) => s.chapterId === chapterId && s.sceneId === sceneId);
}

/**
 * A hero who may still use the fitting stall (docs/class-mastery.md §1):
 * new, which is two things.
 *
 * - **Has finished no chapter.** Every chapter's end awards XP, and nothing
 *   else does, so effective XP of 0 is "no chapter finished that stuck". A
 *   failed campaign takes its XP back, and so makes her new again; a hero who
 *   joined at a tier floor (spec §8.4) has XP she did not play for and is not
 *   new, as `isNewcomer` reads her too.
 * - **Has not spent the swap** (`fitted`), which a failed campaign also gives
 *   back, with the class it took off (`fitClass`).
 */
export function isNewHero(hero: Pick<ResolvedCharacter, "xp" | "fitted">): boolean {
  return hero.xp === 0 && hero.fitted !== true;
}

/**
 * The fresh state for a scene being entered: a closed room is absent. The
 * stall opens only where it stands and only while somebody seated is new, so
 * a table of veterans walks through that scene exactly as before the stall.
 */
export function openClassPlace(
  scene: Scene,
  at?: { rules: Pick<RulesContent, "fittingStall">; chapterId: string; sceneId: string; party: readonly PartyMember[] },
): ClassPlaceState | undefined {
  const taught = classPlaceOf(scene);
  if (taught !== undefined) return { class: taught, answers: {} };
  if (
    at &&
    (scene.type === "story" || scene.type === "choice_point") &&
    fittingStallAt(at.rules, at.chapterId, at.sceneId) &&
    at.party.some((member) => isNewHero(member.character))
  ) {
    return { stall: true, answers: {} };
  }
  return undefined;
}

/** Whether this member may switch here at all, answered or not. */
export function maySwitchAt(place: ClassPlaceState, member: PartyMember): boolean {
  return place.stall ? isNewHero(member.character) : member.character.class !== place.class;
}

/**
 * Whether this member still owes an answer: they could switch (not wearing
 * the room's class; at the stall, still new) and have not said yes or no.
 * Connected or not; `classPlaceWaitingOn` is the one that forgives an absent
 * phone.
 */
export function owesClassAnswer(place: ClassPlaceState, member: PartyMember): boolean {
  return place.answers[member.playerId] === undefined && maySwitchAt(place, member);
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
 * gets the same words from either. `stall` is the intent's: a tap aimed at
 * the stall is refused at a room, and the other way round.
 */
export function classAnswerRefusal(
  state: Pick<RunState, "classPlace" | "party" | "phase">,
  playerId: string,
  classId: unknown,
  wantsSwitch: boolean,
  stall = false,
): string | null {
  const place = state.classPlace;
  if (state.phase !== "scene" || !place) return "there is no class place here";
  if (stall !== (place.stall === true)) {
    return stall ? "there is no fitting stall here" : "this is the fitting stall, not a class place";
  }
  if (!place.stall && classId !== place.class) return `this is not the ${String(classId)} place`;
  const member = state.party.find((m) => m.playerId === playerId);
  if (!member) return `player ${playerId} has no hero in this run`;
  if (place.stall) {
    if (!isNewHero(member.character)) {
      return `${member.character.name} has had a fitting already, or is not new`;
    }
    // Keeping names the class kept; a switch names any other (switchClass refuses the same one).
    if (!wantsSwitch && classId !== member.character.class) return `${member.character.name} is not a ${String(classId)}`;
    if (wantsSwitch && classId === member.character.class) return `${member.character.name} is already a ${String(classId)}`;
    return null;
  }
  if (member.character.class === place.class) {
    return wantsSwitch ? `${member.character.name} is already a ${place.class}` : `${member.character.name} has nothing to decide here`;
  }
  return null;
}

/**
 * "Keep what I wear" for this member at this place, as their phone would
 * send it: the room's class at a room, their own at the stall. For the tools
 * that play a table without phones (the load tool, the playthrough driver).
 */
export function keepClassIntent(place: ClassPlaceState, member: PartyMember): ClientIntent {
  return place.stall
    ? { type: "KEEP_CLASS", classId: member.character.class, stall: true }
    : { type: "KEEP_CLASS", classId: place.class };
}
