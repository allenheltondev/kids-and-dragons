/**
 * `AppSyncEventsChannel` — the prod transport, architecture §4.4.
 *
 * The room is a channel: `room/<code>`. Lambda publishes to it over the Event
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
    const body = JSON.stringify({
      channel: channelFor(roomCode),
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
    });

    if (!response.ok) {
      throw new Error(
        `appsync publish to ${channelFor(roomCode)} failed: ${response.status} ${await safeText(response)}`,
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
      throw new Error(`appsync rejected the event for ${channelFor(roomCode)}: ${detail}`);
    }
  }

  /**
   * Not implemented, deliberately. Subscription happens in the browser against
   * the WebSocket endpoint; no server-side caller has ever needed this, and a
   * silent no-op would turn that into a bug report about missing updates.
   */
  subscribe(_roomCode: string, _onMessage: (m: ChannelMessage) => void): Unsubscribe {
    throw new Error(
      "AppSyncEventsChannel cannot subscribe: browsers subscribe to room/<code> directly",
    );
  }
}

/** Channel path for a room. Leading slash — the Events API requires it. */
export function channelFor(roomCode: string): string {
  return `/${ROOM_NAMESPACE}/${roomCode.toUpperCase()}`;
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}
