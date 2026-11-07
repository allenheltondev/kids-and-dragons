// @vitest-environment jsdom
/**
 * Her look's editors and her name in the DOM (docs/hero-looks.md §7.2, §8;
 * #664): the table's compact editor sends `LOOK_EDIT` naming the revision;
 * the book's shelves edit on the tap itself with nothing said about saving;
 * only looks she holds are offered; and a hero with no look reads exactly as
 * before.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ClientIntent, HeroLookView } from "@kad/shared";
import { makeCharacter, makeMember } from "../testing/fixtures";
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
