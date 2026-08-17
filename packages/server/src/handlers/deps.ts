/**
 * Handler dependencies and result shapes.
 *
 * Every handler in this directory is a pure function of `(request, deps)`. They
 * do not read `process.env`, do not touch `req`/`res`, and do not construct
 * their own clients — which is what makes `dev-server.ts` and a future Lambda
 * entry point two thin wrappers over the same code rather than two
 * implementations of the same protocol.
 *
 * The clock and both randomness sources are injected for the same reason the
 * engine is: the protocol tests need to advance time, force a room-code
 * collision, and get the same dice twice.
 */

import type { Rng } from "@kad/shared";
import type { ActionResponse, RoomChannel } from "@kad/shared";
import type { ContentStore } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import type { IdentityService } from "../identity.ts";
import type { GameRepository } from "../store/repository.ts";

export interface HandlerDeps {
  repo: GameRepository;
  /** The transport seam — architecture §4.4. */
  channel: RoomChannel;
  content: ContentStore;
  engine: Engine;
  /**
   * The auth seam — architecture §4.5. Handlers receive an already-resolved
   * principal (an API Gateway authorizer's job in prod); they use this only to
   * *mint* the room-scoped session token that join hands back.
   */
  identity: IdentityService;
  /**
   * Seeded dice. Separate from `random` on purpose: dice must be reproducible
   * so replaying the event log re-rolls identically (architecture §4.1/§4.3).
   */
  rng: (seed: string | number) => Rng;
  /**
   * Unpredictable uniform [0, 1), used for room codes. A guessable room code is
   * a stranger on your daughter's screen, so this one is crypto-backed and must
   * never be the seeded generator.
   */
  random: () => number;
  /** Epoch millis. */
  now: () => number;
  /**
   * Whether this entry point may run roadmap chapter 6's playtest cheats —
   * warping the run to any scene, and loading the next d20.
   *
   * Required rather than optional on purpose. A new entry point has to state
   * its position, and the answer a forgotten field would default to is the one
   * that must never be reached by accident (playtest.ts).
   */
  playtest: boolean;
}

/** The error shape the protocol already defines (`ActionResponse.error`). */
export type ActionError = NonNullable<ActionResponse["error"]>;

/**
 * Handlers whose success payload has no room for an error field (room create,
 * join, state) return this instead of throwing. `dev-server.ts` maps the codes
 * onto HTTP statuses in exactly one place.
 */
export type HandlerResult<T> = { ok: true; value: T } | { ok: false; error: ActionError };

export function ok<T>(value: T): HandlerResult<T> {
  return { ok: true, value };
}

export function fail<T>(code: ActionError["code"], message: string): HandlerResult<T> {
  return { ok: false, error: { code, message } };
}

/** ISO timestamps everywhere on the wire; millis only inside the server. */
export function iso(millis: number): string {
  return new Date(millis).toISOString();
}
