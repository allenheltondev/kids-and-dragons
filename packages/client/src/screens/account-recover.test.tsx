// @vitest-environment jsdom
/**
 * "Heroes missing from this phone?" on `/account`: the playtest report where an
 * expired device token made a signed-in phone a new player, and its heroes were
 * gone. The button is the way back, so it must always be there to press and
 * must start the sign-in that ends in a picker of the account's kids.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useKeepsakeStore } from "../store/keepsake";
import { AccountScreen } from "./AccountScreen";

const initial = useKeepsakeStore.getState();

beforeEach(() => {
  // `check` would ask the network whether sign-in exists; here it does.
  useKeepsakeStore.setState({ available: true, check: async () => {}, open: vi.fn(), shared: false });
});

afterEach(() => {
  cleanup();
  useKeepsakeStore.setState(initial, true);
});

describe("the recover button", () => {
  it("opens sign-in to pick this phone's hero again, from the home entry", async () => {
    const user = userEvent.setup();
    render(<AccountScreen />);

    await user.click(await screen.findByRole("button", { name: "Get my heroes back" }));

    expect(useKeepsakeStore.getState().open).toHaveBeenCalledWith("recover", "home");
  });

  it("is there even while the phone still says it is signed in", async () => {
    useKeepsakeStore.setState({
      account: { householdId: "h_home", email: "grown@up.test", claimedAt: "2026-10-12T00:00:00.000Z" },
    });
    render(<AccountScreen />);

    expect(await screen.findByRole("button", { name: "Get my heroes back" })).toBeTruthy();
  });

  it("is not drawn where this deployment cannot sign anybody in", async () => {
    useKeepsakeStore.setState({ available: false });
    render(<AccountScreen />);

    await screen.findByText("Accounts and devices");
    expect(screen.queryByRole("button", { name: "Get my heroes back" })).toBeNull();
  });
});
