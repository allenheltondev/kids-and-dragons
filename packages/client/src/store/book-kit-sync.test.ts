/**
 * Sending the book's queued kit changes (#629; docs/camp.md §7): with the
 * phone's device token; a change made with a signal goes with its revision,
 * one queued without merges field by field; no signal keeps it queued and
 * says so; a refused binding drops the queue unsent; what the server kept from
 * elsewhere comes back as a kid's note.
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
  it("sends a change made with a signal with its revision and the phone's device token", async () => {
    const response: BookKitResponse = { kit: { ...KIT, revision: 6, color: "tide" }, applied: ["color"], kept: [], refused: [] };
    serve(() => answer(200, response));
    const applied: [string, JournalKit][] = [];
    await editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "color", before: "rose", after: "tide" }], revision: 5 }, (id, kit) => applied.push([id, kit]));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("/api/journal/kit");
    expect(sent[0]!.headers["x-kad-device-token"]).toBe("dev_1");
    expect(sent[0]!.body).toEqual({ characterId: "c_1", revision: 5, changes: [{ field: "color", before: "rose", after: "tide" }] });
    expect(applied).toEqual([["c_1", response.kit]]);
    expect(loadKitQueue("dev_1")).toEqual([]);
    expect(bookKitStatus()).toEqual({ offline: false, notes: [] });
  });

  it("with no signal keeps the change queued, says so, and merges it field by field once the signal returns", async () => {
    serve(() => Promise.reject(new TypeError("Failed to fetch")));
    await editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "color", before: "rose", after: "tide" }], revision: 5 }, () => undefined);
    expect(bookKitStatus().offline).toBe(true);
    const [queued] = loadKitQueue("dev_1");
    expect(queued).toMatchObject({ characterId: "c_1", changes: [{ field: "color", before: "rose", after: "tide" }] });
    // Its first send never got there, so the revision it was made over no longer decides it.
    expect(queued!.revision).toBeUndefined();

    // Meanwhile a table changed her tent too; the queued tent is the older pick.
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "tent", before: "rolled", after: "patched" }] });
    serve(() => answer(200, { kit: { ...KIT, revision: 7, tent: "quilted", color: "tide" }, applied: ["color"], kept: ["tent"], refused: [] } satisfies BookKitResponse));
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
    expect(applied.at(-1)).toMatchObject({ tent: "quilted", color: "tide" });
    expect(loadKitQueue("dev_1")).toEqual([]);
    expect(bookKitStatus()).toEqual({ offline: false, notes: ["Your tent changed on another screen while you were away, so the newer one stays."] });
  });

  it("says so when an online change found the kit moved on", async () => {
    serve(() => answer(200, { kit: { ...KIT, revision: 9 }, applied: [], kept: ["color"], refused: [], stale: true } satisfies BookKitResponse));
    await editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "color", before: "rose", after: "tide" }], revision: 5 }, () => undefined);
    expect(bookKitStatus().notes).toEqual(["Your kit changed on another screen, so here it is as it is now."]);
    expect(loadKitQueue("dev_1")).toEqual([]);
  });

  it("drops the whole queue unsent when the binding is refused", async () => {
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: null, after: "rose" }] });
    enqueueKitChanges("dev_1", { characterId: "c_2", crew: null, changes: [{ field: "color", before: null, after: "tide" }] });
    serve(() => answer(401, { error: { code: "FORBIDDEN", message: "the adventure book needs this device's token" } }));
    await flushKitQueue(() => undefined);
    expect(sent).toHaveLength(1);
    expect(loadKitQueue("dev_1")).toEqual([]);
  });

  it("lets go of a change that can never land, and sends the rest", async () => {
    enqueueKitChanges("dev_1", { characterId: "c_gone", crew: null, changes: [{ field: "color", before: null, after: "rose" }] });
    enqueueKitChanges("dev_1", { characterId: "c_1", crew: null, changes: [{ field: "color", before: null, after: "tide" }] });
    let calls = 0;
    serve(() => (calls++ === 0 ? answer(404, { error: { code: "NOT_FOUND", message: "that hero is not in your book" } }) : answer(200, { kit: KIT, applied: ["color"], kept: [], refused: [] })));
    await flushKitQueue(() => undefined);
    expect(sent.map((s) => s.body.characterId)).toEqual(["c_gone", "c_1"]);
    expect(loadKitQueue("dev_1")).toEqual([]);
    expect(bookKitStatus().notes).toEqual(["One of your changes could not be saved."]);
  });

  it("waits, keeping the queue, while the browser says it is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    serve(() => answer(200, {}));
    await editBookKit({ characterId: "c_1", crew: "cw_1", changes: [{ field: "buddy", before: null, after: "bun" }], revision: 5 }, () => undefined);
    expect(sent).toHaveLength(0);
    expect(bookKitStatus().offline).toBe(true);
    expect(loadKitQueue("dev_1")).toMatchObject([{ crew: "cw_1", changes: [{ field: "buddy", after: "bun" }] }]);
  });
});
