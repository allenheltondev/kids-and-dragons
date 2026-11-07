// @vitest-environment jsdom
/**
 * Her kit in the adventure book (BookKit.tsx): her pitch shows what she picked
 * the moment she taps, one shelf of painted tiles at a time, every tap an
 * edit straight away (saved behind the scenes, nothing saying so), and the
 * decorations hung by spot rather than picked from a list.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CampFriendCard, HeroKitView } from "@kad/shared";
import { makeCharacter } from "../testing/fixtures";
import { BookKit } from "./BookKit";

const hero = makeCharacter({ id: "c_1", ownerPlayerId: "p_1", name: "Moonbeam" });
const kit = (over: Partial<HeroKitView> = {}): HeroKitView => ({ revision: 4, style: null, tent: null, color: null, slots: [null, null], unlocked: [], ...over });
const friends: CampFriendCard[] = [
  { id: "bun", name: "Bun", figure: "cast/bun" },
  { id: "duckling", name: "Duckling", figure: "entities/duckling" },
];

type Change = Record<string, unknown>;
let edits: Change[] = [];
const edit = (change: Change): void => {
  edits.push(change);
};

beforeEach(() => {
  edits = [];
});
afterEach(cleanup);

const shelf = (name: string): void => {
  fireEvent.click(screen.getByRole("tab", { name }));
};

describe("her kit in the book", () => {
  it("shows her pitch above one shelf at a time, every shelf one tap away", () => {
    render(<BookKit hero={hero} kit={kit()} friends={friends} edit={edit} />);
    expect(screen.getByTestId("book-kit-pitch").textContent).toContain("Moonbeam's pitch");
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Tent", "Bedroll", "Color", "Decorate", "Buddy"]);
    shelf("Bedroll");
    expect(screen.getByRole("tab", { name: "Bedroll" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").querySelectorAll("[data-style]")).toHaveLength(3);
    expect(screen.getByRole("tabpanel").querySelector("[data-tent]")).toBeNull();
  });

  it("changes her kit on the tap itself, with nothing to save and nothing said about saving", () => {
    const { container } = render(<BookKit hero={hero} kit={kit()} friends={friends} edit={edit} />);
    shelf("Tent");
    fireEvent.click(container.querySelector('[data-tent="patched"]')!);
    shelf("Color");
    fireEvent.click(screen.getByRole("button", { name: "Blue" }));
    expect(edits).toEqual([{ tent: "patched" }, { color: "meadow" }]);
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(container.textContent).not.toMatch(/saving|saved|synced/i);
  });

  it("marks what she has chosen, by more than colour alone", () => {
    render(<BookKit hero={hero} kit={kit({ color: "meadow" })} friends={friends} edit={edit} />);
    shelf("Color");
    expect(screen.getByRole("button", { name: "Blue" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "My color" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("hangs a decoration in the spot she picked, moves on to the empty one, and takes it from the other spot", () => {
    const view = render(<BookKit hero={hero} kit={kit()} friends={friends} edit={edit} />);
    shelf("Decorate");
    fireEvent.click(view.container.querySelector('[data-decoration="deco_bunting"]')!);
    expect(edits.at(-1)).toEqual({ slots: ["deco_bunting", null] });
    // The next empty spot is picked for the next tap.
    view.rerender(<BookKit hero={hero} kit={kit({ slots: ["deco_bunting", null] })} friends={friends} edit={edit} />);
    expect(screen.getByRole("radio", { name: /spot 2/i }).getAttribute("aria-checked")).toBe("true");
    // The same decoration in spot 2 leaves spot 1.
    fireEvent.click(view.container.querySelector('[data-decoration="deco_bunting"]')!);
    expect(edits.at(-1)).toEqual({ slots: [null, "deco_bunting"] });
    // And her pitch wears what hangs on it.
    view.rerender(<BookKit hero={hero} kit={kit({ slots: ["deco_bunting", null] })} friends={friends} edit={edit} />);
    expect(view.container.querySelector(".book-kit__hung--0")?.getAttribute("src")).toMatch(/bunting/);
  });

  it("picks her buddy, or everyone taking turns, and has no Buddy shelf for a crew with no friends", () => {
    const view = render(<BookKit hero={hero} kit={kit()} friends={friends} edit={edit} />);
    shelf("Buddy");
    fireEvent.click(view.container.querySelector('[data-buddy="duckling"]')!);
    fireEvent.click(view.container.querySelector('[data-buddy=""]')!);
    expect(edits).toEqual([{ buddy: "duckling" }, { buddy: null }]);
    view.unmount();
    render(<BookKit hero={hero} kit={kit()} friends={[]} edit={edit} />);
    expect(screen.queryByRole("tab", { name: "Buddy" })).toBeNull();
  });
});
