/**
 * Who runs the game, for the privacy page (#523). If either is ever
 * emptied, the page says plainly that nobody is named rather than show a blank
 * or a guessed address.
 */

export interface Operator {
  /** The person or company that runs Kids & Dragons. */
  name: string;
  /** Where a grown-up can write about privacy: an email address. */
  contact: string;
}

export const OPERATOR: Operator = {
  name: "Allen Helton",
  contact: "allenheltondev@gmail.com",
};
