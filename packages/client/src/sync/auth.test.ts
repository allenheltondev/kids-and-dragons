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
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const target = String((init.headers as Record<string, string>)["x-amz-target"]).split(".")[1] ?? "";
    calls.push({ target, body: JSON.parse(String(init.body)) as Record<string, unknown> });

    if (!(target in script)) throw new Error(`unscripted Cognito call: ${target}`);
    const entry = script[target];
    const value: unknown = typeof entry === "function" ? (entry as () => unknown)() : entry;

    if (value instanceof Error) {
      return new Response(
        JSON.stringify({ __type: `com.amazonaws.cognitoidp#${value.message}` }),
        { status: 400 },
      );
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
  it("signs up then starts the email challenge", async () => {
    const { client, calls } = fakeCognito({ SignUp: {}, InitiateAuth: CHALLENGE });

    const challenge = await client.requestCode("Allen@Example.com ");

    expect(calls.map((c) => c.target)).toEqual(["SignUp", "InitiateAuth"]);
    // Normalised once, at the edge: Cognito treats the username as opaque, so
    // "Allen@" and "allen@" would otherwise be two households.
    expect(calls[0]?.body["Username"]).toBe("allen@example.com");
    // Cognito will not create a pool without PASSWORD among its allowed first
    // auth factors, and SignUp then wants a value. It is generated, sent once,
    // and dropped — never shown, never stored, never used to sign in.
    const password = String(calls[0]?.body["Password"] ?? "");
    expect(password.length).toBeGreaterThan(20);
    expect(calls[1]?.body["AuthFlow"]).toBe("USER_AUTH");
    expect((calls[1]?.body["AuthParameters"] as Record<string, string>)["PREFERRED_CHALLENGE"]).toBe(
      "EMAIL_OTP",
    );
    expect(challenge).toEqual({
      email: "allen@example.com",
      session: "sess_1",
      destination: "a***@e***.com",
    });
  });

  it("never sends the same throwaway password twice", async () => {
    const a = fakeCognito({ SignUp: {}, InitiateAuth: CHALLENGE });
    const b = fakeCognito({ SignUp: {}, InitiateAuth: CHALLENGE });
    await a.client.requestCode("allen@example.com");
    await b.client.requestCode("allen@example.com");
    expect(a.calls[0]?.body["Password"]).not.toBe(b.calls[0]?.body["Password"]);
  });

  it("treats an existing user as the normal case, not an error", async () => {
    /*
     * The load-bearing one. The pool sets PreventUserExistenceErrors, which
     * makes an unknown user indistinguishable from a known one — so we cannot
     * branch on it and instead sign up unconditionally. If this stopped
     * swallowing UsernameExists, every returning player would hit a hard error
     * instead of getting a code.
     */
    const { client, calls } = fakeCognito({
      SignUp: () => new Error("UsernameExistsException"),
      InitiateAuth: CHALLENGE,
    });

    const challenge = await client.requestCode("allen@example.com");

    expect(challenge.session).toBe("sess_1");
    expect(calls.map((c) => c.target)).toEqual(["SignUp", "InitiateAuth"]);
  });

  it("propagates a sign-up failure that is not 'already exists'", async () => {
    const { client } = fakeCognito({ SignUp: () => new Error("InvalidParameterException") });
    await expect(client.requestCode("nope")).rejects.toBeInstanceOf(AuthError);
  });

  it("refuses a challenge it does not know how to answer", async () => {
    // A pool misconfigured to prefer SMS or a password would otherwise leave
    // the flow sitting on a code screen no code can satisfy.
    const { client } = fakeCognito({
      SignUp: {},
      InitiateAuth: { ChallengeName: "SMS_OTP", Session: "s" },
    });
    await expect(client.requestCode("allen@example.com")).rejects.toThrow(/unexpected/i);
  });

  it("survives a challenge with no delivery destination", async () => {
    const { client } = fakeCognito({
      SignUp: {},
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
