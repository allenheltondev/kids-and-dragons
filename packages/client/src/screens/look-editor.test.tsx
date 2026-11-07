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
import { CoatCache, setHeroCoats } from "../world/hero-coat-cache";
import { slicedTintRunner } from "../world/hero-coat-pass";
import { loadHeroCoats } from "../world/hero-coat-load";
import { BookLook, LookEditor } from "./LookEditor";
import { HeroName } from "./HeroName";

afterEach(cleanup);

const look = (over: Partial<HeroLookView> = {}): HeroLookView => ({ revision: 3, coat: null, nameplate: null, title: null, unlocked: [], ...over });

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
    expect(tabs).toEqual(["Nameplate", "Title"]);
    fireEvent.click(container.querySelector('[data-nameplate="ribbon"]')!);
    fireEvent.click(screen.getByRole("tab", { name: "Title" }));
    expect(container.querySelector('[data-title="the_kind"]')!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(container.querySelector('[data-title="the_bold"]')!);
    expect(edits).toEqual([{ nameplate: "ribbon" }, { title: "the_bold" }]);
    expect(container.textContent).not.toMatch(/saving|saved|synced|locked/i);
  });
});

describe("the Color shelf (#666, §8)", () => {
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

  it("is not offered while none of her paintings has a mask: every tile would look the same", () => {
    setCoatMaskPaintings([]);
    const member = makeMember({ character: makeCharacter({ name: "Pip", look: look() }) });
    const { container } = render(<LookEditor member={member} held={false} dispatch={() => undefined} />);
    expect(container.querySelector("[data-coat]")).toBeNull();
    cleanup();
    render(<BookLook hero={makeCharacter({ name: "Pip" })} look={look()} edit={() => undefined} />);
    expect(within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Nameplate", "Title"]);
  });

  it("at the table: her species' starter colours and as painted, each tile her hero wearing it, one LOOK_EDIT a tap", async () => {
    setCoatMaskPaintings(fledgling("unicorn"));
    const sent: ClientIntent[] = [];
    const member = makeMember({ character: makeCharacter({ id: "c_1", name: "Pip", species: "unicorn", class: "songkeeper", look: look() }) });
    const { container } = render(<LookEditor member={member} held={false} dispatch={(i) => sent.push(i)} />);
    const coats = [...container.querySelectorAll("[data-coat]")].map((b) => b.getAttribute("data-coat"));
    expect(coats).toEqual(["", ...LOOKS.coats.filter((c) => c.species.includes("unicorn") && c.unlock.from === "starter").map((c) => c.id)]);
    expect(container.querySelector('[data-coat=""]')!.getAttribute("aria-pressed")).toBe("true");
    // Each tile is her hero, tinted once its pass is done; as painted stays as painted.
    await waitFor(() => {
      const srcs = [...container.querySelectorAll("[data-coat] img")].map((i) => i.getAttribute("src"));
      expect(srcs.filter((s) => s?.startsWith("blob:")).length).toBe(coats.length - 1);
    });
    fireEvent.click(container.querySelector('[data-coat="unicorn_sky"]')!);
    fireEvent.click(container.querySelector('[data-coat=""]')!);
    expect(sent).toEqual([
      { type: "LOOK_EDIT", characterId: "c_1", revision: 3, coat: "unicorn_sky" },
      { type: "LOOK_EDIT", characterId: "c_1", revision: 3, coat: null },
    ]);
  });

  it("in the book: Color first, her hero up top wearing it, an edit on the tap", () => {
    setCoatMaskPaintings(fledgling("bigfoot"));
    const edits: unknown[] = [];
    const hero = makeCharacter({ name: "Thistle", species: "bigfoot", class: "thornguard" });
    const { container } = render(<BookLook hero={hero} look={look({ coat: "bigfoot_ginger" })} edit={(c) => edits.push(c)} />);
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Color", "Nameplate", "Title"]);
    fireEvent.click(screen.getByRole("tab", { name: "Color" }));
    expect(container.querySelector('[data-coat="bigfoot_ginger"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-coat^="unicorn_"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-coat="bigfoot_honey"]')!);
    expect(edits).toEqual([{ coat: "bigfoot_honey" }]);
    expect(container.textContent).not.toMatch(/saving|saved|synced|locked/i);
  });
});
