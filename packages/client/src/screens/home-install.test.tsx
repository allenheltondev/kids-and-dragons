// @vitest-environment jsdom
/**
 * Installing, on the home screen (#412): the quiet install card in a tab that
 * can install, and the installed app's first launch, which asks about a hero
 * left in Safari before anything here is anybody.
 *
 * jsdom is not Safari, and neither is Chromium: whether an iPhone's Home
 * Screen app really starts with storage of its own is device QA (#414).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useKeepsakeStore } from "../store/keepsake";
import { DEVICE_IDENTITY_KEY } from "../store/persistence";
import { FIRST_LAUNCH_KEY, INSTALL_HIDDEN_KEY } from "../install/remember";
import { navigate } from "../router";
import { HomeScreen } from "./HomeScreen";
import { AccountScreen } from "./AccountScreen";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";

const ASK = /played in safari before/i;
const INSTALL = /install kids & dragons/i;

function as(userAgent: string, standalone: boolean): void {
  Object.defineProperty(navigator, "userAgent", { value: userAgent, configurable: true });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: standalone && query === "(display-mode: standalone)", media: query }),
  });
}

beforeEach(() => {
  localStorage.clear();
  navigate("/", { replace: true });
  useKeepsakeStore.setState({ check: async () => undefined, step: "closed", account: null, shared: false });
});

afterEach(() => {
  cleanup();
});

describe("the installed app's first launch", () => {
  it("asks about a hero in Safari before anything can join, host or make anybody", () => {
    as(IPHONE_SAFARI, true);
    render(<HomeScreen />);
    expect(screen.getByRole("heading", { name: ASK })).toBeTruthy();
    expect(screen.getByRole("button", { name: /bring my hero over/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /start fresh/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /join a game/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /host a game/i })).toBeNull();
    // Asking made nobody.
    expect(localStorage.getItem(DEVICE_IDENTITY_KEY)).toBeNull();
  });

  it("starts fresh when asked, remembers it, and still makes nobody until a game", () => {
    as(IPHONE_SAFARI, true);
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole("button", { name: /start fresh/i }));
    expect(screen.queryByRole("heading", { name: ASK })).toBeNull();
    expect(screen.getByRole("button", { name: /join a game/i })).toBeTruthy();
    expect(localStorage.getItem(FIRST_LAUNCH_KEY)).toBe("fresh");
    expect(localStorage.getItem(DEVICE_IDENTITY_KEY)).toBeNull();
    // The app never offers to install itself.
    expect(screen.queryByRole("heading", { name: INSTALL })).toBeNull();

    cleanup();
    render(<HomeScreen />);
    expect(screen.queryByRole("heading", { name: ASK })).toBeNull();
  });

  it("sends a hero's family to bring it over, with the code panel open", () => {
    as(IPHONE_SAFARI, true);
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole("button", { name: /bring my hero over/i }));
    expect(window.location.pathname).toBe("/account");
    expect(window.location.search).toBe("?bring=1");
    expect(localStorage.getItem(DEVICE_IDENTITY_KEY)).toBeNull();
  });

  it("is not asked of an app that is already somebody", () => {
    as(IPHONE_SAFARI, true);
    localStorage.setItem(DEVICE_IDENTITY_KEY, JSON.stringify({ householdId: "hh_1", playerId: "p_1", deviceToken: "dev_1" }));
    render(<HomeScreen />);
    expect(screen.queryByRole("heading", { name: ASK })).toBeNull();
    expect(screen.getByRole("button", { name: /join a game/i })).toBeTruthy();
  });

  it("is not asked in a browser tab", () => {
    as(IPHONE_SAFARI, false);
    render(<HomeScreen />);
    expect(screen.queryByRole("heading", { name: ASK })).toBeNull();
  });
});

describe("the accounts page, opened to bring a hero over", () => {
  it("opens Bring my hero with words for the browser on this same phone", async () => {
    as(IPHONE_SAFARI, true);
    navigate("/account?bring=1", { replace: true });
    render(<AccountScreen />);
    expect(await screen.findByLabelText("Your code")).toBeTruthy();
    expect(screen.getByText(/in safari, open kids & dragons/i)).toBeTruthy();
    // Taken out of the address bar, like a pairing link.
    expect(window.location.search).toBe("");
  });
});

describe("the install card", () => {
  it("tells Safari on an iPhone how, and stays put away once put away", () => {
    as(IPHONE_SAFARI, false);
    render(<HomeScreen />);
    expect(screen.getByRole("heading", { name: INSTALL })).toBeTruthy();
    expect(screen.getByText(/add to home screen/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(screen.queryByRole("heading", { name: INSTALL })).toBeNull();
    expect(localStorage.getItem(INSTALL_HIDDEN_KEY)).toBe("1");

    cleanup();
    render(<HomeScreen />);
    expect(screen.queryByRole("heading", { name: INSTALL })).toBeNull();
  });

  it("says nothing in a browser that offered no way to install", () => {
    as(DESKTOP_FIREFOX, false);
    render(<HomeScreen />);
    expect(screen.queryByRole("heading", { name: INSTALL })).toBeNull();
  });

  it("is never drawn where a room's link landed for want of a session", () => {
    as(IPHONE_SAFARI, false);
    for (const path of ["/tv/ABCD", "/p/ABCD"]) {
      navigate(path, { replace: true });
      render(<HomeScreen />);
      expect(screen.getByRole("button", { name: /join a game/i }), path).toBeTruthy();
      expect(screen.queryByRole("heading", { name: INSTALL }), path).toBeNull();
      cleanup();
    }
  });

  it("steps aside while a grown-up is hosting", () => {
    as(IPHONE_SAFARI, false);
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole("button", { name: /host a game/i }));
    expect(screen.queryByRole("heading", { name: INSTALL })).toBeNull();
  });
});
