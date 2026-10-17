import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ActionResponse, ChannelMessage, JsonPatchOp, ResolvedCharacter, RunState, ServerMessage } from "@kad/shared";
import {
  gameStoreCreator,
  isPromptForPlayer,
  selectMe,
  type GameStoreDeps,
  type InternalGameStore,
} from "./index";
import type { ChannelOptions } from "../sync/channel";
import { ApiError, type Api } from "../sync/client";
import {
  becomeSharedDevice,
  loadPlayerDeviceToken,
  loadSession,
  loadSharedDevice,
  saveIdentity,
  type KeyValueStorage,
} from "./persistence";
import { makeMember, makeState } from "../testing/fixtures";
import { getFieldGuideDiscoveries, setFieldGuideDiscoveries } from "./field-guide-discoveries";
import {
  ackFieldGuideNews,
  clearFieldGuideNews,
  getFieldGuideNews,
  subscribeFieldGuideNews,
} from "./field-guide-news";

// ---------------------------------------------------------------------------
// Harness — no network, no DOM, no timers.
// ---------------------------------------------------------------------------

function memoryStorage(): KeyValueStorage & Pick<Storage, "key" | "length"> {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

/** Every key and value in a storage, for asserting what was never written. */
function dump(storage: KeyValueStorage): Record<string, string> {
  const real = storage as KeyValueStorage & Pick<Storage, "key" | "length">;
  const out: Record<string, string> = {};
  for (let i = 0; i < real.length; i += 1) {
    const key = real.key(i);
    if (key !== null) out[key] = real.getItem(key) ?? "";
  }
  return out;
}

interface Harness {
  store: StoreApi<InternalGameStore>;
  api: {
    [K in keyof Api]: ReturnType<typeof vi.fn>;
  };
  storage: KeyValueStorage & Pick<Storage, "key" | "length">;
  /** This tab's storage: where a shared tablet keeps its sessions (#250). */
  tab: KeyValueStorage & Pick<Storage, "key" | "length">;
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
    // The TV opening a Party Mode room: the room and a binding, no seat.
    openDisplayRoom: vi.fn(async () => ({
      code: state.roomCode,
      runId: state.runId,
      mode: "party" as const,
      expiresAt: "2026-07-28T06:00:00.000Z",
      deviceToken: "dev_tv",
    })),
    // This player's saved heroes (spec §5). Empty unless a test says otherwise.
    listHeroes: vi.fn(async () => ({ heroes: [] as ResolvedCharacter[] })),
    // Between games (screens/JournalScreen). Empty unless a test says otherwise.
    loadJournal: vi.fn(async () => ({ heroes: [] as ResolvedCharacter[], fieldGuide: {}, finders: {}, whereabouts: null })),
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
    // Remove, lock, close (#263, #267): one call, by control.
    hostControl: vi.fn(async (): Promise<void> => undefined),
    postAction: vi.fn(async (): Promise<ActionResponse> => ({ ok: true, seq: state.seq })),
    postPreview: vi.fn(async (): Promise<void> => undefined),
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
    loadWorld: vi.fn(async () => ({
      title: "The Realm of Red Sky",
      image: { src: "/assets/world/realm_of_red_sky.webp", width: 10, height: 10 },
      places: {},
    })),
    // The optional sign-in (§4.5). `null` is the local-dev answer — there is no
    // user pool, so no offer is made, and the game store never touches these.
    fetchConfig: vi.fn(async () => null),
    probeDevAuth: vi.fn(async () => false),
    linkAccount: vi.fn(),
    adoptDevice: vi.fn(),
    // A shared tablet (#250): sessions only, never a device token.
    shareDevice: vi.fn(),
    forgetDevice: vi.fn(),
    listSharedPlayers: vi.fn(async () => ({
      householdId: "h_1",
      players: [
        { id: "p_ada", displayName: "Ada", color: "#7FD4C1", heroes: ["Sparklehoof"] },
        { id: "p_ben", displayName: "Ben", color: "#F2A65A", heroes: [] },
      ],
    })),
    joinRoomShared: vi.fn(async (_code: string, _token: string, seat: { playerId?: string }) => ({
      runId: state.runId,
      playerId: seat.playerId ?? "p_new",
      mode: state.mode,
      sessionToken: `tok_${seat.playerId ?? "new"}`,
      state,
    })),
    createRoomShared: vi.fn(async (_body: unknown, _token: string, seat: { playerId?: string }) => ({
      code: state.roomCode,
      runId: state.runId,
      mode: state.mode,
      expiresAt: "2026-07-28T06:00:00.000Z",
      playerId: seat.playerId ?? "p_new",
      sessionToken: `tok_${seat.playerId ?? "new"}`,
      state,
      host: true,
    })),
  };

  const storage = memoryStorage();
  const tab = memoryStorage();
  const navigate = vi.fn();

  const deps = {
    api: api as unknown as Api,
    storage,
    tabStorage: tab,
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
    tab,
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

  it("opens a room from the TV without seating it, and goes to the TV route", async () => {
    const h = harness();
    await h.store.getState().openOnThisScreen();

    expect(h.api.openDisplayRoom).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: expect.stringMatching(/^hh_/) }),
    );
    // The TV is the lobby, not a player (spec §2.1).
    expect(h.api.createRoom).not.toHaveBeenCalled();
    expect(h.api.joinRoom).not.toHaveBeenCalled();
    expect(h.store.getState().session).toBeNull();
    expect(h.navigate).toHaveBeenCalledWith({ name: "tv", code: "ABCD" }, { replace: true });
    // The binding is kept, so tomorrow's room lands in the same household.
    expect(h.storage.getItem("kad.device")).toContain("dev_tv");
  });

  it("lists heroes with the room session, and none for a screen with no seat", async () => {
    const h = harness();
    expect(await h.store.getState().listHeroes()).toEqual([]);
    expect(h.api.listHeroes).not.toHaveBeenCalled();

    await h.store.getState().joinRoom("ABCD", "Allen");
    await h.store.getState().listHeroes();
    expect(h.api.listHeroes).toHaveBeenCalledWith("tok_1");
  });

  it("opens the journal with the device binding, and not on a phone that has never played", async () => {
    const h = harness();
    expect(await h.store.getState().loadJournal()).toBeNull();
    expect(h.api.loadJournal).not.toHaveBeenCalled();
    // Asking must not mint an identity for a phone that has never played.
    expect(h.storage.getItem("kad.device")).toBeNull();

    // Hosting is what binds this phone; out of the room, the binding remains.
    await h.store.getState().createRoom("travel", "Allen");
    h.store.getState().leave();
    expect(await h.store.getState().loadJournal()).toMatchObject({
      journal: { heroes: [], whereabouts: null },
      savedAt: null,
    });
    expect(h.api.loadJournal).toHaveBeenCalledWith("dev_host");
  });

  it("offers no journal to a screen that only hosted, until it is seated as a player", async () => {
    const h = harness();
    await h.store.getState().openOnThisScreen();
    // The TV keeps its binding for tomorrow's room, but it is nobody.
    expect(h.storage.getItem("kad.device")).toContain("dev_tv");
    expect(await h.store.getState().loadJournal()).toBeNull();
    expect(h.api.loadJournal).not.toHaveBeenCalled();

    await h.store.getState().joinRoom("ABCD", "Allen");
    h.store.getState().leave();
    await h.store.getState().loadJournal();
    expect(h.api.loadJournal).toHaveBeenCalledWith("dev_tv");
  });

  it("keeps a player's book when that phone later hosts Party Mode on itself", async () => {
    const h = harness();
    await h.store.getState().createRoom("travel", "Allen");
    h.store.getState().leave();

    await h.store.getState().openOnThisScreen();
    expect(await h.store.getState().loadJournal()).not.toBeNull();
    expect(h.api.loadJournal).toHaveBeenLastCalledWith("dev_tv");
  });

  it("opens last time's journal when the server cannot be reached", async () => {
    const h = harness();
    await h.store.getState().createRoom("travel", "Allen");
    h.store.getState().leave();
    const fresh = await h.store.getState().loadJournal();

    h.api.loadJournal.mockRejectedValueOnce(new ApiError(0, "The game took too long to answer. Tap again."));
    const offline = await h.store.getState().loadJournal();
    expect(offline?.journal).toEqual(fresh?.journal);
    expect(offline?.savedAt).toEqual(expect.any(String));

    h.api.loadJournal.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect((await h.store.getState().loadJournal())?.savedAt).toEqual(expect.any(String));
  });

  it("forgets the saved journal when the server refuses the binding", async () => {
    const h = harness();
    await h.store.getState().createRoom("travel", "Allen");
    h.store.getState().leave();
    await h.store.getState().loadJournal();
    expect(h.storage.getItem("kad.journal")).not.toBeNull();

    // A guest household swept after its week: last time's heroes are gone.
    h.api.loadJournal.mockRejectedValueOnce(new ApiError(401, "the journal needs this device's token", "FORBIDDEN"));
    await expect(h.store.getState().loadJournal()).rejects.toThrow();
    expect(h.storage.getItem("kad.journal")).toBeNull();

    h.api.loadJournal.mockRejectedValueOnce(new ApiError(0, "timeout"));
    await expect(h.store.getState().loadJournal()).rejects.toThrow("timeout");
  });

  it("never shows one binding's saved journal to another", async () => {
    const h = harness();
    await h.store.getState().createRoom("travel", "Allen");
    h.store.getState().leave();
    await h.store.getState().loadJournal();

    const identity = JSON.parse(h.storage.getItem("kad.device") ?? "{}") as Record<string, unknown>;
    h.storage.setItem("kad.device", JSON.stringify({ ...identity, deviceToken: "dev_other" }));
    h.api.loadJournal.mockRejectedValueOnce(new ApiError(0, "timeout"));
    await expect(h.store.getState().loadJournal()).rejects.toThrow("timeout");
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

  it("stores progression for application subscribers once per authoritative seq", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");
    const seen: number[] = [];
    const unsubscribe = h.store.subscribe((state) => {
      if (state.progression) seen.push(state.progression.seq);
    });
    const progression = {
      characters: [],
      awards: [{ characterId: "c_1", leveledTo: 4, newTier: "sworn" as const }],
    };
    const message = {
      ...patch(2, [{ op: "replace", path: "/narration", value: "level up" }]),
      progression,
    };

    h.publish(message);
    h.publish(message);
    unsubscribe();

    expect(h.store.getState().progression).toEqual({ seq: 2, progression });
    expect(seen).toEqual([2]);
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

describe("preview", () => {
  it("posts the newest pick only, one at a time, and skips a repeat", async () => {
    const h = harness(makeState({ seq: 7 }));
    await h.store.getState().joinRoom("ABCD", "Allen");
    let release: () => void = () => undefined;
    h.api.postPreview.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));

    const { preview } = h.store.getState();
    preview({ kind: "choice", choiceId: "east" }, "choice:1");
    // Two more taps while the first is in the air: only the last is worth sending.
    preview({ kind: "choice", choiceId: "west" }, "choice:1");
    preview(null, null);
    expect(h.api.postPreview).toHaveBeenCalledTimes(1);
    expect(h.api.postPreview).toHaveBeenLastCalledWith({ kind: "choice", choiceId: "east" }, "choice:1", "tok_1");
    release();
    await vi.waitFor(() => expect(h.api.postPreview).toHaveBeenCalledTimes(2));
    expect(h.api.postPreview).toHaveBeenLastCalledWith(null, null, "tok_1");

    // Already told: saying it again sends nothing.
    preview(null, null);
    await Promise.resolve();
    expect(h.api.postPreview).toHaveBeenCalledTimes(2);
  });

  it("keeps everybody's picks with the decision they were made for, and forgets a withdrawn one", async () => {
    const h = harness(makeState({ seq: 7 }));
    await h.store.getState().joinRoom("ABCD", "Allen");
    h.publish({ kind: "preview", seq: 7, runId: "r_1", playerId: "p_2", preview: { kind: "end_turn" }, context: "fight:x" });
    expect(h.store.getState().previews).toEqual({ p_2: { preview: { kind: "end_turn" }, context: "fight:x" } });
    h.publish({ kind: "preview", seq: 7, runId: "r_1", playerId: "p_2", preview: null, context: null });
    expect(h.store.getState().previews).toEqual({});
    expect(h.store.getState().state?.seq).toBe(7);
  });
});

describe("arrivals and removal (#267)", () => {
  it("holds who joined, once each, without touching the mirror", async () => {
    const h = harness(makeState({ seq: 7 }));
    await h.store.getState().joinRoom("ABCD", "Allen");
    const arrival = { kind: "arrival" as const, seq: 7, runId: "r_1", playerId: "p_2", name: "Mia", color: "#7FD4C1" };
    h.publish(arrival);
    // A phone that reloads on the join screen joins twice; it is one arrival.
    h.publish({ ...arrival, name: "Mia again" });
    expect(h.store.getState().arrivals).toEqual([{ playerId: "p_2", name: "Mia again", color: "#7FD4C1" }]);
    expect(h.store.getState().state?.seq).toBe(7);

    h.store.getState().dismissArrival("p_2");
    expect(h.store.getState().arrivals).toEqual([]);
  });

  it("ignores an arrival for some other run", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");
    h.publish({ kind: "arrival", seq: 0, runId: "r_other", playerId: "p_2", name: "Mia", color: "#fff" });
    expect(h.store.getState().arrivals).toEqual([]);
  });

  it("knows it is the host when the server says so, and keeps knowing after a reload", async () => {
    const h = harness();
    h.api.createRoom.mockImplementationOnce(async () => ({
      code: "ABCD",
      runId: "r_1",
      mode: "travel",
      expiresAt: "2026-07-28T06:00:00.000Z",
      playerId: "p_host",
      sessionToken: "tok_host",
      state: makeState(),
      deviceToken: "dev_host",
      host: true,
    }));
    await h.store.getState().createRoom("travel", "Allen");
    expect(h.store.getState().session?.host).toBe(true);
    expect(JSON.parse(h.storage.getItem("kad.session.ABCD") ?? "{}")).toMatchObject({ host: true });
  });

  it("lets the host take a player out, with its device binding", async () => {
    const h = harness();
    h.api.createRoom.mockImplementationOnce(async () => ({
      code: "ABCD",
      runId: "r_1",
      mode: "travel",
      expiresAt: "2026-07-28T06:00:00.000Z",
      playerId: "p_host",
      sessionToken: "tok_host",
      state: makeState(),
      deviceToken: "dev_host",
      host: true,
    }));
    await h.store.getState().createRoom("travel", "Allen");
    h.publish({ kind: "arrival", seq: 0, runId: "r_1", playerId: "p_2", name: "Mia", color: "#fff" });

    expect(await h.store.getState().removePlayer("p_2")).toBe(true);
    expect(h.api.hostControl).toHaveBeenCalledWith("ABCD", "remove", { playerId: "p_2" }, { deviceToken: "dev_host" });
    expect(h.store.getState().arrivals).toEqual([]);
  });

  it("locks, unlocks and closes the room it opened (#263)", async () => {
    const h = harness();
    await h.store.getState().createRoom("travel", "Allen");
    h.store.setState({ session: { ...h.store.getState().session!, host: true } });

    expect(await h.store.getState().lockRoom(true)).toBe(true);
    expect(await h.store.getState().lockRoom(false)).toBe(true);
    expect(await h.store.getState().closeRoom()).toBe(true);
    expect(h.api.hostControl.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ["lock", { locked: true }],
      ["lock", { locked: false }],
      ["close", {}],
    ]);
  });

  it("never lets a burst push a host's arrival out, though it caps everyone else's", async () => {
    // The host's notices are its only Remove control (review of #269).
    const hosted = harness();
    hosted.api.createRoom.mockImplementationOnce(async () => ({
      code: "ABCD",
      runId: "r_1",
      mode: "travel",
      expiresAt: "2026-07-28T06:00:00.000Z",
      playerId: "p_host",
      sessionToken: "tok_host",
      state: makeState(),
      deviceToken: "dev_host",
      host: true,
    }));
    await hosted.store.getState().createRoom("travel", "Allen");
    const guest = harness();
    await guest.store.getState().joinRoom("ABCD", "Sam");
    for (const h of [hosted, guest]) {
      for (let i = 0; i < 10; i++) {
        h.publish({ kind: "arrival", seq: 0, runId: "r_1", playerId: `p_${i}`, name: `P${i}`, color: "#fff" });
      }
    }
    expect(hosted.store.getState().arrivals).toHaveLength(10);
    expect(guest.store.getState().arrivals).toHaveLength(6);
  });

  it("bounds the host's list in a flood of joins, keeps the newest, and counts what fell off", async () => {
    // Review of #269: anyone with the code can join as a new player over and over.
    const h = harness();
    h.api.createRoom.mockImplementationOnce(async () => ({
      code: "ABCD",
      runId: "r_1",
      mode: "travel",
      expiresAt: "2026-07-28T06:00:00.000Z",
      playerId: "p_host",
      sessionToken: "tok_host",
      state: makeState(),
      deviceToken: "dev_host",
      host: true,
    }));
    await h.store.getState().createRoom("travel", "Allen");
    for (let i = 0; i < 1000; i++) {
      h.publish({ kind: "arrival", seq: 0, runId: "r_1", playerId: `p_${i}`, name: `P${i}`, color: "#fff" });
    }
    const { arrivals, arrivalsDropped } = h.store.getState();
    expect(arrivals).toHaveLength(50);
    expect(arrivals.at(-1)?.playerId).toBe("p_999");
    expect(arrivalsDropped).toBe(950);
  });

  it("does not try when this device is not the host", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");
    expect(await h.store.getState().removePlayer("p_2")).toBe(false);
    expect(await h.store.getState().lockRoom(true)).toBe(false);
    expect(await h.store.getState().closeRoom()).toBe(false);
    expect(h.api.hostControl).not.toHaveBeenCalled();
  });

  it("says why when the server refuses", async () => {
    const h = harness();
    h.api.createRoom.mockImplementationOnce(async () => ({
      code: "ABCD",
      runId: "r_1",
      mode: "travel",
      expiresAt: "2026-07-28T06:00:00.000Z",
      playerId: "p_host",
      sessionToken: "tok_host",
      state: makeState(),
      deviceToken: "dev_host",
      host: true,
    }));
    await h.store.getState().createRoom("travel", "Allen");
    h.api.hostControl.mockRejectedValueOnce(new ApiError(403, "only the screen or phone that opened this room can take someone out"));
    expect(await h.store.getState().removePlayer("p_2")).toBe(false);
    expect(h.store.getState().error).toMatch(/only the screen or phone/);
  });

  it("has a TV that opened the room present its binding, to learn it is still the host", async () => {
    const h = harness();
    await h.store.getState().openOnThisScreen();
    h.api.watchRoom.mockImplementationOnce(async () => ({
      runId: "r_1",
      mode: "party",
      expiresAt: "2026-07-05T00:00:00.000Z",
      viewerToken: "tok_view",
      state: makeState(),
      host: true,
    }));
    await h.store.getState().attach("ABCD", "display");
    expect(h.api.watchRoom).toHaveBeenCalledWith("ABCD", expect.any(Number), "dev_tv");
    expect(h.store.getState().session).toMatchObject({ playerId: "", host: true });
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
  it("does not restore a room when its pending attach finishes after leaving", async () => {
    const h = harness();
    let finish!: (value: unknown) => void;
    h.api.watchRoom.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const attaching = h.store.getState().attach("ABCD", "display");
    h.store.getState().leave();
    finish({ runId: "r_1", mode: "party", viewerToken: "viewer", state: makeState() });
    await attaching;
    expect(h.store.getState().session).toBeNull();
    expect(h.store.getState().state).toBeNull();
    expect(h.store.getState().connection).toBe("idle");
  });

  it("coalesces overlapping recovery requests and catches up again from the latest sequence", async () => {
    const h = harness(makeState({ seq: 1 }));
    await h.store.getState().joinRoom("ABCD", "Allen");
    let finish!: (value: unknown) => void;
    h.api.fetchState
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ seq: 3, state: makeState({ seq: 3 }) });
    const first = h.channelOptions().resync(1);
    const second = h.channelOptions().resync(1);
    const third = h.channelOptions().resync(1);
    expect(h.api.fetchState).toHaveBeenCalledTimes(1);
    finish({ seq: 2, state: makeState({ seq: 2 }) });
    await Promise.all([first, second, third]);
    expect(h.api.fetchState).toHaveBeenCalledTimes(2);
    expect(h.api.fetchState).toHaveBeenLastCalledWith(
      { runId: "r_1", code: "ABCD", sinceSeq: 2 }, "tok_1",
    );
    expect(h.store.getState().state?.seq).toBe(3);
  });

  it("retries a failed reconnect catch-up without requiring another channel event", async () => {
    vi.useFakeTimers();
    const h = harness(makeState({ seq: 1 }));
    try {
      await h.store.getState().joinRoom("ABCD", "Allen");
      h.api.fetchState.mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ seq: 2, state: makeState({ seq: 2 }) });
      await expect(h.channelOptions().resync(1)).rejects.toThrow("offline");
      await vi.advanceTimersByTimeAsync(501);
      expect(h.api.fetchState).toHaveBeenCalledTimes(2);
      expect(h.store.getState().state?.seq).toBe(2);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(h.api.fetchState).toHaveBeenCalledTimes(2);
    } finally {
      h.store.getState().leave();
      vi.useRealTimers();
    }
  });

  it("cancels failed catch-up retries on leave", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await h.store.getState().joinRoom("ABCD", "Allen");
      h.api.fetchState.mockRejectedValue(new Error("offline"));
      await expect(h.channelOptions().resync(1)).rejects.toThrow("offline");
      h.store.getState().leave();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(h.api.fetchState).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let repeated gap notifications bypass recovery backoff", async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    const h = harness(makeState({ seq: 1 }));
    try {
      await h.store.getState().joinRoom("ABCD", "Allen");
      h.api.fetchState.mockRejectedValue(new Error("offline"));
      h.publish(patch(3, [{ op: "replace", path: "/seq", value: 3 }]));
      await vi.advanceTimersByTimeAsync(2_000);
      // Gap at 750ms, retry at 1250ms. The next gap at 1500ms must wait
      // for the scheduled second retry at 2250ms.
      expect(h.api.fetchState).toHaveBeenCalledTimes(2);
    } finally {
      h.store.getState().leave();
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it("retries failed broadcast recovery and stops once caught up", async () => {
    vi.useFakeTimers();
    try {
      const h = harness(makeState({ seq: 7 }));
      await h.store.getState().joinRoom("ABCD", "Allen");
      h.api.postAction.mockResolvedValueOnce({ ok: true, seq: 8 });
      h.api.fetchState
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ seq: 8, state: makeState({ seq: 8 }) });
      await h.store.getState().send({ type: "READY", ready: true });
      await vi.advanceTimersByTimeAsync(8_100);
      expect(h.api.fetchState).toHaveBeenCalledTimes(2);
      expect(h.store.getState().state?.seq).toBe(8);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(h.api.fetchState).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a resync snapshot that completes after leaving", async () => {
    const h = harness();
    await h.store.getState().joinRoom("ABCD", "Allen");
    let finish!: (value: unknown) => void;
    h.api.fetchState.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const syncing = h.channelOptions().resync(0);
    h.store.getState().leave();
    finish({ seq: 8, state: makeState({ seq: 8 }) });
    await syncing;
    expect(h.store.getState().state).toBeNull();
  });

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
    const table = [...party, makeMember({ playerId: "p_2" })];
    expect(isPromptForPlayer(prompt, "p_2", table)).toBe(true);
    expect(isPromptForPlayer(prompt, "p_1", table)).toBe(false);
  });

  it("opens a story turn to anyone once the turn holder has dropped (spec §6.1)", () => {
    const prompt = {
      kind: "choice" as const,
      sceneId: "s",
      options: [],
      forPlayerIds: ["p_2"],
      vote: false,
    };
    // The engine takes a stand-in's answer, so the stand-in needs the buttons.
    const table = [...party, makeMember({ playerId: "p_2", connected: false })];
    expect(isPromptForPlayer(prompt, "p_1", table)).toBe(true);
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
    // A roller who has left the run cannot hold the check up: anyone may roll.
    expect(isPromptForPlayer({ ...prompt, characterId: "c_nope" }, "p_1", party)).toBe(true);
  });

  it("hands a whole-party check to everyone who has not rolled yet", () => {
    const table = [...party, makeMember({ playerId: "p_2", character: { ...party[0]!.character, id: "c_2" } })];
    const prompt = {
      kind: "roll" as const,
      sceneId: "s",
      stat: "quick" as const,
      tn: 12,
      prompt: "Cross together",
      characterId: "c_2",
      group: { pending: ["c_2"], rolls: [] },
    };
    expect(isPromptForPlayer(prompt, "p_2", table)).toBe(true);
    expect(isPromptForPlayer(prompt, "p_1", table)).toBe(false);
  });

  it("opens a roll to the table when the nominee's phone has dropped", () => {
    const prompt = {
      kind: "roll" as const,
      sceneId: "s",
      stat: "quick" as const,
      tn: 12,
      prompt: "Wriggle through",
      characterId: "c_1",
    };
    const table = [...party, makeMember({ playerId: "p_2", character: { ...party[0]!.character, id: "c_2" } })];
    expect(isPromptForPlayer(prompt, "p_2", table)).toBe(false);
    const dropped = table.map((m) => (m.character.id === "c_1" ? { ...m, connected: false } : m));
    expect(isPromptForPlayer(prompt, "p_2", dropped)).toBe(true);
    expect(isPromptForPlayer(prompt, "p_stranger", dropped)).toBe(false);
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

  it("retries failed config discovery and opens the production transport", async () => {
    vi.useFakeTimers();
    const h = harness();
    try {
      h.api.fetchConfig.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(REALTIME);
      await h.store.getState().joinRoom("ABCD", "Allen");
      expect(h.store.getState().connection).toBe("reconnecting");
      expect(() => h.channelOptions()).toThrow("no channel");
      await vi.advanceTimersByTimeAsync(501);
      expect(h.api.fetchConfig).toHaveBeenCalledTimes(2);
      expect(h.channelOptions().createEventSource).toBeTypeOf("function");
      expect(h.store.getState().connection).toBe("open");
    } finally {
      h.store.getState().leave();
      vi.useRealTimers();
    }
  });

  it("cancels config retries when leaving", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.api.fetchConfig.mockRejectedValue(new Error("offline"));
      await h.store.getState().joinRoom("ABCD", "Allen");
      h.store.getState().leave();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(h.api.fetchConfig).toHaveBeenCalledTimes(1);
      expect(h.store.getState().session).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

    expect(h.api.watchRoom).toHaveBeenCalledWith("ABCD", expect.any(Number));
    expect(h.channelOptions().createEventSource).toBeTypeOf("function");
  });
});

describe("recovering a stored session from the URL", () => {
  /**
   * A phone that has already joined, reloaded. This is the state every surface
   * is in after a hard refresh: a session in storage, nothing in memory.
   */
  async function refreshed(h: ReturnType<typeof harness>) {
    await h.store.getState().joinRoom("ABCD", "Allen");
    // Wipe the in-memory half only — storage keeps the session, exactly as a
    // page load does.
    h.store.setState({ session: null, state: null, connection: "idle" });
    h.api.fetchState.mockClear();
    return h;
  }

  it("keeps asking when the server is briefly unreachable", async () => {
    /*
     * Architecture §4.3 promises a surface can be hard-refreshed mid-encounter
     * and recover. That held only while the *first* `fetchState` succeeded: one
     * failure set `connection: "error"` and stopped forever, and with `session`
     * still null on a cold load, `App.pickLayout` renders the **home screen**
     * on the `/p/CODE` URL — run still live on the server, token still in
     * storage.
     *
     * The stranding is not the worst of it. The home screen's first button is
     * "Start a game", so the obvious move at a table creates a second room and
     * abandons the evening in progress. A phone that cannot reach the server
     * for a moment has to wait, not offer to throw the game away.
     */
    vi.useFakeTimers();
    try {
      const h = await refreshed(harness());
      h.api.fetchState
        .mockRejectedValueOnce(new Error("network down"))
        .mockRejectedValueOnce(new Error("network down"));

      const attaching = h.store.getState().attach("ABCD", "player");
      await vi.advanceTimersByTimeAsync(10_000);
      await attaching;

      expect(h.api.fetchState).toHaveBeenCalledTimes(3);
      expect(h.store.getState().session?.roomCode).toBe("ABCD");
      expect(h.store.getState().error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the spinner rather than the home screen while it retries", async () => {
    /*
     * `App.pickLayout` renders `HomeScreen` for a code with no session unless
     * `connection === "connecting"`. So the status during the retries is not
     * cosmetic — it is the whole difference between a spinner and a button
     * that starts a second game.
     */
    vi.useFakeTimers();
    try {
      const h = await refreshed(harness());
      h.api.fetchState.mockRejectedValueOnce(new Error("network down"));

      const attaching = h.store.getState().attach("ABCD", "player");
      await vi.advanceTimersByTimeAsync(100);
      expect(h.store.getState().connection).toBe("connecting");
      expect(h.store.getState().session).toBeNull();

      await vi.advanceTimersByTimeAsync(10_000);
      await attaching;
      expect(h.store.getState().session?.roomCode).toBe("ABCD");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a room that is genuinely gone, without spinning", async () => {
    /*
     * The other half. A 410 answers the same way forever, so retrying it would
     * hold a spinner in front of an eight-year-old until somebody gave up —
     * a worse failure than the honest one. Told plainly, once.
     */
    vi.useFakeTimers();
    try {
      const h = await refreshed(harness());
      h.api.fetchState.mockRejectedValue(new ApiError(410, "That room has expired."));

      const attaching = h.store.getState().attach("ABCD", "player");
      await vi.advanceTimersByTimeAsync(10_000);
      await attaching;

      expect(h.api.fetchState).toHaveBeenCalledTimes(1);
      expect(h.store.getState().error).toBe("That room has expired.");
      expect(h.store.getState().connection).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a token this device may no longer use", async () => {
    // 401/403 are as permanent as 410 and for the same reason: asking again
    // with the same token cannot change the answer.
    vi.useFakeTimers();
    try {
      const h = await refreshed(harness());
      h.api.fetchState.mockRejectedValue(new ApiError(403, "Not your room."));

      const attaching = h.store.getState().attach("ABCD", "player");
      await vi.advanceTimersByTimeAsync(10_000);
      await attaching;

      expect(h.api.fetchState).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops trying after a bounded number of attempts", async () => {
    // The retry has to be able to end. A phone that spins forever is the
    // failure this fix would otherwise have replaced the old one with.
    vi.useFakeTimers();
    try {
      const h = await refreshed(harness());
      h.api.fetchState.mockRejectedValue(new Error("network down"));

      const attaching = h.store.getState().attach("ABCD", "player");
      await vi.advanceTimersByTimeAsync(60_000);
      await attaching;

      expect(h.api.fetchState).toHaveBeenCalledTimes(5);
      expect(h.store.getState().connection).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("recovering a display surface from the URL", () => {
  it("keeps asking when the server is briefly unreachable", async () => {
    /*
     * The review catch on the review catch: the first §4.3 fix retried the
     * stored-session path and left the display branch on one attempt — and the
     * TV is §4.3's *headline case* ("The TV can be hard-refreshed mid-encounter
     * and recover"). It holds no session and recovers from the URL alone, so a
     * single cold Lambda on that single attempt left the room's biggest screen
     * on an error card for the rest of the evening.
     */
    vi.useFakeTimers();
    try {
      const h = harness();
      h.api.watchRoom
        .mockRejectedValueOnce(new Error("network down"))
        .mockRejectedValueOnce(new Error("network down"));

      const attaching = h.store.getState().attach("ABCD", "display");
      await vi.advanceTimersByTimeAsync(10_000);
      await attaching;

      expect(h.api.watchRoom).toHaveBeenCalledTimes(3);
      expect(h.store.getState().session?.roomCode).toBe("ABCD");
      expect(h.store.getState().session?.playerId).toBe("");
      expect(h.store.getState().error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a room that is genuinely gone", async () => {
    // Same permanence rule as the phone path: 404/410 answer the same way
    // forever, and a spinner that never ends is worse than the honest error.
    vi.useFakeTimers();
    try {
      const h = harness();
      h.api.watchRoom.mockRejectedValue(new ApiError(404, "No such room."));

      const attaching = h.store.getState().attach("ABCD", "display");
      await vi.advanceTimersByTimeAsync(10_000);
      await attaching;

      expect(h.api.watchRoom).toHaveBeenCalledTimes(1);
      expect(h.store.getState().connection).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the recovery deadline", () => {
  /**
   * A fetchState that behaves like the real failure: a dropped-but-open
   * connection that consumes its entire per-request bound before failing.
   * The earlier tests rejected instantly, which proved the attempt count and
   * the retry classification while hiding the actual wall-clock — five 10s
   * request timeouts plus backoff is nearly a minute of spinner, not the
   * "about seven seconds" the first version claimed. Review caught it.
   */
  function hangingApi(h: ReturnType<typeof harness>, calls: number[]) {
    h.api.fetchState.mockImplementation(
      (_q: unknown, _t: unknown, timeoutMs?: number) =>
        new Promise((_resolve, reject) => {
          calls.push(timeoutMs ?? -1);
          setTimeout(() => {
            reject(new ApiError(0, "The game took too long to answer. Tap again."));
          }, timeoutMs ?? 10_000);
        }) as never,
    );
  }

  it("gives up within ~20 seconds against a dead connection, not a minute", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await h.store.getState().joinRoom("ABCD", "Allen");
      h.store.setState({ session: null, state: null, connection: "idle" });
      h.api.fetchState.mockClear();
      const calls: number[] = [];
      hangingApi(h, calls);

      const started = Date.now();
      let settledAt = 0;
      // The attach's own settle time, not the timer advance's: fake time keeps
      // moving after recovery has already given up.
      const attaching = h.store.getState().attach("ABCD", "player").then(() => {
        settledAt = Date.now();
      });
      await vi.advanceTimersByTimeAsync(60_000);
      await attaching;
      const elapsed = settledAt - started;

      /*
       * The contract under test: recovery is bounded by a deadline, not only
       * an attempt count. 22s of slack over the 20s deadline covers the last
       * attempt's residual budget; anything near a minute means the deadline
       * stopped binding the per-request timeout again.
       */
      expect(elapsed).toBeLessThanOrEqual(22_000);
      expect(h.store.getState().connection).toBe("error");

      // Every attempt's request was bounded by the remaining budget: the
      // first gets the funnel default, the rest strictly less.
      expect(calls[0]).toBe(10_000);
      for (const ms of calls.slice(1)) expect(ms).toBeLessThan(10_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still recovers when the second attempt succeeds inside the budget", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await h.store.getState().joinRoom("ABCD", "Allen");
      const state = h.store.getState().state!;
      h.store.setState({ session: null, state: null, connection: "idle" });
      h.api.fetchState.mockClear();
      h.api.fetchState
        .mockImplementationOnce(
          (_q: unknown, _t: unknown, timeoutMs?: number) =>
            new Promise((_res, rej) => {
              setTimeout(() => { rej(new ApiError(0, "timed out")); }, timeoutMs ?? 10_000);
            }) as never,
        )
        .mockResolvedValueOnce({ seq: state.seq, state } as never);

      const attaching = h.store.getState().attach("ABCD", "player");
      await vi.advanceTimersByTimeAsync(15_000);
      await attaching;

      expect(h.store.getState().session?.roomCode).toBe("ABCD");
      expect(h.store.getState().error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// The Field Guide (#106): the book rides the mirror, the news rides the wire.
// ---------------------------------------------------------------------------

describe("the Field Guide sync", () => {
  const MOTH = { firstFoundBy: "p_1", foundAt: "2026-07-04T18:00:00.000Z", runId: "r_1" };
  const NEWT = { firstFoundBy: "p_2", foundAt: "2026-07-04T18:05:00.000Z", runId: "r_1" };

  beforeEach(() => {
    setFieldGuideDiscoveries(null);
    clearFieldGuideNews();
  });

  it("fills the guide from the joined state and every patch after it", async () => {
    const h = harness(makeState({ fieldGuide: { "creature.moth": MOTH } }));
    await h.store.getState().joinRoom("ABCD", "Allen");
    expect(getFieldGuideDiscoveries()).toEqual({ "creature.moth": MOTH });

    h.publish(patch(2, [{ op: "add", path: "/fieldGuide/creature.newt", value: NEWT }]));
    expect(getFieldGuideDiscoveries()).toEqual({ "creature.moth": MOTH, "creature.newt": NEWT });

    // A patch that does not touch the book leaves the same object in place.
    const book = getFieldGuideDiscoveries();
    h.publish(patch(3, [{ op: "replace", path: "/narration", value: "on" }]));
    expect(getFieldGuideDiscoveries()).toBe(book);
  });

  it("announces a new find once, after its patch, and acking consumes it", async () => {
    const h = harness(makeState({ fieldGuide: {} }));
    await h.store.getState().joinRoom("ABCD", "Allen");
    const seen: string[][] = [];
    const off = subscribeFieldGuideNews((pending) => {
      seen.push(pending.map((n) => n.canonId));
      // The book already holds whatever is announced.
      for (const n of pending) expect(getFieldGuideDiscoveries()).toHaveProperty([n.canonId]);
    });

    const message = {
      ...patch(2, [{ op: "add", path: "/fieldGuide/creature.newt", value: NEWT }]),
      discovered: ["creature.newt"],
    };
    h.publish(message);
    h.publish(message); // a duplicate delivery
    off();

    expect(getFieldGuideNews()).toEqual([{ canonId: "creature.newt", seq: 2 }]);
    expect(seen).toEqual([["creature.newt"]]);
    ackFieldGuideNews(["creature.newt"]);
    expect(getFieldGuideNews()).toEqual([]);
  });

  it("a resync rebuilds the book without replaying the news", async () => {
    const h = harness(makeState({ fieldGuide: {} }));
    await h.store.getState().joinRoom("ABCD", "Allen");

    // The server's log never carries `discovered`; a replay is patches alone.
    h.api.fetchState.mockResolvedValueOnce({
      seq: 2,
      events: [patch(2, [{ op: "add", path: "/fieldGuide/creature.moth", value: MOTH }])],
    });
    await h.channelOptions().resync(1);
    expect(getFieldGuideDiscoveries()).toEqual({ "creature.moth": MOTH });

    // And a cold snapshot, the same.
    h.api.fetchState.mockResolvedValueOnce({
      seq: 3,
      state: makeState({ seq: 3, fieldGuide: { "creature.moth": MOTH, "creature.newt": NEWT } }),
    });
    await h.channelOptions().resync(2);
    expect(Object.keys(getFieldGuideDiscoveries())).toEqual(["creature.moth", "creature.newt"]);
    expect(getFieldGuideNews()).toEqual([]);
  });

  it("leaving the room clears the book and anything not yet celebrated", async () => {
    const h = harness(makeState({ fieldGuide: { "creature.moth": MOTH } }));
    await h.store.getState().joinRoom("ABCD", "Allen");
    h.publish({
      ...patch(2, [{ op: "add", path: "/fieldGuide/creature.newt", value: NEWT }]),
      discovered: ["creature.newt"],
    });
    h.store.getState().leave();
    expect(getFieldGuideDiscoveries()).toEqual({});
    expect(getFieldGuideNews()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Shared tablets (#250)
// ---------------------------------------------------------------------------

describe("a shared tablet", () => {
  function tablet(): Harness {
    const h = harness();
    // As if a phone had played here first, then a grown-up made it shared.
    saveIdentity({ householdId: "h_1", playerId: "p_old", displayName: "Old", deviceToken: "dev_old" }, h.storage);
    h.storage.setItem("kad.session.WXYZ", JSON.stringify({ runId: "r_0", roomCode: "WXYZ", playerId: "p_old", mode: "party", sessionToken: "tok_old" }));
    becomeSharedDevice({ token: "shared_1", householdId: "h_1" }, h.storage, h.tab);
    return h;
  }

  it("forgets whoever it was before it became shared", () => {
    const h = tablet();
    expect(Object.keys(dump(h.storage))).toEqual(["kad.shared"]);
  });

  it("seats the kid picked, on the tablet's token and a session alone", async () => {
    const h = tablet();
    const session = await h.store.getState().joinRoom("abcd", "", { playerId: "p_ada" });

    expect(h.api.joinRoomShared).toHaveBeenCalledWith("ABCD", "shared_1", { playerId: "p_ada" });
    expect(h.api.joinRoom).not.toHaveBeenCalled();
    expect(session.playerId).toBe("p_ada");
    // In this tab, so the next kid to pick the tablet up is asked who they are.
    expect(loadSession("ABCD", h.tab)?.playerId).toBe("p_ada");
    expect(loadSession("ABCD", h.storage)).toBeNull();
  });

  it("lands each kid in their own seat, taking turns", async () => {
    const h = tablet();
    const first = await h.store.getState().joinRoom("ABCD", "", { playerId: "p_ada" });
    h.store.getState().leave();
    const second = await h.store.getState().joinRoom("ABCD", "", { playerId: "p_ben" });

    expect(first.sessionToken).toBe("tok_p_ada");
    expect(second.sessionToken).toBe("tok_p_ben");
    expect(h.store.getState().session?.playerId).toBe("p_ben");
  });

  it("never writes a long-lived token for a kid, even if the server sent one", async () => {
    const h = tablet();
    h.api.joinRoomShared.mockResolvedValueOnce({
      runId: "r_1",
      playerId: "p_ada",
      mode: "party",
      sessionToken: "tok_ada",
      state: makeState(),
      deviceToken: "dev_leaked",
    });
    await h.store.getState().joinRoom("ABCD", "", { playerId: "p_ada" });
    h.store.getState().leave();
    await h.store.getState().createRoom("travel", "", { newPlayer: "Cass" });

    const written = JSON.stringify({ ...dump(h.storage), ...dump(h.tab) });
    expect(written).not.toContain("dev_");
    expect(dump(h.storage)).toEqual({ "kad.shared": JSON.stringify({ token: "shared_1", householdId: "h_1" }) });
    expect(loadPlayerDeviceToken(h.storage)).toBeNull();
  });

  it("will not seat nobody", async () => {
    const h = tablet();
    await expect(h.store.getState().joinRoom("ABCD", "Ada")).rejects.toThrow();
    expect(h.api.joinRoomShared).not.toHaveBeenCalled();
    expect(h.api.joinRoom).not.toHaveBeenCalled();
  });

  it("goes back to an ordinary start once it has been forgotten", async () => {
    const h = tablet();
    h.api.joinRoomShared.mockRejectedValueOnce(new ApiError(401, "This tablet was forgotten.", "FORBIDDEN"));
    await expect(h.store.getState().joinRoom("ABCD", "", { playerId: "p_ada" })).rejects.toThrow();
    expect(loadSharedDevice(h.storage)).toBeNull();

    const h2 = tablet();
    h2.api.listSharedPlayers.mockRejectedValueOnce(new ApiError(401, "forgotten", "FORBIDDEN"));
    expect(await h2.store.getState().loadSharedPlayers()).toBeNull();
    expect(loadSharedDevice(h2.storage)).toBeNull();
  });

  it("lists the household for the picker, and keeps a renewed token", async () => {
    const h = tablet();
    h.api.listSharedPlayers.mockResolvedValueOnce({ householdId: "h_1", players: [], rotatedToken: "shared_2" });
    expect(await h.store.getState().loadSharedPlayers()).toEqual([]);
    expect(loadSharedDevice(h.storage)?.token).toBe("shared_2");
  });

  it("takes a stranger out of a room it opened, on its token and the kid's session", async () => {
    const h = tablet();
    await h.store.getState().createRoom("travel", "", { playerId: "p_ada" });
    expect(h.store.getState().session?.host).toBe(true);

    expect(await h.store.getState().removePlayer("p_stranger")).toBe(true);
    expect(h.api.hostControl).toHaveBeenCalledWith(
      "ABCD",
      "remove",
      { playerId: "p_stranger" },
      { sharedToken: "shared_1", sessionToken: "tok_p_ada" },
    );
    // Still nobody: asking did not mint an identity on the tablet.
    expect(Object.keys(dump(h.storage))).toEqual(["kad.shared"]);
  });

  it("is not a shared tablet unless it was made one", async () => {
    const h = harness();
    expect(await h.store.getState().loadSharedPlayers()).toBeNull();
    expect(h.api.listSharedPlayers).not.toHaveBeenCalled();
  });
});
