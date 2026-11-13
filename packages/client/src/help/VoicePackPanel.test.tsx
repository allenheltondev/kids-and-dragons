// @vitest-environment jsdom
/**
 * "Keep this chapter's voices" under Help (#547): offered when the chapter has recordings, shows
 * how far a keep has got, says so when they are kept, and draws nothing where there is nothing to keep.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chapter = vi.hoisted(() => ({ current: { id: "ch" } as { id: string } | null }));
const pack = vi.hoisted(() => ({
  loadVoicePack: vi.fn(),
  keptPaths: vi.fn(),
  keepVoices: vi.fn(),
}));
vi.mock("../store", () => ({ useChapter: () => chapter.current }));
vi.mock("../speech/voice-pack", () => pack);

import VoicePackPanel from "./VoicePackPanel";

const MB = 1024 * 1024;
const PATHS = ["/voice/aa/1.webm", "/voice/bb/2.webm", "/voice/cc/3.webm"];

beforeEach(() => {
  chapter.current = { id: "ch" };
  pack.loadVoicePack.mockResolvedValue({ paths: PATHS, bytes: 7 * MB });
  pack.keptPaths.mockResolvedValue(new Set());
  pack.keepVoices.mockResolvedValue("kept");
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the Keep this chapter's voices button", () => {
  it("offers to keep the chapter, and says how much it takes", async () => {
    render(<VoicePackPanel />);
    expect(await screen.findByRole("button", { name: "Keep this chapter's voices" })).toBeTruthy();
    expect(screen.getByText(/About 7 MB/)).toBeTruthy();
    expect(pack.loadVoicePack).toHaveBeenCalledWith("ch");
  });

  it("draws nothing for a chapter with no recordings, or with no chapter on screen", async () => {
    pack.loadVoicePack.mockResolvedValue(null);
    const none = render(<VoicePackPanel />);
    await waitFor(() => { expect(pack.loadVoicePack).toHaveBeenCalled(); });
    expect(none.container.textContent).toBe("");
    cleanup();
    chapter.current = null;
    pack.loadVoicePack.mockClear();
    const away = render(<VoicePackPanel />);
    expect(away.container.textContent).toBe("");
    expect(pack.loadVoicePack).not.toHaveBeenCalled();
  });

  it("shows how far a keep has got, then says the chapter is kept", async () => {
    let tell: (done: number, total: number) => void = () => undefined;
    let finish: (result: string) => void = () => undefined;
    pack.keepVoices.mockImplementation((_paths: string[], onProgress: typeof tell) => {
      tell = onProgress;
      return new Promise((resolve) => { finish = resolve; });
    });
    render(<VoicePackPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Keep this chapter's voices" }));
    tell(2, 3);
    expect(await screen.findByText(/Keeping voices… 2 of 3/)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("max")).toBe("3");
    finish("kept");
    expect(await screen.findByText(/voices are kept on this device/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep this chapter's voices" })).toBeNull();
  });

  it("says a chapter already kept is kept, with nothing to tap", async () => {
    pack.keptPaths.mockResolvedValue(new Set(PATHS));
    render(<VoicePackPanel />);
    expect(await screen.findByText(/voices are kept on this device/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says what went wrong and offers to try again", async () => {
    pack.keepVoices.mockResolvedValue("partial");
    pack.keptPaths.mockResolvedValue(new Set([PATHS[0]]));
    render(<VoicePackPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Keep this chapter's voices" }));
    expect(await screen.findByText(/Some voices could not be kept/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep this chapter's voices" })).toBeTruthy();

    pack.keepVoices.mockResolvedValue("unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Keep this chapter's voices" }));
    expect(await screen.findByText(/once the app has finished getting ready/)).toBeTruthy();
  });
});
