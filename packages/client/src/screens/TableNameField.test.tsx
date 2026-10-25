// @vitest-environment jsdom
/**
 * The optional table name, on both ways a TV is opened: the ordinary start
 * screen's field, and the family tablet's (SharedHome), which used to open the
 * TV without any way to set or change the name.
 */

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useGameStore } from "../store";
import { SharedHome } from "./SharedHome";
import { TableNameField } from "./TableNameField";

function Harness({ start = "" }: { start?: string }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <TableNameField value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("TableNameField", () => {
  it("is a quiet link until asked for, with no form showing", async () => {
    render(<Harness />);
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: /name your table \(optional\)/i }));
    expect(screen.getByRole("textbox", { name: /name your table/i })).toBeTruthy();
  });

  it("shows a name already given beside a change link, and opens to edit it", async () => {
    const user = userEvent.setup();
    render(<Harness start="Kitchen table" />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/Kitchen table\s*·/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "change" }));
    const field = screen.getByRole("textbox") as HTMLInputElement;
    expect(field.value).toBe("Kitchen table");
    await user.clear(field);
    await user.type(field, "Grandma's house");
    expect(screen.getByTestId("value").textContent).toBe("Grandma's house");
  });
});

describe("SharedHome: the family tablet as the TV", () => {
  const openOnThisScreen = vi.fn(async (_location?: string) => {});

  beforeEach(() => {
    openOnThisScreen.mockClear();
    useGameStore.setState({
      loadSharedPlayers: async () => [],
      openOnThisScreen,
      pendingCode: null,
    });
  });

  it("offers the name, and opens the TV with what was typed", async () => {
    const user = userEvent.setup();
    render(<SharedHome />);
    await user.click(await screen.findByRole("button", { name: /name your table \(optional\)/i }));
    await user.type(screen.getByRole("textbox", { name: /name your table/i }), "Kitchen table");
    await user.click(screen.getByRole("button", { name: /show the game on this screen/i }));
    await waitFor(() => expect(openOnThisScreen).toHaveBeenCalledWith("Kitchen table"));
  });

  it("starts from the name this tablet already remembers, and lets it be changed", async () => {
    localStorage.setItem("kad.location", "Grandma's house");
    const user = userEvent.setup();
    render(<SharedHome />);
    expect(await screen.findByText(/Grandma's house/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "change" }));
    const field = screen.getByRole("textbox") as HTMLInputElement;
    await user.clear(field);
    await user.type(field, "Kitchen table");
    await user.click(screen.getByRole("button", { name: /show the game on this screen/i }));
    await waitFor(() => expect(openOnThisScreen).toHaveBeenCalledWith("Kitchen table"));
  });

  it("opens with no name when it was never given one", async () => {
    const user = userEvent.setup();
    render(<SharedHome />);
    await user.click(await screen.findByRole("button", { name: /show the game on this screen/i }));
    await waitFor(() => expect(openOnThisScreen).toHaveBeenCalledWith(""));
  });
});
