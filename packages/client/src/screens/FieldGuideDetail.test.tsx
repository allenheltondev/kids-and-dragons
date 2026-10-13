// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setSpeaker } from "@kad/shared";
import type { FieldGuide as FieldGuideData } from "@kad/shared";
import real from "../../../../content/field-guide.json";
import { FieldGuide } from "./FieldGuide";
import { FieldGuideDetail } from "./FieldGuideDetail";
import { resetFieldGuideCache } from "./content";
import { openGuide, setPlayerSection, usePlayerNavigation } from "../store/player-navigation";
import { setFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { FIELD_GUIDE_SEEN_KEY, resetFieldGuideSeen } from "../store/field-guide-seen";
import { useGameStore } from "../store";

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
    expect(screen.getByText("Northern River Bridge")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Northern River Bridge" })).toBeNull();
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

  it("Read aloud goes through the speak seam as ui", async () => {
    const speaker = vi.fn();
    setSpeaker(speaker);
    const e = guide.entries["creature.bone_crawler"]!;
    setFieldGuideDiscoveries({ [e.id]: find() });
    render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Read aloud/ }));
    expect(speaker).toHaveBeenCalledTimes(1);
    expect(speaker.mock.calls[0]![0]).toContain(e.title);
    expect(speaker.mock.calls[0]![1]).toMatchObject({ source: "ui" });
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
