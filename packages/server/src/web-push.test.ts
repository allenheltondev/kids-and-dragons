import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { PUSH_TAG, turnPushPayload } from "@kad/shared";
import {
  mintVapidKeys,
  parseVapidKeys,
  pushMode,
  recordingSender,
  sendOutcome,
} from "./web-push.ts";

/** A subscription a browser could have made: a real P-256 key and auth secret. */
function browserSubscription(endpoint = "https://push.example/send/abc") {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
  };
}

describe("web push transport (#466)", () => {
  it("only on or record turns pushes on", () => {
    expect(pushMode(undefined)).toBe("off");
    expect(pushMode("")).toBe("off");
    expect(pushMode("off")).toBe("off");
    expect(pushMode("yes")).toBe("off");
    expect(pushMode("on")).toBe("on");
    expect(pushMode("record")).toBe("record");
  });

  it("mints a key pair it can read back, and refuses anything else", () => {
    const keys = parseVapidKeys(mintVapidKeys());
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(keys.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(() => parseVapidKeys("{}")).toThrow(/VAPID/);
    expect(() => parseVapidKeys("not json")).toThrow();
  });

  it("reads 404 and 410 as gone, 2xx as sent, and the rest as failed", () => {
    expect(sendOutcome(201)).toBe("sent");
    expect(sendOutcome(404)).toBe("gone");
    expect(sendOutcome(410)).toBe("gone");
    expect(sendOutcome(429)).toBe("failed");
    expect(sendOutcome(500)).toBe("failed");
    expect(sendOutcome(undefined)).toBe("failed");
  });

  it("builds an encrypted request with a VAPID header, the turn's topic and no readable words", () => {
    const keys = parseVapidKeys(mintVapidKeys());
    const payload = JSON.stringify(turnPushPayload("abcd"));
    const request = webpush.generateRequestDetails(browserSubscription(), payload, {
      vapidDetails: { subject: "mailto:grown-ups@example.com", ...keys },
      TTL: 900,
      urgency: "high",
      topic: PUSH_TAG,
    });
    expect(request.headers["Authorization"]).toMatch(/^vapid t=.+, k=/);
    expect(request.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(request.headers["Topic"]).toBe(PUSH_TAG);
    // What the push service carries says nothing it can read.
    expect(Buffer.from(request.body as Buffer).toString("latin1")).not.toContain("turn");
  });

  it("records instead of sending, and answers gone for an endpoint that ends in /gone", async () => {
    const sender = recordingSender(() => 0);
    const subscription = {
      playerId: "p_1",
      householdId: "h_1",
      deviceId: "d_1",
      createdAt: "2026-10-24T00:00:00.000Z",
      ...browserSubscription(),
    };
    expect(await sender.send(subscription, turnPushPayload("ABCD"))).toBe("sent");
    expect(await sender.send({ ...subscription, endpoint: "https://push.example/gone" }, turnPushPayload("ABCD"))).toBe("gone");
    expect(sender.sent).toEqual([
      {
        at: "1970-01-01T00:00:00.000Z",
        playerId: "p_1",
        deviceId: "d_1",
        endpoint: subscription.endpoint,
        payload: turnPushPayload("ABCD"),
      },
    ]);
  });
});
