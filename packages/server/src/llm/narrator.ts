/**
 * The live narrator — architecture §6.4's speculative prefetch, over Bedrock.
 *
 * ---------------------------------------------------------------------------
 * THE ONE PROMISE: NOTHING EVER WAITS
 *
 * §6.4: "Two-second pauses at a table with an eight-year-old are fatal to
 * momentum." The way this file keeps that promise is not a short timeout — it
 * is that **`take()` cannot wait even if it wanted to.** It is synchronous. It
 * reads a map. There is no code path from a player's tap to a network call, so
 * there is no code path from a slow model to a stalled television.
 *
 * What makes that work is that turn-based games know the small set of things
 * that can happen next. The party enters a scene, and while somebody is reading
 * it aloud the server has already asked for the line that goes with every
 * button on the phones. By the time she taps, it is either sitting in the map
 * or it is not, and both are fine.
 *
 * ---------------------------------------------------------------------------
 * WHY A MISS IS NOT A FAILURE
 *
 * A miss is the authored text — which is the text the game shipped with, which
 * is good. Every branch in here that gives up gives up *to the same place*: a
 * cold process, a slow model, an expired entry, a validator rejection, a thrown
 * request, `LIVE_LLM_ENABLED=false`. All of them are `null`, all of them are
 * silent, and the game does not know the difference. That is the AI-optional
 * invariant, and it is structural rather than tested-for.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CACHE IS AND IS NOT
 *
 * An in-process map. On Lambda it survives warm invocations and does not
 * survive a cold start, and concurrent instances do not share it. That is
 * acceptable *because* a miss costs nothing — the alternative, putting
 * speculative flavour text in DynamoDB, would add a write and a read to the
 * critical path in exchange for a slightly better hit rate on a thing that is
 * allowed to miss. It is bounded in both directions (entries and age) because
 * an unbounded map in a long-lived process is a leak with a delay on it.
 */

import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type { Chapter, RulesContent } from "@kad/shared";
import {
  cachedPrefix,
  momentBlock,
  partyBlock,
  recapPrompt,
  sceneBlock,
} from "./prompt.ts";
import type { Narrator, NarrationRequest, PrefetchKey, RecapRequest } from "./port.ts";
import { validateNarration, validateRecap } from "./validate.ts";

/** §6.1 — "Live flavor text, NPC lines, recaps: `claude-haiku-4-5`, Lambda." */
export const LIVE_MODEL = "anthropic.claude-haiku-4-5";

/** A flavour line is under 240 characters; this is room to overshoot and fail. */
const FLAVOR_MAX_TOKENS = 300;
const RECAP_MAX_TOKENS = 500;

/** The model's way of saying it has nothing to add. Not an error. */
const PASS = "PASS";

/**
 * How long a speculative line is worth keeping, and how many.
 *
 * Ten minutes is well past the point where a party is still on the scene it was
 * prefetched from; 256 is more scenes than a session has. Both exist to bound a
 * map in a process that may live for hours, not to be tuned.
 */
const ENTRY_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 256;

/**
 * How long a turn will hold its invocation open warming the next lines.
 *
 * Four seconds, against a batch of four Haiku calls that run in parallel and
 * take about one. It is a backstop for a hung request rather than a target: the
 * turn has already committed and already broadcast by the time this runs, so
 * every millisecond here is Lambda duration spent on something nobody is
 * waiting for, and an unbounded wait would let one stuck socket push a healthy
 * turn into the function's own timeout.
 */
const WARM_BUDGET_MS = 4_000;

export interface NarratorConfig {
  rules: RulesContent;
  awsRegion: string;
  model?: string;
  /**
   * Whether to shout when the prompt cache is not working.
   *
   * §6.3: "Assert on it in dev. Log `usage.cache_read_input_tokens` and fail
   * loudly in development if it's zero across repeated calls." Loud in dev,
   * silent in prod — a table mid-session is not the place to learn about a
   * billing regression.
   */
  assertCache?: boolean;
  /** Injectable for tests. Defaults to a real Bedrock client. */
  send?: (request: LiveRequest) => Promise<LiveReply>;
  log?: (line: string) => void;
}

/** What a call looks like, with the transport factored out so tests can fake it. */
export interface LiveRequest {
  model: string;
  maxTokens: number;
  /** The cached prefix. Exactly one breakpoint, at the end of this. */
  cached: string;
  /** Everything behind the breakpoint. */
  tail: string;
}

export interface LiveReply {
  text: string;
  /** `usage.cache_read_input_tokens`, for the dev assertion. */
  cacheRead: number;
  cacheWrite: number;
}

interface Entry {
  text: string;
  at: number;
}

/**
 * The map key — **every field of `PrefetchKey`, and that is the point.**
 *
 * The run id is here for a reason worth stating: a shared process serves many
 * households, and without it one table's prefetched line reaches another's
 * television.
 *
 * The stamp is here because it was added to `PrefetchKey` and *not* to this
 * string, which made the whole staleness fix a no-op: `ready.has()` matched on
 * the fields that had not changed, suppressed the regeneration, and `take()`
 * handed back the line written before the fight. The type gained a field, the
 * behaviour gained nothing, and every test still passed — because they all
 * measured what `nextMoments` and `arrivalKey` *produced* rather than what the
 * map did with it.
 *
 * So this serialises the whole key, and destructures rather than dots so that
 * adding a field to `PrefetchKey` and forgetting this function is a lint error
 * about an unused binding rather than a silent cache collision.
 */
function keyOf(key: PrefetchKey): string {
  const { runId, sceneId, choiceId, stamp } = key;
  return `${runId} ${sceneId} ${choiceId ?? ""} ${stamp}`;
}

/**
 * The Bedrock transport.
 *
 * Non-streaming on purpose, which is the opposite of the generator's choice and
 * for the opposite reason: a flavour line is 240 characters, so there is no
 * timeout to avoid, and nothing downstream can consume a partial line anyway —
 * the validator has to see the whole thing before any of it may reach a screen.
 */
function bedrockSender(region: string, log: (line: string) => void): (request: LiveRequest) => Promise<LiveReply> {
  const client = new AnthropicBedrockMantle({ awsRegion: region });
  return async (request) => {
    const message = await client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      system: [{ type: "text", text: request.cached, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: request.tail }],
    });
    const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    const usage = message.usage as { cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    log(`live: ${String(message.usage.input_tokens)} in, cache read ${String(usage.cache_read_input_tokens ?? 0)}`);
    return {
      text,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
    };
  };
}

export function createNarrator(config: NarratorConfig): Narrator {
  const log = config.log ?? ((line: string) => { console.log(line); });
  const model = config.model ?? LIVE_MODEL;
  const send = config.send ?? bedrockSender(config.awsRegion, log);

  const ready = new Map<string, Entry>();
  /** In-flight keys, so two taps in the same scene do not buy the same line twice. */
  const pending = new Set<string>();

  /*
   * The cached prefix, memoised per chapter.
   *
   * Rebuilding it is cheap, but the memo is not about CPU: prefix matching is on
   * bytes, and one function that returns the identical string every time is a
   * stronger guarantee than a builder everyone trusts to be deterministic.
   */
  const prefixes = new Map<string, string>();
  const prefixFor = (chapter: Chapter): string => {
    const hit = prefixes.get(chapter.id);
    if (hit !== undefined) return hit;
    const built = cachedPrefix(config.rules, chapter);
    prefixes.set(chapter.id, built);
    return built;
  };

  let calls = 0;
  let cacheHits = 0;
  let warned = false;

  /** §6.3's dev assertion, kept out of the hot path's way. */
  function noteUsage(reply: LiveReply): void {
    calls += 1;
    if (reply.cacheRead > 0) cacheHits += 1;
    if (config.assertCache !== true || warned) return;
    /*
     * The first call *writes* the cache and legitimately reads nothing, so the
     * assertion cannot fire on it. Three calls in with nothing read back means
     * the prefix is under the floor, or something volatile is in front of it —
     * both of which are silent everywhere else.
     */
    if (calls >= 3 && cacheHits === 0) {
      warned = true;
      log(
        `LIVE LLM: the prompt cache is not hitting — ${String(calls)} calls, zero cache reads. ` +
          `The prefix is probably under Haiku's 4096-token floor, or something volatile is in ` +
          `front of it (architecture §6.3). Every call is being paid for in full.`,
      );
    }
  }

  function remember(key: string, text: string): void {
    // Oldest out first. A Map iterates in insertion order, so the first key is
    // the oldest and no sorting is needed.
    if (ready.size >= MAX_ENTRIES) {
      const oldest = ready.keys().next();
      if (!oldest.done) ready.delete(oldest.value);
    }
    ready.set(key, { text, at: Date.now() });
  }

  async function generate(key: string, request: NarrationRequest): Promise<void> {
    const tail = [
      partyBlock(request.party),
      "",
      sceneBlock(request.chapter, request.sceneId, request.scene, request.flags),
      "",
      momentBlock(request),
    ].join("\n");

    const reply = await send({
      model,
      maxTokens: FLAVOR_MAX_TOKENS,
      cached: prefixFor(request.chapter),
      tail,
    });
    noteUsage(reply);

    const candidate = reply.text.trim();
    // Declining is a good answer and the prompt asks for it by name. Storing
    // nothing means the authored line stands, which is what PASS means.
    if (candidate === PASS || candidate.length === 0) return;

    const verdict = validateNarration(candidate, {
      scene: request.scene,
      chapter: request.chapter,
      authored: request.authored,
    });
    if (!verdict.ok) {
      // §6.5: discarded silently. The log is for a developer, never a player.
      log(`live: rejected (${verdict.reason})`);
      return;
    }
    remember(key, verdict.text);
  }

  return {
    take(key) {
      const id = keyOf(key);
      const entry = ready.get(id);
      if (!entry) return null;
      // Read once. A line written for *this* arrival is wrong for the next one,
      // and serving it twice would make the layer look broken in the one way a
      // player would actually notice.
      ready.delete(id);
      if (Date.now() - entry.at > ENTRY_TTL_MS) return null;
      return entry.text;
    },

    async warm(moments) {
      /*
       * Awaited, not fired and forgotten — see `Narrator.warm` for why Lambda
       * leaves no choice. In parallel, because the whole batch has to fit in
       * the gap and four sequential calls would not.
       *
       * Bounded by `WARM_BUDGET_MS`, which is the piece that makes awaiting
       * safe: without it a hung request would hold the invocation open to the
       * function's own timeout, and a turn that has already committed and
       * already broadcast would fail its caller for the sake of flavour text.
       * The requests are not cancelled when the budget runs out — nothing can
       * cancel them — they are simply no longer waited for, and land in the map
       * if they land at all.
       */
      const started: Promise<void>[] = [];
      for (const { key, request } of moments) {
        const id = keyOf(key);
        if (pending.has(id)) continue;
        // An entry past its TTL is a miss that has not been read yet, not a
        // reason to skip: with a fight's stamp held still for the whole fight
        // (port.ts `stampOf`), a fight that outlasts the TTL warms this same
        // key again and should get a fresh line, not a guaranteed miss.
        const held = ready.get(id);
        if (held && Date.now() - held.at <= ENTRY_TTL_MS) continue;
        ready.delete(id);
        pending.add(id);
        started.push(
          generate(id, request)
            .catch((error: unknown) => {
              log(`live: prefetch failed — ${error instanceof Error ? error.message : String(error)}`);
            })
            .finally(() => {
              pending.delete(id);
            }),
        );
      }
      if (started.length === 0) return;

      let timer: ReturnType<typeof setTimeout> | undefined;
      const budget = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, WARM_BUDGET_MS);
      });
      try {
        await Promise.race([Promise.all(started).then(() => undefined), budget]);
      } finally {
        // Or the timer holds the event loop open for its full span after a
        // batch that finished in 300ms — which in a dev server is a process
        // that will not exit, and in Lambda is billed time.
        if (timer) clearTimeout(timer);
      }
    },

    async recap(request: RecapRequest) {
      /*
       * The one call that may take its time. Nobody is waiting on a button: the
       * chapter is over and the completion screen is already up with its own
       * content on it.
       */
      try {
        const reply = await send({
          model,
          maxTokens: RECAP_MAX_TOKENS,
          cached: prefixFor(request.chapter),
          tail: recapPrompt(request),
        });
        noteUsage(reply);
        const candidate = reply.text.trim();
        if (candidate === PASS || candidate.length === 0) return null;
        const verdict = validateRecap(candidate, request.chapter);
        if (!verdict.ok) {
          log(`live: recap rejected (${verdict.reason})`);
          return null;
        }
        return verdict.text;
      } catch (error) {
        log(`live: recap failed — ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    },
  };
}
