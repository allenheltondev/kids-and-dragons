/**
 * Whether this browser is a television's own (#264).
 *
 * Used only to spend less on a set-top GPU, never to decide what the game shows: a TV and a
 * laptop on the end of an HDMI cable run the same display, and anything that changed the story
 * or the controls by make of screen would be untestable at the table. A wrong guess here costs
 * a slightly softer board, nothing else.
 *
 * Sniffing a user agent is a last resort, and this is one of the places it is the only resort:
 * nothing a TV browser reports says "I am a TV" except its name, and `devicePixelRatio` cannot
 * tell a 4K panel from a retina laptop.
 */

/** The names the TV platforms put in their user agent. Samsung's is `Tizen`, with `SMART-TV`. */
const TV_NAMES = /\b(?:smart-?tv|smarttv|tizen|web0s|webos|hbbtv|netcast|viera|bravia|aquos|vidaa|googletv|crkey|appletv|roku|silk\/|aft[a-z]{1,4}\b)/i;

export function isTvBrowser(agent: string | undefined = typeof navigator === "undefined" ? undefined : navigator.userAgent): boolean {
  return agent !== undefined && TV_NAMES.test(agent);
}
