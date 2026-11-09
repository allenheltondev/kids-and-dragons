// @vitest-environment jsdom
/**
 * Her look's editors and her name in the DOM (docs/hero-looks.md §7.2, §8;
 * #664): the table's compact editor sends `LOOK_EDIT` naming the revision;
 * the book's shelves edit on the tap itself with nothing said about saving;
 * only looks she holds are offered; and a hero with no look reads exactly as
 * before.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ClientIntent, HeroLookView } from "@kad/shared";
import { makeCharacter, makeMember } from "../testing/fixtures";
import { fakeUrls, pixelIO, servePainting } from "../testing/coat-fixture";
import { LOOKS } from "../world/hero-name";
import { setCoatMaskPaintings } from "../world/coat-masks";
import { characterPortraitArtUrl } from "../world/art-paths";
import { CoatCache, setHeroCoats } from "../world/hero-coat-cache";
import { slicedTintRunner, type TintJob } from "../world/hero-coat-pass";
import { PREVIEW_TINT_PX, heroPaintingUrl } from "../world/hero-art";
import { loadHeroCoats } from "../world/hero-coat-load";
import { BookLook, LookEditor } from "./LookEditor";
import { HeroName } from "./HeroName";

afterEach(cleanup);

const look = (over: Partial<HeroLookView> = {}): HeroLookView => ({ revision: 3, coat: null, accent: null, special: null, nameplate: null, title: null, unlocked: [], ...over });

describe("her name in the DOM", () => {
  it("is just her name when she has no look, exactly as before", () => {
    const { container } = render(<p><HeroName name="Pip" look={undefined} /></p>);
    expect(container.innerHTML).toBe("<p>Pip</p>");
  });

  it("puts her title under her name", () => {
    render(<p data-testid="name"><HeroName name="Pip" look={look({ title: "the_bold" })} /></p>);
    const name = screen.getByTestId("name");
    expect(name.querySelector(".hero-name__name")?.textContent).toBe("Pip");
    expect(name.querySelector(".hero-name__title")?.textContent).toBe("the Bold");
  });

  it("draws no frame, and asks for no painting, while a frame's art is not delivered", () => {
    const { container } = render(<HeroName name="Pip" look={look({ nameplate: "starry", title: "the_kind" })} />);
    expect(container.querySelector(".hero-name--framed")).toBeNull();
    expect(container.innerHTML).not.toContain("nameplates/");
  });
});

describe("the table's look editor (§8.2)", () => {
  it("sends LOOK_EDIT naming her look's revision, one tap one field", () => {
    const sent: ClientIntent[] = [];
    const member = makeMember({ character: makeCharacter({ id: "c_1", name: "Pip", look: look() }) });
    const { container } = render(<LookEditor member={member} held={false} dispatch={(i) => sent.push(i)} />);
    fireEvent.click(container.querySelector('[data-nameplate="leafy"]')!);
    fireEvent.click(container.querySelector('[data-title="the_curious"]')!);
    fireEvent.click(container.querySelector('[data-title=""]')!);
    expect(sent).toEqual([
      { type: "LOOK_EDIT", characterId: "c_1", revision: 3, nameplate: "leafy" },
      { type: "LOOK_EDIT", characterId: "c_1", revision: 3, title: "the_curious" },
      { type: "LOOK_EDIT", characterId: "c_1", revision: 3, title: null },
    ]);
  });

  it("names revision 0 for a hero with no look yet, and marks the plain plate and no title as hers", () => {
    const sent: ClientIntent[] = [];
    const member = makeMember({ character: makeCharacter({ id: "c_1", name: "Pip" }) });
    const { container } = render(<LookEditor member={member} held={false} dispatch={(i) => sent.push(i)} />);
    expect(container.querySelector('[data-nameplate="plain"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-title=""]')!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(container.querySelector('[data-title="the_bold"]')!);
    expect(sent).toEqual([{ type: "LOOK_EDIT", characterId: "c_1", revision: 0, title: "the_bold" }]);
  });

  it("offers only what she holds: the starters, and an earned one only once it is hers", () => {
    const member = makeMember({ character: makeCharacter({ name: "Pip", look: look() }) });
    const { container, rerender } = render(<LookEditor member={member} held={false} dispatch={() => undefined} />);
    const titles = [...container.querySelectorAll("[data-title]")].map((b) => b.getAttribute("data-title"));
    expect(titles).toEqual(["", "the_bold", "the_kind", "the_curious"]);
    expect([...container.querySelectorAll("[data-nameplate]")].map((b) => b.getAttribute("data-nameplate"))).toEqual(["plain", "ribbon", "leafy", "starry"]);
    expect(container.textContent).not.toContain("of the Gemfall");

    const earned = makeMember({ character: makeCharacter({ name: "Pip", look: look({ unlocked: ["of_the_gemfall"] }) }) });
    rerender(<LookEditor member={earned} held={false} dispatch={() => undefined} />);
    expect(container.querySelector('[data-title="of_the_gemfall"]')).not.toBeNull();
  });
});

describe("the book's Look page (§8.1)", () => {
  it("shows her name wearing the look up top, and edits on the tap with nothing said about saving", () => {
    const edits: unknown[] = [];
    const hero = makeCharacter({ name: "Moonbeam" });
    const { container } = render(<BookLook hero={hero} look={look({ title: "the_kind" })} edit={(c) => edits.push(c)} />);
    expect(screen.getByTestId("book-look-name").textContent).toBe("Moonbeamthe Kind");
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent);
    // her species' base paintings have masks (coatMasks.paintings), so her two colour shelves come first
    expect(tabs).toEqual(["Coat", "Mane", "Nameplate", "Title"]);
    fireEvent.click(screen.getByRole("tab", { name: "Nameplate" }));
    fireEvent.click(container.querySelector('[data-nameplate="ribbon"]')!);
    fireEvent.click(screen.getByRole("tab", { name: "Title" }));
    expect(container.querySelector('[data-title="the_kind"]')!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(container.querySelector('[data-title="the_bold"]')!);
    expect(edits).toEqual([{ nameplate: "ribbon" }, { title: "the_bold" }]);
    expect(container.textContent).not.toMatch(/saving|saved|synced|locked/i);
  });
});

describe("her colour shelves (#666, §8; two parts, owner 2026-11-07)", () => {
  const fledgling = (species: "unicorn" | "bigfoot") => [`characters/${species}/fledgling/assembled.png`];
  beforeEach(async () => {
    await loadHeroCoats();
    const files = new Map();
    for (const species of ["unicorn", "bigfoot"] as const) servePainting(files, `/assets/${fledgling(species)[0]!}`, "#E2CDEC", 16);
    setHeroCoats(new CoatCache({ runner: slicedTintRunner(pixelIO(files)), urls: fakeUrls() }));
  });
  afterEach(() => {
    setHeroCoats(null);
    setCoatMaskPaintings(null);
  });

  const starters = (species: string, part: "main" | "accent") =>
    LOOKS.coats.filter((c) => c.species.includes(species as "unicorn") && c.part === part && c.unlock.from === "starter").map((c) => c.id);

  it("are not offered while none of her paintings has a mask: every tile would look the same", () => {
    setCoatMaskPaintings([]);
    const member = makeMember({ character: makeCharacter({ name: "Pip", look: look() }) });
    const { container } = render(<LookEditor member={member} held={false} dispatch={() => undefined} />);
    expect(container.querySelector("[data-coat]")).toBeNull();
    expect(container.querySelector("[data-accent]")).toBeNull();
    cleanup();
    render(<BookLook hero={makeCharacter({ name: "Pip" })} look={look()} edit={() => undefined} />);
    expect(within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Nameplate", "Title"]);
  });

  it("at the table: two shelves named for her parts, her species' starters for each, one LOOK_EDIT a tap", async () => {
    setCoatMaskPaintings(fledgling("unicorn"));
    const sent: ClientIntent[] = [];
    const member = makeMember({ character: makeCharacter({ id: "c_1", name: "Pip", species: "unicorn", class: "songkeeper", look: look() }) });
    const { container } = render(<LookEditor member={member} held={false} dispatch={(i) => sent.push(i)} />);
    expect([...container.querySelectorAll("legend")].map((l) => l.textContent)).toEqual(["Coat", "Mane", "Nameplate", "Title"]);
    const coats = [...container.querySelectorAll("[data-coat]")].map((b) => b.getAttribute("data-coat"));
    expect(coats).toEqual(["", ...starters("unicorn", "main")]);
    const accents = [...container.querySelectorAll("[data-accent]")].map((b) => b.getAttribute("data-accent"));
    expect(accents).toEqual(["", ...starters("unicorn", "accent")]);
    expect(container.querySelector('[data-coat=""]')!.getAttribute("aria-pressed")).toBe("true");
    // Each tile is her hero, tinted once its pass is done; as painted stays as painted.
    await waitFor(() => {
      const srcs = [...container.querySelectorAll("[data-coat] img")].map((i) => i.getAttribute("src"));
      expect(srcs.filter((s) => s?.startsWith("blob:")).length).toBe(coats.length - 1);
    });
    fireEvent.click(container.querySelector('[data-coat="unicorn_sky"]')!);
    fireEvent.click(container.querySelector('[data-accent="unicorn_accent_rose"]')!);
    fireEvent.click(container.querySelector('[data-coat=""]')!);
    expect(sent).toEqual([
      { type: "LOOK_EDIT", characterId: "c_1", revision: 3, coat: "unicorn_sky" },
      { type: "LOOK_EDIT", characterId: "c_1", revision: 3, accent: "unicorn_accent_rose" },
      { type: "LOOK_EDIT", characterId: "c_1", revision: 3, coat: null },
    ]);
  });

  it("in the book: Fur and Skin for a Bigfoot, her hero up top wearing them, an edit on the tap", () => {
    setCoatMaskPaintings(fledgling("bigfoot"));
    const edits: unknown[] = [];
    const hero = makeCharacter({ name: "Thistle", species: "bigfoot", class: "thornguard" });
    const { container } = render(<BookLook hero={hero} look={look({ coat: "bigfoot_ginger", accent: "bigfoot_accent_tan" })} edit={(c) => edits.push(c)} />);
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Fur", "Skin", "Nameplate", "Title"]);
    fireEvent.click(screen.getByRole("tab", { name: "Fur" }));
    expect(container.querySelector('[data-coat="bigfoot_ginger"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-coat^="unicorn_"]')).toBeNull();
    expect(container.querySelector('[data-coat^="bigfoot_accent_"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-coat="bigfoot_honey"]')!);
    fireEvent.click(screen.getByRole("tab", { name: "Skin" }));
    expect(container.querySelector('[data-accent="bigfoot_accent_tan"]')!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(container.querySelector('[data-accent=""]')!);
    expect(edits).toEqual([{ coat: "bigfoot_honey" }, { accent: null }]);
    expect(container.textContent).not.toMatch(/saving|saved|synced|locked/i);
  });
});

describe("the Special shelf (§5.5, §8)", () => {
  afterEach(() => setCoatMaskPaintings(null));

  it("shows only once she has earned a special, and offers only those she holds", () => {
    setCoatMaskPaintings([]);
    const hero = makeCharacter({ name: "Pip", species: "unicorn" });
    const { container } = render(<BookLook hero={hero} look={look()} edit={() => undefined} />);
    expect(within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent)).not.toContain("Special");
    cleanup();
    const edits: unknown[] = [];
    const again = render(<BookLook hero={hero} look={look({ unlocked: ["aurora"] })} edit={(c) => edits.push(c)} />);
    expect(within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Special", "Nameplate", "Title"]);
    fireEvent.click(screen.getByRole("tab", { name: "Special" }));
    expect([...again.container.querySelectorAll("[data-special]")].map((b) => b.getAttribute("data-special"))).toEqual(["", "aurora"]);
    fireEvent.click(again.container.querySelector('[data-special="aurora"]')!);
    expect(edits).toEqual([{ special: "aurora" }]);
  });

  it("at the table, under her colours, a LOOK_EDIT naming it", () => {
    setCoatMaskPaintings([]);
    const sent: ClientIntent[] = [];
    const member = makeMember({ character: makeCharacter({ id: "c_1", name: "Pip", species: "unicorn", look: look({ unlocked: ["gold"] }) }) });
    const { container } = render(<LookEditor member={member} held={false} dispatch={(i) => sent.push(i)} />);
    expect([...container.querySelectorAll("legend")].map((l) => l.textContent)).toEqual(["Special", "Nameplate", "Title"]);
    fireEvent.click(container.querySelector('[data-special="gold"]')!);
    expect(sent).toEqual([{ type: "LOOK_EDIT", characterId: "c_1", revision: 3, special: "gold" }]);
  });
});

describe("a shelf's tiles appear together (one tint at a time would repaint them one by one)", () => {
  afterEach(() => {
    setHeroCoats(null);
    setCoatMaskPaintings(null);
  });

  it("waits for Aurora's figure on a gear portrait, so its sparkles are there the moment the tiles show", async () => {
    await loadHeroCoats();
    // A classed hero whose portrait is a gear portrait: opaque, so her sparkles are clipped by a figure the tinter makes.
    const found = (["thornguard", "duskrunner", "starweaver", "songkeeper"] as const)
      .flatMap((cls) => (["sworn", "radiant", "mythic"] as const).map((tier) => ({ cls, tier, portrait: characterPortraitArtUrl("unicorn", tier, cls) })))
      .find((p) => p.portrait.includes("gear-portraits/"));
    expect(found).toBeDefined();
    const { cls, tier, portrait } = found!;
    const files = new Map();
    servePainting(files, portrait, "#E2CDEC", 16);
    setCoatMaskPaintings([portrait.slice("/assets/".length)]);
    setHeroCoats(new CoatCache({ runner: slicedTintRunner(pixelIO(files, { delayMs: 5 })), urls: fakeUrls() }));

    // No colour chosen: the None and Aurora tiles have no colour to wait for, only Aurora's figure.
    const hero = makeCharacter({ name: "Pip", species: "unicorn", class: cls, tier });
    const { container } = render(<BookLook hero={hero} look={look({ unlocked: ["aurora"] })} edit={() => undefined} />);
    fireEvent.click(screen.getByRole("tab", { name: "Special" }));
    const art = (id: string) => container.querySelector(`[data-special="${id}"] .book-look__tile-art`)!;
    expect(art("aurora").classList.contains("look-art--pending")).toBe(true);
    expect(art("").classList.contains("look-art--pending")).toBe(true);

    await waitFor(() => expect(art("aurora").classList.contains("look-art--pending")).toBe(false));
    expect(art("").classList.contains("look-art--pending")).toBe(false);
    const stars = art("aurora").querySelector<HTMLElement>(".hero-sparkle");
    expect(stars?.dataset["sparkleClip"]).toMatch(/^blob:/);
  });
});

describe("a shelf whose colours cannot be made", () => {
  afterEach(() => {
    setHeroCoats(null);
    setCoatMaskPaintings(null);
  });

  it("still shows its tiles, each her portrait as painted, rather than waiting for good", async () => {
    await loadHeroCoats();
    const hero = makeCharacter({ name: "Pip", look: look() });
    const portrait = characterPortraitArtUrl(hero.species, hero.tier, hero.class);
    setCoatMaskPaintings([portrait.slice("/assets/".length)]);
    setHeroCoats(new CoatCache({ runner: () => Promise.reject(new Error("no mask")), urls: fakeUrls() }));
    const member = makeMember({ character: hero });
    const { container } = render(<LookEditor member={member} held={false} dispatch={() => undefined} />);
    const arts = () => [...container.querySelectorAll("[data-coat] .look-option__art")];
    expect(arts().length).toBeGreaterThan(1);
    await waitFor(() => expect(arts().every((a) => !a.classList.contains("look-art--pending"))).toBe(true));
    const srcs = [...container.querySelectorAll("[data-coat] img")].map((i) => i.getAttribute("src"));
    expect(srcs.every((src) => src === portrait)).toBe(true);
  });
});

describe("a quick shelf, and a figure that keeps her colour (docs/hero-looks.md §5.3)", () => {
  afterEach(() => {
    setHeroCoats(null);
    setCoatMaskPaintings(null);
  });

  /** Her painting in both places served and masked, and every pass counted. */
  async function serving(hero: ReturnType<typeof makeCharacter>): Promise<{ jobs: TintJob[]; world: string }> {
    await loadHeroCoats();
    const world = heroPaintingUrl(hero, "world");
    const portrait = heroPaintingUrl(hero, "portrait");
    const files = new Map();
    for (const url of new Set([world, portrait])) servePainting(files, url, "#E2CDEC", 16);
    setCoatMaskPaintings([...new Set([world, portrait])].map((u) => u.slice("/assets/".length)));
    const jobs: TintJob[] = [];
    const run = slicedTintRunner(pixelIO(files));
    setHeroCoats(new CoatCache({ runner: (job, signal) => (jobs.push(job), run(job, signal)), urls: fakeUrls() }));
    return { jobs, world };
  }

  it("tints a shelf's tiles at preview size, one pass a tile: the shelf and its tiles ask for the same", async () => {
    const hero = makeCharacter({ name: "Pip", look: look() });
    const { jobs } = await serving(hero);
    const { container } = render(<LookEditor member={makeMember({ character: hero })} held={false} dispatch={() => undefined} />);
    const arts = () => [...container.querySelectorAll("[data-coat] .look-option__art, [data-accent] .look-option__art")];
    await waitFor(() => expect(arts().every((a) => !a.classList.contains("look-art--pending"))).toBe(true));
    expect(jobs.length).toBeGreaterThan(1);
    expect(jobs.every((j) => j.size === PREVIEW_TINT_PX)).toBe(true);
    const keys = jobs.map((j) => `${j.painting}|${JSON.stringify(j.paint)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps her last colour on the figure while the next is made, never her painting between", async () => {
    const hero = makeCharacter({ name: "Pip", species: "unicorn" });
    const { world } = await serving(hero);
    const mains = LOOKS.coats.filter((c) => c.species.includes("unicorn") && c.part === "main" && c.unlock.from === "starter").map((c) => c.id);
    const figure = () => screen.getByTestId("book-look-figure");
    const view = render(<BookLook hero={hero} look={look({ coat: mains[0]! })} edit={() => undefined} />);
    await waitFor(() => expect(figure().getAttribute("src")).toMatch(/^blob:/));
    const first = figure().getAttribute("src");
    const stage = figure().parentElement;

    view.rerender(<BookLook hero={hero} look={look({ coat: mains[1]! })} edit={() => undefined} />);
    // The same stage and figure, still wearing the first colour: not her painting, not hidden.
    expect(figure().parentElement).toBe(stage);
    expect(figure().getAttribute("src")).toBe(first);
    expect(figure().getAttribute("src")).not.toBe(world);
    expect(figure().getAttribute("data-tint-hold")).toBe("shown");
    await waitFor(() => expect(figure().getAttribute("src")).not.toBe(first));
    expect(figure().getAttribute("src")).toMatch(/^blob:/);
  });
});
