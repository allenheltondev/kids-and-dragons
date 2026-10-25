/**
 * Stream liveness (#469): a beat or a send that fails at the network says the
 * stream is probably dead too, and replaces it once. An HTTP status does not.
 */
import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { ActionResponse } from "@kad/shared";
import { ApiError, type Api } from "../sync/client";
import { nudgeReconnect } from "../sync/wake-reconnect";
import { makeState } from "../testing/fixtures";
import { gameStoreCreator, type GameStoreDeps, type InternalGameStore } from "./index";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

async function harness() {
  const state = makeState({ seq: 1 });
  let reconnects = 0;
  const api = {
    joinRoom: vi.fn(async () => ({ runId: state.runId, playerId: "p_1", mode: state.mode, sessionToken: "tok_1", state })),
    postPresence: vi.fn(async (): Promise<void> => undefined),
    postAction: vi.fn(async (): Promise<ActionResponse> => ({ ok: true, seq: 1 })),
    fetchState: vi.fn(async () => ({ seq: 1, state })),
    fetchConfig: vi.fn(async () => null),
    loadRules: vi.fn(async () => ({ version: 1 })),
    loadItems: vi.fn(async () => ({})),
    loadCampaign: vi.fn(async () => ({ id: "c", title: "C", blurb: "", chapters: ["bramblewood-01"] })),
    loadChapter: vi.fn(async () => ({ id: "bramblewood-01", biome: "enchanted_woods", scenes: {} })),
    loadAbilities: vi.fn(async () => ({ version: 1, abilities: {} })),
    loadBestiary: vi.fn(async () => ({ version: 1, creatures: {} })),
    loadWorld: vi.fn(async () => ({ title: "W", image: { src: "", width: 1, height: 1 }, places: {} })),
  };
  const deps = {
    api: api as unknown as Api,
    storage: memoryStorage(),
    tabStorage: memoryStorage(),
    navigate: vi.fn(),
    eventsUrl: () => "",
    openChannel: (opts: { onStatus: (s: string) => void }) => {
      opts.onStatus("open");
      return { close: () => undefined, reconnect: () => void (reconnects += 1) };
    },
    nudgeReconnect: () => nudgeReconnect(() => store.getState().reconnect()),
  } as unknown as GameStoreDeps;
  const store = createStore<InternalGameStore>(gameStoreCreator(deps));
  await store.getState().joinRoom("ABCD", "Allen");
  return { store, api, reconnects: () => reconnects };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("liveness (#469)", () => {
  it("a beat whose fetch rejects reconnects once, even when two fail together", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_000_000);
      const h = await harness();
      h.api.postPresence.mockRejectedValue(new TypeError("Failed to fetch"));
      const before = h.reconnects();
      h.store.getState().beat();
      h.store.getState().beat();
      await flush();
      expect(h.reconnects() - before).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a beat answered with HTTP 500 does not reconnect", async () => {
    const h = await harness();
    h.api.postPresence.mockRejectedValue(new ApiError(500, "boom"));
    const before = h.reconnects();
    h.store.getState().beat();
    await flush();
    expect(h.reconnects()).toBe(before);
  });

  it("a send that fails at the network reconnects, and an HTTP error does not", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(2_000_000);
      const h = await harness();
      const intent = { type: "ready" } as never;
      const before = h.reconnects();
      h.api.postAction.mockRejectedValueOnce(new ApiError(500, "boom"));
      await h.store.getState().send(intent);
      expect(h.reconnects()).toBe(before);

      h.api.postAction.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await h.store.getState().send(intent);
      expect(h.reconnects() - before).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
