import { describe, expect, it, vi } from "vitest";
import { AuthError, createCognitoClient } from "./auth";

const CONFIG = { region: "us-east-1", userPoolId: "us-east-1_abc", clientId: "client123" };

interface Call {
  target: string;
  body: Record<string, unknown>;
}

/**
 * A fake Cognito. Responses are keyed by action so a test only has to describe
 * the calls it cares about; anything unscripted is an explicit failure rather
 * than an empty object, because a silently-empty response is exactly the shape
 * of the bug these tests exist to catch.
 */
function fakeCognito(script: Record<string, unknown | (() => unknown)>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    // Our own API's one call here is told apart by its path; everything else
    // is Cognito, named by its `x-amz-target`.
    const start = url === "/api/auth/start";
    const target = start ? "Start" : (String((init.headers as Record<string, string>)["x-amz-target"]).split(".")[1] ?? "");
    calls.push({ target, body: JSON.parse(String(init.body)) as Record<string, unknown> });

    if (!(target in script)) throw new Error(`unscripted call: ${target}`);
    const entry = script[target];
    const value: unknown = typeof entry === "function" ? (entry as () => unknown)() : entry;

    // The API answers in its own shape: a status, and `{ error: { message } }`.
    if (start) {
      if (typeof value === "number") {
        return new Response(JSON.stringify({ ok: false, error: { code: "X", message: `server said ${String(value)}` } }), { status: value });
      }
      return new Response(null, { status: 204 });
    }
    if (value instanceof Error) {
      return new Response(JSON.stringify({ __type: `com.amazonaws.cognitoidp#${value.message}` }), { status: 400 });
    }
    return new Response(JSON.stringify(value), { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  return { client: createCognitoClient(CONFIG, fetchImpl), calls };
}

const CHALLENGE = {
  ChallengeName: "EMAIL_OTP",
  Session: "sess_1",
  ChallengeParameters: { CODE_DELIVERY_DESTINATION: "a***@e***.com" },
};

describe("requestCode", () => {
  it("has the API make sure the account exists, then starts the email challenge", async () => {
    const { client, calls } = fakeCognito({ Start: {}, InitiateAuth: CHALLENGE });

    const challenge = await client.requestCode("Allen@Example.com ");

    expect(calls.map((c) => c.target)).toEqual(["Start", "InitiateAuth"]);
    // Normalised once, at the edge: Cognito treats the username as opaque, so
    // "Allen@" and "allen@" would otherwise be two households.
    expect(calls[0]?.body).toEqual({ email: "allen@example.com" });
    expect(calls[1]?.body["AuthFlow"]).toBe("USER_AUTH");
    expect((calls[1]?.body["AuthParameters"] as Record<string, string>)["USERNAME"]).toBe("allen@example.com");
    expect((calls[1]?.body["AuthParameters"] as Record<string, string>)["PREFERRED_CHALLENGE"]).toBe(
      "EMAIL_OTP",
    );
    expect(challenge).toEqual({
      email: "allen@example.com",
      session: "sess_1",
      destination: "a***@e***.com",
    });
  });

  it("never signs up with Cognito itself, and never sends a password anywhere", async () => {
    /*
     * The load-bearing one. Cognito's public sign-up takes a password, and the
     * pool cannot tell a browser that throws its password away from a caller
     * who keeps theirs. So the browser makes no account: an unscripted
     * `SignUp` here is a thrown error, and no call carries a password.
     */
    const { client, calls } = fakeCognito({ Start: {}, InitiateAuth: CHALLENGE });

    await client.requestCode("allen@example.com");

    expect(calls.map((c) => c.target)).not.toContain("SignUp");
    expect(JSON.stringify(calls)).not.toMatch(/password/i);
  });

  it("asks for no code when the account could not be made, and says to try again", async () => {
    // Under PreventUserExistenceErrors Cognito would answer with a pretend
    // challenge for an address it has no account for: a code screen that no
    // code will ever satisfy.
    const { client, calls } = fakeCognito({ Start: 500, InitiateAuth: CHALLENGE });

    await expect(client.requestCode("allen@example.com")).rejects.toMatchObject({
      code: "StartFailed",
      message: "We couldn't start signing you in. Try again in a moment.",
    });
    expect(calls.map((c) => c.target)).toEqual(["Start"]);
  });

  it("passes on what the server says about an address it will not take, or too many tries", async () => {
    for (const [status, code] of [[400, "InvalidParameterException"], [429, "TooManyRequestsException"]] as const) {
      const { client } = fakeCognito({ Start: status, InitiateAuth: CHALLENGE });
      const refused = client.requestCode("allen@example.com");
      await expect(refused).rejects.toBeInstanceOf(AuthError);
      await expect(refused).rejects.toMatchObject({ code, message: `server said ${String(status)}` });
    }
  });

  it("refuses a challenge it does not know how to answer", async () => {
    // A pool misconfigured to prefer SMS or a password would otherwise leave
    // the flow sitting on a code screen no code can satisfy.
    const { client } = fakeCognito({
      Start: {},
      InitiateAuth: { ChallengeName: "SMS_OTP", Session: "s" },
    });
    await expect(client.requestCode("allen@example.com")).rejects.toThrow(/unexpected/i);
  });

  it("survives a challenge with no delivery destination", async () => {
    const { client } = fakeCognito({
      Start: {},
      InitiateAuth: { ChallengeName: "EMAIL_OTP", Session: "s" },
    });
    const challenge = await client.requestCode("allen@example.com");
    expect(challenge.destination).toBeUndefined();
  });
});

describe("submitCode", () => {
  const challenge = { email: "allen@example.com", session: "sess_1" };

  it("exchanges the code for tokens", async () => {
    const { client, calls } = fakeCognito({
      RespondToAuthChallenge: {
        AuthenticationResult: { IdToken: "id", AccessToken: "acc", RefreshToken: "ref" },
      },
    });

    const tokens = await client.submitCode(challenge, "123 456");

    // Spaces and dashes are what a human types when reading six digits off a
    // screen; Cognito wants the digits.
    const responses = calls[0]?.body["ChallengeResponses"] as Record<string, string>;
    expect(responses["EMAIL_OTP_CODE"]).toBe("123456");
    expect(responses["USERNAME"]).toBe("allen@example.com");
    expect(tokens).toEqual({ idToken: "id", accessToken: "acc", refreshToken: "ref" });
  });

  it("turns a wrong code into something a person can act on", async () => {
    const { client } = fakeCognito({
      RespondToAuthChallenge: () => new Error("CodeMismatchException"),
    });

    await expect(client.submitCode(challenge, "000000")).rejects.toMatchObject({
      code: "CodeMismatchException",
      // Not Cognito's "Invalid code or auth state for the user" — a sentence
      // that tells a parent what to do next.
      message: expect.stringContaining("Have another look") as unknown as string,
    });
  });

  it("does not report success when Cognito returns no tokens", async () => {
    // A 200 with an empty AuthenticationResult would otherwise flow straight
    // into the claim call with `undefined` as an id token.
    const { client } = fakeCognito({ RespondToAuthChallenge: {} });
    await expect(client.submitCode(challenge, "123456")).rejects.toThrow(/didn't complete/);
  });
});

describe("passkeys", () => {
  it("reports itself unusable where WebAuthn is absent", () => {
    const { client } = fakeCognito({});
    // Node has no navigator.credentials, which is the same answer an older
    // phone gives — and the flow must skip the step rather than fail it.
    expect(client.canUsePasskey()).toBe(false);
  });

  it("does not register when the browser cannot", async () => {
    const { client, calls } = fakeCognito({});
    expect(await client.registerPasskey({ idToken: "id", accessToken: "acc" })).toBe(false);
    expect(calls).toEqual([]);
  });

  it("treats a dismissed platform prompt as 'not now', not a failure", async () => {
    const create = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    vi.stubGlobal("navigator", { credentials: { create } });
    vi.stubGlobal("PublicKeyCredential", class {});

    const { client } = fakeCognito({
      StartWebAuthnRegistration: {
        CredentialCreationOptions: {
          challenge: "AAAA",
          rp: { id: "example.com", name: "K&D" },
          user: { id: "AAAA", name: "a@e.com", displayName: "a" },
          pubKeyCredParams: [{ alg: -7, type: "public-key" }],
        },
      },
    });

    // The characters are already kept by this point; an error screen over a
    // completed action would read as though the keeping had failed.
    expect(await client.registerPasskey({ idToken: "id", accessToken: "acc" })).toBe(false);
    expect(create).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe("createDevAuthClient", () => {
  it("issues a dev token carrying the normalised email, with no passkey step", async () => {
    const { createDevAuthClient } = await import("./auth");
    const client = createDevAuthClient();
    const challenge = await client.requestCode(" Ada@Example.com ");
    expect(challenge.email).toBe("ada@example.com");
    const tokens = await client.submitCode(challenge, "anything");
    expect(tokens.idToken.startsWith("dev.")).toBe(true);
    const claims = JSON.parse(atob(tokens.idToken.slice(4).replace(/-/g, "+").replace(/_/g, "/")));
    expect(claims).toEqual({ email: "ada@example.com" });
    expect(client.canUsePasskey()).toBe(false);
  });
});
