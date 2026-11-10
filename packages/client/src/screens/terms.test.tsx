// @vitest-environment jsdom
/**
 * The terms of use (`/terms`): a quiet footer link beside the privacy policy,
 * a public page that needs no room, and words that say they are a draft and
 * promise nothing the game does not do.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { formatRoute, navigate, parseRoute } from "../router";
import { useKeepsakeStore } from "../store/keepsake";
import { HomeScreen } from "./HomeScreen";
import TermsScreen from "./TermsScreen";
import { PrivacyFooter } from "../ui/PrivacyFooter";
import { OPERATOR } from "./operator";
import { TERMS_LEDE, TERMS_SECTIONS } from "./terms-of-use";

const words = () =>
  [TERMS_LEDE, ...TERMS_SECTIONS.flatMap((s) => [s.title, ...(s.paragraphs ?? []), ...(s.bullets ?? [])])].join(" ");

beforeEach(() => {
  localStorage.clear();
  navigate("/", { replace: true });
  useKeepsakeStore.setState({ check: async () => undefined, step: "closed", account: null, shared: false });
});

afterEach(() => cleanup());

describe("the /terms route", () => {
  it("parses and formats, and needs no room", () => {
    expect(parseRoute("/terms")).toEqual({ name: "terms" });
    expect(parseRoute("/terms?x=1")).toEqual({ name: "terms" });
    expect(formatRoute({ name: "terms" })).toBe("/terms");
  });
});

describe("reaching it", () => {
  it("is a quiet footer link on the start screen, beside Privacy, in a tab of its own", () => {
    render(<HomeScreen />);
    const link = screen.getByRole("link", { name: /^terms$/i });
    expect(link.closest("footer.privacy-footer")).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/terms");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("stays in a compact footer and in the guide's own footer", () => {
    const { container, rerender } = render(<PrivacyFooter compact />);
    expect(container.querySelector('a[href="/terms"]')).not.toBeNull();
    rerender(<PrivacyFooter guide={false} />);
    expect(container.querySelector('a[href="/terms"]')).not.toBeNull();
  });
});

describe("what it says", () => {
  it("names the operator, every section and the date, and links the privacy page", () => {
    render(<TermsScreen />);
    expect(screen.getByRole("heading", { level: 1, name: /terms of use/i })).toBeTruthy();
    expect(screen.getByText(/last updated \d{4}-\d{2}-\d{2}/i)).toBeTruthy();
    expect(screen.getByText(new RegExp(OPERATOR.contact.replace(/[.]/g, "\\.")))).toBeTruthy();
    for (const section of TERMS_SECTIONS) expect(screen.getByRole("heading", { level: 2, name: section.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: /privacy page/i }).getAttribute("href")).toBe("/privacy");
  });

  it("asks for questions about the terms, not privacy questions, in its contact line", () => {
    render(<TermsScreen />);
    const who = screen.getByRole("heading", { level: 2, name: /who runs this/i }).parentElement!;
    expect(who.textContent).toMatch(/with questions about these terms\./);
    expect(who.textContent).not.toMatch(/privacy questions/);
  });

  it("says plainly that it has not been reviewed by a lawyer", () => {
    expect(TERMS_LEDE).toMatch(/not had these terms reviewed by a lawyer/);
  });

  it("puts a grown-up in charge, and asks for made-up names", () => {
    expect(words()).toMatch(/parent or guardian decides whether a child plays/);
    expect(words()).toMatch(/made-up names/);
  });

  it("promises nothing the game does not do: no purchases, no chat, no accounts for kids", () => {
    expect(words()).toMatch(/does not sell anything/);
    expect(words()).toMatch(/Kids play without accounts/);
    // There is no chat, so the rules never pretend to police one.
    expect(words().toLowerCase()).not.toMatch(/\bchat\b|\bmessag/);
    // Nothing real-money: no prices, subscriptions or refunds to describe.
    expect(words().toLowerCase()).not.toMatch(/\$|subscription|refund|credit card/);
  });

  it("does not claim to comply with any law", () => {
    expect(words()).not.toMatch(/\bCOPPA\b|\bcomplian/i);
  });
});
