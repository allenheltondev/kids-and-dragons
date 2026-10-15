// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PhoneMagic } from "./PhoneMagic";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("animates nested tap targets without delaying the action and replaces rapid feedback", () => {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  const action = vi.fn();
  render(<PhoneMagic enabled><button onClick={action}><span>Choose</span></button></PhoneMagic>);
  const button = screen.getByRole("button");
  Object.defineProperty(button, "animate", { value: animate });
  fireEvent.click(screen.getByText("Choose"));
  fireEvent.click(screen.getByText("Choose"));
  expect(action).toHaveBeenCalledTimes(2);
  expect(animate).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it.each(["TV", "reduced motion", "disabled"])("keeps %s interactions free of extra animation", (mode) => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: mode === "reduced motion" })));
  const animate = vi.fn();
  render(<PhoneMagic enabled={mode !== "TV"}><button aria-disabled={mode === "disabled"}>Choose</button></PhoneMagic>);
  const button = screen.getByRole("button");
  Object.defineProperty(button, "animate", { value: animate });
  fireEvent.click(button);
  expect(animate).not.toHaveBeenCalled();
});

it("keeps controls working when animation and vibration APIs are absent", () => {
  const action = vi.fn();
  render(<PhoneMagic enabled><button onClick={action}>Choose</button></PhoneMagic>);
  fireEvent.click(screen.getByRole("button"));
  expect(action).toHaveBeenCalledOnce();
});
