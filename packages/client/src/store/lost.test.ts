/**
 * A room that is gone stops looking like a reconnect (#470): a catch-up that
 * answers 401/403/404/410 is terminal, while 5xx and network errors retry.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { gameStoreCreator, type GameStoreDeps, type InternalGameStore } from "./index";
import type { ChannelOptions } from "../sync/channel";
import { ApiError, type Api } from "../sync/client";
import type { KeyValueStorage } from "./persistence";
import { makeState } from "../testing/fixtures";

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

async function joined() {
  const state = makeState();
  const opened: ChannelOptions[] = [];
  let closes = 0;
  const api = {
    joinRoom: vi.fn(async () => ({
      runId: state.runId,
      playerId: "p_1",
      mode: state.mode,
      sessionToken: "tok_1",
      state,
    })),
    fetchState: vi.fn(async () => ({ seq: state.seq, state })),
    postPresence: vi.fn(async () => undefined),
    fetchConfig: vi.fn(async () => null),
  };
  const deps = {
    api: api as unknown as Api,
    storage: memoryStorage(),
    tabStorage: memoryStorage(),
    navigate: vi.fn(),
    eventsUrl: (code: string, sinceSeq: number) => `/events/${code}?sinceSeq=${sinceSeq}`,
    openChannel: (opts: ChannelOptions) => {
      opened.push(opts);
      opts.onStatus("open");
      return {
        close: () => {
          closes += 1;
          opts.onStatus("idle");
        },
        reconnect: () => undefined,
      };
    },
  } as unknown as GameStoreDeps;
  const store = createStore<InternalGameStore>(gameStoreCreator(deps));
  await store.getState().joinRoom("abcd", "Allen");
  return { store, api, opened, closes: () => closes };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a catch-up that says the room is gone", () => {
  it.each([401, 403, 404, 410])("%i is terminal: lost, channel closed, no retry", async (status) => {
    vi.useFakeTimers();
    const h = await joined();
    h.api.fetchState.mockRejectedValueOnce(new ApiError(status, "gone"));
    await h.opened.at(-1)!.resync(0).catch(() => undefined);

    expect(h.store.getState().connection).toBe("lost");
    expect(h.closes()).toBe(1);
    h.api.fetchState.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(h.api.fetchState).not.toHaveBeenCalled();
    expect(h.opened).toHaveLength(1);
  });

  it("a 500 or a network error stays transient and retries", async () => {
    vi.useFakeTimers();
    const h = await joined();
    h.api.fetchState.mockRejectedValueOnce(new ApiError(500, "oops"));
    await h.opened.at(-1)!.resync(0).catch(() => undefined);
    expect(h.store.getState().connection).toBe("open");
    expect(h.closes()).toBe(0);

    h.api.fetchState.mockClear();
    h.api.fetchState.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.advanceTimersByTime(20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.api.fetchState).toHaveBeenCalled();
    expect(h.store.getState().connection).not.toBe("lost");
  });

  it("reconnect() from lost opens a fresh channel", async () => {
    const h = await joined();
    h.api.fetchState.mockRejectedValueOnce(new ApiError(404, "gone"));
    await h.opened.at(-1)!.resync(0).catch(() => undefined);
    expect(h.store.getState().connection).toBe("lost");

    h.store.getState().reconnect();
    await vi.waitFor(() => {
      expect(h.opened).toHaveLength(2);
    });
    expect(h.store.getState().connection).toBe("open");
  });
});
