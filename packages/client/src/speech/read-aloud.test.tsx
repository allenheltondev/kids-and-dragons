// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

class Utterance {
  rate = 1;
  lang = "";
  constructor(public text: string) {}
}

const spoken: string[] = [];
let cancels = 0;
const synth = {
  speak: (u: Utterance) => void spoken.push(u.text),
  cancel: () => void (cancels += 1),
  getVoices: () => [],
};

beforeEach(() => {
  spoken.length = 0;
  cancels = 0;
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  localStorage.clear();
  vi.resetModules();
});
afterEach(() => {
  cleanup();
  currentShared?.setSpeaker(null);
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "speechSynthesis");
});

// Modules are reset per test, so the seam is imported from the same graph as the code under test.
async function load() {
  const shared = await import("@kad/shared");
  currentShared = shared;
  return { ...(await import("./index")), ...shared };
}
let currentShared: typeof import("@kad/shared") | null = null;
const getSpeaker = () => currentShared!.getSpeaker();
const speak = (text: string) => currentShared!.speak(text);

describe("read-aloud switch", () => {
  it("is off by default: no speaker, speak() is silent", async () => {
    const { startReadAloud } = await load();
    startReadAloud();
    speak("Nothing.");
    expect(getSpeaker()).toBeNull();
    expect(spoken).toEqual([]);
  });

  it("turning it on installs the speaker, remembers it, and turning it off silences it", async () => {
    const { setReadAloud, READ_ALOUD_KEY } = await load();
    setReadAloud(true);
    await waitFor(() => expect(getSpeaker()).not.toBeNull());
    speak("Once upon a time.");
    expect(spoken).toEqual(["Once upon a time."]);
    expect(localStorage.getItem(READ_ALOUD_KEY)).toBe("1");
    setReadAloud(false);
    expect(getSpeaker()).toBeNull();
    expect(cancels).toBeGreaterThan(0);
    expect(localStorage.getItem(READ_ALOUD_KEY)).toBe("0");
    speak("Quiet now.");
    expect(spoken).toEqual(["Once upon a time."]);
  });

  it("comes back on after a reload when it was left on", async () => {
    localStorage.setItem("kad.readaloud", "1");
    const { startReadAloud } = await load();
    startReadAloud();
    await waitFor(() => expect(getSpeaker()).not.toBeNull());
  });

  it("does not install if switched off while the engine was loading", async () => {
    const { setReadAloud } = await load();
    setReadAloud(true);
    setReadAloud(false);
    await act(async () => { await Promise.resolve(); });
    await new Promise((r) => setTimeout(r, 20));
    expect(getSpeaker()).toBeNull();
  });

  it("hear() speaks on request even with the switch off, interrupting", async () => {
    const { hear } = await load();
    hear("Tap to hear me.");
    await waitFor(() => expect(spoken).toEqual(["Tap to hear me."]));
    expect(cancels).toBe(1);
    expect(getSpeaker()).toBeNull();
  });

  it("the control toggles and reflects the state; absent without SpeechSynthesis", async () => {
    const { ReadAloudControl } = await load();
    render(<ReadAloudControl />);
    const button = screen.getByRole("button", { name: "Turn read-aloud on" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { button.click(); });
    expect(screen.getByRole("button", { name: "Turn read-aloud off" }).getAttribute("aria-pressed")).toBe("true");
    cleanup();
    Reflect.deleteProperty(window, "speechSynthesis");
    vi.resetModules();
    const again = await load();
    const { container } = render(<again.ReadAloudControl />);
    expect(container.firstChild).toBeNull();
  });
});
