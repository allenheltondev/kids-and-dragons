/**
 * `AppSyncEventsChannel` — the prod transport, architecture §4.4.
 *
 * A game is a channel: `room/<code>/<runId>`. Lambda publishes to it over the Event
 * API's HTTP endpoint with SigV4; browsers subscribe over its WebSocket endpoint
 * with their room session token (see `lambda/channel-authorizer.ts`). That
 * asymmetry is why `subscribe()` here throws rather than being implemented —
 * nothing server-side ever needs to listen to a room, and a plausible-looking
 * no-op would hide that fact until a handler quietly stopped receiving.
 *
 * Why AppSync Events at all (§1.1): no connection table, no `$connect` /
 * `$disconnect` bookkeeping, no stale-connection sweeping. The seam exists so
 * that decision stays reversible — Momento Topics or API Gateway WebSockets is
 * one more class implementing `RoomChannel`, and nothing above this file moves.
 */

import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import type { AwsCredentialIdentityProvider } from "@smithy/types";
import type { ChannelMessage, RoomChannel, Unsubscribe } from "@kad/shared";

export interface AppSyncEventsChannelOptions {
  /** The Event API's HTTP domain, e.g. `abc123.appsync-api.us-east-1.amazonaws.com`. */
  httpDomain: string;
  region: string;
  /** Defaults to the Lambda execution role. */
  credentials?: AwsCredentialIdentityProvider;
  /** Injected by tests. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/** A publish is one small POST; past this, the connection is not coming back. */
export const PUBLISH_TIMEOUT_MS = 2_000;

/** The channel namespace the API is configured with. Rooms live under it. */
export const ROOM_NAMESPACE = "room";

export class AppSyncEventsChannel implements RoomChannel {
  private readonly signer: SignatureV4;
  private readonly endpoint: string;
  private readonly domain: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: AppSyncEventsChannelOptions) {
    this.domain = options.httpDomain;
    this.endpoint = `https://${options.httpDomain}/event`;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.signer = new SignatureV4({
      service: "appsync",
      region: options.region,
      credentials: options.credentials ?? defaultProvider(),
      sha256: Hash.bind(null, "sha256"),
    });
  }

  async publish(roomCode: string, message: ChannelMessage): Promise<void> {
    // The run is in the channel's name (see `channelFor`); every message carries it.
    const channel = channelFor(roomCode, message.runId);
    const body = JSON.stringify({
      channel,
      // The Events API takes an array of **strings**, each one a serialised
      // event — not an array of objects. Passing objects is accepted and then
      // delivered as `[object Object]`, which is a genuinely confusing hour.
      events: [JSON.stringify(message)],
    });

    const request = new HttpRequest({
      method: "POST",
      protocol: "https:",
      hostname: this.domain,
      path: "/event",
      headers: {
        // `host` must be present *before* signing or the signature covers a
        // header the service computes differently, and every call 403s.
        host: this.domain,
        "content-type": "application/json",
      },
      body,
    });

    const signed = await this.signer.sign(request);
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: signed.headers,
      body,
      // The caller retries once. Without a deadline a stalled connection held
      // the request, already committed, until the Lambda timed out, and the
      // phone retried into STALE_SEQ while the TV waited on the broadcast.
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `appsync publish to ${channel} failed: ${response.status} ${await safeText(response)}`,
      );
    }

    /*
     * A 200 is not a success. The Events API reports per-event outcomes in the
     * body, so a publish that reached the service but never reached a phone
     * comes back looking exactly like one that worked. Unchecked, a TV would
     * simply stop updating mid-encounter with nothing in the logs.
     */
    const result = (await response.json()) as {
      failed?: { identifier?: string; code?: string; message?: string }[];
    };
    const failed = result.failed ?? [];
    if (failed.length > 0) {
      const detail = failed.map((f) => f.message ?? f.code ?? "unknown").join("; ");
      throw new Error(`appsync rejected the event for ${channel}: ${detail}`);
    }
  }

  /**
   * Not implemented, deliberately. Subscription happens in the browser against
   * the WebSocket endpoint; no server-side caller has ever needed this, and a
   * silent no-op would turn that into a bug report about missing updates.
   */
  subscribe(_roomCode: string, _onMessage: (m: ChannelMessage) => void): Unsubscribe {
    throw new Error(
      "AppSyncEventsChannel cannot subscribe: browsers subscribe to room/<code>/<runId> directly",
    );
  }
}

/**
 * Channel path for one game in a room. Leading slash — the Events API requires it.
 *
 * The run is in the name because a room's four letters are reused once it
 * closes, and an AppSync subscription outlives its authorization: a socket that
 * stayed open would otherwise receive the next family's game on the same
 * channel. With the run in the name, it only ever hears its own.
 */
export function channelFor(roomCode: string, runId: string): string {
  return `/${ROOM_NAMESPACE}/${roomCode.toUpperCase()}/${runId}`;
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}
