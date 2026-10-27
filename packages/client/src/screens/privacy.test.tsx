// @vitest-environment jsdom
/**
 * The privacy policy (#523): reachable before anybody joins or hosts, honest
 * about what is collected, and never again saying what was wrong about it.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useKeepsakeStore } from "../store/keepsake";
import { navigate, parseRoute, formatRoute } from "../router";
import { HomeScreen } from "./HomeScreen";
import PrivacyScreen, { OperatorLines } from "./PrivacyScreen";
import { PRIVACY_LEDE, PRIVACY_SECTIONS } from "./privacy-policy";
import { DELETING, ELSEWHERE, STORED } from "./what-we-store";

const SRC = path.resolve(import.meta.dirname, "..");

/** Everything a grown-up can read about what the game keeps, as one string. */
function allWords(): string {
  const policy = [PRIVACY_LEDE, ...PRIVACY_SECTIONS.flatMap((s) => [s.title, ...(s.paragraphs ?? []), ...(s.bullets ?? [])])];
  const stored = [...STORED.flatMap((s) => [s.what, s.kept, ...Object.values(s.fields ?? {})]), ...ELSEWHERE.map((e) => e.what), ...DELETING];
  const screens = ["WhatWeStore.tsx", "SignInFlow.tsx"].map((f) => readFileSync(path.join(SRC, "screens", f), "utf8"));
  return [...policy, ...stored, ...screens].join("\n").replace(/\s+/g, " ");
}

beforeEach(() => {
  localStorage.clear();
  navigate("/", { replace: true });
  useKeepsakeStore.setState({ check: async () => undefined, step: "closed", account: null, shared: false });
});

afterEach(() => cleanup());

describe("the /privacy route", () => {
  it("parses and formats, and needs no room", () => {
    expect(parseRoute("/privacy")).toEqual({ name: "privacy" });
    expect(parseRoute("/privacy?x=1")).toEqual({ name: "privacy" });
    expect(formatRoute({ name: "privacy" })).toBe("/privacy");
  });
});

describe("reaching it", () => {
  it("is a link on the start screen, before anyone joins or hosts", () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole("button", { name: /privacy: what we collect/i }));
    expect(window.location.pathname).toBe("/privacy");
  });
});

describe("what it says", () => {
  it("names the operator, or says plainly that nobody is named yet", () => {
    const { unmount } = render(<OperatorLines name="" contact="" />);
    expect(screen.getByText(/have not been published yet/i)).toBeTruthy();
    unmount();
    render(<OperatorLines name="Example Co" contact="privacy@example.test" />);
    expect(screen.getByRole("link", { name: "privacy@example.test" }).getAttribute("href")).toBe("mailto:privacy@example.test");
  });

  it("renders every section, with its title", () => {
    render(<PrivacyScreen />);
    for (const section of PRIVACY_SECTIONS) {
      expect(screen.getByRole("heading", { name: section.title })).toBeTruthy();
    }
    expect(screen.getByRole("heading", { name: "Who runs this" })).toBeTruthy();
  });

  it("covers what #523 asks of it", () => {
    const titles = PRIVACY_SECTIONS.map((s) => s.id);
    for (const id of ["what-kids-give", "what-grown-ups-give", "automatic", "who-else", "how-long", "your-choices", "consent"]) {
      expect(titles).toContain(id);
    }
  });
});

describe("what it must never claim again", () => {
  const FALSE_CLAIMS: readonly [RegExp, string][] = [
    [/never type anything personal/i, "kids do type a nickname and a hero name"],
    [/only live on this phone/i, "the game keeps them on its servers"],
    [/compl(y|ies|iant|iance)/i, "no claim of legal compliance before it is verified"],
    [/\bCOPPA\b/, "no claim about COPPA before counsel has looked"],
    [/never (stored|kept|collected)/i, "absolute claims about storage"],
    [/stay for good/i, "kept households have no promise of forever"],
    [/always (offline|on the device)/i, "browser speech is not verified offline"],
  ];

  it.each(FALSE_CLAIMS)("%s (%s)", (pattern) => {
    expect(allWords()).not.toMatch(pattern);
  });

  it("does not deny analytics outright while it measures chapter durations itself", () => {
    const text = allWords();
    // Every mention of analytics or trackers is limited to third parties or advertising.
    for (const sentence of text.split(/(?<=[.!?])\s+/).filter((t) => /analytics|trackers?\b/i.test(t))) {
      expect(sentence, sentence).toMatch(/third-party|advertising/i);
    }
    // And the first-party measuring it does is described, with how long it is kept.
    const automatic = PRIVACY_SECTIONS.find((s) => s.id === "automatic")!.bullets!.join(" ");
    expect(automatic).toMatch(/how long chapters take/i);
    expect(automatic).toMatch(/add these up/i);
    expect(automatic).toMatch(/180 days/);
    const why = PRIVACY_SECTIONS.find((s) => s.id === "why")!.paragraphs!.join(" ");
    expect(why).toMatch(/our own, of how long chapters take/i);
  });

  it("says the nickname filter checks bad words, not personal details", () => {
    expect(allWords()).toMatch(/not for personal details/i);
  });

  it("says the parent email is held twice, as the server's owner rows do", () => {
    const grownUps = STORED.find((s) => s.entities.includes("owner"))!;
    expect(grownUps.what).toMatch(/two places/i);
    expect(grownUps.what).toMatch(/Cognito/);
  });

  it("does not promise a retention limit that is not enforced", () => {
    const howLong = PRIVACY_SECTIONS.find((s) => s.id === "how-long")!;
    expect(howLong.bullets!.join(" ")).toMatch(/no automatic end today/i);
    expect(howLong.bullets!.join(" ")).toMatch(/no warning before a household is deleted/i);
  });
});
