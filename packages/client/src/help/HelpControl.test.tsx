// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HelpContent, PartyMember, RunState } from "@kad/shared";
import { navigate } from "../router";
import { useGameStore } from "../store";
import { setPlayerSection } from "../store/player-navigation";

const hear = vi.hoisted(() => vi.fn());
vi.mock("../speech/read-aloud", () => ({ hear, stopSpeaking: vi.fn() }));

import { HelpControl } from "./HelpControl";
import { resetHelpCache } from "./content";
import { closeHelp, showThingHelp, setHelpPane } from "./focus";

const help = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "content", "help.json"), "utf8")) as HelpContent;

function joinRoom(): void {
  const me = { playerId: "p_1", character: { id: "c_1" } } as unknown as PartyMember;
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party", sessionToken: "t" },
    state: { party: [me] } as unknown as RunState,
  });
}

describe("the ? button", () => {
  beforeEach(() => {
    resetHelpCache();
    hear.mockClear();
    navigate("/p/ABCD");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(help) })));
    joinRoom();
    setPlayerSection("bag");
  });
  afterEach(() => {
    act(() => { closeHelp(); setHelpPane("player"); });
    cleanup();
    vi.unstubAllGlobals();
  });

  it("says what this screen is, from the content, and reads it aloud", async () => {
    const user = userEvent.setup();
    render(<HelpControl />);
    await user.click(screen.getByRole("button", { name: "Help" }));
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    expect(dialog.textContent).toContain(help.surfaces.inventory.text);
    expect(hear).toHaveBeenCalledWith(help.surfaces.inventory.text, { source: "ui" });
  });

  it("follows the pane the player is on", async () => {
    const user = userEvent.setup();
    render(<HelpControl />);
    act(() => { setHelpPane("map"); });
    await user.click(screen.getByRole("button", { name: "Help" }));
    expect((await screen.findByRole("dialog")).textContent).toContain(help.surfaces.map.text);
  });

  it("closes with Got it and with Escape, and gives the page back", async () => {
    const user = userEvent.setup();
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    render(<HelpControl />, { container: root.appendChild(document.createElement("div")) });
    await user.click(screen.getByRole("button", { name: "Help" }));
    await screen.findByRole("dialog");
    expect(root.hasAttribute("inert")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(root.hasAttribute("inert")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Help" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    root.remove();
  });

  it("shows a held thing's own words, falling back to its kind's", async () => {
    render(<HelpControl />);
    act(() => { showThingHelp({ kind: "item", name: "Sunbloom Draught", text: "Still warm. Heal 2 HP." }); });
    const dialog = await screen.findByRole("dialog", { name: "Sunbloom Draught" });
    expect(dialog.textContent).toContain("Still warm. Heal 2 HP.");
    expect(hear).toHaveBeenLastCalledWith("Still warm. Heal 2 HP.", { source: "ui" });

    act(() => { showThingHelp({ kind: "buff", name: "Guard" }); });
    expect((await screen.findByRole("dialog", { name: "Guard" })).textContent).toContain(help.things.buff.text);
  });

  it("is not on the TV or the join screen", () => {
    act(() => { navigate("/tv/ABCD"); });
    const { container } = render(<HelpControl />);
    expect(container.querySelector("button")).toBeNull();
    cleanup();
    act(() => { navigate("/"); });
    expect(render(<HelpControl />).container.querySelector("button")).toBeNull();
  });
});
