/**
 * The push-sender function (#466): "It's your turn", off the request path.
 *
 * The API function decides which kids a step opened a question for and hands
 * that job here with an asynchronous invoke (`push-dispatch.ts`); this
 * function does the slow part, in an invocation of its own: reads the room
 * and its presence beats, picks the kids whose phone is quiet and who are
 * still being asked, sends one push per subscribed phone, and forgets the
 * subscriptions a push service says are gone (`deliverTurnPush`).
 *
 * Every push failure is swallowed and the invocation succeeds, so Lambda's
 * async retries only ever follow a crash here (a boot that could not read the
 * table or the key). A job that is not one is dropped with a log line rather
 * than retried: retrying it would not make it one.
 */

import { deliverTurnPush, readTurnPushJob, type PushSenderDeps, type TurnPushReport } from "../handlers/push.ts";
import { DynamoRepository } from "../store/dynamo-repository.ts";
import { pushDeliveryFromEnv, requiredEnv } from "./runtime.ts";

/** What one invocation did. `skipped` when pushes are off here or the job was not one. */
export type SenderResult = TurnPushReport | { skipped: "off" | "not-a-job" };

/** The handler with its wiring passed in, so a test runs it on a memory store and a recorder. */
export function makeSenderHandler(deps: () => Promise<PushSenderDeps | null>): (event: unknown) => Promise<SenderResult> {
  return async (event: unknown) => {
    const job = readTurnPushJob(event);
    if (!job) {
      console.warn("push-sender: an event that is not a turn job was dropped");
      return { skipped: "not-a-job" };
    }
    const wired = await deps();
    if (!wired) return { skipped: "off" };
    return deliverTurnPush(job, wired);
  };
}

let cached: Promise<PushSenderDeps | null> | null = null;

/** Built once per container: the table client and the signed transport. */
function senderRuntime(): Promise<PushSenderDeps | null> {
  cached ??= (async () => {
    const delivery = await pushDeliveryFromEnv();
    if (!delivery) return null;
    return { repo: new DynamoRepository({ tableName: requiredEnv("TABLE_NAME") }), now: () => Date.now(), delivery };
  })().catch((err: unknown) => {
    // Never cache a failed boot: the retry Lambda makes deserves a fresh one.
    cached = null;
    throw err;
  });
  return cached;
}

export const handler = makeSenderHandler(senderRuntime);
