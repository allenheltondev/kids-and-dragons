/**
 * Sending the book's queued kit changes (#629; docs/camp.md §7, §11): with the
 * phone's device token; a change made with a signal goes straight away, one
 * queued without is sent `merge`; either way it applies over what the server
 * has (the device wins); no signal keeps it queued and says so; a refused
 * binding drops the queue unsent; a pick the server refuses says so.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookKitResponse, JournalKit } from "@kad/shared";
import { bookKitStatus, editBookKit, flushKitQueue, resetBookKitSync } from "./book-kit-sync";
import { dropKitQueue, enqueueKitChanges, loadKitQueue } from "./kit-queue";
import { saveIdentity } from "./persistence";

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

  it("waits, keeping the queue, while the browser says it is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    serve(() => answer(200, {}));
    await editBookKit({ characterId: "c_1", crew: "cw_1", changes: [{ field: "buddy", before: null, after: "bun" }] }, () => undefined);
    expect(sent).toHaveLength(0);
    expect(bookKitStatus().offline).toBe(true);
    expect(loadKitQueue("dev_1")).toMatchObject([{ crew: "cw_1", changes: [{ field: "buddy", after: "bun" }] }]);
  });
});
