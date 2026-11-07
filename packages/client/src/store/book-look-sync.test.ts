/**
 * Her look's changes from the book (docs/hero-looks.md §3.2, §12; #664): the
 * kit's queue, sender and endpoint, with the look's fields as change kinds of
 * their own. Two offline edits to one field end on the later one after sync;
 * the look the server answers with goes to the open book; a family tablet's
 * taps show at once from memory and are sent in tap order.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeBookLook, readLook, lookEditProblem, lookView, type BookKitResponse, type BookLookChange, type HeroLookView, type JournalKit } from "@kad/shared";
import { bookKitStatus, editBookKit, flushKitQueue, pendingKitEdits, resetBookKitSync } from "./book-kit-sync";
import { useGameStore } from "./index";
import { NO_LOOK, dropKitQueue, loadKitQueue, withQueuedKit, withQueuedLook } from "./kit-queue";
import { saveIdentity } from "./persistence";
import { LOOKS } from "../world/hero-name";

const KIT: JournalKit = { revision: 5, style: null, tent: "rolled", color: "rose", slots: [null, null], unlocked: [], buddies: {} };

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const sent: { body: Record<string, unknown> }[] = [];
function serve(reply: () => Response | Promise<Response>): void {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent.push({ body: JSON.parse(String(init.body)) as Record<string, unknown> });
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

describe("her look from the book", () => {
  it("queues two offline picks of one field as one change, shows the later at once, and the later stands after sync", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    serve(() => answer(200, {}));
    await editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "title", before: null, after: "the_bold" }] }, () => undefined);
    await editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "title", before: "the_bold", after: "the_kind" }] }, () => undefined);
    expect(sent).toHaveLength(0);
    expect(bookKitStatus().offline).toBe(true);
    const queue = loadKitQueue("dev_1");
    expect(queue).toMatchObject([{ characterId: "c_1", changes: [{ field: "title", before: null, after: "the_kind" }] }]);
    expect(withQueuedLook(undefined, "c_1", queue).title).toBe("the_kind");
    // The kit is untouched by a look change.
    expect(withQueuedKit(KIT, "c_1", queue)).toEqual(KIT);

    // Back online: sent `merge`, and the server's own merge (shared `mergeBookLook`) lands the later pick.
    vi.stubGlobal("navigator", { onLine: true });
    let stored = readLook({});
    serve(() => {
      const changes = sent.at(-1)!.body.changes as BookLookChange[];
      const merged = mergeBookLook(stored, changes, (edit) => lookEditProblem(LOOKS, [], edit, "unicorn"));
      stored = { ...merged.look, revision: stored.revision + 1 };
      return answer(200, { kit: KIT, look: lookView(stored), applied: merged.applied, refused: merged.refused } satisfies BookKitResponse);
    });
    const looks: (HeroLookView | undefined)[] = [];
    await flushKitQueue((_, __, look) => looks.push(look));
    expect(sent.at(-1)!.body).toMatchObject({ characterId: "c_1", merge: true });
    expect(looks.at(-1)).toMatchObject({ title: "the_kind", revision: 1 });
    expect(loadKitQueue("dev_1")).toEqual([]);
    expect(bookKitStatus()).toEqual({ offline: false, notes: [] });
  });

  it("says so when the server skips a look that is not hers", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    serve(() => answer(200, {}));
    await editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "nameplate", before: null, after: "golden" }] }, () => undefined);
    vi.stubGlobal("navigator", { onLine: true });
    serve(() => answer(200, { kit: KIT, look: { ...NO_LOOK, revision: 0 }, applied: [], refused: ["nameplate"] } satisfies BookKitResponse));
    await flushKitQueue(() => undefined);
    expect(bookKitStatus().notes).toEqual(["Your nameplate pick could not be saved."]);
  });

  it("on a family tablet shows each tap at once from memory and sends them in tap order", async () => {
    saveIdentity({ householdId: "h_1", playerId: "p_1", displayName: "Ada" } as Parameters<typeof saveIdentity>[0]);
    useGameStore.setState({ session: { sessionToken: "s_1" } as never });
    const releases: (() => void)[] = [];
    serve(() => new Promise<Response>((resolve) => releases.push(() => resolve(answer(200, { kit: KIT, look: { ...NO_LOOK, revision: 1, title: "the_bold" }, applied: ["title"], refused: [] })))));
    const first = editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "title", before: null, after: "the_bold" }] }, () => undefined);
    const second = editBookKit({ characterId: "c_1", crew: null, changes: [{ field: "title", before: "the_bold", after: "the_kind" }] }, () => undefined);
    // Both shown at once, the later on top; nothing kept on the tablet.
    expect(withQueuedLook(undefined, "c_1", pendingKitEdits()).title).toBe("the_kind");
    expect(loadKitQueue(null)).toEqual([]);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases[0]!();
    await first;
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!();
    await second;
    expect(sent.map((s) => (s.body.changes as BookLookChange[])[0]!.after)).toEqual(["the_bold", "the_kind"]);
    useGameStore.setState({ session: null });
  });
});
