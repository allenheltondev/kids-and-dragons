/**
 * The API function's push dispatcher (#466): one asynchronous invoke of the
 * push-sender function per step that opened a question, with the job as its
 * payload.
 *
 * `InvocationType: "Event"` is the point. Lambda queues the event and answers
 * 202 at once, so the API waits only for the hand-over (tens of milliseconds,
 * and never more than `DISPATCH_WAIT_MS`), and the sender reads presence and
 * phones and calls the push services in its own invocation, which outlives
 * this one. Not awaiting at all would not do: once the API's response is
 * returned the container is frozen, and an invoke still in flight may never
 * leave it.
 *
 * Lambda keeps its default async retries (two). The sender swallows every
 * push failure and returns success, so a retry follows only a crash of the
 * sender itself, and the job is read against the room as it is then.
 */

import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { PushDispatch, TurnPushJob } from "../handlers/push.ts";

/** The one call made on the client, so a test can stand in for it. */
export interface InvokeClient {
  send(command: InvokeCommand): Promise<{ StatusCode?: number | undefined }>;
}

export function lambdaPushDispatch(functionName: string, client: InvokeClient = new LambdaClient({})): PushDispatch {
  return async (job: TurnPushJob) => {
    const out = await client.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(JSON.stringify(job)),
      }),
    );
    // 202 is "queued". Anything else is a hand-over that did not happen.
    if (out.StatusCode !== 202) throw new Error(`push sender invoke answered ${String(out.StatusCode)}`);
  };
}
