/**
 * The name of a game's realtime channel: `/room/<code>/<runId>`.
 *
 * One definition, used by the publisher, the browser and the authorizer, so the
 * three cannot drift. AppSync Events allows one to five slash-separated
 * segments, each of letters, digits and hyphens only, starting and ending with
 * a letter or digit and at most 50 characters. Our ids have an underscore
 * (`r_4k2...`), which is not allowed, so the run's segment is the id with each
 * underscore written as a hyphen. That is for the channel's name alone: the run
 * keeps its id everywhere else, in the database and in every token.
 *
 * It is reversible because no id carries a hyphen, and an id that is not
 * representable gets no channel (`null`) rather than a colliding one.
 */

/** One AppSync Events channel segment. */
const SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?$/;

/** The whole channel, as AppSync documents it (`event-api-websocket-protocol`). */
export const APPSYNC_CHANNEL_PATTERN =
  /^\/?[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?(?:\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?){0,4}\/?$/;

/** A run's channel segment, or `null` for an id that has none. */
export function runChannelSegment(runId: string): string | null {
  if (runId.includes("-")) return null;
  const segment = runId.replace(/_/g, "-");
  return SEGMENT.test(segment) ? segment : null;
}

/** `/room/ABCD/r-4k2...` for a namespace, a room's letters and a run. Throws for an id with no channel. */
export function roomChannelPath(namespace: string, roomCode: string, runId: string): string {
  const segment = runChannelSegment(runId);
  if (segment === null) throw new Error(`run id ${JSON.stringify(runId)} cannot be a channel name`);
  return `/${namespace}/${roomCode.toUpperCase()}/${segment}`;
}
