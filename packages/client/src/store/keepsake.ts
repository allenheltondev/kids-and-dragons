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
 * seven days after the household last played (the window slides on play:
 * server `keepGuestHousehold`).
 */

import { create } from "zustand";
import {
  AuthError,
  createCognitoClient,
  createDevAuthClient,
  type AuthTokens,
  type CognitoClient,
  type PendingChallenge,
} from "../sync/auth";
import { api as defaultApi, type Api, type LinkAccountResponse } from "../sync/client";
import { useOrganizerStore } from "./organizer";
import {
  asPlayerIdentity,
  becomeSharedDevice,
  clearSharedDevice,
  defaultStorage,
  loadAccount,
  loadIdentity,
  loadSharedDevice,
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
  | "household"
  | "choose"
  | "passkey"
  | "kept"
  | "organize";

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
 *
 * Two more endings for a shared tablet (#250), both a grown-up's:
 *
 *   `share`   — make this device the family's tablet. It stops being anybody
 *               and opens on a "who's playing?" picker from then on.
 *   `forget`  — the reverse: revoke the tablet. Nobody's heroes go with it.
 *
 * Neither leaves the grown-up signed in on the tablet, and neither offers a
 * passkey: a tablet that remembered the owner's face would hand every kid who
 * picks it up the owner's account.
 */
export type KeepsakePurpose = "keep" | "restore" | "share" | "forget" | "organize" | "visitors";
/*
 * And one for an organizer (#248): `organize` signs a grown-up in to manage
 * their households and groups, in the organizer panel (store/organizer.ts).
 * Like a tablet's errands it keeps nobody signed in once the panel closes.
 *
 * And `visitors` (#249): a grown-up who runs the game signs in on the host's
 * screen to open the room to visitors, or to close it to new ones. One errand,
 * then nobody is signed in: the host's screen is often a kid's phone.
 */

/** A household offered by the `household` step (#248), for an account that owns more than one. */
export interface KeepsakeHousehold {
  id: string;
  displayName: string;
  players: number;
}

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
  /** Populated for the `household` step only. */
  households: KeepsakeHousehold[];
  /** The `visitors` errand (#249): which room, and which way the switch goes. */
  visitorRoom: { code: string; open: boolean } | null;
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
  /** This browser is the family's shared tablet (#250). Re-read by `refreshShared`. */
  shared: boolean;
  /** Whether this browser can register a passkey; false skips that step. */
  passkeyPossible: boolean;
  passkeyAdded: boolean;

  /** Reads `/api/config` once. Safe to call from a render effect. */
  check(): Promise<void>;
  /**
   * Where the flow was opened from. `home` is the always-there "Sign in or
   * create an account" button: it skips the offer (there is no party on screen
   * to offer to keep) and the copy talks about the account, not the characters.
   */
  entry: "offer" | "home";
  open(purpose?: KeepsakePurpose, entry?: "offer" | "home"): void;
  /** Sign a grown-up in to open `code` to visitors, or close it to new ones (#249). */
  openVisitors(code: string, open: boolean): void;
  close(): void;
  /** Back one step, from the code screen to the email one. */
  back(): void;
  sendCode(email: string): Promise<void>;
  submitCode(code: string): Promise<void>;
  /** The `restore` ending: bind this phone to one of the household's players. */
  choosePlayer(playerId: string): Promise<void>;
  /** The `household` step: which of the account's households this is for (#248). */
  chooseHousehold(householdId: string): Promise<void>;
  addPasskey(): Promise<void>;
  skipPasskey(): void;
  dismissError(): void;
  /** Re-reads whether this is a shared tablet, after the game store found it forgotten. */
  refreshShared(): void;
}

export interface KeepsakeDeps {
  api: Api;
  storage: KeyValueStorage;
  /** Built from `/api/config` on first use; injected whole by tests. */
  makeCognito: typeof createCognitoClient;
  /** Where the `organize` sign-in goes on to (#248). */
  organizer: { begin(idToken: string, email: string): Promise<void>; end(): void };
}

export function defaultKeepsakeDeps(): KeepsakeDeps {
  return {
    api: defaultApi,
    storage: defaultStorage(),
    makeCognito: createCognitoClient,
    organizer: {
      begin: (idToken, email) => useOrganizerStore.getState().begin(idToken, email),
      end: () => useOrganizerStore.getState().end(),
    },
  };
}

/** A tablet's errands and the organizer's panel never leave the grown-up signed in. */
function transient(purpose: KeepsakePurpose): boolean {
  return purpose === "share" || purpose === "forget" || purpose === "organize" || purpose === "visitors";
}

export function createKeepsakeStore(deps: KeepsakeDeps = defaultKeepsakeDeps()) {
  let cognito: CognitoClient | null = null;
  let tokens: AuthTokens | null = null;
  /** The code `tokens` came from: a retry on the same code reuses them (a code works once). */
  let tokensFor: PendingChallenge | null = null;
  /**
   * The account a `restore` sign-in found, held here — not saved — until a
   * player is picked. Saving it before adoption would mark this phone as
   * signed in while it is still nobody, and the home card would then hide the
   * only way to finish (closing the picker, a failed adopt, a reload).
   */
  let pendingAccount: AccountRecord | null = null;
  let checking: Promise<void> | null = null;

  return create<KeepsakeStore>()((set, get) => {
    /**
     * What a sign-in or a picked household (#248) came back with: bind this
     * phone if the server did, ask which household or which player if there
     * is a choice to make, and otherwise it is done.
     */
    async function afterLink(result: LinkAccountResponse, email: string): Promise<void> {
      const identity = loadIdentity(deps.storage);
      // The server will not guess between an account's households, and
      // neither do we: the grown-up picks, and the link is asked again.
      if (result.householdId === null) {
        set({ step: "household", busy: false, challenge: null, households: result.households ?? [] });
        return;
      }
      const householdId = result.householdId;

      // A device token comes back only when the server bound this browser
      // during the link; keeping the existing one otherwise.
      if (result.deviceToken) {
        saveIdentity(asPlayerIdentity(identity, result.deviceToken), deps.storage);
      }

      const account: AccountRecord = {
        householdId,
        email,
        claimedAt: new Date().toISOString(),
      };

      /*
       * The `restore` ending needs a player picked before this phone is
       * anybody. Skipped when the server already bound us — that happens on a
       * brand-new account, where it created the household and made this
       * device its first player, so there is nothing to choose between.
       */
      const needsPlayer =
        get().purpose === "restore" &&
        !result.deviceToken &&
        result.deviceBound !== true &&
        result.players.length > 0;
      if (needsPlayer) {
        const byOwner = new Map<string, string[]>();
        for (const character of result.characters) {
          const owned = byOwner.get(character.ownerPlayerId) ?? [];
          owned.push(character.name);
          byOwner.set(character.ownerPlayerId, owned);
        }
        pendingAccount = account;
        set({
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

      // This phone is bound to the household now, so the account is real.
      saveAccount(account, deps.storage);
      pendingAccount = null;
      // Offer the passkey only where it can work — otherwise this is done.
      const next = get().passkeyPossible ? "passkey" : "kept";
      set({ account, step: next, busy: false, challenge: null });
    }

    /** The `share` ending, once it is known which household the tablet is for. */
    async function finishShare(householdId: string | undefined): Promise<void> {
      if (!tokens) return;
      const shared = loadSharedDevice(deps.storage);
      // The phone binding this browser held goes along to be revoked.
      const deviceToken = loadIdentity(deps.storage).deviceToken;
      const result = householdId
        ? await deps.api.shareDevice(tokens.idToken, deviceToken, shared?.token, householdId)
        : await deps.api.shareDevice(tokens.idToken, deviceToken, shared?.token);
      becomeSharedDevice({ token: result.sharedToken, householdId: result.householdId }, deps.storage);
      doneOnTablet();
    }

    /**
     * Not kept once done: the grown-up signed in to do one thing on a device
     * every kid in the house picks up. Until then a failure keeps them, so
     * "try again" needs no new code, and nothing has changed this device: the
     * server revokes the old binding last, and `becomeSharedDevice` forgets
     * the old identity only once the new token is saved.
     */
    function doneOnTablet(): void {
      tokens = null;
      tokensFor = null;
      set({
        step: "kept",
        busy: false,
        challenge: null,
        households: [],
        account: loadAccount(deps.storage),
        shared: loadSharedDevice(deps.storage) !== null,
      });
    }

    return {
    step: "closed",
    purpose: "keep",
    entry: "offer",
    players: [],
    households: [],
    visitorRoom: null,
    available: null,
    busy: false,
    error: null,
    account: loadAccount(deps.storage),
    shared: loadSharedDevice(deps.storage) !== null,
    challenge: null,
    passkeyPossible: false,
    passkeyAdded: false,

    async check() {
      // Idempotent and concurrency-safe: several screens mount at once and all
      // of them want to know whether to show the offer.
      checking ??= (async () => {
        const config = await deps.api.fetchConfig();
        if (!config?.auth.userPoolId) {
          // No user pool: either a deployment without sign-in, or the local dev
          // server, which offers its own pool-free one.
          if (await deps.api.probeDevAuth()) {
            cognito = createDevAuthClient();
            set({ available: true, passkeyPossible: false });
          } else {
            set({ available: false });
          }
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

    open(purpose: KeepsakePurpose = "keep", entry: "offer" | "home" = "offer") {
      // `restore` and the home button skip the offer: somebody who tapped to
      // sign in has already decided, and there is no party on screen to show.
      const step = purpose === "keep" && entry === "offer" ? "offer" : "email";
      set({ purpose, entry, step, error: null, players: [], households: [], visitorRoom: null });
    },

    openVisitors(code: string, open: boolean) {
      set({ purpose: "visitors", entry: "home", step: "email", error: null, players: [], households: [], visitorRoom: { code, open } });
    },

    close() {
      // A tablet's errand never leaves the grown-up signed in, even half done.
      const purpose = get().purpose;
      if (transient(purpose)) {
        tokens = null;
        tokensFor = null;
      }
      if (purpose === "organize") deps.organizer.end();
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
        /*
         * A second tap on the same code, after the step below failed, reuses
         * the sign-in: the code was spent the first time, and asking for a new
         * email just because the network blinked is how a setup gets abandoned.
         */
        if (!tokens || tokensFor !== challenge) {
          tokens = await cognito.submitCode(challenge, code);
          tokensFor = challenge;
        }

        const purpose = get().purpose;
        if (purpose === "organize") {
          // The panel takes the token from here; this flow is done with it.
          await deps.organizer.begin(tokens.idToken, challenge.email);
          set({ step: "organize", busy: false, challenge: null });
          return;
        }
        if (purpose === "share") {
          // An account running a group as well as a family is asked which
          // one this tablet is for (#248), never guessed for.
          const { households } = await deps.api.listHouseholds(tokens.idToken);
          if (households.length > 1) {
            set({ step: "household", busy: false, challenge: null, households });
            return;
          }
          await finishShare(undefined);
          return;
        }
        if (purpose === "visitors") {
          const room = get().visitorRoom;
          if (room) await deps.api.setVisitors(tokens.idToken, room.code, room.open);
          // Done, and nobody stays signed in. The room says it is open on the
          // patch every screen receives.
          tokens = null;
          tokensFor = null;
          set({ step: "closed", busy: false, challenge: null, visitorRoom: null });
          return;
        }
        if (purpose === "forget") {
          const shared = loadSharedDevice(deps.storage);
          if (shared) {
            await deps.api.forgetDevice(tokens.idToken, shared.token);
            clearSharedDevice(deps.storage);
          }
          doneOnTablet();
          return;
        }

        /*
         * The claim itself. The device token goes along because it is what
         * names the household to adopt — without it the server would have
         * nothing to claim and would mint an empty household instead, quietly
         * losing the characters this whole flow is about.
         */
        const identity = loadIdentity(deps.storage);
        const fromHome = get().entry === "home";
        const result = await deps.api.linkAccount(tokens.idToken, identity.deviceToken, fromHome);
        await afterLink(result, challenge.email);
      } catch (err) {
        set({ busy: false, error: messageFor(err) });
      }
    },

    async chooseHousehold(householdId: string) {
      if (!tokens) return;
      set({ busy: true, error: null });
      try {
        if (get().purpose === "share") {
          await finishShare(householdId);
          return;
        }
        const identity = loadIdentity(deps.storage);
        const result = await deps.api.linkAccount(tokens.idToken, identity.deviceToken, true, householdId);
        await afterLink(result, tokensFor?.email ?? get().account?.email ?? "");
      } catch (err) {
        set({ busy: false, error: messageFor(err) });
      }
    },

    async choosePlayer(playerId: string) {
      const account = pendingAccount;
      if (!tokens || !account) return;

      set({ busy: true, error: null });
      try {
        const result = await deps.api.adoptDevice(tokens.idToken, account.householdId, playerId);
        // This is the write that makes the phone *be* that player from now on.
        const identity = loadIdentity(deps.storage);
        saveIdentity(asPlayerIdentity(identity, result.deviceToken), deps.storage);
        // Only now is this phone somebody in the household — record the account.
        saveAccount(account, deps.storage);
        pendingAccount = null;

        const next = get().passkeyPossible ? "passkey" : "kept";
        set({ account, step: next, busy: false });
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

    refreshShared() {
      set({ shared: loadSharedDevice(deps.storage) !== null });
    },
  };
  });
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
