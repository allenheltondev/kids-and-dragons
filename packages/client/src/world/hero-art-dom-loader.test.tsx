// @vitest-environment jsdom
/** The tinter would not load (a dropped connection on its chunk): a held image fails open to her painting. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { characterWorldArtUrl } from "./art-paths";

afterEach(() => {
  cleanup();
  vi.doUnmock("./hero-coat-cache");
  vi.resetModules();
});

describe("holdUntilTinted when the tinter's chunk fails to load", () => {
  it("shows her painting rather than staying hidden", async () => {
    vi.resetModules();
    vi.doMock("./hero-coat-cache", () => {
      throw new Error("chunk failed");
    });
    const { setCoatMaskPaintings } = await import("./coat-masks");
    const { HeroImage } = await import("./hero-art-dom");
    const painting = characterWorldArtUrl("unicorn", "fledgling");
    setCoatMaskPaintings([painting.slice("/assets/".length)]);
    const { container } = render(<HeroImage hero={{ species: "unicorn", tier: "fledgling", look: { coat: "unicorn_sky" } }} place="world" alt="" holdUntilTinted />);
    const img = container.querySelector("img")!;
    expect(img.style.opacity).toBe("0");
    await waitFor(() => expect(img.style.opacity).toBe("1"));
    expect(img.getAttribute("src")).toBe(painting);
  });
});
