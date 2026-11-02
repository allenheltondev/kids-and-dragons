// @vitest-environment jsdom
/**
 * WelcomeBack — bringing a saved hero to a new table (spec §5).
 *
 * The rule the screen exists for: a player with saved heroes is asked whether
 * to bring one before being made to start from nothing, and a player with none
 * never sees this screen at all.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HeroHold, ResolvedCharacter } from "@kad/shared";
import { makeCharacter, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { WelcomeBack } from "./WelcomeBack";

function mount(heroes: ResolvedCharacter[] | Error, accepted = true, fresh = false, held: Record<string, HeroHold> = {}) {
  const send = vi.fn(async () => accepted);
  const listHeroes = vi.fn(async () => {
    if (heroes instanceof Error) throw heroes;
    return heroes;
  });
  useGameStore.setState({ send, listHeroes, rules: null, loadContent: async () => undefined, heldHeroes: held, savedHeroes: {},
    state: makeState(fresh ? { crew: "cw_1", crewSetup: true, crews: [{ id: "cw_1", name: "The Otter Crew" }] } : {}) });
  render(<WelcomeBack />);
  return { send, listHeroes };
}

afterEach(() => {
  cleanup();
});

const SPARKLEHOOF = makeCharacter({ id: "c_old", name: "Sparklehoof", level: 4, tier: "sworn" });

describe("WelcomeBack", () => {
  it("guides a returning player straight into new heroes when the TV starts a crew", async () => {
    const { send } = mount([SPARKLEHOOF], true, true);
    expect(screen.getByText(/Make a new hero for The Otter Crew/)).toBeTruthy();
    expect(await screen.findByText(/getting the character sheet ready/i)).toBeTruthy();
    expect(screen.queryByText(/welcome back/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Sparklehoof/ })).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it("goes straight to making someone when there is nobody to bring", async () => {
    mount([]);
    // CreationFlow, waiting on rules this test never loads.
    expect(await screen.findByText(/getting the character sheet ready/i)).toBeTruthy();
    expect(screen.queryByText(/welcome back/i)).toBeNull();
  });

  it("treats a list it cannot fetch as an empty one, never a stuck spinner", async () => {
    mount(new Error("offline"));
    expect(await screen.findByText(/getting the character sheet ready/i)).toBeTruthy();
  });

  it("offers saved heroes at their level, and brings the chosen one on confirm", async () => {
    const user = userEvent.setup();
    const { send } = mount([SPARKLEHOOF]);

    expect(await screen.findByText(/welcome back/i)).toBeTruthy();
    expect(screen.getByText(/Level 4 · Sworn/)).toBeTruthy();

    // Nothing is sent on the tap that chooses (spec §11) — only on confirm.
    await user.click(screen.getByRole("button", { name: /Sparklehoof/ }));
    expect(send).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /play as sparklehoof/i }));
    expect(send).toHaveBeenCalledWith({ type: "SEAT_CHARACTER", characterId: "c_old" });
  });

  it("says so when the server will not seat that hero", async () => {
    const user = userEvent.setup();
    mount([SPARKLEHOOF], false);
    await user.click(await screen.findByRole("button", { name: /Sparklehoof/ }));
    await user.click(screen.getByRole("button", { name: /play as sparklehoof/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });

  it("names a hero busy in another adventure, and offers a new hero for this one (#282)", async () => {
    const user = userEvent.setup();
    const send = vi.fn(async () => {
      // As the store does with the server's HERO_BUSY refusal.
      useGameStore.setState({ error: "Sparklehoof is in the middle of another adventure" });
      return false;
    });
    useGameStore.setState({ send, listHeroes: async () => [SPARKLEHOOF], rules: null, loadContent: async () => undefined });
    render(<WelcomeBack />);

    await user.click(await screen.findByRole("button", { name: /Sparklehoof/ }));
    await user.click(screen.getByRole("button", { name: /play as sparklehoof/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Sparklehoof is in the middle of another adventure/);

    await user.click(screen.getByRole("button", { name: /make a new hero for this one/i }));
    expect(await screen.findByText(/getting the character sheet ready/i)).toBeTruthy();
  });

  it("says on her card which crew a hero is playing with, and that choosing her moves the room", async () => {
    const user = userEvent.setup();
    const { send } = mount([SPARKLEHOOF], true, false, {
      c_old: { campaign: "Gemfall", crew: "The Otter Crew", switches: true },
    });
    expect(await screen.findByText("Playing Gemfall with The Otter Crew")).toBeTruthy();
    // Nothing about the room until she is chosen; then what sitting her down does.
    expect(screen.queryByRole("status")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Sparklehoof/ }));
    expect(screen.getByRole("status").textContent).toMatch(/This room will switch to The Otter Crew so Sparklehoof can keep going/);
    await user.click(screen.getByRole("button", { name: /play as sparklehoof/i }));
    expect(send).toHaveBeenCalledWith({ type: "SEAT_CHARACTER", characterId: "c_old" });
  });

  it("warns before Begin when the room is playing as a different crew it will not leave", async () => {
    const user = userEvent.setup();
    mount([SPARKLEHOOF], true, false, { c_old: { campaign: "Gemfall", crew: "The Otter Crew" } });
    await user.click(await screen.findByRole("button", { name: /Sparklehoof/ }));
    expect(screen.getByRole("status").textContent).toMatch(/this room is playing as a different crew/);
  });

  it("dims a hero this room cannot seat, says why on her card, and never lets her be chosen", async () => {
    const user = userEvent.setup();
    const BO = makeCharacter({ id: "c_bo", name: "Bo", level: 2, tier: "fledgling" });
    const { send } = mount([SPARKLEHOOF, BO], true, false, {
      c_old: { campaign: "Gemfall", at: "Rue's", blocked: "Sparklehoof is in the middle of another adventure" },
    });
    const card = await screen.findByRole("button", { name: /Sparklehoof/ });
    expect(card.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Partway through Gemfall at Rue's")).toBeTruthy();
    expect(screen.getByText("Sparklehoof is in the middle of another adventure.")).toBeTruthy();
    await user.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /pick a hero/i })).toHaveProperty("disabled", true);
    // Another hero is still a tap away.
    await user.click(screen.getByRole("button", { name: /^Bo/ }));
    await user.click(screen.getByRole("button", { name: /play as bo/i }));
    expect(send).toHaveBeenCalledWith({ type: "SEAT_CHARACTER", characterId: "c_bo" });
  });

  it("checks a can't-sit hero again on a tap, and chooses her once her other table has let her go", async () => {
    const user = userEvent.setup();
    const held = { c_old: { campaign: "Gemfall", at: "Rue's", blocked: "Sparklehoof is in the middle of another adventure" } };
    let calls = 0;
    // As the store's listHeroes does: the hold comes with each list. Rue's lets her go after the first.
    const listHeroes = vi.fn(async () => {
      calls += 1;
      useGameStore.setState({ heldHeroes: calls === 1 ? held : {} });
      return [SPARKLEHOOF];
    });
    const send = vi.fn(async () => true);
    useGameStore.setState({ send, listHeroes, rules: null, loadContent: async () => undefined, heldHeroes: {}, savedHeroes: {}, state: makeState({}) });
    render(<WelcomeBack />);

    const card = await screen.findByRole("button", { name: /Sparklehoof/ });
    expect(card.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Tap to check again")).toBeTruthy();
    await user.click(card);
    await waitFor(() => expect(screen.getByRole("button", { name: /^Sparklehoof/ }).getAttribute("aria-pressed")).toBe("true"));
    expect(listHeroes).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Tap to check again")).toBeNull();
    await user.click(screen.getByRole("button", { name: /play as sparklehoof/i }));
    expect(send).toHaveBeenCalledWith({ type: "SEAT_CHARACTER", characterId: "c_old" });
  });

  it("keeps a hero blocked, and still choosable later, when the check says she is still busy", async () => {
    const user = userEvent.setup();
    mount([SPARKLEHOOF], true, false, {
      c_old: { campaign: "Gemfall", at: "Rue's", blocked: "Sparklehoof is in the middle of another adventure" },
    });
    const card = await screen.findByRole("button", { name: /Sparklehoof/ });
    await user.click(card);
    await waitFor(() => expect(screen.getByText("Tap to check again")).toBeTruthy());
    expect(screen.getByRole("button", { name: /^Sparklehoof/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("names the adventure of a hero partway through with this room's own crew, quietly", async () => {
    mount([SPARKLEHOOF], true, false, { c_old: { campaign: "Gemfall" } });
    expect(await screen.findByText("Partway through Gemfall")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sparklehoof/ }).getAttribute("aria-disabled")).toBeNull();
  });

  it("still lets them make someone new", async () => {
    const user = userEvent.setup();
    mount([SPARKLEHOOF]);
    await user.click(await screen.findByRole("button", { name: /make someone new/i }));
    expect(await screen.findByText(/getting the character sheet ready/i)).toBeTruthy();
  });
});
