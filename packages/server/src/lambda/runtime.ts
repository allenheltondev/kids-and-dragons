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

import { DynamoTimingStore } from "../store/timing-store.ts";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { AppSyncEventsChannel } from "../channel/appsync-events-channel.ts";
import { loadContent, type ContentStore } from "../content/loader.ts";
import { loadSharedRuntime } from "../engine/shared-engine.ts";
import type { HandlerDeps } from "../handlers/deps.ts";
import { DynamoRepository } from "../store/dynamo-repository.ts";
import { ssmParameterSource, TokenIdentity } from "../token-identity.ts";
import { mintVapidKeys, parseVapidKeys, pushConfig, pushMode, webPushSender, type VapidKeys } from "../web-push.ts";
import type { PushConfig, PushDelivery, PushDispatch } from "../handlers/push.ts";
import { lambdaPushDispatch } from "./push-dispatch.ts";

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
  const push = await pushFromEnv();
  // Session timing (#511): its own table, on unless the stack says off. No table named, nothing kept.
  const timingTable = process.env.KAD_TIMING === "off" ? undefined : process.env.TIMING_TABLE_NAME;

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
    ...(push ? { push } : {}),
    // Family-session timing (#511); the dev server labels its own runs `playtest`,
    // so the two never share a source.
    ...(timingTable ? { timing: { source: "family" as const, store: new DynamoTimingStore({ tableName: timingTable }) } } : {}),
  };
}

/** Reads a SecureString parameter, minting it when `mint` says so. */
type KeySource = (name: string) => () => Promise<string>;

/** The API's source: it may mint the pair, as it mints the signing key. */
const mintingSource: KeySource = (name) =>
  ssmParameterSource(name, {
    createIfMissing: true,
    mint: mintVapidKeys,
    description: "Kids & Dragons Web Push VAPID key pair (#466)",
  });

/** The sender's: read only. The API has always minted it before any job exists. */
const readingSource: KeySource = (name) => ssmParameterSource(name);

/**
 * "It's your turn" pushes (#466), as both functions read the stack: on only
 * when it says `KAD_PUSH=on` and names a subject (`KAD_PUSH_SUBJECT`, a
 * `mailto:` or `https:` contact the push services can reach). The VAPID key
 * pair lives in one SecureString, `PUSH_KEY_PARAMETER`. A subject missing
 * while pushes are on, or a key pair that cannot be read, is a stack mistake:
 * logged, and pushes stay off for this container rather than the function
 * failing.
 */
async function pushKeysFromEnv(
  env: NodeJS.ProcessEnv,
  source: KeySource,
): Promise<{ keys: VapidKeys; subject: string } | undefined> {
  if (pushMode(env.KAD_PUSH) !== "on") return undefined;
  const subject = env.KAD_PUSH_SUBJECT ?? "";
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    console.warn("push: KAD_PUSH is on but KAD_PUSH_SUBJECT is not a mailto: or https: address; pushes stay off");
    return undefined;
  }
  const parameter = env.PUSH_KEY_PARAMETER;
  if (!parameter) {
    console.error("push: KAD_PUSH is on but PUSH_KEY_PARAMETER is not set; pushes stay off");
    return undefined;
  }
  try {
    return { keys: parseVapidKeys(await source(parameter)()), subject };
  } catch (err) {
    // A push key that cannot be read must never take the game down with it.
    console.error(`push: the key pair in ${parameter} could not be read; pushes stay off:`, err);
    return undefined;
  }
}

/**
 * The API function's half: the public key for the client, and a dispatcher
 * that hands each job to the push-sender function (`PUSH_SENDER_FUNCTION`)
 * by an asynchronous invoke. It never sends a push itself.
 */
export async function pushFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  source: KeySource = mintingSource,
  dispatchTo: (functionName: string) => PushDispatch = (name) => lambdaPushDispatch(name),
): Promise<PushConfig | undefined> {
  const found = await pushKeysFromEnv(env, source);
  if (!found) return undefined;
  const sender = env.PUSH_SENDER_FUNCTION;
  if (!sender) {
    console.error("push: KAD_PUSH is on but PUSH_SENDER_FUNCTION is not set; pushes stay off");
    return undefined;
  }
  return pushConfig(found.keys, dispatchTo(sender));
}

/** The push-sender function's half: the transport, signed with the same pair. */
export async function pushDeliveryFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  source: KeySource = readingSource,
): Promise<PushDelivery | undefined> {
  const found = await pushKeysFromEnv(env, source);
  return found ? { sender: webPushSender(found.keys, found.subject) } : undefined;
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
