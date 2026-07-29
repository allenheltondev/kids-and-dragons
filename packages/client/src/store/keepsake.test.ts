import { describe, expect, it, vi } from "vitest";
import type { CognitoClient } from "../sync/auth";
import { AuthError } from "../sync/auth";
import type { Api, LinkAccountResponse } from "../sync/client";
import { createKeepsakeStore, type KeepsakeDeps } from "./keepsake";
import { loadAccount, loadIdentity, saveIdentity, type KeyValueStorage } from "./persistence";

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const LINKED: LinkAccountResponse = {
  householdId: "h_1",
  claimed: true,
  players: [
    { id: "p_1", displayName: "Allen", color: "#7FD4C1", role: "adult" },
    { id: "p_2", displayName: "Ada", color: "#F2A65A", role: "child" },
  ],
  characters: [
    { id: "c_1", name: "Sparklehoof", species: "unicorn", ownerPlayerId: "p_2" },
    { id: "c_2", name: "Ember", species: "dragonling", ownerPlayerId: "p_1" },
  ],
};

function setup(
  overrides: {
    api?: Partial<Api>;
    cognito?: Partial<CognitoClient>;
    passkey?: boolean;
  } = {},
) {
  const storage = memoryStorage();

  const cognito: CognitoClient = {
    requestCode: vi.fn(async (email: string) => ({ email, session: "sess_1" })),
    submitCode: vi.fn(async () => ({ idToken: "id_tok", accessToken: "acc_tok" })),
    canUsePasskey: vi.fn(() => overrides.passkey ?? false),
    registerPasskey: vi.fn(async () => true),
    ...overrides.cognito,
  };

  const api = {
    fetchConfig: vi.fn(async () => ({
      region: "us-east-1",
      realtime: { httpDomain: "h", realtimeDomain: "r", namespace: "room" },
      auth: { userPoolId: "us-east-1_abc", clientId: "client123" },
    })),
    linkAccount: vi.fn(async () => LINKED),
    adoptDevice: vi.fn(async () => ({ deviceToken: "dev_new", playerId: "p_2" })),
    ...overrides.api,
  } as unknown as Api;

  const deps: KeepsakeDeps = { api, storage, makeCognito: () => cognito };
  return { store: createKeepsakeStore(deps), api, cognito, storage };
}

describe("availability", () => {
  it("offers sign-in only where there is a user pool", async () => {
    const { store } = setup();
    expect(store.getState().available).toBeNull();
    await store.getState().check();
    expect(store.getState().available).toBe(true);
  });

  it("stays silent in local dev, where /api/config does not exist", async () => {
    // Not an error state: anonymous play is the whole product on a laptop.
    const { store } = setup({ api: { fetchConfig: vi.fn(async () => null) } });
    await store.getState().check();
    expect(store.getState().available).toBe(false);
  });

  it("stays silent when the config request fails outright", async () => {
    const { store } = setup({
      api: {
        fetchConfig: vi.fn(async () => {
          throw new Error("offline");
        }),
      },
    });
    await store.getState().check();
    expect(store.getState().available).toBe(false);
  });

  it("asks once however many screens ask it", async () => {
    const { store, api } = setup();
    await Promise.all([
      store.getState().check(),
      store.getState().check(),
      store.getState().check(),
    ]);
    expect(api.fetchConfig).toHaveBeenCalledTimes(1);
  });
});

describe("keeping the characters", () => {
  it("walks offer → email → code → kept and records the account", async () => {
    const { store, api, storage } = setup();
    await store.getState().check();
    saveIdentity(
      { householdId: "hh", playerId: "p", displayName: "Allen", deviceToken: "dev_old" },
      storage,
    );

    store.getState().open();
    expect(store.getState().step).toBe("offer");

    await store.getState().sendCode("allen@example.com");
    expect(store.getState().step).toBe("code");

    await store.getState().submitCode("123456");

    // No passkey support in this browser, so that step is skipped rather than
    // shown and immediately failed.
    expect(store.getState().step).toBe("kept");
    expect(store.getState().account).toMatchObject({
      householdId: "h_1",
      email: "allen@example.com",
    });
    // Persisted, so the offer does not come back every chapter.
    expect(loadAccount(storage)?.householdId).toBe("h_1");

    /*
     * The device token has to go with the link. It is what names the household
     * to claim — without it the server has nothing to attach the account to and
     * mints an empty one instead, quietly losing the characters this whole flow
     * is about.
     */
    expect(api.linkAccount).toHaveBeenCalledWith("id_tok", "dev_old");
  });

  it("offers the passkey step only where the browser has one", async () => {
    const { store } = setup({ passkey: true });
    await store.getState().check();
    store.getState().open();
    await store.getState().sendCode("allen@example.com");
    await store.getState().submitCode("123456");

    expect(store.getState().step).toBe("passkey");
    await store.getState().addPasskey();
    expect(store.getState().step).toBe("kept");
    expect(store.getState().passkeyAdded).toBe(true);
  });

  it("still ends kept when the passkey is declined", async () => {
    const { store } = setup({
      passkey: true,
      cognito: { registerPasskey: vi.fn(async () => false) },
    });
    await store.getState().check();
    store.getState().open();
    await store.getState().sendCode("a@e.com");
    await store.getState().submitCode("123456");
    await store.getState().addPasskey();

    expect(store.getState().step).toBe("kept");
    expect(store.getState().passkeyAdded).toBe(false);
    expect(store.getState().error).toBeNull();
  });

  it("does not turn a passkey failure into a failed keep", async () => {
    const { store } = setup({
      passkey: true,
      cognito: {
        registerPasskey: vi.fn(async () => {
          throw new Error("authenticator exploded");
        }),
      },
    });
    await store.getState().check();
    store.getState().open();
    await store.getState().sendCode("a@e.com");
    await store.getState().submitCode("123456");
    await store.getState().addPasskey();

    // The characters were kept two calls ago. An error here would say otherwise.
    expect(store.getState().step).toBe("kept");
    expect(store.getState().error).toBeNull();
  });

  it("rejects an address that is not one before sending anything", async () => {
    const { store, cognito } = setup();
    await store.getState().check();
    await store.getState().sendCode("allen");

    expect(cognito.requestCode).not.toHaveBeenCalled();
    expect(store.getState().error).toMatch(/doesn't look right/);
    expect(store.getState().step).not.toBe("code");
  });

  it("stays on the code step after a wrong code, so it can be retyped", async () => {
    const { store } = setup({
      cognito: {
        submitCode: vi.fn(async () => {
          throw new AuthError("CodeMismatchException", "That code doesn't match.");
        }),
      },
    });
    await store.getState().check();
    store.getState().open();
    await store.getState().sendCode("a@e.com");
    await store.getState().submitCode("000000");

    expect(store.getState().step).toBe("code");
    expect(store.getState().error).toMatch(/doesn't match/);
    expect(store.getState().challenge).not.toBeNull();
    expect(store.getState().account).toBeNull();
  });

  it("does not record an account when the claim itself fails", async () => {
    // Cognito said yes and our server said no. Recording the account here would
    // suppress the offer forever on a household that was never claimed.
    const { store, storage } = setup({
      api: {
        linkAccount: vi.fn(async () => {
          throw new Error("household is already claimed");
        }),
      },
    });
    await store.getState().check();
    store.getState().open();
    await store.getState().sendCode("a@e.com");
    await store.getState().submitCode("123456");

    expect(store.getState().account).toBeNull();
    expect(loadAccount(storage)).toBeNull();
    expect(store.getState().error).toMatch(/already claimed/);
  });

  it("closing is 'not now', not 'undo'", async () => {
    const { store } = setup();
    await store.getState().check();
    store.getState().open();
    await store.getState().sendCode("a@e.com");
    await store.getState().submitCode("123456");
    store.getState().close();

    expect(store.getState().step).toBe("closed");
    // Reopening must not re-offer something already done.
    expect(store.getState().account).not.toBeNull();
  });
});

describe("restoring on a new phone", () => {
  it("skips the offer and ends in a player picker", async () => {
    const { store, api, storage } = setup();
    await store.getState().check();

    store.getState().open("restore");
    // Nothing on this phone to show them, and they have already decided.
    expect(store.getState().step).toBe("email");

    await store.getState().sendCode("allen@example.com");
    await store.getState().submitCode("123456");

    expect(store.getState().step).toBe("choose");
    // Each player is offered with the characters they own, so "which one am I?"
    // is answerable by a name a child recognises rather than by a profile.
    expect(store.getState().players).toEqual([
      { id: "p_1", displayName: "Allen", color: "#7FD4C1", characters: ["Ember"] },
      { id: "p_2", displayName: "Ada", color: "#F2A65A", characters: ["Sparklehoof"] },
    ]);

    await store.getState().choosePlayer("p_2");

    expect(api.adoptDevice).toHaveBeenCalledWith("id_tok", "h_1", "p_2");
    // The write that makes this phone *be* Ada from now on.
    expect(loadIdentity(storage).deviceToken).toBe("dev_new");
    expect(store.getState().step).toBe("kept");
  });

  it("skips the picker when the server already bound this device", async () => {
    // A brand-new account: the server created the household and made this
    // device its first adult, so there is nothing to choose between.
    const { store, api } = setup({
      api: {
        linkAccount: vi.fn(async () => ({
          householdId: "h_new",
          claimed: false,
          players: [{ id: "p_1", displayName: "Allen", color: "#7FD4C1", role: "adult" }],
          characters: [],
          deviceToken: "dev_fresh",
          playerId: "p_1",
        })),
      },
    });
    await store.getState().check();
    store.getState().open("restore");
    await store.getState().sendCode("a@e.com");
    await store.getState().submitCode("123456");

    expect(store.getState().step).toBe("kept");
    expect(api.adoptDevice).not.toHaveBeenCalled();
  });

  it("stays on the picker when adopting fails", async () => {
    const { store, storage } = setup({
      api: {
        adoptDevice: vi.fn(async () => {
          throw new Error("that household belongs to a different account");
        }),
      },
    });
    await store.getState().check();
    store.getState().open("restore");
    await store.getState().sendCode("a@e.com");
    await store.getState().submitCode("123456");
    await store.getState().choosePlayer("p_2");

    expect(store.getState().step).toBe("choose");
    expect(store.getState().error).toMatch(/different account/);
    // Critically, the device is not half-bound.
    expect(loadIdentity(storage).deviceToken).toBeUndefined();
  });
});
