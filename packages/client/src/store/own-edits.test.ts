/**
 * Her own kit and look at the table (own-edits.ts): shown at the tap, one send
 * in the air per hero and kind, later taps merged and sent on the revision the
 * table's view shows once the first has landed, and a refusal giving way.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientIntent, RunState } from "@kad/shared";
import { createOwnEdits, withOwnEdits } from "./own-edits";

function harness() {
  let state = {
    party: [{ playerId: "p_1", character: { id: "c_1", look: { revision: 0, coat: null, accent: null, special: null, nameplate: null, title: null, unlocked: [] } } }],
    kits: { c_1: { revision: 3, style: null, tent: null, color: null, slots: [], unlocked: [] } },
  } as unknown as RunState;
  const listeners = new Set<() => void>();
  const sent: ClientIntent[] = [];
  const answers: ((ok: boolean) => void)[] = [];
  const edits = createOwnEdits({
    send: (intent) => {
      sent.push(intent);
      return new Promise<boolean>((resolve) => answers.push(resolve));
    },
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    settleMs: 1000,
  });
  /** The table's patch arriving: her look or kit at the next revision with these fields. */
  const patch = (kind: "look" | "kit", fields: Record<string, unknown>) => {
    if (kind === "look") {
      const member = state.party[0]!;
      const look = member.character.look!;
      state = { ...state, party: [{ ...member, character: { ...member.character, look: { ...look, ...fields, revision: look.revision + 1 } } }] } as RunState;
    } else {
      const kit = state.kits!["c_1"]!;
      state = { ...state, kits: { c_1: { ...kit, ...fields, revision: kit.revision + 1 } } } as RunState;
    }
    for (const listener of [...listeners]) listener();
  };
  return { edits, sent, answers, patch, listeners };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("her own kit and look (own-edits.ts)", () => {
  it("shows a tap at once and sends it on the revision the table shows", () => {
    const { edits, sent } = harness();
    edits.edit({ type: "LOOK_EDIT", characterId: "c_1", revision: 99, coat: "unicorn_sky" });
    expect(edits.shown("LOOK_EDIT", "c_1")).toEqual({ coat: "unicorn_sky" });
    expect(sent).toEqual([{ type: "LOOK_EDIT", characterId: "c_1", revision: 0, coat: "unicorn_sky" }]);
  });

  it("merges taps made while one is in the air and sends them once the table shows the first", async () => {
    const { edits, sent, answers, patch } = harness();
    edits.edit({ type: "LOOK_EDIT", characterId: "c_1", revision: 0, coat: "unicorn_sky" });
    edits.edit({ type: "LOOK_EDIT", characterId: "c_1", revision: 0, coat: "unicorn_blush" });
    edits.edit({ type: "LOOK_EDIT", characterId: "c_1", revision: 0, title: "the_bold" });
    expect(sent).toHaveLength(1);
    // The latest pick of each field shows, over the one in the air.
    expect(edits.shown("LOOK_EDIT", "c_1")).toEqual({ coat: "unicorn_blush", title: "the_bold" });
    answers[0]!(true);
    await flush();
    // Answered, but the table's view has not caught up: nothing more is sent yet.
    expect(sent).toHaveLength(1);
    patch("look", { coat: "unicorn_sky" });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ type: "LOOK_EDIT", characterId: "c_1", revision: 1, coat: "unicorn_blush", title: "the_bold" });
    answers[1]!(true);
    await flush();
    patch("look", { coat: "unicorn_blush", title: "the_bold" });
    expect(edits.shown("LOOK_EDIT", "c_1")).toEqual({});
  });

  it("keeps the same overlay object while nothing changes, and tells listeners when it does", () => {
    const { edits } = harness();
    const heard = vi.fn();
    edits.subscribe(heard);
    const empty = edits.shown("KIT_EDIT", "c_1");
    expect(edits.shown("KIT_EDIT", "c_1")).toBe(empty);
    edits.edit({ type: "KIT_EDIT", characterId: "c_1", revision: 0, style: "quilted" });
    expect(heard).toHaveBeenCalled();
    const one = edits.shown("KIT_EDIT", "c_1");
    expect(edits.shown("KIT_EDIT", "c_1")).toBe(one);
  });

  it("gives way to what is stored when the send is refused", async () => {
    const { edits, sent, answers } = harness();
    edits.edit({ type: "KIT_EDIT", characterId: "c_1", revision: 0, style: "quilted" });
    expect(sent[0]).toMatchObject({ revision: 3 });
    answers[0]!(false);
    await flush();
    expect(edits.shown("KIT_EDIT", "c_1")).toEqual({});
  });

  it("sends what waited even when the table's view never catches up", async () => {
    vi.useFakeTimers();
    const { edits, sent, answers } = harness();
    edits.edit({ type: "KIT_EDIT", characterId: "c_1", revision: 0, style: "quilted" });
    edits.edit({ type: "KIT_EDIT", characterId: "c_1", revision: 0, color: "rose" });
    answers[0]!(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ type: "KIT_EDIT", revision: 3, color: "rose" });
  });

  it("stops listening to the store once nothing is pending", async () => {
    const { edits, answers, patch, listeners } = harness();
    edits.edit({ type: "KIT_EDIT", characterId: "c_1", revision: 0, style: "quilted" });
    expect(listeners.size).toBe(1);
    answers[0]!(true);
    await flush();
    patch("kit", { style: "quilted" });
    expect(listeners.size).toBe(0);
  });
});

describe("withOwnEdits", () => {
  it("lays her picks over the view, a buddy of null meaning none", () => {
    const kit = { revision: 1, style: null, tent: null, color: null, slots: [], unlocked: [], buddy: "otter" };
    expect(withOwnEdits(kit, {})).toBe(kit);
    expect(withOwnEdits(kit, { style: "quilted", buddy: null })).toEqual({ revision: 1, style: "quilted", tent: null, color: null, slots: [], unlocked: [] });
  });
});
