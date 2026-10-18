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
import type { ResolvedCharacter } from "@kad/shared";
import { makeCharacter } from "../testing/fixtures";
import { useGameStore } from "../store";
import { WelcomeBack } from "./WelcomeBack";

function mount(heroes: ResolvedCharacter[] | Error, accepted = true) {
  const send = vi.fn(async () => accepted);
  const listHeroes = vi.fn(async () => {
    if (heroes instanceof Error) throw heroes;
    return heroes;
  });
  useGameStore.setState({ send, listHeroes, rules: null, loadContent: async () => undefined });
  render(<WelcomeBack />);
  return { send, listHeroes };
}

afterEach(() => {
  cleanup();
});

const SPARKLEHOOF = makeCharacter({ id: "c_old", name: "Sparklehoof", level: 4, tier: "sworn" });

describe("WelcomeBack", () => {
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

  it("still lets them make someone new", async () => {
    const user = userEvent.setup();
    mount([SPARKLEHOOF]);
    await user.click(await screen.findByRole("button", { name: /make someone new/i }));
    expect(await screen.findByText(/getting the character sheet ready/i)).toBeTruthy();
  });
});
