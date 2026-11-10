// @vitest-environment jsdom
/**
 * "This device", as a parent meets it: who the device plays as, one question
 * before anything happens, and no button at all where leaving would lose a hero.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeaveDevice } from "./LeaveDevice";

afterEach(cleanup);

const kept = { displayName: "Ada", kept: true, canLeave: true };

describe("LeaveDevice", () => {
  it("draws nothing for a device that is nobody", async () => {
    const load = vi.fn(async () => null);
    const { container } = render(<LeaveDevice load={load} leave={vi.fn()} onLeft={vi.fn()} />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("says who the device plays as, and asks before it does anything", async () => {
    const user = userEvent.setup();
    const leave = vi.fn(async () => {});
    const onLeft = vi.fn();
    render(<LeaveDevice load={async () => kept} leave={leave} onLeft={onLeft} />);

    expect(await screen.findByText("Ada")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Not Ada? Leave this device" }));

    // One tap is a question, never the act.
    expect(leave).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("heroes stay safe");
    expect(screen.getByRole("status").textContent).toContain("A grown-up signing in");

    await user.click(screen.getByRole("button", { name: "Yes, take Ada off this device" }));
    await waitFor(() => expect(onLeft).toHaveBeenCalledTimes(1));
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("lets a second thought win", async () => {
    const user = userEvent.setup();
    const leave = vi.fn(async () => {});
    render(<LeaveDevice load={async () => kept} leave={leave} onLeft={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Not Ada? Leave this device" }));
    await user.click(screen.getByRole("button", { name: "Not now" }));

    expect(leave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Not Ada? Leave this device" })).toBeTruthy();
  });

  it("promises only what is true where nobody has signed in: her other device brings her back", async () => {
    const user = userEvent.setup();
    render(<LeaveDevice load={async () => ({ displayName: "Ada", kept: false, canLeave: true })} leave={vi.fn()} onLeft={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Not Ada? Leave this device" }));
    const words = screen.getByRole("status").textContent ?? "";
    expect(words).toContain("Ada’s other device");
    expect(words).not.toContain("signing in");
  });

  it("offers no way to leave where it would lose her heroes, and says what to do first", async () => {
    render(<LeaveDevice load={async () => ({ displayName: "Ada", kept: false, canLeave: false })} leave={vi.fn()} onLeft={vi.fn()} />);

    expect(await screen.findByText(/only on this device/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stays put and says why when leaving fails", async () => {
    const user = userEvent.setup();
    const onLeft = vi.fn();
    const leave = vi.fn(async () => {
      throw new Error("We couldn’t reach the game. Try again?");
    });
    render(<LeaveDevice load={async () => kept} leave={leave} onLeft={onLeft} />);

    await user.click(await screen.findByRole("button", { name: "Not Ada? Leave this device" }));
    await user.click(screen.getByRole("button", { name: "Yes, take Ada off this device" }));

    expect((await screen.findByRole("alert")).textContent).toContain("couldn’t reach the game");
    expect(onLeft).not.toHaveBeenCalled();
    // Still asking, so trying again is one tap.
    expect(screen.getByRole("button", { name: "Yes, take Ada off this device" })).toBeTruthy();
  });
});
