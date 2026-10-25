/** Keep the approved 1.4s recording, slowed to the longer visual throw. */
export const DICE_TUMBLE_MS = 2200;
export const DICE_PLAYBACK_RATE = 1400 / DICE_TUMBLE_MS;
/** These six contacts already occur in the recorded sample. */
export const DICE_CONTACT_MS = [218, 403, 640, 810, 1040, 1230].map(
  (ms) => ms / DICE_PLAYBACK_RATE,
);
