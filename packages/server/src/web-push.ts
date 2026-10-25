/**
 * The push transport (#466): `web-push` behind the `PushSender` seam, and how
 * each entry point decides whether pushes are on at all.
 *
 * Off is the default everywhere. `KAD_PUSH` must say `on` (or, in the dev
 * server only, `record`), and there must be a VAPID key pair and a subject:
 *
 * - **Lambda** (`lambda/runtime.ts`): the key pair is one SecureString,
 *   `PUSH_KEY_PARAMETER` (`/kad/<stage>/push-vapid-keys`), minted by the API
 *   function on first use exactly as the token signing key is
 *   (`ssmParameterSource`), so turning pushes on needs no secret typed in by
 *   hand. The subject is `KAD_PUSH_SUBJECT`, a `mailto:` or `https:` address
 *   the push services can reach the operator at.
 * - **Dev server**: `KAD_VAPID_PUBLIC_KEY`, `KAD_VAPID_PRIVATE_KEY` and
 *   `KAD_PUSH_SUBJECT`; or `KAD_PUSH=record`, which needs none of them and
 *   sends nothing anywhere: every push is kept in memory for
 *   `GET /api/dev/push`, so an e2e test can see what would have gone.
 *
 * The payload is encrypted for the browser (RFC 8291), so the push service
 * (Apple's, Google's, Mozilla's) carries bytes it cannot read; and what is
 * inside is only ever the fixed sentence and the room's path (#320).
 */

import webpush from "web-push";
import { PUSH_TAG, type TurnPushPayload } from "@kad/shared";
import { deliverTurnPush, type PushConfig, type PushDispatch, type PushSender, type PushSenderDeps, type PushSendResult } from "./handlers/push.ts";
import type { PushSubscriptionRecord } from "./store/repository.ts";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * How long a push service may hold a turn for a phone that is off: a question
 * a quarter of an hour old has usually been answered by somebody else.
 */
const TTL_SECONDS = 900;
/** A push service slower than this is not worth holding the action's response for. */
const SEND_TIMEOUT_MS = 3000;

/** A fresh VAPID key pair, as the one SecureString the Lambda keeps it in. */
export function mintVapidKeys(): string {
  return JSON.stringify(webpush.generateVAPIDKeys());
}

/** The stored pair, checked. Throws on anything else: a wrong key must fail loudly, at boot. */
export function parseVapidKeys(stored: string): VapidKeys {
  const parsed = JSON.parse(stored) as Partial<VapidKeys>;
  if (typeof parsed.publicKey !== "string" || typeof parsed.privateKey !== "string") {
    throw new Error("push key parameter does not hold a VAPID key pair");
  }
  return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
}

/** What `web-push` throws for a refused delivery. */
function statusOf(err: unknown): number | undefined {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" ? status : undefined;
}

/** 404 and 410 are the push service saying this subscription is gone for good. */
export function sendOutcome(status: number | undefined): PushSendResult {
  if (status === undefined) return "failed";
  if (status === 404 || status === 410) return "gone";
  return status >= 200 && status < 300 ? "sent" : "failed";
}

/** The real thing. */
export function webPushSender(keys: VapidKeys, subject: string): PushSender {
  return {
    async send(subscription: PushSubscriptionRecord, payload: TurnPushPayload): Promise<PushSendResult> {
      try {
        const out = await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          JSON.stringify(payload),
          {
            vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
            TTL: TTL_SECONDS,
            urgency: "high",
            // A second turn waiting at the push service replaces the first.
            topic: PUSH_TAG,
            timeout: SEND_TIMEOUT_MS,
          },
        );
        return sendOutcome(out.statusCode);
      } catch (err) {
        const status = statusOf(err);
        if (status === undefined) console.warn("push: the push service could not be reached:", err);
        return sendOutcome(status);
      }
    },
  };
}

/** One push the recording sender kept (`KAD_PUSH=record`). */
export interface RecordedPush {
  at: string;
  playerId: string;
  deviceId: string;
  endpoint: string;
  payload: TurnPushPayload;
}

/**
 * The dev server's stand-in push service: keeps every push in `sent` and
 * sends nothing. An endpoint whose path ends in `/gone` answers 410, so the
 * "forget a dead subscription" path can be driven end to end too.
 */
export function recordingSender(now: () => number = Date.now): PushSender & { sent: RecordedPush[] } {
  const sent: RecordedPush[] = [];
  return {
    sent,
    async send(subscription, payload) {
      if (subscription.endpoint.endsWith("/gone")) return "gone";
      sent.push({
        at: new Date(now()).toISOString(),
        playerId: subscription.playerId,
        deviceId: subscription.deviceId,
        endpoint: subscription.endpoint,
        payload,
      });
      return "sent";
    },
  };
}

/**
 * A key pair the recording sender hands the client. A real pair, so the
 * browser's `pushManager.subscribe` would take it; minted per dev server.
 */
export function devVapidKeys(): VapidKeys {
  return webpush.generateVAPIDKeys();
}

/** `KAD_PUSH`, read the one way both entry points read it. Anything but `on`/`record` is off. */
export function pushMode(value: string | undefined): "off" | "on" | "record" {
  return value === "on" || value === "record" ? value : "off";
}

/** The config the handlers get, when pushes are on. */
export function pushConfig(keys: VapidKeys, dispatch: PushDispatch): PushConfig {
  return { publicKey: keys.publicKey, dispatch };
}

/**
 * The dev server's dispatcher: the same job the push-sender Lambda runs, run
 * in this process once the current request has been answered (`setImmediate`
 * fires after the response is written). Hand-over is immediate; the send
 * happens later, exactly as an async invoke's does. `settled` lets a test
 * wait for the sends.
 */
export function inProcessDispatch(deps: PushSenderDeps): PushDispatch & { settled(): Promise<void> } {
  let pending: Promise<unknown> = Promise.resolve();
  const dispatch = (async (job) => {
    const run = new Promise<void>((resolve) => {
      setImmediate(() => {
        void deliverTurnPush(job, deps).finally(resolve);
      });
    });
    pending = Promise.all([pending, run]);
  }) as PushDispatch & { settled(): Promise<void> };
  dispatch.settled = async () => {
    await pending;
  };
  return dispatch;
}
