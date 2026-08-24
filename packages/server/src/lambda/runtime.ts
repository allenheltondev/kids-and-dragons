/**
 * Container-scoped wiring for the Lambdas.
 *
 * This is the file `dev-server.ts` promised: the move to Lambda is
 * `MemoryRepository → DynamoRepository`, `LocalSseChannel →
 * AppSyncEventsChannel`, `DevIdentity → TokenIdentity`, and nothing under
 * `handlers/` changes. Everything env-shaped lives here so the handlers stay
 * pure functions of `(request, deps)` and remain testable without AWS.
 *
 * Built once per container and reused across invocations — the AWS clients, the
 * content files, and above all the token signing key, which would otherwise
 * cost a network round trip on every single request.
 */

import { CognitoJwtVerifier } from "aws-jwt-verify";
import { AppSyncEventsChannel } from "../channel/appsync-events-channel.ts";
import { loadContent, type ContentStore } from "../content/loader.ts";
import { loadSharedRuntime } from "../engine/shared-engine.ts";
import type { HandlerDeps } from "../handlers/deps.ts";
import { installNarrator } from "../llm/install.ts";
import { DynamoRepository } from "../store/dynamo-repository.ts";
import { ssmParameterSource, TokenIdentity } from "../token-identity.ts";

/**
 * Read at module load so a missing variable fails the **first** invocation
 * loudly, with the name of what is missing, rather than surfacing as a
 * `TypeError: undefined is not a string` somewhere in the SDK.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
}

let cached: Promise<HandlerDeps> | null = null;

export function runtime(): Promise<HandlerDeps> {
  cached ??= build().catch((err: unknown) => {
    // Never cache a failed boot: a throttled cold start would otherwise poison
    // the container for its whole life.
    cached = null;
    throw err;
  });
  return cached;
}

async function build(): Promise<HandlerDeps> {
  const region = requiredEnv("AWS_REGION");
  const repo = new DynamoRepository({ tableName: requiredEnv("TABLE_NAME") });
  const shared = await loadSharedRuntime();
  const loaded = await content();

  return {
    repo,
    channel: new AppSyncEventsChannel({
      httpDomain: requiredEnv("APPSYNC_HTTP_DOMAIN"),
      region,
    }),
    content: loaded,
    engine: shared.engine,
    identity: new TokenIdentity({
      repo,
      // The only function allowed to mint the key — see token-identity.ts.
      secret: ssmParameterSource(requiredEnv("TOKEN_KEY_PARAMETER"), { createIfMissing: true }),
    }),
    rng: shared.rng,
    random: cryptoRandom,
    now: () => Date.now(),
    /*
     * Not an env var, not a config lookup, not a default — a literal. Roadmap
     * chapter 6's playtest cheats warp the run to any scene and load the next
     * d20, and the only safe number of ways to switch that on in production is
     * zero (playtest.ts).
     */
    playtest: false,
    /*
     * The live narration layer — roadmap chapter 7. Unlike `playtest` directly
     * above, this one *is* an environment lookup, and the difference is which
     * way the default has to fall. A playtest cheat reaching production is a
     * stranger warping a child's run, so it is a literal `false`. The live
     * layer reaching production is the feature working, so it is a switch —
     * one that still has to be turned on explicitly (§6.6, enabled.ts).
     */
    // The literal `false` is the cache assertion staying quiet in every
    // deployed stack, the same shape as `playtest` above — a table mid-session
    // is not where anybody learns about a billing regression.
    narrator: installNarrator(loaded, false),
  };
}

let contentCache: ContentStore | null = null;

/**
 * Content ships **inside** the deployment package (`infra/build.mjs` copies
 * `content/` next to the handler). It is four small JSON files that are already
 * validated in CI, and a chapter the server cannot read is a session that cannot
 * start — putting that behind an S3 GET would trade a build-time guarantee for a
 * runtime failure mode, at the table, for nothing.
 */
async function content(): Promise<ContentStore> {
  contentCache ??= await loadContent();
  return contentCache;
}

/**
 * The Cognito ID-token verifier — the only place that knows sign-in exists.
 *
 * Verification is local: `aws-jwt-verify` fetches the pool's JWKS once and
 * checks signature, issuer, audience, expiry, and `token_use` itself. No call
 * to Cognito sits in the request path.
 */
let verifierCache: ReturnType<typeof makeVerifier> | null = null;

function makeVerifier() {
  return CognitoJwtVerifier.create({
    userPoolId: requiredEnv("USER_POOL_ID"),
    tokenUse: "id",
    clientId: requiredEnv("USER_POOL_CLIENT_ID"),
  });
}

export interface VerifiedAccount {
  cognitoSub: string;
  email?: string | undefined;
}

/** `null` for any token that does not verify. Never throws on a bad token. */
export async function verifyAccountToken(token: string): Promise<VerifiedAccount | null> {
  if (!token) return null;
  verifierCache ??= makeVerifier();
  try {
    const claims = await verifierCache.verify(token);
    return {
      cognitoSub: claims.sub,
      email: typeof claims.email === "string" ? claims.email : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Crypto-backed uniform [0, 1). Room codes must not be guessable — a guessable
 * code is a stranger on your daughter's screen.
 */
function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) / 0x1_0000_0000;
}
