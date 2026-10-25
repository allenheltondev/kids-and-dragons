// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FORGOTTEN_FINDER, setSpeaker } from "@kad/shared";
import type { FieldGuide as FieldGuideData } from "@kad/shared";
import real from "../../../../content/field-guide.json";
import { FieldGuide } from "./FieldGuide";
import { FieldGuideDetail, spokenText } from "./FieldGuideDetail";
import { CLASS_PLACE_NAME } from "./ClassPlace";
import { resetFieldGuideCache } from "./content";
import { runBackStep } from "../store/back-steps";
import { openGuide, setPlayerSection, usePlayerNavigation } from "../store/player-navigation";
import { setFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { FIELD_GUIDE_SEEN_KEY, resetFieldGuideSeen } from "../store/field-guide-seen";
import { useGameStore } from "../store";
import type { WorldMap } from "@kad/shared";

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
  useGameStore.setState({ state: null, world: null } as never);
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

describe("classes", () => {
  const CLASSES = ["thornguard", "starweaver", "duskrunner", "songkeeper"] as const;
  const hub = (cls: (typeof CLASSES)[number]) => guide.entries[`class.${cls}`]!.class!.home;

  it("names each class's place the way the class place screen does", () => {
    for (const cls of CLASSES) {
      const title = guide.entries[hub(cls)]!.title;
      expect(title.replace(/^The /, "the "), cls).toBe(CLASS_PLACE_NAME[cls]);
    }
  });

  it("shows the role, the gear and the three distinctions", () => {
    const e = guide.entries["class.thornguard"]!;
    setFieldGuideDiscoveries({ [e.id]: find() });
    render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(screen.getByRole("heading", { name: "Thornguard" })).toBeTruthy();
    expect(screen.getByText(/Front line\. Their gear is a thorn bracer\./)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Distinctions" })).toBeTruthy();
    expect(screen.getByText("Apprentice.").closest("li")?.textContent).toContain("Shove");
    expect(screen.getByText("Expert.").closest("li")?.textContent).toContain("Bramble Wall");
    expect(screen.getByText("Master.").closest("li")?.textContent).toContain("Unbreakable");
  });

  it.each(CLASSES)("keeps the %s's place a ??? until the party has been there", (cls) => {
    const e = guide.entries[`class.${cls}`]!;
    const place = guide.entries[hub(cls)]!;
    setFieldGuideDiscoveries({ [e.id]: find() });
    const { container } = render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(screen.getByRole("heading", { name: "Where they learn" })).toBeTruthy();
    expect(screen.getByText("???")).toBeTruthy();
    // Neither the name nor the picture of the place is anywhere on the page.
    expect(container.innerHTML).not.toContain(place.title);
    expect(screen.queryByRole("button", { name: place.title })).toBeNull();
    // The class wears its own painted badge, never a picture of the room.
    expect(container.querySelector('img[src*="scenes"], img[src*="dojo"], img[src*="academy"], img[src*="rookery"], img[src*="conservatory"]')).toBeNull();
  });

  it.each(CLASSES)("links the %s to its place once the party has been there, and opens it", async (cls) => {
    const e = guide.entries[`class.${cls}`]!;
    const place = guide.entries[hub(cls)]!;
    setFieldGuideDiscoveries({ [e.id]: find(), [place.id]: find() });
    const user = userEvent.setup();
    render(<FieldGuideDetail guide={guide} entryId={e.id} />);
    expect(screen.queryByText("???")).toBeNull();
    await user.click(screen.getByRole("button", { name: place.title }));
    expect(usePlayerNavigation.getState().guideEntry).toBe(place.id);
  });

  describe("the place on the map", () => {
    const WORLD: WorldMap = {
      title: "Realm", image: { src: "/assets/world/realm.webp", width: 1000, height: 800 },
      places: {
        rookery: { id: "location.rookery", title: "The Rookery", kind: "location", anchor: { x: 350, y: 843 }, parent: null },
      },
    } as never;
    const mapOf = (container: HTMLElement) => container.querySelector(".fgd__map");

    it("shows no map before the party has been to the place, though canon placed it", () => {
      const e = guide.entries["class.duskrunner"]!;
      useGameStore.setState({ world: WORLD } as never);
      setFieldGuideDiscoveries({ [e.id]: find() });
      const { container } = render(<FieldGuideDetail guide={guide} entryId={e.id} />);
      expect(mapOf(container)).toBeNull();
      expect(screen.queryByRole("heading", { name: "On the map" })).toBeNull();
      expect(container.innerHTML).not.toContain("realm.webp");
    });

    it("shows the pin once the place is found for the first time", () => {
      const e = guide.entries["class.duskrunner"]!;
      useGameStore.setState({ world: WORLD } as never);
      setFieldGuideDiscoveries({ [e.id]: find(), "location.rookery": find() });
      const { container } = render(<FieldGuideDetail guide={guide} entryId={e.id} />);
      expect(screen.getByRole("heading", { name: "On the map" })).toBeTruthy();
      expect(screen.getByRole("img", { name: "The Rookery on the map of the realm" })).toBeTruthy();
      const pin = container.querySelector<HTMLElement>(".fgd__map-pin")!;
      expect(pin.style.left).toBe("35%");
      expect(pin.style.top).toBe("84.3%");
    });

    it("shows no map for a place the map does not carry, even once found", () => {
      const e = guide.entries["class.thornguard"]!; // WORLD above has only the Rookery
      useGameStore.setState({ world: WORLD } as never);
      setFieldGuideDiscoveries({ [e.id]: find(), [e.class!.home]: find() });
      const { container } = render(<FieldGuideDetail guide={guide} entryId={e.id} />);
      expect(mapOf(container)).toBeNull();
    });

    it.each(["thornguard", "starweaver", "duskrunner", "songkeeper"] as const)("pins the %s's place on the real map once found, and not before", (cls) => {
      const e = guide.entries[`class.${cls}`]!;
      const slug = e.class!.home.split(".")[1]!;
      const real = JSON.parse(readFileSync(resolve(__dirname, "../../../../content/world.json"), "utf8")) as WorldMap;
      expect(real.places[slug]?.id).toBe(e.class!.home);
      useGameStore.setState({ world: real } as never);
      setFieldGuideDiscoveries({ [e.id]: find() });
      const before = render(<FieldGuideDetail guide={guide} entryId={e.id} />);
      expect(mapOf(before.container)).toBeNull();
      before.unmount();
      setFieldGuideDiscoveries({ [e.id]: find(), [e.class!.home]: find() });
      const after = render(<FieldGuideDetail guide={guide} entryId={e.id} />);
      expect(mapOf(after.container)).not.toBeNull();
    });

    it("shows no map while the map has not loaded", () => {
      const e = guide.entries["class.duskrunner"]!;
      useGameStore.setState({ world: null } as never);
      setFieldGuideDiscoveries({ [e.id]: find(), "location.rookery": find() });
      const { container } = render(<FieldGuideDetail guide={guide} entryId={e.id} />);
      expect(mapOf(container)).toBeNull();
    });
  });

  it("reads aloud the place only once it is found", () => {
    const e = guide.entries["class.songkeeper"]!;
    expect(spokenText(e, {})).toContain("Songkeeper");
    expect(spokenText(e, {})).toContain("Soothe");
    expect(spokenText(e, {})).not.toContain("Conservatory");
    expect(spokenText(e, { [e.class!.home]: find() })).toContain("Taught at The Conservatory");
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
    expect(screen.queryByRole("button", { name: /Back to the guide|Return to the guide/ })).toBeNull();
    act(() => { expect(runBackStep()).toBe(true); });
    expect(usePlayerNavigation.getState().guideEntry).toBeNull();
  });
});
