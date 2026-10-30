// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RulesContent } from "@kad/shared";
import rulesJson from "../../../../content/rules.json";
import { useGameStore } from "../store";
import { CreationFlow } from "./CreationFlow";
import { EMPTY_DRAFT, getCreationDraft, patchCreationDraft, resetCreationDraft, setCreationDraft } from "./creationDraft";

const rules = rulesJson as unknown as RulesContent;

afterEach(() => { cleanup(); resetCreationDraft(); });

function mount() {
  const send = vi.fn(async () => true);
  useGameStore.setState({ rules, synced: true, state: null, send, loadContent: async () => undefined });
  render(<CreationFlow />);
  return send;
}

describe("creation guidance", () => {
  it("suggests a class's strength without advancing, and lets the player edit the points", () => {
    setCreationDraft({ ...EMPTY_DRAFT, species: "unicorn", klass: "thornguard", step: "stats", assigned: { might: 0, quick: 0, clever: 0, heart: 0 } });
    const send = mount();
    expect(screen.getByText(/Spend .*points to keep going/)).toBeTruthy();
    expect(screen.getByText("Lift, push and stand strong.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Help me choose" }));
    const primary = rules.classes.thornguard.stat;
    expect(getCreationDraft().assigned[primary]).toBe(rules.creationPoints);
    expect(getCreationDraft().step).toBe("stats");
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: `Take a point off ${primary}` }));
    const other = primary === "quick" ? "heart" : "quick";
    fireEvent.click(screen.getByRole("button", { name: `Add a point to ${other}` }));
    expect(getCreationDraft().assigned[primary]).toBe(rules.creationPoints - 1);
    expect(getCreationDraft().assigned[other]).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(getCreationDraft().step).toBe("name");
    expect(send).not.toHaveBeenCalled();
  });

  it("explains the missing choice beside Next at each step", () => {
    resetCreationDraft();
    mount();
    expect(screen.getByText("Pick your creature to keep going.")).toBeTruthy();
    act(() => patchCreationDraft({ step: "class", species: "unicorn" }));
    expect(screen.getByText("Pick what you love doing to keep going.")).toBeTruthy();
    act(() => patchCreationDraft({ step: "name" }));
    expect(screen.getByText("Pick a name or type your own.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "That's me!" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
