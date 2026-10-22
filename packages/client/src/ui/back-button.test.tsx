// @vitest-environment jsdom
/**
 * The global back button: top left, one page back wherever you are, and it
 * closes whatever is open on the page before it leaves the page.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { canGoBack, currentRoute, navigate } from "../router";
import { pushBackStep } from "../store/back-steps";
import { BackButton } from "./BackButton";

afterEach(() => {
  cleanup();
});

describe("the back button", () => {
  it("is not on the home screen, where there is nothing behind you", () => {
    act(() => navigate("/", { replace: true }));
    render(<BackButton />);
    expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
  });

  it("is on the book, the guide and the account page", () => {
    for (const path of ["/journal", "/guide", "/account"]) {
      act(() => navigate(path));
      const { unmount } = render(<BackButton />);
      expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();
      unmount();
    }
  });

  it("goes back to the page the app came from", async () => {
    act(() => navigate("/", { replace: true }));
    act(() => navigate("/journal"));
    expect(canGoBack()).toBe(true);
    render(<BackButton />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(() => expect(currentRoute().name).toBe("home"));
  });

  it("goes home when the visit began on this page, and never off to somewhere else", async () => {
    act(() => navigate("/journal", { replace: true }));
    // A page the app did not push: the first of the visit.
    history.replaceState(null, "", "/journal");
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(canGoBack()).toBe(false);
    render(<BackButton />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Go back" }));
    expect(currentRoute().name).toBe("home");
  });

  it("closes what is open on the page first, and only then leaves it", async () => {
    act(() => navigate("/", { replace: true }));
    act(() => navigate("/journal"));
    let open = true;
    const drop = pushBackStep(() => {
      if (!open) return false;
      open = false;
      return true;
    });
    render(<BackButton />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(open).toBe(false);
    expect(currentRoute().name).toBe("journal");
    await user.click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(() => expect(currentRoute().name).toBe("home"));
    drop();
  });

  it("in a game, appears only while something is open to step back out of", () => {
    act(() => navigate("/p/ABCD"));
    render(<BackButton />);
    expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
    let drop = (): void => undefined;
    act(() => { drop = pushBackStep(() => true); });
    expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();
    act(() => drop());
    expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
  });
});
