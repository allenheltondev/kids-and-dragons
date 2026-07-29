/**
 * The browser half of the optional sign-in — architecture §4.5.
 *
 * Talks to Cognito **directly**, over its plain JSON API. Two consequences
 * worth being explicit about:
 *
 *   1. No credential ever reaches our Lambda. The browser gets an ID token and
 *      hands *that* to `POST /api/auth/link`, which is the only thing our
 *      server ever sees.
 *   2. No SDK. `amazon-cognito-identity-js` is ~120KB for four calls we can
 *      write in a page, and this bundle already ships a WebGL renderer to a
 *      phone in a car. The API is a stable, documented JSON-over-POST surface
 *      (`X-Amz-Target`), and none of these calls are signed — they are the
 *      unauthenticated ones by design.
 *
 * There are no passwords in the pool at all (see `infra/template.yaml`), so the
 * whole flow is: prove you can read an email, then optionally register a
 * passkey so you never have to again.
 */

/** Everything here is unauthenticated; region and client id come from /api/config. */
export interface AuthConfig {
  region: string;
  userPoolId: string;
  clientId: string;
}

export interface AuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
}

/** A code has been emailed and we are waiting for it. */
export interface PendingChallenge {
  email: string;
  /** Cognito's opaque continuation token. Meaningless to us, required by it. */
  session: string;
  /** Where Cognito says it sent the code — masked, e.g. `a***@e***.com`. */
  destination?: string;
}

export class AuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

/**
 * Errors an 8-year-old's parent might actually hit, in words that say what to
 * do next. Anything unmapped keeps Cognito's own message — a wrong-but-friendly
 * translation of an unexpected failure is worse than an accurate odd one.
 */
const FRIENDLY: Record<string, string> = {
  CodeMismatchException: "That code doesn't match. Have another look at the email.",
  ExpiredCodeException: "That code has expired — we can send a fresh one.",
  NotAuthorizedException: "That code didn't work. Try sending a new one.",
  TooManyRequestsException: "Too many tries just now. Wait a moment and try again.",
  TooManyFailedAttemptsException: "Too many wrong codes. Wait a moment and start again.",
  LimitExceededException: "Too many tries just now. Wait a moment and try again.",
  InvalidParameterException: "That email address doesn't look right.",
  UserNotFoundException: "We couldn't find that email. Check the spelling?",
};

export interface CognitoClient {
  /** Sends a 6-digit code to `email`, creating the account if it is new. */
  requestCode(email: string): Promise<PendingChallenge>;
  /** Exchanges the code for tokens. */
  submitCode(challenge: PendingChallenge, code: string): Promise<AuthTokens>;
  /** True when this browser can register a passkey at all. */
  canUsePasskey(): boolean;
  /** Registers a passkey for the signed-in user. Resolves false if declined. */
  registerPasskey(tokens: AuthTokens): Promise<boolean>;
}

export function createCognitoClient(
  config: AuthConfig,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): CognitoClient {
  const endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`;

  async function call<T>(action: string, body: unknown): Promise<T> {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        __type?: string;
        message?: string;
      };
      // `__type` arrives as `com.amazonaws...#CodeMismatchException`.
      const code = (payload.__type ?? "UnknownError").split("#").pop() ?? "UnknownError";
      throw new AuthError(code, FRIENDLY[code] ?? payload.message ?? `Sign-in failed (${code})`);
    }
    return (await response.json()) as T;
  }

  return {
    async requestCode(email: string): Promise<PendingChallenge> {
      const username = email.trim().toLowerCase();

      /*
       * Sign up first, unconditionally, and swallow "already exists".
       *
       * The tempting order is the other way around — try to sign in, and
       * register only if the user is unknown — but the pool sets
       * `PreventUserExistenceErrors: ENABLED`, which is precisely a promise
       * that an unknown user is *indistinguishable* from a known one. Under
       * that setting `InitiateAuth` returns a simulated challenge for an email
       * that has never been seen, so the "is this a new user?" branch can never
       * be taken and a first-time player would wait forever for a code that was
       * never sent.
       *
       * Signing up first costs a returning user nothing: Cognito rejects it
       * immediately with `UsernameExistsException` and sends no email.
       */
      try {
        await call("SignUp", {
          ClientId: config.clientId,
          Username: username,
          // A password nobody will ever see, type, or need.
          //
          // Cognito requires PASSWORD among the pool's allowed first auth
          // factors (it refuses to create a pool without it) and SignUp wants a
          // value that satisfies the policy. Sign-in is the emailed code, so
          // this secret is generated here, sent once, and dropped — there is
          // nothing to store, nothing to remember, and nothing to leak.
          Password: throwawayPassword(),
          UserAttributes: [{ Name: "email", Value: username }],
        });
      } catch (err) {
        if (!(err instanceof AuthError) || err.code !== "UsernameExistsException") throw err;
      }

      const result = await call<{
        ChallengeName?: string;
        Session?: string;
        ChallengeParameters?: Record<string, string>;
      }>("InitiateAuth", {
        AuthFlow: "USER_AUTH",
        ClientId: config.clientId,
        AuthParameters: { USERNAME: username, PREFERRED_CHALLENGE: "EMAIL_OTP" },
      });

      if (result.ChallengeName !== "EMAIL_OTP" || !result.Session) {
        throw new AuthError(
          "UnexpectedChallenge",
          `Sign-in asked for something unexpected (${result.ChallengeName ?? "nothing"}).`,
        );
      }
      const destination = result.ChallengeParameters?.["CODE_DELIVERY_DESTINATION"];
      return { email: username, session: result.Session, ...(destination ? { destination } : {}) };
    },

    async submitCode(challenge: PendingChallenge, code: string): Promise<AuthTokens> {
      const result = await call<{
        AuthenticationResult?: { IdToken?: string; AccessToken?: string; RefreshToken?: string };
      }>("RespondToAuthChallenge", {
        ClientId: config.clientId,
        ChallengeName: "EMAIL_OTP",
        Session: challenge.session,
        ChallengeResponses: {
          USERNAME: challenge.email,
          EMAIL_OTP_CODE: code.replace(/\D/g, ""),
        },
      });

      const auth = result.AuthenticationResult;
      if (!auth?.IdToken || !auth.AccessToken) {
        throw new AuthError("NoTokens", "Sign-in didn't complete. Try sending a new code.");
      }
      return {
        idToken: auth.IdToken,
        accessToken: auth.AccessToken,
        ...(auth.RefreshToken ? { refreshToken: auth.RefreshToken } : {}),
      };
    },

    canUsePasskey(): boolean {
      return (
        typeof navigator !== "undefined" &&
        typeof navigator.credentials?.create === "function" &&
        typeof PublicKeyCredential !== "undefined"
      );
    },

    async registerPasskey(tokens: AuthTokens): Promise<boolean> {
      if (!this.canUsePasskey()) return false;

      const start = await call<{ CredentialCreationOptions?: PublicKeyCredentialJson }>(
        "StartWebAuthnRegistration",
        { AccessToken: tokens.accessToken },
      );
      const options = start.CredentialCreationOptions;
      if (!options) return false;

      let credential: Credential | null;
      try {
        credential = await navigator.credentials.create({
          publicKey: decodeCreationOptions(options),
        });
      } catch {
        /*
         * The user dismissed the platform sheet, or the device has no
         * authenticator. Neither is an error: a passkey is a convenience on top
         * of a sign-in that has already succeeded, and saying so would turn
         * "not right now" into a failure screen over a completed action.
         */
        return false;
      }
      if (!credential) return false;

      await call("CompleteWebAuthnRegistration", {
        AccessToken: tokens.accessToken,
        Credential: encodeCredential(credential as PublicKeyCredential),
      });
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// WebAuthn wire encoding
//
// The API speaks JSON, `navigator.credentials` speaks ArrayBuffer, and the
// bridge between them is base64url in both directions. Getting a single field
// wrong produces a credential the authenticator accepts and Cognito rejects, so
// each conversion is in exactly one place.
// ---------------------------------------------------------------------------

interface PublicKeyCredentialJson {
  challenge: string;
  rp: PublicKeyCredentialRpEntity;
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: { id: string; type: "public-key"; transports?: string[] }[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
}

function decodeCreationOptions(json: PublicKeyCredentialJson): PublicKeyCredentialCreationOptions {
  return {
    ...json,
    challenge: fromB64url(json.challenge),
    user: { ...json.user, id: fromB64url(json.user.id) },
    ...(json.excludeCredentials
      ? {
          excludeCredentials: json.excludeCredentials.map((c) => ({
            ...c,
            id: fromB64url(c.id),
            transports: c.transports as AuthenticatorTransport[] | undefined,
          })),
        }
      : {}),
  } as PublicKeyCredentialCreationOptions;
}

function encodeCredential(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: toB64url(response.clientDataJSON),
      attestationObject: toB64url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

/**
 * A password that exists only to satisfy Cognito's sign-up validator.
 *
 * 32 bytes of CSPRNG, plus one character from each class the default policy
 * insists on. It is never persisted, never displayed, and never used to sign in
 * — the emailed code does that — so the only property that matters is that
 * nobody, including us, can guess it afterwards.
 */
function throwawayPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return `Aa1!${btoa(raw).replace(/[+/=]/g, "")}`;
}

function toB64url(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
