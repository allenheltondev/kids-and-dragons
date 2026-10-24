// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FieldGuide as FieldGuideData, FieldGuideEntry } from "@kad/shared";
import { FieldGuideIndex, FieldGuide } from "./FieldGuide";
import { resetFieldGuideCache } from "./content";
import { runBackStep } from "../store/back-steps";
import { openGuide, usePlayerNavigation, setPlayerSection } from "../store/player-navigation";
import { setFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { resetFieldGuideSeen, FIELD_GUIDE_SEEN_KEY } from "../store/field-guide-seen";

function entry(id: string, category: FieldGuideEntry["category"], title: string, art?: string): FieldGuideEntry {
  return { id, category, kind: "creature", title, ...(art ? { art } : {}) };
}

const guide: FieldGuideData = {
  version: 1,
  entries: {
    "creature.a": entry("creature.a", "creatures", "Mossback", "/art/mossback.png"),
    "creature.b": entry("creature.b", "creatures", "Secretwyrm", "/art/secretwyrm.png"),
    "creature.c": entry("creature.c", "creatures", "Puddlefin"),
    "people.a": entry("people.a", "peoples", "Frogfolk"),
    "place.a": entry("place.a", "places", "Glimmer Marsh"),
  },
};

const find = (by = "p1") => ({ firstFoundBy: by, foundAt: "2026-01-01T00:00:00Z" });

beforeEach(() => {
  resetFieldGuideSeen();
  setPlayerSection("bag");
});
afterEach(() => {
  cleanup();
  setFieldGuideDiscoveries(null);
  resetFieldGuideSeen();
});

describe("FieldGuideIndex", () => {
  it("shows discovered cards with title and art, undiscovered as anonymous", () => {
    setFieldGuideDiscoveries({ "creature.a": find(), "creature.c": find() });
    const { container } = render(<FieldGuideIndex guide={guide} />);
    expect(screen.getByRole("button", { name: /Mossback/ })).toBeTruthy();
    expect(container.querySelector('img[src="/art/mossback.png"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: /Puddlefin/ })).toBeTruthy(); // icon fallback
    const hidden = screen.getByRole("button", { name: "Undiscovered creature" });
    expect(hidden.hasAttribute("disabled")).toBe(true);
    expect(container.innerHTML).not.toContain("Secretwyrm");
    expect(container.innerHTML).not.toContain("secretwyrm.png");
    expect(container.innerHTML).not.toContain("Frogfolk");
  });

  it("counts per section and overall", async () => {
    setFieldGuideDiscoveries({ "creature.a": find(), "creature.c": find(), "place.a": find(), "gone.x": find() });
    const user = userEvent.setup();
    render(<FieldGuideIndex guide={guide} />);
    expect(screen.getByText("3 of 5 found")).toBeTruthy();
    expect(screen.getByText("2 of 3 creatures found")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Peoples" }));
    expect(screen.getByText("0 of 1 peoples found")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undiscovered people" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Places" }));
    expect(screen.getByText("1 of 1 places found")).toBeTruthy();
  });

  it("opens a discovered card, and an undiscovered one does nothing", async () => {
    setFieldGuideDiscoveries({ "creature.a": find() });
    const user = userEvent.setup();
    render(<FieldGuideIndex guide={guide} />);
    await user.click(screen.getAllByRole("button", { name: "Undiscovered creature" })[0]!);
    expect(usePlayerNavigation.getState().guideEntry).toBeNull();
    await user.click(screen.getByRole("button", { name: /Mossback/ }));
    expect(usePlayerNavigation.getState().guideEntry).toBe("creature.a");
  });
});

describe("FieldGuide (new marker)", () => {
  it("shows New until the entry is opened, and remembers it on this device", async () => {
    setFieldGuideDiscoveries({ "creature.a": find(), "creature.c": find() });
    const user = userEvent.setup();
    const { rerender } = render(<FieldGuideIndex guide={guide} />);
    expect(screen.getAllByTestId("guide-new")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /Mossback/ }));
    rerender(<FieldGuideIndex guide={guide} />);
    const card = screen.getByRole("button", { name: /Mossback/ });
    expect(within(card).queryByTestId("guide-new")).toBeNull();
    expect(screen.getAllByTestId("guide-new")).toHaveLength(1);
    expect(localStorage.getItem(FIELD_GUIDE_SEEN_KEY)).toContain("creature.a");
  });
});

describe("FieldGuide tabs", () => {
  it("come back on the tab you left after reading an entry", async () => {
    setFieldGuideDiscoveries({ "creature.a": find(), "place.a": find() });
    const user = userEvent.setup();
    act(() => { openGuide(); });
    const { unmount } = render(<FieldGuideIndex guide={guide} />);
    await user.click(screen.getByRole("tab", { name: "Places" }));
    await user.click(screen.getByRole("button", { name: /Glimmer Marsh/ }));
    // Opening an entry unmounts the index; this is the index coming back.
    unmount();
    render(<FieldGuideIndex guide={guide} />);
    expect(screen.getByRole("tab", { name: "Places" }).getAttribute("aria-selected")).toBe("true");
  });

  it("start from the first tab again once the guide is closed", async () => {
    const user = userEvent.setup();
    act(() => { openGuide(); });
    const { unmount } = render(<FieldGuideIndex guide={guide} />);
    await user.click(screen.getByRole("tab", { name: "Places" }));
    unmount();
    act(() => { setPlayerSection("bag"); });
    render(<FieldGuideIndex guide={guide} />);
    expect(screen.getByRole("tab", { name: "Creatures" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("FieldGuide shell", () => {
  it("renders the placeholder detail with a way back to the index", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => guide }) as unknown as Response);
    resetFieldGuideCache();
    setFieldGuideDiscoveries({ "creature.a": find() });
    const user = userEvent.setup();
    render(<FieldGuide />);
    act(() => { openGuide("creature.a"); });
    expect(await screen.findByRole("heading", { name: "Mossback" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Back to the guide|Return to the guide/ })).toBeNull();
    act(() => { expect(runBackStep()).toBe(true); });
    expect(usePlayerNavigation.getState().guideEntry).toBeNull();
    expect(await screen.findByText("1 of 5 found")).toBeTruthy();
    vi.unstubAllGlobals();
    resetFieldGuideCache();
  });
});
