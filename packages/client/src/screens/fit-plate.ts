/**
 * Fits the TV's story plate to its pane (#331).
 *
 * The plate is capped at half the pane so the stage keeps its share (stage-inset.ts), and the
 * story is typeset for a sofa, so a long passage in a wide font, or at the largest text size,
 * does not fit above its choices. The choices are what the table has to act on, so they get
 * their room first: the plate steps its type down one rung at a time, story first, until
 * everything fits. Each rung is a `data-fit` value NarrationPanel.css gives sizes to, and the
 * last never goes under the app's own body size, so a long passage stays readable. If even that
 * rung is too tall, the story alone scrolls (`data-clipped`) and the choices stay put.
 *
 * Measured on the page rather than guessed from the text's length, so it holds for whatever
 * font the screen ends up with, Inter, a system font, or a fallback.
 */

/** The last rung of NarrationPanel.css's ladder. */
export const LAST_FIT = 6;

/** Largest type that fits, from the top rung down; the plate is left as it was drawn if nothing is wrong. */
export function fitPlate(plate: HTMLElement): void {
  plate.removeAttribute("data-clipped");
  for (let rung = 0; rung <= LAST_FIT; rung++) {
    plate.dataset.fit = String(rung);
    if (plate.scrollHeight <= plate.clientHeight + 1) return;
  }
  plate.setAttribute("data-clipped", "");
}

/** Back to the plate's natural size (a fight, where the strip is not capped). */
export function unfitPlate(plate: HTMLElement): void {
  plate.removeAttribute("data-fit");
  plate.removeAttribute("data-clipped");
}
