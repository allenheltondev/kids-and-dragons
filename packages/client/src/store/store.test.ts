import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ActionResponse, ChannelMessage, JsonPatchOp, RunState, ServerMessage } from "@kad/shared";
import {
  gameStoreCreator,
  isPromptForPlayer,
  selectMe,
  type GameStoreDeps,
  type InternalGameStore,
} from "./index";
import type { ChannelOptions } from "../sync/channel";
import type { Api } from "../sync/client";
import type { KeyValueStorage } from "./persistence";
import { makeMember, makeState } from "../testing/fixtures";

// ---------------------------------------------------------------------------
// Harness — no network, no DOM, no timers.
// ---------------------------------------------------------------------------

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

interface Harness {
  store: StoreApi<InternalGameStore>;
  api: {
    [K in keyof Api]: ReturnType<typeof vi.fn>;
  };
  storage: KeyValueStorage;
  navigate: ReturnType<typeof vi.fn>;
  /** Push a server message down the open channel. */
  publish(message: ChannelMessage): void;
  channelOptions(): ChannelOptions;
  closed(): number;
}

function harness(state: RunState = makeState()): Harness {
  let options: ChannelOptions | null = null;
  let closes = 0;

  const api = {
    // Creating a room seats the host, so the real response is a room *and* a
    // join, with the device binding the server issued.
    createRoom: vi.fn(async () => ({
      code: state.roomCode,
      runId: state.runId,
      mode: state.mode,
      expiresAt: "2026-07-28T06:00:00.000Z",
      playerId: "p_host",
      sessionToken: "tok_host",
      state,
      deviceToken: "dev_host",
    })),
    joinRoom: vi.fn(async () => ({
      runId: state.runId,
      playerId: "p_1",
      mode: state.mode,
      sessionToken: "tok_1",
      state,
    })),
    // How a display client attaches (§4.5): a viewer token plus the snapshot,
    // in one call. The TV cannot subscribe to the prod channel without it.
    watchRoom: vi.fn(async () => ({
      runId: state.runId,
      mode: state.mode,
      expiresAt: "2026-07-05T00:00:00.000Z",
      viewerToken: "tok_view",
      state,
    })),
    postAction: vi.fn(async (): Promise<ActionResponse> => ({ ok: true, seq: state.seq })),
    fetchState: vi.fn(async () => ({ seq: state.seq, state })),
    loadRules: vi.fn(async () => ({ version: 1 })),
    loadItems: vi.fn(async () => ({})),
    loadCampaign: vi.fn(async () => ({
      id: "the-hollow-crown",
      title: "The Hollow Crown",
      blurb: "",
      chapters: ["bramblewood-01"],
    })),
    loadChapter: vi.fn(async () => ({ id: "bramblewood-01", biome: "enchanted_woods", scenes: {} })),
    loadAbilities: vi.fn(async () => ({ version: 1, abilities: {} })),
    // The optional sign-in (§4.5). `null` is the local-dev answer — there is no
    // user pool, so no offer is made, and the game store never touches these.
    fetchConfig: vi.fn(async () => null),
    linkAccount: vi.fn(),
    adoptDevice: vi.fn(),
  };

  const storage = memoryStorage();
  const navigate = vi.fn();

  const deps = {
    api: api as unknown as Api,
    storage,
    navigate: navigate as unknown as GameStoreDeps["navigate"],
    eventsUrl: (code: string, sinceSeq: number) => `/events/${code}?sinceSeq=${sinceSeq}`,
    openChannel: (opts: ChannelOptions) => {
      options = opts;
      opts.onStatus("open");
      return {
        close: () => {
          closes += 1;
        },
      };
    },
  } as GameStoreDeps;

  return {
    store: createStore<InternalGameStore>(gameStoreCreator(deps)),
    api,
    storage,
    navigate,
    publish: (message) => options?.sequencer.ingest(message),
    channelOptions: () => {
      if (!options) throw new Error("no channel was opened");
      return options;
    },
    closed: () => closes,
  };
}

type PatchMessage = { kind: "patch" } & ServerMessage;

function patch(seq: number, ops: JsonPatchOp[]): PatchMessage {
  return { kind: "patch", seq, runId: "r_1", patch: ops };
}

// ---------------------------------------------------------------------------

describe("joining", () => {
  it("stores the session, mirrors the snapshot, and opens the channel", async () => {
    const h = harness();
    const session = await h.store.getState().joinRoom("abcd", "Allen");

    expect(session.roomCode).toBe("ABCD");
    expect(h.api.joinRoom).toHaveBeenCalledWith("ABCD", expect.objectContaining({ displayName: "Allen" }));
    expect(h.store.getState().state?.runId).toBe("r_1");
    expect(h.store.getState().connection).toBe("open");
    expect(h.navigate).toHaveBeenCalledWith({ name: "player", code: "ABCD" }, { replace: true });
  });

  it("persists the session so a hard refresh recovers (architecture §4.3)", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");

    expect(h.storage.getItem("kad.session.ABCD")).toContain("tok_1");

    // A second store on the same device — i.e. the page was reloaded.
    const reloaded = harness();
    const shared = h.storage;
    const state = reloaded.store.getState();
    void state; // the fresh harness has its own storage; assert on the raw record
    expect(JSON.parse(shared.getItem("kad.session.ABCD") ?? "{}")).toMatchObject({
      runId: "r_1",
      playerId: "p_1",
      roomCode: "ABCD",
    });
  });

  it("takes the seat the create response already gave it", async () => {
    const h = harness();
    const session = await h.store.getState().createRoom("travel", "Allen");

    expect(h.api.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "travel", householdId: expect.stringMatching(/^hh_/) }),
    );
    // Joining again would seat a *second* player and orphan the first.
    expect(h.api.joinRoom).not.toHaveBeenCalled();
    expect(session.playerId).toBe("p_host");
  });

  it("keeps the device binding, and presents it when joining later", async () => {
    const h = harness();
    await h.store.getState().createRoom("travel", "Allen");
    h.store.getState().leave();

    await h.store.getState().joinRoom("ABCD", "Allen");

    // Without this the same phone rejoins as a stranger and its character is
    // orphaned (architecture §4.5).
    expect(h.api.joinRoom).toHaveBeenCalledWith(
      "ABCD",
      expect.objectContaining({ deviceToken: "dev_host" }),
    );
  });

  it("surfaces a failure and does not leave a half-built session", async () => {
    const h = harness();
    h.api.joinRoom.mockRejectedValueOnce(new Error("No such room."));

    await expect(h.store.getState().joinRoom("ZZZZ", "Allen")).rejects.toThrow("No such room.");
    expect(h.store.getState().session).toBeNull();
    expect(h.store.getState().error).toBe("No such room.");
  });
});

describe("the mirror", () => {
  it("moves forward only by applying a server patch", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");
    const before = h.store.getState().state;

    h.publish(patch(2, [{ op: "replace", path: "/narration", value: "The thorns part." }]));

    const after = h.store.getState().state;
    expect(after?.narration).toBe("The thorns part.");
    expect(after).not.toBe(before);
    expect(before?.narration).toBe(""); // the previous mirror was not mutated
  });

  it("surfaces presentation separately from state (architecture §4.2)", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");

    h.publish({
      ...patch(2, [{ op: "replace", path: "/narration", value: "hit" }]),
      presentation: { kind: "DOWN", targetId: "c_1" },
    });

    expect(h.store.getState().presentation).toEqual({
      seq: 2,
      presentation: { kind: "DOWN", targetId: "c_1" },
    });
    expect(h.store.getState().state?.narration).toBe("hit");
  });

  it("holds the patch until a registered world surface has played the animation", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");

    let release = (): void => {};
    const unregister = h.store
      .getState()
      .registerPresentationPlayer(() => new Promise<void>((resolve) => (release = resolve)));

    h.publish({
      ...patch(2, [{ op: "replace", path: "/narration", value: "the die lands" }]),
      presentation: { kind: "ROLL", roll: { die: 17, mod: 3, total: 20, tn: 14, result: "success", characterId: "c_1" } },
    });

    expect(h.store.getState().presentation?.seq).toBe(2);
    expect(h.store.getState().state?.narration).toBe("");

    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.store.getState().state?.narration).toBe("the die lands");
    unregister();
  });

  it("resyncs on a gap instead of guessing", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");
    h.api.fetchState.mockClear();

    await h.channelOptions().resync(1);

    expect(h.api.fetchState).toHaveBeenCalledWith(
      { runId: "r_1", code: "ABCD", sinceSeq: 1 },
      "tok_1",
    );
  });

  it("replays missed events when the server sends them instead of a snapshot", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");
    h.api.fetchState.mockResolvedValueOnce({
      seq: 3,
      events: [
        { seq: 2, runId: "r_1", patch: [{ op: "replace", path: "/narration", value: "two" }] },
        { seq: 3, runId: "r_1", patch: [{ op: "replace", path: "/narration", value: "three" }] },
      ],
    } as never);

    await h.channelOptions().resync(1);

    expect(h.store.getState().state?.narration).toBe("three");
  });
});

describe("send", () => {
  it("posts the intent with the last-seen server seq and changes nothing locally", async () => {
    const h = harness(makeState({ seq: 7 }));
    await h.store.getState().joinRoom("ABCD", "Allen");
    const before = h.store.getState().state;

    await h.store.getState().send({ type: "READY", ready: true });

    expect(h.api.postAction).toHaveBeenCalledWith(
      { runId: "r_1", playerId: "p_1", seq: 7, intent: { type: "READY", ready: true } },
      "tok_1",
    );
    // The server is authoritative: nothing moves until the patch comes back.
    expect(h.store.getState().state).toBe(before);
  });

  it("catches up and sends the intent again on STALE_SEQ", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");
    h.api.fetchState.mockClear();
    h.api.postAction.mockResolvedValueOnce({
      ok: false,
      seq: 9,
      error: { code: "STALE_SEQ", message: "behind" },
    });

    await h.store.getState().send({ type: "ROLL" });

    // Resync, then exactly one more attempt. A rejected intent never applied,
    // so re-sending it cannot double-apply; a tap that silently does nothing
    // is the outcome worth avoiding.
    expect(h.api.fetchState).toHaveBeenCalledTimes(1);
    expect(h.api.postAction).toHaveBeenCalledTimes(2);
    expect(h.store.getState().error).toBeNull(); // being behind is not a player error
  });

  it("retries at the seq the server reported, not the mirror's", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");
    h.api.postAction.mockResolvedValueOnce({
      ok: false,
      seq: 9,
      error: { code: "STALE_SEQ", message: "behind" },
    });

    await h.store.getState().send({ type: "ROLL" });

    // The mirror can legitimately still be behind: a patch carrying a dice
    // roll waits out the WorldView animation. Re-posting the mirror's seq
    // would be rejected as stale a second time and the tap would vanish.
    const retry = h.api.postAction.mock.calls.at(-1)?.[0];
    expect(retry?.seq).toBe(9);
  });

  it("does not retry forever when the catch-up still leaves it stale", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");
    h.api.postAction.mockResolvedValue({
      ok: false,
      seq: 9,
      error: { code: "STALE_SEQ", message: "behind" },
    });

    await h.store.getState().send({ type: "ROLL" });

    expect(h.api.postAction).toHaveBeenCalledTimes(2); // one retry, never a loop
    expect(h.store.getState().error).toBe("behind");
  });

  it("resyncs when the broadcast an ok response promised never arrives", async () => {
    /*
     * The recovery contract for a server whose publish failed after the
     * commit: the acting phone would otherwise wait forever on a patch that
     * never left, with the state quietly advanced server-side. An ok response
     * that names a seq ahead of the mirror arms a watchdog; if the channel
     * has not caught up within the grace period, the client resyncs.
     */
    vi.useFakeTimers();
    try {
      const h = harness(makeState({ seq: 7 }));
      await h.store.getState().joinRoom("ABCD", "Allen");
      h.api.fetchState.mockClear();
      // Committed as seq 8, but no broadcast will follow.
      h.api.postAction.mockResolvedValueOnce({ ok: true, seq: 8 });

      await h.store.getState().send({ type: "READY", ready: true });
      expect(h.api.fetchState).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(4_100);
      expect(h.api.fetchState).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not resync when the broadcast arrives in time", async () => {
    vi.useFakeTimers();
    try {
      const state = makeState({ seq: 7 });
      const h = harness(state);
      await h.store.getState().joinRoom("ABCD", "Allen");
      h.api.fetchState.mockClear();
      h.api.postAction.mockResolvedValueOnce({ ok: true, seq: 8 });

      await h.store.getState().send({ type: "READY", ready: true });
      // The patch lands on the channel like it normally would.
      h.publish(patch(8, [{ op: "replace", path: "/seq", value: 8 }]));

      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.api.fetchState).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports whether the server accepted the intent", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");

    await expect(h.store.getState().send({ type: "ROLL" })).resolves.toBe(true);

    h.api.postAction.mockResolvedValueOnce({
      ok: false,
      seq: 1,
      error: { code: "ILLEGAL", message: "Not your turn." },
    });
    // A caller that discards work on success has to be able to tell — the
    // creation flow resets five screens of choices on a `true`.
    await expect(h.store.getState().send({ type: "ROLL" })).resolves.toBe(false);
  });

  it("shows an ILLEGAL rejection to the player, and dismisses it", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");
    h.api.postAction.mockResolvedValueOnce({
      ok: false,
      seq: 1,
      error: { code: "ILLEGAL", message: "Not your turn." },
    });

    await h.store.getState().send({ type: "ROLL" });
    expect(h.store.getState().error).toBe("Not your turn.");

    h.store.getState().dismissError();
    expect(h.store.getState().error).toBeNull();
  });

  it("keeps a network failure out of the game state", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");
    const before = h.store.getState().state;
    h.api.postAction.mockRejectedValueOnce(new Error("offline"));

    await h.store.getState().send({ type: "ADVANCE" });

    expect(h.store.getState().error).toBe("offline");
    expect(h.store.getState().state).toBe(before);
  });
});

describe("display clients (spec §2.1)", () => {
  it("attach with no player, no token, and nothing persisted", async () => {
    const h = harness();
    await h.store.getState().attach("abcd", "display");

    const session = h.store.getState().session;
    // A viewer token, not a session token: it names the room and nothing else,
    // and `playerId: ""` is what actually denies authority.
    expect(session).toMatchObject({
      runId: "r_1",
      roomCode: "ABCD",
      playerId: "",
      sessionToken: "tok_view",
    });
    expect(h.api.joinRoom).not.toHaveBeenCalled();
    expect(h.storage.getItem("kad.session.ABCD")).toBeNull();
    expect(h.store.getState().state?.runId).toBe("r_1");
  });

  it("never send an intent", async () => {
    const h = harness();
    await h.store.getState().attach("ABCD", "display");

    await h.store.getState().send({ type: "ROLL" });

    expect(h.api.postAction).not.toHaveBeenCalled();
  });

  it("recover from the URL alone after a hard refresh", async () => {
    const h = harness(makeState({ seq: 42, narration: "mid-encounter" }));
    await h.store.getState().attach("ABCD", "display");

    expect(h.store.getState().state?.narration).toBe("mid-encounter");
    expect(h.store.getState().connection).toBe("open");
  });
});

describe("attach as a player", () => {
  it("resumes a stored session without rejoining", async () => {
    const h = harness();
    h.storage.setItem(
      "kad.session.ABCD",
      JSON.stringify({
        runId: "r_1",
        roomCode: "ABCD",
        playerId: "p_1",
        mode: "travel",
        sessionToken: "tok_1",
      }),
    );

    await h.store.getState().attach("ABCD", "player");

    expect(h.api.joinRoom).not.toHaveBeenCalled();
    expect(h.store.getState().session?.playerId).toBe("p_1");
    expect(h.store.getState().state?.runId).toBe("r_1");
  });

  it("falls back to the home screen with the code remembered when there is no session", async () => {
    const h = harness();
    await h.store.getState().attach("ABCD", "player");

    expect(h.store.getState().session).toBeNull();
    expect(h.store.getState().pendingCode).toBe("ABCD");
    expect(h.store.getState().connection).toBe("idle");
  });
});

describe("leave", () => {
  it("closes the channel, forgets the session, and goes home", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");

    h.store.getState().leave();

    expect(h.closed()).toBe(1);
    expect(h.store.getState().session).toBeNull();
    expect(h.store.getState().state).toBeNull();
    expect(h.storage.getItem("kad.session.ABCD")).toBeNull();
    expect(h.navigate).toHaveBeenLastCalledWith({ name: "home" });
  });
});

describe("content", () => {
  it("loads rules and items once", async () => {
    const h = harness();
    await Promise.all([h.store.getState().loadContent(), h.store.getState().loadContent()]);
    await h.store.getState().loadContent();

    expect(h.api.loadRules).toHaveBeenCalledTimes(1);
    expect(h.store.getState().rules).toEqual({ version: 1 });
  });
});

// ---------------------------------------------------------------------------
// Pure selectors
// ---------------------------------------------------------------------------

describe("selectMe", () => {
  it("finds this device's party member", () => {
    const state = makeState({
      party: [makeMember(), makeMember({ playerId: "p_2", character: { ...makeMember().character, id: "c_2" } })],
    });
    expect(selectMe(state, "p_2")?.playerId).toBe("p_2");
    expect(selectMe(state, "p_9")).toBeNull();
    expect(selectMe(null, "p_1")).toBeNull();
    expect(selectMe(state, "")).toBeNull();
  });
});

describe("isPromptForPlayer", () => {
  const party = [makeMember()];

  it("is false when there is no prompt", () => {
    expect(isPromptForPlayer(null, "p_1", party)).toBe(false);
  });

  it("treats an empty forPlayerIds as everyone", () => {
    expect(
      isPromptForPlayer(
        { kind: "choice", sceneId: "s", options: [], forPlayerIds: [], vote: false },
        "p_1",
        party,
      ),
    ).toBe(true);
  });

  it("respects an explicit audience", () => {
    const prompt = {
      kind: "choice" as const,
      sceneId: "s",
      options: [],
      forPlayerIds: ["p_2"],
      vote: false,
    };
    expect(isPromptForPlayer(prompt, "p_2", party)).toBe(true);
    expect(isPromptForPlayer(prompt, "p_1", party)).toBe(false);
  });

  it("resolves a character-scoped prompt through the party", () => {
    const prompt = {
      kind: "roll" as const,
      sceneId: "s",
      stat: "quick" as const,
      tn: 12,
      prompt: "Wriggle through",
      characterId: "c_1",
    };
    expect(isPromptForPlayer(prompt, "p_1", party)).toBe(true);
    expect(isPromptForPlayer(prompt, "p_2", party)).toBe(false);
    expect(isPromptForPlayer({ ...prompt, characterId: "c_nope" }, "p_1", party)).toBe(false);
  });

  it("is never true for a display client", () => {
    expect(
      isPromptForPlayer({ kind: "ready", forPlayerIds: [] }, "", party),
    ).toBe(false);
  });
});

// A store built per test; nothing leaks between them.
beforeEach(() => {
  vi.clearAllMocks();
});

describe("choosing a transport (architecture §4.4)", () => {
  /*
   * The regression this exists for: the server was switched to publish through
   * AppSync Events while the client still opened an `EventSource` against the
   * dev server's `/events/<code>`, which no Lambda serves. Every check passed —
   * locally SSE is the only transport there is — and in production every phone
   * and TV would have 404ed forever and silently never applied a patch.
   */
  const REALTIME = {
    region: "us-east-1",
    realtime: {
      httpDomain: "abc.appsync-api.us-east-1.amazonaws.com",
      realtimeDomain: "abc.appsync-realtime-api.us-east-1.amazonaws.com",
      namespace: "room",
    },
    auth: { userPoolId: "us-east-1_abc", clientId: "c" },
  };

  it("opens the AppSync socket where the deployment has one", async () => {
    const h = harness();
    h.api.fetchConfig.mockResolvedValue(REALTIME);

    await h.store.getState().joinRoom("ABCD", "Allen");

    expect(h.channelOptions().createEventSource).toBeTypeOf("function");
  });

  it("falls back to SSE on a laptop, where /api/config does not exist", async () => {
    const h = harness();
    // `fetchConfig` already resolves null — the local-dev answer.
    await h.store.getState().joinRoom("ABCD", "Allen");

    // Undefined means openChannel uses its own EventSource default.
    expect(h.channelOptions().createEventSource).toBeUndefined();
  });

  it("falls back to SSE rather than failing when the config cannot be read", async () => {
    const h = harness();
    h.api.fetchConfig.mockRejectedValue(new Error("offline"));

    await h.store.getState().joinRoom("ABCD", "Allen");

    expect(h.store.getState().session).not.toBeNull();
    expect(h.channelOptions().createEventSource).toBeUndefined();
  });

  it("asks for the config once, however many rooms are joined", async () => {
    const h = harness();
    h.api.fetchConfig.mockResolvedValue(REALTIME);

    await h.store.getState().joinRoom("ABCD", "Allen");
    h.store.getState().leave();
    await h.store.getState().joinRoom("ABCD", "Allen");

    expect(h.api.fetchConfig).toHaveBeenCalledTimes(1);
  });

  it("gives the TV the same transport as a phone, on its viewer token", async () => {
    const h = harness();
    h.api.fetchConfig.mockResolvedValue(REALTIME);

    await h.store.getState().attach("ABCD", "display");

    expect(h.api.watchRoom).toHaveBeenCalledWith("ABCD");
    expect(h.channelOptions().createEventSource).toBeTypeOf("function");
  });
});
