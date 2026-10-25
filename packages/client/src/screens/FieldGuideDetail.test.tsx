// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FORGOTTEN_FINDER, setSpeaker } from "@kad/shared";
import type { FieldGuide as FieldGuideData } from "@kad/shared";
import real from "../../../../content/field-guide.json";
import { FieldGuide } from "./FieldGuide";
import { FieldGuideDetail } from "./FieldGuideDetail";
import { resetFieldGuideCache } from "./content";
import { openGuide, setPlayerSection, usePlayerNavigation } from "../store/player-navigation";
import { setFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { FIELD_GUIDE_SEEN_KEY, resetFieldGuideSeen } from "../store/field-guide-seen";
import { useGameStore } from "../store";
import rulesJson from "../../../../content/rules.json";
import type { RulesContent } from "@kad/shared";

const guide = real as unknown as FieldGuideData;
const find = (by = "p_1") => ({ firstFoundBy: by, foundAt: "2026-01-01T00:00:00Z" });

function setParty(names: Record<string, string>) {
  useGameStore.setState({
    state: { party: Object.entries(names).map(([playerId, name]) => ({ playerId, character: { name } })) } as never,
  });
}

beforeEach(() => {
  resetFieldGuideSeen();
  setPlayerSection("bag");
  setParty({ p_1: "Juniper" });
});
afterEach(() => {
  cleanup();
  setFieldGuideDiscoveries(null);
  resetFieldGuideSeen();
  useGameStore.setState({ state: null });
  setSpeaker(null);
});

const ids = (pred: (e: FieldGuideData["entries"][string]) => boolean) =>
  Object.values(guide.entries).filter(pred).map((e) => e.id);

describe("FieldGuideDetail sections", () => {
  it("creature: header, badges, lore, opinions, tips, first finder", () => {
    const e = guide.entries["creature.bone_crawler"]!;
    setFieldGuideDiscoveries({ [e.id]: find() });
    render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(screen.getByRole("heading", { name: e.title })).toBeTruthy();
    if (e.lore?.hook) expect(screen.getByText(e.lore.hook)).toBeTruthy();
    if (e.short_description) expect(screen.getByText(e.short_description)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Story" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Tips" })).toBeTruthy();
    expect(screen.getByText(/Throw the glowing thing/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Likes" })).toBeTruthy();
    expect(screen.getByText(e.lore!.likes[0]!.because)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "History" })).toBeNull();
    expect(screen.getByText("First found by Juniper")).toBeTruthy();
    expect(screen.getByLabelText("At a glance").textContent).not.toMatch(/_/);
  });

  it("maps danger and size to kid words", () => {
    const e = { ...guide.entries["creature.bone_crawler"]!, danger_level: "low", scale: "tiny" };
    setFieldGuideDiscoveries({ [e.id]: find() });
    render(<FieldGuideDetail guide={{ ...guide, entries: { [e.id]: e } }} entryId={e.id} />);
    expect(screen.getByText("Mostly harmless")).toBeTruthy();
    expect(screen.getByText("Fits in cupped hands")).toBeTruthy();
  });

  it("people: lore sections and who likes them", () => {
    const e = guide.entries["character.bigfoot"] ?? guide.entries["npc.boggart"]!;
    setFieldGuideDiscoveries({ [e.id]: find() });
    render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(screen.getByRole("heading", { name: "Story" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Tips" })).toBeNull();
  });

  it("npc with likedBy shows 'Who likes them'", () => {
    const e = guide.entries["npc.boggart"]!;
    setFieldGuideDiscoveries({ [e.id]: find() });
    render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(screen.getByRole("heading", { name: e.title })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Who likes them" })).toBeTruthy();
  });

  it("individual: no lore means no empty sections", () => {
    const id = ids((e) => e.kind === "individual")[0]!;
    setFieldGuideDiscoveries({ [id]: find() });
    const { container } = render(<FieldGuideDetail guide={guide} entryId={id} />);
    expect(container.querySelectorAll("h4").length).toBe(0);
    expect(screen.getByRole("heading", { name: guide.entries[id]!.title })).toBeTruthy();
    expect(screen.getByText("First found by Juniper")).toBeTruthy();
  });

  it("biome: place sections, neighbours; non-guide neighbours are plain text", () => {
    const e = guide.entries["biome.eastern_plains"]!;
    setFieldGuideDiscoveries({ [e.id]: find() });
    render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(screen.getByRole("heading", { name: "Where it came from" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Neighbours" })).toBeTruthy();
    // route.* is not in the guide: its title shows as text, not a button.
    expect(screen.getByText("Ashspan Bridge")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ashspan Bridge" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Story" })).toBeNull();
  });

  it("location: place sections and a feature.* neighbour as plain text", () => {
    const e = guide.entries["location.bone_yard"]!;
    setFieldGuideDiscoveries({ [e.id]: find() });
    render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(screen.getByRole("heading", { name: e.title })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Where it came from" })).toBeTruthy();
    expect(screen.getByText("The Great River")).toBeTruthy();
  });

  it("falls back gracefully when the finder is not in the party", () => {
    const e = guide.entries["creature.bone_crawler"]!;
    setFieldGuideDiscoveries({ [e.id]: find("ghost") });
    render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(screen.getByText("First found by someone in your household")).toBeTruthy();
  });

  it("credits a kid who has since been deleted to a friend (#252)", () => {
    const e = guide.entries["creature.bone_crawler"]!;
    setFieldGuideDiscoveries({ [e.id]: find(FORGOTTEN_FINDER) });
    render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(screen.getByText("First found by a friend")).toBeTruthy();
  });

  it("Read aloud speaks on tap even with the read-aloud switch off", async () => {
    const spoken: string[] = [];
    Object.defineProperty(window, "speechSynthesis", {
      value: { speak: (u: { text: string }) => void spoken.push(u.text), cancel() {}, getVoices: () => [] },
      configurable: true,
    });
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
    try {
      const e = guide.entries["creature.bone_crawler"]!;
      setFieldGuideDiscoveries({ [e.id]: find() });
      render(<FieldGuideDetail guide={guide} entryId={e.id} />);
      await userEvent.setup().click(screen.getByRole("button", { name: /Read aloud/ }));
      await vi.waitFor(() => expect(spoken.length).toBeGreaterThan(0));
      expect(spoken.join(" ")).toContain(e.title);
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(window, "speechSynthesis");
    }
  });
});

describe("cross-links", () => {
  const home = "creature.home";
  const target = "creature.zzyzx";
  const mini: FieldGuideData = {
    version: 1,
    entries: {
      [home]: {
        id: home, category: "creatures", kind: "creature", title: "Homebody",
        lore: {
          story: "A tale.", pastimes: [], dislikes: [],
          likes: [{ of: target, title: "Zzyzx Wyrm", because: "It hums nicely." }],
        },
      },
      [target]: { id: target, category: "creatures", kind: "creature", title: "Zzyzx Wyrm" },
    },
  };

  it("undiscovered target shows ??? with the because, never its title", () => {
    setFieldGuideDiscoveries({ [home]: find() });
    const { container } = render(<FieldGuideDetail guide={mini} entryId={home} />);
    expect(screen.getByText("???")).toBeTruthy();
    expect(screen.getByText(/It hums nicely\./)).toBeTruthy();
    expect(container.innerHTML).not.toContain("Zzyzx");
    expect(screen.queryByRole("button", { name: /Zzyzx/ })).toBeNull();
  });

  it("discovered target opens that entry and marks it seen", async () => {
    setFieldGuideDiscoveries({ [home]: find(), [target]: find() });
    const user = userEvent.setup();
    render(<FieldGuideDetail guide={mini} entryId={home} />);
    await user.click(screen.getByRole("button", { name: "Zzyzx Wyrm" }));
    expect(usePlayerNavigation.getState().guideEntry).toBe(target);
    expect(localStorage.getItem(FIELD_GUIDE_SEEN_KEY)).toContain(target);
  });

  it("opens a cross-linked entry in a fresh scroller, at its top", async () => {
    setFieldGuideDiscoveries({ [home]: find(), [target]: find() });
    const user = userEvent.setup();
    const { rerender } = render(<FieldGuideDetail guide={mini} entryId={home} />);
    const before = screen.getByTestId("guide-detail");
    await user.click(screen.getByRole("button", { name: "Zzyzx Wyrm" }));
    rerender(<FieldGuideDetail guide={mini} entryId={target} />);
    // A new element, not the old one scrolled to wherever the reader was.
    expect(screen.getByTestId("guide-detail")).not.toBe(before);
  });

  it("reverse opinions hide undiscovered holders too", () => {
    const e = guide.entries["npc.boggart"]!;
    const holder = e.likedBy![0]!;
    setFieldGuideDiscoveries({ [e.id]: find() });
    const { container } = render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(container.innerHTML).not.toContain(holder.title);
    expect(screen.getByText(holder.because)).toBeTruthy();
  });
});

describe("FieldGuide shell guard", () => {
  async function mountShell() {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => guide }) as unknown as Response);
    resetFieldGuideCache();
    return render(<FieldGuide />);
  }
  afterEach(() => { vi.unstubAllGlobals(); resetFieldGuideCache(); });

  it("a deep link to an undiscovered id shows the index and nothing about it", async () => {
    setFieldGuideDiscoveries({ "creature.bone_crawler": find() });
    const { container } = await mountShell();
    act(() => { openGuide("creature.restless_remains"); });
    expect(await screen.findByText(/found$/, { selector: "p.field-guide__summary" })).toBeTruthy();
    expect(container.innerHTML).not.toContain(guide.entries["creature.restless_remains"]!.title);
    expect(screen.queryByTestId("guide-detail")).toBeNull();
    expect(container.querySelector("[data-entry]")).toBeNull();
  });

  it("an unknown id also falls back, and a discovered one shows the detail", async () => {
    setFieldGuideDiscoveries({ "creature.bone_crawler": find(), "nope.x": find() });
    await mountShell();
    act(() => { openGuide("nope.x"); });
    expect(await screen.findByText(/found$/, { selector: "p.field-guide__summary" })).toBeTruthy();
    act(() => { openGuide("creature.bone_crawler"); });
    expect(await screen.findByTestId("guide-detail")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back to the guide" }));
    expect(usePlayerNavigation.getState().guideEntry).toBeNull();
  });
});

describe("FieldGuideDetail matchups", () => {
  const rules = rulesJson as unknown as RulesContent;
  beforeEach(() => useGameStore.setState({ rules }));
  afterEach(() => useGameStore.setState({ rules: null }));

  it("creature: Fighting it shows traits, who is good, careful and the gentle line", () => {
    const e = guide.entries["creature.bone_crawler"]!;
    expect(e.traits).toEqual(["armored", "swarming"]);
    setFieldGuideDiscoveries({ [e.id]: find() });
    render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(screen.getByRole("heading", { name: "Fighting it" })).toBeTruthy();
    expect(screen.getByText("Shell-hided")).toBeTruthy();
    expect(screen.getByText(rules.matchups!.traits.armored!.text)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Good against it" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Careful" })).toBeTruthy();
    expect(screen.getByText(/Not every fight has to be a fight/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Likes" })).toBeTruthy();
  });

  it("names the playable species a creature likes", () => {
    const e = guide.entries["creature.glassback_crab"]!;
    setFieldGuideDiscoveries({ [e.id]: find() });
    render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(screen.getByText(/Goes easy on:/).parentElement!.textContent).toMatch(/Dragonling/);
  });

  it("is hidden for a creature with no traits and no species opinions", () => {
    const e = { ...guide.entries["creature.bone_crawler"]!, traits: undefined, lore: { ...guide.entries["creature.bone_crawler"]!.lore!, likes: [], dislikes: [] } };
    setFieldGuideDiscoveries({ [e.id]: find() });
    render(<FieldGuideDetail guide={{ ...guide, entries: { [e.id]: e } }} entryId={e.id} />);
    expect(screen.queryByRole("heading", { name: "Fighting it" })).toBeNull();
  });

  it("leaks nothing for an undiscovered creature", () => {
    const e = guide.entries["creature.bone_crawler"]!;
    setFieldGuideDiscoveries({});
    const { container } = render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(container.textContent).toBe("");
  });

  it("species: Good at and Watch out, in words", () => {
    setFieldGuideDiscoveries({ "character.unicorn": find() });
    render(<FieldGuideDetail guide={guide} entryId="character.unicorn" />);
    expect(screen.getByRole("heading", { name: "Good at" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Watch out" })).toBeTruthy();
    expect(screen.getByText(/horn glances off armor/)).toBeTruthy();
  });
});
