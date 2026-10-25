/**
 * "It's your turn" while the app is in the background (#466).
 *
 * A kid's phone set down on the sofa goes quiet: the page is hidden, so it
 * stops beating (#258), and nothing on it can say a question is waiting. The
 * installed app can be woken by a Web Push. So when an action opens a prompt
 * for a kid whose phone has gone quiet in that room, the server sends one push
 * to each of her own phones that asked for them, and the service worker shows
 * a notification that opens the room.
 *
 * Three rules hold everything here:
 *
 * - **Off unless configured.** `deps.push` is absent unless the entry point
 *   was given VAPID keys and `KAD_PUSH=on`; absent, nothing here reads the
 *   store or sends anything.
 * - **Never in the way.** The request path only decides who a step opened a
 *   question for (`turnPushJob`, pure, from the states it already holds) and
 *   hands that job over (`PushConfig.dispatch`): an asynchronous invoke of a
 *   second Lambda in production (`lambda/push-sender.ts`), a task after the
 *   response in the dev server. Presence, subscriptions, devices and the push
 *   service are all the sender's (`deliverTurnPush`), so a slow push vendor
 *   never slows a tap, and a push service that says no is logged and forgotten.
 * - **Nothing but the sentence (#320).** The notification says `PUSH_BODY`
 *   and nothing else; the room's path rides encrypted, as data.
 *
 * "Quiet" is the server's own away rule (`AWAY_AFTER_MS`, presence.ts): her
 * last beat in this room is older than that, or her phone said goodbye. A
 * phone with no beat on record and still marked here is left alone, as the
 * presence sweep leaves it alone: there is no evidence it went anywhere.
 */

import {
  isPromptForPlayer,
  turnPushPayload,
  type PushKeyResponse,
  type PushSubscribeRequest,
  type RunState,
  type TurnPushPayload,
} from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import type { GameRepository, PushSubscriptionRecord } from "../store/repository.ts";
import { iso } from "./deps.ts";
import { AWAY_AFTER_MS } from "./presence.ts";

/** What a push service said about one delivery. */
export type PushSendResult =
  /** Accepted for delivery. */
  | "sent"
  /** 404 or 410: this subscription is dead and should be forgotten. */
  | "gone"
  /** Anything else. Logged; the subscription is kept for next time. */
  | "failed";

/** The transport seam: `web-push` in production, a recorder in tests and e2e. */
export interface PushSender {
  send(subscription: PushSubscriptionRecord, payload: TurnPushPayload): Promise<PushSendResult>;
}

/**
 * Present only when the entry point turned pushes on (`KAD_PUSH=on`) and has
 * keys. The request path needs only these two: the key to hand the client,
 * and a way to hand a job to whatever sends it. It never sends.
 */
export interface PushConfig {
  /** The VAPID public key, base64url, as `pushManager.subscribe` wants it. */
  publicKey: string;
  /**
   * Hand one turn's job to the sender, off the request path: an asynchronous
   * invoke of the push-sender Lambda in production, a task after the
   * response in the dev server. Resolves once the job is handed over, never
   * once it is sent (`dispatchTurnPush`).
   */
  dispatch: PushDispatch;
}

export type PushDispatch = (job: TurnPushJob) => Promise<void>;

/** What the sender needs that the request path does not: the transport and the away rule. */
export interface PushDelivery {
  sender: PushSender;
  /** `AWAY_AFTER_MS` unless the dev server says otherwise (`KAD_PRESENCE_AWAY_MS`). */
  awayAfterMs?: number | undefined;
}

export interface PushDeps {
  repo: GameRepository;
  now: () => number;
  push?: PushConfig | undefined;
}

/** The sender's own dependencies (`lambda/push-sender.ts`, the dev server's in-process copy). */
export interface PushSenderDeps {
  repo: GameRepository;
  now: () => number;
  delivery: PushDelivery;
}

// ---------------------------------------------------------------------------
// The client's half: the key, subscribing, unsubscribing
// ---------------------------------------------------------------------------

/** `GET /api/push/key`. */
export function pushKey(deps: Pick<PushDeps, "push">): PushKeyResponse {
  return deps.push ? { enabled: true, publicKey: deps.push.publicKey } : { enabled: false };
}

export type PushSubscribeResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; code: "ILLEGAL" | "FORBIDDEN" | "NOT_FOUND"; message: string };

/** Far longer than any push service's endpoint; a guard against a padded body. */
const MAX_ENDPOINT_CHARS = 2048;
/** A P-256 public key is 87 base64url characters, an auth secret 22. */
const MAX_KEY_CHARS = 256;
const BASE64URL = /^[A-Za-z0-9_-]+=*$/;

/** The body, checked: an `https:` endpoint and two base64url keys. `null` when it is not one. */
export function readSubscription(body: unknown): PushSubscribeRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { endpoint, keys } = body as { endpoint?: unknown; keys?: unknown };
  if (typeof endpoint !== "string" || endpoint.length > MAX_ENDPOINT_CHARS) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (typeof keys !== "object" || keys === null) return null;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  const key = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_CHARS && BASE64URL.test(value);
  if (!key(p256dh) || !key(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/**
 * `POST /api/push/subscribe`: this phone takes pushes for its kid. Only a
 * kid's own phone, by its device token: a TV or a family tablet is nobody's
 * phone, and a push to it would tell the wrong person.
 */
export async function subscribePush(
  input: { principal: DeviceIdentity | null; body: unknown },
  deps: PushDeps,
): Promise<PushSubscribeResult> {
  if (!deps.push) return { ok: false, status: 404, code: "NOT_FOUND", message: "this server sends no pushes" };
  const principal = input.principal;
  if (!principal || principal.playerId === "") {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "only a player's own phone takes pushes" };
  }
  const subscription = readSubscription(input.body);
  if (!subscription) return { ok: false, status: 400, code: "ILLEGAL", message: "not a push subscription" };
  await deps.repo.putPushSubscription({
    playerId: principal.playerId,
    householdId: principal.householdId,
    deviceId: principal.deviceId,
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    createdAt: iso(deps.now()),
  });
  return { ok: true };
}

/**
 * `POST /api/push/unsubscribe`: this phone stops taking pushes. Works with
 * pushes switched off too, so a phone can always take its address back.
 */
export async function unsubscribePush(
  input: { principal: DeviceIdentity | null },
  deps: Pick<PushDeps, "repo">,
): Promise<PushSubscribeResult> {
  const principal = input.principal;
  if (!principal || principal.playerId === "") {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "only a player's own phone takes pushes" };
  }
  await deps.repo.deletePushSubscription(principal.playerId, principal.deviceId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * The kids a step just opened a question for. Pure.
 *
 * "Opened": the prompt after the step waits on her (`isPromptForPlayer`, the
 * same answer her phone's buttons and badge read), and the one before either
 * did not, or was a different question (another scene, another roll). A whole-
 * party roll that only lost somebody else's die opened nothing new for her.
 * The kid who just acted is never one: she is holding her phone.
 */
export function openedFor(before: RunState, after: RunState, actorId: string): string[] {
  if (after.closed || !after.prompt) return [];
  const same = promptKey(before) === promptKey(after);
  return after.party
    .map((member) => member.playerId)
    .filter((playerId) => playerId !== actorId)
    .filter((playerId) => isPromptForPlayer(after.prompt, playerId, after.party))
    .filter((playerId) => !same || !isPromptForPlayer(before.prompt, playerId, before.party));
}

/** Which question a prompt is, ignoring how far it has got (votes cast, dice rolled). */
function promptKey(state: RunState): string {
  const prompt = state.prompt;
  if (!prompt) return "";
  switch (prompt.kind) {
    case "interaction":
      return `interaction ${prompt.openedSeq}`;
    case "choice":
      return `choice ${prompt.sceneId}`;
    case "roll":
      return `roll ${prompt.sceneId} ${prompt.group ? "all" : prompt.characterId}`;
    case "item_swap":
      return `item_swap ${prompt.characterId} ${prompt.incomingItemId}`;
    case "ready":
      return `ready ${state.phase} ${state.sceneId ?? ""}`;
  }
}

/**
 * Of `candidates`, the ones whose phone is quiet in this room: marked away, or
 * last heard from longer ago than the away rule allows. Pure.
 */
export function quietOnes(
  candidates: readonly string[],
  state: RunState,
  beats: Record<string, string>,
  nowMs: number,
  awayAfterMs: number = AWAY_AFTER_MS,
): string[] {
  return candidates.filter((playerId) => {
    const member = state.party.find((m) => m.playerId === playerId);
    if (!member) return false;
    if (!member.connected) return true;
    const seen = beats[playerId];
    return seen !== undefined && nowMs - Date.parse(seen) > awayAfterMs;
  });
}

// ---------------------------------------------------------------------------
// The job: decided on the request path, sent off it
// ---------------------------------------------------------------------------

/**
 * One step's worth of turn notices, as handed from the action handler to the
 * sender: everything the decision needs that the step already knew, and
 * nothing about the kids but their ids.
 */
export interface TurnPushJob {
  kind: "turn";
  runId: string;
  roomCode: string;
  /** The step that opened the question. */
  seq: number;
  /** The kids it opened a question for (`openedFor`), the actor never among them. */
  candidates: string[];
  actorId: string;
  /** Epoch millis of the step. */
  at: number;
}

/** The job for a step, or `null` when it opened a question for nobody. Pure. */
export function turnPushJob(before: RunState, after: RunState, actorId: string, at: number): TurnPushJob | null {
  const candidates = openedFor(before, after, actorId);
  if (candidates.length === 0) return null;
  return { kind: "turn", runId: after.runId, roomCode: after.roomCode, seq: after.seq, candidates, actorId, at };
}

/** A job off the wire (an async invoke's payload), checked. `null` when it is not one. */
export function readTurnPushJob(value: unknown): TurnPushJob | null {
  const job = value as Partial<TurnPushJob> | null;
  if (typeof job !== "object" || job === null || job.kind !== "turn") return null;
  const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128;
  if (!id(job.runId) || !id(job.roomCode) || typeof job.actorId !== "string") return null;
  if (typeof job.seq !== "number" || typeof job.at !== "number") return null;
  if (!Array.isArray(job.candidates) || job.candidates.length > 16 || !job.candidates.every(id)) return null;
  return { kind: "turn", runId: job.runId, roomCode: job.roomCode, seq: job.seq, candidates: [...job.candidates], actorId: job.actorId, at: job.at };
}

/**
 * The longest the action handler waits for a job to be handed over. An async
 * Lambda invoke answers in tens of milliseconds; one that has not answered by
 * then is abandoned and logged, so a slow or broken dispatch can never hold a
 * tap's answer for longer than this.
 */
export const DISPATCH_WAIT_MS = 500;

/**
 * The request path's whole part in a push: decide whether this step opened a
 * question for anybody, and if so hand the job over. No store reads, no
 * sends. Never throws, and never waits longer than `DISPATCH_WAIT_MS`.
 */
export async function dispatchTurnPush(
  input: { before: RunState; after: RunState; actorId: string },
  deps: Pick<PushDeps, "push" | "now">,
  waitMs: number = DISPATCH_WAIT_MS,
): Promise<void> {
  const push = deps.push;
  if (!push) return;
  let job: TurnPushJob | null;
  try {
    job = turnPushJob(input.before, input.after, input.actorId, deps.now());
  } catch (err) {
    console.warn(`push: could not decide turn notices for run ${input.after.runId}:`, err);
    return;
  }
  if (!job) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), waitMs);
  });
  try {
    const handed = await Promise.race([push.dispatch(job).then(() => "handed" as const), late]);
    if (handed === "late") console.warn(`push: handing over turn notices for run ${job.runId} took over ${String(waitMs)}ms; moved on`);
  } catch (err) {
    console.warn(`push: turn notices for run ${job.runId} could not be handed over:`, err);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// The send (the push-sender's job)
// ---------------------------------------------------------------------------

/** What `deliverTurnPush` did, for tests and the log. */
export interface TurnPushReport {
  sent: number;
  /** Subscriptions forgotten: the push service said gone, or the phone is no longer hers. */
  dropped: number;
  failed: number;
}

const NOTHING: TurnPushReport = { sent: 0, dropped: 0, failed: 0 };

/**
 * One job: of the kids the step opened a question for, those whose phone is
 * quiet now and who are still being asked, get one push per subscribed
 * phone. Read against the room as it is now, not as it was: a question
 * answered by the time the job runs tells nobody. Never throws; every
 * failure is logged and swallowed, so an async retry only ever follows a
 * crash of the sender itself.
 */
export async function deliverTurnPush(job: TurnPushJob, deps: PushSenderDeps): Promise<TurnPushReport> {
  try {
    const [state, beats] = await Promise.all([deps.repo.getState(job.runId), deps.repo.getPresence(job.runId)]);
    if (!state || state.closed || !state.prompt) return NOTHING;
    const asked = job.candidates.filter((playerId) => isPromptForPlayer(state.prompt, playerId, state.party));
    const quiet = quietOnes(asked, state, beats, deps.now(), deps.delivery.awayAfterMs);
    if (quiet.length === 0) return NOTHING;

    const payload = turnPushPayload(job.roomCode);
    const report = { sent: 0, dropped: 0, failed: 0 };
    const subscriptions = (await Promise.all(quiet.map((playerId) => deps.repo.listPushSubscriptions(playerId)))).flat();
    const outcomes = await Promise.all(subscriptions.map((s) => deliver(s, payload, deps.delivery.sender, deps.repo)));
    for (const outcome of outcomes) report[outcome] += 1;
    if (report.failed > 0) {
      console.warn(`push: ${String(report.failed)} turn notice(s) for run ${job.runId} were not accepted`);
    }
    return report;
  } catch (err) {
    console.warn(`push: turn notices for run ${job.runId} were skipped:`, err);
    return NOTHING;
  }
}

/** One phone. Hers still, and alive, or forgotten. */
async function deliver(
  subscription: PushSubscriptionRecord,
  payload: TurnPushPayload,
  sender: PushSender,
  repo: GameRepository,
): Promise<"sent" | "dropped" | "failed"> {
  try {
    // A phone revoked, forgotten, moved to another kid or deleted since it
    // subscribed is not hers to tell any more.
    const device = await repo.getDeviceById(subscription.deviceId);
    const hers = device !== null && !device.revoked && device.kind !== "shared" && device.playerId === subscription.playerId;
    if (!hers) {
      await repo.deletePushSubscription(subscription.playerId, subscription.deviceId);
      return "dropped";
    }
    const result = await sender.send(subscription, payload);
    if (result === "gone") {
      await repo.deletePushSubscription(subscription.playerId, subscription.deviceId);
      return "dropped";
    }
    return result === "sent" ? "sent" : "failed";
  } catch (err) {
    console.warn(`push: a turn notice to device ${subscription.deviceId} failed:`, err);
    return "failed";
  }
}
