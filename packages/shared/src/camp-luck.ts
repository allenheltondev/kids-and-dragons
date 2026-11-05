/**
 * Lucky drops' numbers (docs/camp.md §5.2, decided): a 1 in 8 chance of 1
 * Dash Cash after each mini-game the party succeeds at and each fight it
 * wins, at most 2 a chapter. In a file of their own, with no imports, because
 * the engine rolls them and everything the engine imports rides in the first
 * paint (away.ts says why).
 */

/** A lucky drop is a 1 in this many chance. */
export const LUCKY_DROP_ODDS = 8;
/** At most this many lucky drops in one chapter, across every attempt at it. */
export const LUCKY_DROPS_PER_CHAPTER = 2;

/** Whether one draw of the step's seeded rng (`Rng.next()`, in [0, 1)) comes up. */
export function luckyRoll(draw: number): boolean {
  return draw < 1 / LUCKY_DROP_ODDS;
}
