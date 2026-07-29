/**
 * The keepsake flow — "keep these characters?" — architecture §4.5.
 *
 * A **separate store from the game store**, on purpose. `store/index.ts` mirrors
 * the server's authoritative run state and must only ever move forward by
 * applying a patch (architecture §4.1); this is local UI state about an account,
 * belongs to no run, and outlives every room. Folding it in would put a
 * hand-written setter next to the one place the mirror is allowed to change,
 * which is the invariant that file exists to protect.
 *
 * The shape of the offer matters as much as the mechanics. Signing in is never
 * a gate: the flow opens from a button, closes on a tap, and the game keeps
 * running underneath at every step. The worst outcome of ignoring it entirely
 * is the thing anonymous play already promised — the characters are forgotten
 * in seven days.
 */

import { create } from "zustand";
import {
  AuthError,
  createCognitoClient,
  type AuthTokens,
  type CognitoClient,
  type PendingChallenge,
} from "../sync/auth";
import { api as defaultApi, type Api } from "../sync/client";
import {
  defaultStorage,
  loadAccount,
  loadIdentity,
  saveAccount,
  saveIdentity,
  type AccountRecord,
  type KeyValueStorage,
} from "./persistence";

/**
 * `closed` is not a step in the flow, it is the absence of one — the flow is a
 * panel over the game, not a screen the game navigates to.
 */
export type KeepsakeStep =
  | "closed"
  | "offer"
  | "email"
  | "code"
  | "choose"
  | "passkey"
  | "kept";

/**
 * Two reasons to sign in, sharing one email-and-code middle.
 *
 *   `keep`    — the common one. Claim the household this device is already
 *               playing in, so tonight's characters survive the week.
 *   `restore` — a phone that has never played, belonging to somebody who has.
 *               Ends in a player picker instead, because the server will not
 *               guess which member of the household this phone is (§4.5) and
 *               neither should we.
 *
 * They are one flow because the middle is genuinely identical, and two endings
 * because claiming and adopting are different things happening to different
 * rows.
 */
export type KeepsakePurpose = "keep" | "restore";

/** A household member offered by the picker in the `restore` ending. */
export interface KeepsakePlayer {
  id: string;
  displayName: string;
  color: string;
  /** Character names this player owns, for "Ada — Sparklehoof". */
  characters: string[];
}

export interface KeepsakeStore {
  step: KeepsakeStep;
  purpose: KeepsakePurpose;
  /** Populated for the `restore` ending only. */
  players: KeepsakePlayer[];
  /**
   * Whether this deployment can offer sign-in at all. `null` until checked —
   * distinct from `false`, because "we don't know yet" must not render as
   * "you can't keep these".
   */
  available: boolean | null;
  busy: boolean;
  error: string | null;
  /** Set once claimed, so the offer does not come back every chapter. */
  account: AccountRecord | null;
  challenge: PendingChallenge | null;
  /** Whether this browser can register a passkey; false skips that step. */
  passkeyPossible: boolean;
  passkeyAdded: boolean;

  /** Reads `/api/config` once. Safe to call from a render effect. */
  check(): Promise<void>;
  open(purpose?: KeepsakePurpose): void;
  close(): void;
  /** Back one step, from the code screen to the email one. */
  back(): void;
  sendCode(email: string): Promise<void>;
  submitCode(code: string): Promise<void>;
  /** The `restore` ending: bind this phone to one of the household's players. */
  choosePlayer(playerId: string): Promise<void>;
  addPasskey(): Promise<void>;
  skipPasskey(): void;
  dismissError(): void;
}

export interface KeepsakeDeps {
  api: Api;
  storage: KeyValueStorage;
  /** Built from `/api/config` on first use; injected whole by tests. */
  makeCognito: typeof createCognitoClient;
}

export function defaultKeepsakeDeps(): KeepsakeDeps {
  return { api: defaultApi, storage: defaultStorage(), makeCognito: createCognitoClient };
}

export function createKeepsakeStore(deps: KeepsakeDeps = defaultKeepsakeDeps()) {
  let cognito: CognitoClient | null = null;
  let tokens: AuthTokens | null = null;
  let checking: Promise<void> | null = null;

  return create<KeepsakeStore>()((set, get) => ({
    step: "closed",
    purpose: "keep",
    players: [],
    available: null,
    busy: false,
    error: null,
    account: loadAccount(deps.storage),
    challenge: null,
    passkeyPossible: false,
    passkeyAdded: false,

    async check() {
      // Idempotent and concurrency-safe: several screens mount at once and all
      // of them want to know whether to show the offer.
      checking ??= (async () => {
        const config = await deps.api.fetchConfig();
        if (!config?.auth.userPoolId) {
          set({ available: false });
          return;
        }
        cognito = deps.makeCognito({
          region: config.region,
          userPoolId: config.auth.userPoolId,
          clientId: config.auth.clientId,
        });
        set({ available: true, passkeyPossible: cognito.canUsePasskey() });
      })().catch(() => {
        set({ available: false });
        checking = null;
      });
      await checking;
    },

    open(purpose: KeepsakePurpose = "keep") {
      // `restore` skips the offer: somebody tapping "I've played before" has
      // already decided, and there are no characters on this phone to show them.
      set({ purpose, step: purpose === "keep" ? "offer" : "email", error: null, players: [] });
    },

    close() {
      // Deliberately keeps `account` and `passkeyAdded`: closing is "not now",
      // not "undo". Reopening after a successful claim should still say kept.
      set({ step: "closed", error: null, challenge: null, busy: false });
    },

    back() {
      set({ step: "email", error: null, challenge: null });
    },

    async sendCode(email: string) {
      const trimmed = email.trim();
      if (!trimmed.includes("@")) {
        set({ error: "That email address doesn't look right." });
        return;
      }
      if (!cognito) {
        set({ error: "Sign-in isn't available here." });
        return;
      }

      set({ busy: true, error: null });
      try {
        const challenge = await cognito.requestCode(trimmed);
        set({ step: "code", challenge, busy: false });
      } catch (err) {
        set({ busy: false, error: messageFor(err) });
      }
    },

    async submitCode(code: string) {
      const challenge = get().challenge;
      if (!cognito || !challenge) return;

      set({ busy: true, error: null });
      try {
        tokens = await cognito.submitCode(challenge, code);

        /*
         * The claim itself. The device token goes along because it is what
         * names the household to adopt — without it the server would have
         * nothing to claim and would mint an empty household instead, quietly
         * losing the characters this whole flow is about.
         */
        const identity = loadIdentity(deps.storage);
        const result = await deps.api.linkAccount(tokens.idToken, identity.deviceToken);

        // A device token comes back only when the server bound this browser
        // during the link; keeping the existing one otherwise.
        if (result.deviceToken) {
          saveIdentity({ ...identity, deviceToken: result.deviceToken }, deps.storage);
        }

        const account: AccountRecord = {
          householdId: result.householdId,
          email: challenge.email,
          claimedAt: new Date().toISOString(),
        };
        saveAccount(account, deps.storage);

        /*
         * The `restore` ending needs a player picked before this phone is
         * anybody. Skipped when the server already bound us — that happens on a
         * brand-new account, where it created the household and made this
         * device its first adult, so there is nothing to choose between.
         */
        const needsPlayer =
          get().purpose === "restore" && !result.deviceToken && result.players.length > 0;
        if (needsPlayer) {
          const byOwner = new Map<string, string[]>();
          for (const character of result.characters) {
            const owned = byOwner.get(character.ownerPlayerId) ?? [];
            owned.push(character.name);
            byOwner.set(character.ownerPlayerId, owned);
          }
          set({
            account,
            step: "choose",
            busy: false,
            challenge: null,
            players: result.players.map((p) => ({
              id: p.id,
              displayName: p.displayName,
              color: p.color,
              characters: byOwner.get(p.id) ?? [],
            })),
          });
          return;
        }

        // Offer the passkey only where it can work — otherwise this is done.
        const next = get().passkeyPossible ? "passkey" : "kept";
        set({ account, step: next, busy: false, challenge: null });
      } catch (err) {
        set({ busy: false, error: messageFor(err) });
      }
    },

    async choosePlayer(playerId: string) {
      const account = get().account;
      if (!tokens || !account) return;

      set({ busy: true, error: null });
      try {
        const result = await deps.api.adoptDevice(tokens.idToken, account.householdId, playerId);
        // This is the write that makes the phone *be* that player from now on.
        const identity = loadIdentity(deps.storage);
        saveIdentity({ ...identity, deviceToken: result.deviceToken }, deps.storage);

        const next = get().passkeyPossible ? "passkey" : "kept";
        set({ step: next, busy: false });
      } catch (err) {
        set({ busy: false, error: messageFor(err) });
      }
    },

    async addPasskey() {
      if (!cognito || !tokens) {
        set({ step: "kept" });
        return;
      }
      set({ busy: true, error: null });
      try {
        const added = await cognito.registerPasskey(tokens);
        set({ passkeyAdded: added, step: "kept", busy: false });
      } catch {
        /*
         * Silent. The characters are already kept — the passkey is a
         * convenience on top of a sign-in that has succeeded, and an error
         * screen over a completed action reads as though the keeping failed.
         */
        set({ step: "kept", busy: false });
      }
    },

    skipPasskey() {
      set({ step: "kept" });
    },

    dismissError() {
      set({ error: null });
    },
  }));
}

function messageFor(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Try again in a moment.";
}

export const useKeepsakeStore = createKeepsakeStore();

/** True when there is a live offer worth showing — see `SignInFlow`. */
export function useKeepsakeOffer(): { available: boolean; kept: boolean } {
  const available = useKeepsakeStore((s) => s.available);
  const account = useKeepsakeStore((s) => s.account);
  return { available: available === true, kept: account !== null };
}
