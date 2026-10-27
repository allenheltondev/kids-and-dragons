/**
 * Who runs the game, for the privacy page (#523). Empty on purpose until the
 * operator fills it in: the page says so plainly rather than show an address
 * nobody reads. A launch checklist item (docs/review/us-launch-privacy-readiness.md,
 * #526), not something to guess.
 */

export interface Operator {
  /** The person or company that runs Kids & Dragons. */
  name: string;
  /** Where a grown-up can write about privacy: an email address. */
  contact: string;
}

export const OPERATOR: Operator = {
  name: "",
  contact: "",
};
