/**
 * Sending the book's queued kit changes (#629; docs/camp.md §7, §11): with the
 * phone's device token; a change made with a signal goes straight away, one
 * queued without is sent `merge`; either way it applies over what the server
 * has (the device wins); no signal keeps it queued and says so; a refused
 * binding drops the queue unsent; a pick the server refuses says so.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookKitProblem, mergeBookKit, type BookKitChange, type BookKitResponse, type JournalKit } from "@kad/shared";
import { UNSAVED_NOTE, bookKitStatus, editBookKit, flushKitQueue, pendingKitEdits, resetBookKitSync } from "./book-kit-sync";
import { useGameStore } from "./index";
import { KIT_QUEUE_KEY, dropKitQueue, enqueueKitChanges, hasQueuedKitChanges, journalKitState, kitQueueUnsaved, loadKitQueue, withQueuedKit } from "./kit-queue";
import { defaultStorage, saveIdentity } from "./persistence";

const KIT: JournalKit = { revision: 5, style: null, tent: "rolled", color: "rose", slots: [null, null], unlocked: [], buddies: {} };

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
function serve(reply: () => Response | Promise<Response>): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return reply();
  });
}

beforeEach(() => {
  saveIdentity({ householdId: "h_1", playerId: "p_1", displayName: "Ada", deviceToken: "dev_1" } as Parameters<typeof saveIdentity>[0]);
  dropKitQueue();
  resetBookKitSync();
  sent.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sending the book's kit changes", () => {
  it("sends a change made with a signal straight away, with the phone's device token", async () => {
    const response: BookKitResponse = { kit: { ...KIT, revision: 6, color: "tide" }, applied: ["color"], refused: [] };
    serve(() => answer(200, response));
    const applied: [string, JournalKit][] = [];
    await editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "color", before: "rose", after: "tide" }] }, (id, kit) => applied.push([id, kit]));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("/api/journal/kit");
    expect(sent[0]!.headers["x-kad-device-token"]).toBe("dev_1");
    expect(sent[0]!.body).toEqual({ characterId: "c_1", changes: [{ field: "color", before: "rose", after: "tide" }] });
    expect(applied).toEqual([["c_1", response.kit]]);
    expect(loadKitQueue("dev_1")).toEqual([]);
    expect(bookKitStatus()).toEqual({ offline: false, notes: [] });
  });

  it("with no signal keeps the change queued, says so, and sends every field when the signal returns, with no note", async () => {
    serve(() => Promise.reject(new TypeError("Failed to fetch")));
    await editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "color", before: "rose", after: "tide" }] }, () => undefined);
    expect(bookKitStatus().offline).toBe(true);
    const [queued] = loadKitQueue("dev_1");
    expect(queued).toMatchObject({ characterId: "c_1", changes: [{ field: "color", before: "rose", after: "tide" }] });
    expect(queued!.direct).toBeUndefined();

    // Meanwhile a table changed her tent; the queued tent is sent all the same, and wins.
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "tent", before: "rolled", after: "patched" }] });
    serve(() => answer(200, { kit: { ...KIT, revision: 7, tent: "patched", color: "tide" }, applied: ["tent", "color"], refused: [] } satisfies BookKitResponse));
    const applied: JournalKit[] = [];
    await flushKitQueue((_, kit) => applied.push(kit));
    expect(sent.at(-1)!.body).toEqual({
      characterId: "c_1",
      merge: true,
      changes: [
        { field: "color", before: "rose", after: "tide" },
        { field: "tent", before: "rolled", after: "patched" },
      ],
    });
    expect(applied.at(-1)).toMatchObject({ tent: "patched", color: "tide" });
    expect(loadKitQueue("dev_1")).toEqual([]);
    expect(bookKitStatus()).toEqual({ offline: false, notes: [] });
  });

  it("says so when a pick could not be saved", async () => {
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: "cw_1", changes: [{ field: "buddy", before: null, after: "bun" }, { field: "color", before: "rose", after: "tide" }] });
    // Two entries: her kit, and her buddy in that crew's camp; the crew has no Bun.
    serve(() => {
      const buddy = (sent.at(-1)!.body.changes as { field: string }[]).some((c) => c.field === "buddy");
      return answer(200, { kit: { ...KIT, color: "tide" }, applied: buddy ? [] : ["color"], refused: buddy ? ["buddy"] : [] } satisfies BookKitResponse);
    });
    await flushKitQueue(() => undefined);
    expect(sent).toHaveLength(2);
    expect(bookKitStatus().notes).toEqual(["Your buddy pick could not be saved."]);
  });

  it("drops the whole queue unsent when the binding is refused", async () => {
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: null, after: "rose" }] });
    enqueueKitChanges("dev_1", { characterId: "c_2", crew: null, changes: [{ field: "color", before: null, after: "tide" }] });
    serve(() => answer(401, { error: { code: "FORBIDDEN", message: "the adventure book needs this device's token" } }));
    await flushKitQueue(() => undefined);
    expect(sent).toHaveLength(1);
    expect(loadKitQueue("dev_1")).toEqual([]);
  });

  it("lets go of a change that can never land, says so, and sends the rest", async () => {
    enqueueKitChanges("dev_1", { characterId: "c_gone", crew: null, changes: [{ field: "color", before: null, after: "rose" }] });
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: null, after: "tide" }] });
    let calls = 0;
    serve(() => (calls++ === 0 ? answer(404, { error: { code: "NOT_FOUND", message: "that hero is not in your book" } }) : answer(200, { kit: KIT, applied: ["color"], refused: [] })));
    await flushKitQueue(() => undefined);
    expect(sent.map((s) => s.body.characterId)).toEqual(["c_gone", "c_1"]);
    expect(loadKitQueue("dev_1")).toEqual([]);
    expect(bookKitStatus().notes).toEqual(["One of your changes could not be saved."]);
  });

  for (const status of [408, 429]) {
    it(`keeps a change the server throttled or timed out (${String(status)}) and sends it again (#656)`, async () => {
      enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: "rose", after: "tide" }] });
      serve(() => answer(status, { error: { code: "SLOW_DOWN", message: "try again soon" } }));
      await flushKitQueue(() => undefined);
      expect(loadKitQueue("dev_1")).toHaveLength(1);
      expect(bookKitStatus()).toMatchObject({ offline: true, notes: [] });

      const applied: JournalKit[] = [];
      serve(() => answer(200, { kit: { ...KIT, revision: 6, color: "tide" }, applied: ["color"], refused: [] }));
      await flushKitQueue((_, kit) => applied.push(kit));
      expect(loadKitQueue("dev_1")).toEqual([]);
      expect(applied.map((k) => k.color)).toEqual(["tide"]);
      expect(sent.map((s) => s.body.characterId)).toEqual(["c_1", "c_1"]);
    });
  }

  it("queues a swap of two hung decorations offline, shows it, and the server's merge applies it whole (#656)", async () => {
    const hung: JournalKit = { ...KIT, slots: ["deco_a", "deco_b"], unlocked: [] };
    vi.stubGlobal("navigator", { onLine: false });
    serve(() => answer(200, {}));
    await editBookKit(
      { characterId: "c_1", crew: null, changes: [{ field: "slot0", before: "deco_a", after: "deco_b" }, { field: "slot1", before: "deco_b", after: "deco_a" }] },
      () => undefined,
    );
    expect(sent).toHaveLength(0);
    expect(withQueuedKit(hung, "c_1", loadKitQueue("dev_1")).slots).toEqual(["deco_b", "deco_a"]);

    // Back online: sent `merge`, and the server's own merge (shared `mergeBookKit`) lands both slots.
    vi.stubGlobal("navigator", { onLine: true });
    const rules = { styles: [], tents: [], decorations: [{ id: "deco_a", group: "catalog" }, { id: "deco_b", group: "catalog" }] };
    serve(() => {
      const changes = sent.at(-1)!.body.changes as BookKitChange[];
      const merged = mergeBookKit(journalKitState(hung, null), changes, (base, next) => bookKitProblem(rules, [], base, next, []));
      return answer(200, { kit: { ...hung, revision: 6, slots: merged.state.slots }, applied: merged.applied, refused: merged.refused } satisfies BookKitResponse);
    });
    const applied: JournalKit[] = [];
    await flushKitQueue((_, kit) => applied.push(kit));
    expect(sent.at(-1)!.body).toMatchObject({ characterId: "c_1", merge: true });
    expect(applied.at(-1)!.slots).toEqual(["deco_b", "deco_a"]);
    expect(loadKitQueue("dev_1")).toEqual([]);
    expect(bookKitStatus()).toEqual({ offline: false, notes: [] });
  });

  it("waits, keeping the queue, while the browser says it is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    serve(() => answer(200, {}));
    await editBookKit({ characterId: "c_1", crew: "cw_1", changes: [{ field: "buddy", before: null, after: "bun" }] }, () => undefined);
    expect(sent).toHaveLength(0);
    expect(bookKitStatus().offline).toBe(true);
    expect(loadKitQueue("dev_1")).toMatchObject([{ crew: "cw_1", changes: [{ field: "buddy", after: "bun" }] }]);
  });

  describe("when the phone's storage will not keep the queue (#656)", () => {
    /** Out of quota, or a private window: every write to storage throws. */
    const full = () =>
      vi.spyOn(defaultStorage(), "setItem").mockImplementation(() => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      });

    it("with a signal, still shows the change and sends it, and says nothing", async () => {
      full();
      let shown: JournalKit | null = null;
      serve(() => {
        // While it is on its way, the book shows it from the page's memory.
        shown = withQueuedKit(KIT, "c_1", loadKitQueue("dev_1"));
        return answer(200, { kit: { ...KIT, revision: 6, color: "tide" }, applied: ["color"], refused: [] } satisfies BookKitResponse);
      });
      const applied: JournalKit[] = [];
      await editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "color", before: "rose", after: "tide" }] }, (_, kit) => applied.push(kit));
      expect(shown).toMatchObject({ color: "tide" });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.body).toEqual({ characterId: "c_1", changes: [{ field: "color", before: "rose", after: "tide" }] });
      expect(applied).toEqual([expect.objectContaining({ color: "tide" })]);
      expect(loadKitQueue("dev_1")).toEqual([]);
      expect(bookKitStatus()).toEqual({ offline: false, notes: [] });
    });

    it("with no signal, says it was not saved on this phone, keeps it in memory while the page is open, and sends it when the signal returns", async () => {
      full();
      vi.stubGlobal("navigator", { onLine: false });
      serve(() => answer(200, {}));
      await editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "color", before: "rose", after: "tide" }] }, () => undefined);
      expect(sent).toHaveLength(0);
      expect(bookKitStatus()).toEqual({ offline: true, notes: [UNSAVED_NOTE] });
      expect(UNSAVED_NOTE).toBe("This phone couldn't save that. Try again when you're back online.");
      // Not in the phone's storage, but in the page's memory: still shown, still queued.
      expect(defaultStorage().getItem(KIT_QUEUE_KEY)).toBeNull();
      expect(kitQueueUnsaved()).toBe(true);
      expect(hasQueuedKitChanges()).toBe(true);
      expect(withQueuedKit(KIT, "c_1", loadKitQueue("dev_1")).color).toBe("tide");
      // Another try with no signal says it once.
      await flushKitQueue(() => undefined);
      expect(bookKitStatus().notes).toEqual([UNSAVED_NOTE]);

      vi.stubGlobal("navigator", { onLine: true });
      serve(() => answer(200, { kit: { ...KIT, revision: 6, color: "tide" }, applied: ["color"], refused: [] } satisfies BookKitResponse));
      await flushKitQueue(() => undefined);
      expect(sent.at(-1)!.body).toEqual({ characterId: "c_1", merge: true, changes: [{ field: "color", before: "rose", after: "tide" }] });
      expect(loadKitQueue("dev_1")).toEqual([]);
      expect(kitQueueUnsaved()).toBe(false);
      expect(bookKitStatus()).toEqual({ offline: false, notes: [] });
    });
  });
});

describe("a family tablet's seat: no binding of its own, so no queue (#661)", () => {
  const SEAT = { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "travel" as const, sessionToken: "seat_1" };
  beforeEach(() => {
    // Seated on the tablet, with no device token of the kid's own.
    saveIdentity({ householdId: "h_1", playerId: "p_1", displayName: "Ada", deviceToken: "" } as Parameters<typeof saveIdentity>[0]);
    useGameStore.setState({ session: SEAT });
  });
  afterEach(() => {
    useGameStore.setState({ session: null });
  });

  it("shows each tap at once, sends them one at a time in the order tapped, and the last tap stands", async () => {
    const replies: ((response: Response) => void)[] = [];
    serve(() => new Promise<Response>((resolve) => replies.push(resolve)));
    const applied: JournalKit[] = [];
    const first = editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "color", before: "rose", after: "tide" }] }, (_, kit) => applied.push(kit));
    const second = editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "color", before: "tide", after: "meadow" }] }, (_, kit) => applied.push(kit));
    // Both shown straight away, before the server has answered either; the later tap on top.
    expect(withQueuedKit(KIT, "c_1", pendingKitEdits()).color).toBe("meadow");
    // One send at a time: the second waits for the first's answer, however slow.
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(1);
    expect((sent[0]!.body.changes as { after: string }[])[0]!.after).toBe("tide");
    replies[0]!(answer(200, { kit: { ...KIT, revision: 6, color: "tide" }, applied: ["color"], refused: [] }));
    await first;
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect((sent[1]!.body.changes as { after: string }[])[0]!.after).toBe("meadow");
    // The later tap still shows while its send is out.
    expect(withQueuedKit({ ...KIT, revision: 6, color: "tide" }, "c_1", pendingKitEdits()).color).toBe("meadow");
    replies[1]!(answer(200, { kit: { ...KIT, revision: 7, color: "meadow" }, applied: ["color"], refused: [] }));
    await second;
    expect(applied.map((k) => k.color)).toEqual(["tide", "meadow"]);
    expect(pendingKitEdits()).toEqual([]);
    expect(defaultStorage().getItem(KIT_QUEUE_KEY)).toBeNull();
  });

  it("rolls a refused tap back, and the next tap still goes", async () => {
    let calls = 0;
    serve(() => (calls++ === 0 ? answer(403, { error: { code: "FORBIDDEN", message: "not your hero" } }) : answer(200, { kit: { ...KIT, color: "meadow" }, applied: ["color"], refused: [] })));
    await expect(editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "color", before: "rose", after: "tide" }] }, () => undefined)).rejects.toThrow();
    expect(pendingKitEdits()).toEqual([]);
    await editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "color", before: "rose", after: "meadow" }] }, () => undefined);
    expect(sent).toHaveLength(2);
  });
});
