// @vitest-environment jsdom
/**
 * The book's Camp and Style pages while their kid is seated at a live game
 * (book-table.tsx; docs/camp.md §7): in downtime a tap hands her to the
 * game's Camp at that hero's part and saves nothing here; in a scene it saves
 * as ever, and the page says she wears it from the next rest.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CampView, JournalKit, JournalResponse, RunState } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { currentRoute, navigate } from "../router";
import { setCoatMaskPaintings } from "../world/coat-masks";
import { resetBookKitSync } from "../store/book-kit-sync";
import { closeCampPanel, takeCampFocus } from "./camp-panel";
import CampPane from "./CampPane";
import LookPane from "./LookPane";

const SEAT = { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party" as const, sessionToken: "t" };
const PIP = makeCharacter({ id: "c_1", ownerPlayerId: "p_1", name: "Pip" });
const KIT: JournalKit = { revision: 2, style: null, tent: "rolled", color: null, slots: [null, null], unlocked: [], buddies: {} };
const CAMP: CampView = { revision: 1, frameStage: 2, grownBy: ["gemfall"], dashCash: 0, owned: [], placed: {}, friends: [], shopOpen: false };

const journal = (): JournalResponse => ({
  heroes: [PIP],
  fieldGuide: {},
  finders: {},
  whereabouts: null,
  camp: { crews: [{ crew: null, name: "The Lanterns", camp: CAMP, friends: [], sources: {} }], kits: { c_1: KIT } },
} as unknown as JournalResponse);

function seat(over: Partial<RunState>): void {
  useGameStore.setState({ session: SEAT, state: makeState({ roomCode: "ABCD", party: [makeMember({ playerId: "p_1", character: PIP })], ...over }) });
}

let fetched: string[] = [];

beforeEach(() => {
  localStorage.clear();
  setCoatMaskPaintings([]);
  navigate({ name: "journal" });
  fetched = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetched.push(String(url));
    return new Response(JSON.stringify({ kit: KIT, applied: [], refused: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  act(() => closeCampPanel());
  takeCampFocus();
  resetBookKitSync();
  setCoatMaskPaintings(null);
  useGameStore.setState({ session: null, state: null });
  navigate({ name: "home" });
});

const camp = () => render(<CampPane journal={journal()} fresh={false} hero={PIP} onHero={() => undefined} onKit={() => undefined} />);
const style = () => render(<LookPane journal={journal()} hero={PIP} onHero={() => undefined} onKit={() => undefined} />);

describe("the book's Camp page, seated", () => {
  it("in downtime hands a tent tap to the game's Camp, at her tent, and saves nothing here", () => {
    seat({ phase: "scene", sceneType: "rest" });
    const { container } = camp();
    expect(screen.getByTestId("book-table-note").textContent).toContain("Change it there");
    fireEvent.click(container.querySelector('[data-tent="patched"]')!);
    expect(currentRoute()).toEqual({ name: "player", code: "ABCD" });
    expect(takeCampFocus()).toEqual({ hero: "c_1", part: "tent" });
    expect(fetched).toEqual([]);
  });

  it("hands a decoration to Camp at her decorations", () => {
    seat({ phase: "lobby" });
    const { container } = camp();
    fireEvent.click(screen.getByRole("tab", { name: "Decorate" }));
    fireEvent.click(container.querySelector('[data-decoration="deco_bunting"]')!);
    expect(takeCampFocus()).toEqual({ hero: "c_1", part: "decor" });
  });

  it("in a scene saves the tap as ever, and says it shows from the next rest", async () => {
    seat({ phase: "scene", sceneType: "story" });
    const { container } = camp();
    expect(screen.getByTestId("book-table-note").textContent).toContain("next rest");
    fireEvent.click(screen.getByRole("tab", { name: "Tent" }));
    await act(async () => {
      fireEvent.click(container.querySelector('[data-tent="patched"]')!);
    });
    expect(currentRoute()).toEqual({ name: "journal" });
    expect(fetched.some((u) => u.includes("/api/journal/kit"))).toBe(true);
  });

  it("is the book's as ever with no game", () => {
    camp();
    expect(screen.queryByTestId("book-table-note")).toBeNull();
  });
});

describe("the book's Style page, seated", () => {
  it("in downtime hands a tap to the game's Camp, at her look", () => {
    seat({ phase: "chapter_complete" });
    const { container } = style();
    fireEvent.click(screen.getByRole("tab", { name: "Title" }));
    fireEvent.click(container.querySelector('[data-title="the_bold"]')!);
    expect(currentRoute()).toEqual({ name: "player", code: "ABCD" });
    expect(takeCampFocus()).toEqual({ hero: "c_1", part: "look" });
    expect(fetched).toEqual([]);
  });

  it("in a scene saves the tap, and says it shows from the next rest", async () => {
    seat({ phase: "scene", sceneType: "story" });
    const { container } = style();
    expect(screen.getByTestId("book-table-note").textContent).toContain("next rest");
    fireEvent.click(screen.getByRole("tab", { name: "Title" }));
    await act(async () => {
      fireEvent.click(container.querySelector('[data-title="the_bold"]')!);
    });
    expect(currentRoute()).toEqual({ name: "journal" });
    expect(fetched.some((u) => u.includes("/api/journal/kit"))).toBe(true);
  });
});
