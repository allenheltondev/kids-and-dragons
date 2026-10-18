import { describe, expect, it, vi } from "vitest";
import { moveCodeIn, takeMoveLink, type MoveLinkDeps } from "./move-link";

function deps(href: string, load: MoveLinkDeps["load"]) {
  const location = { href };
  const replaceUrl = vi.fn((next: string) => {
    location.href = new URL(next, href).href;
  });
  return { location, replaceUrl, load, wait: vi.fn(async () => undefined) };
}

describe("a scanned move link (#251)", () => {
  it("reads the code as the organizer panel types it", () => {
    expect(moveCodeIn("https://x/?move=ab-cd12ef")).toBe("ABCDEF");
    expect(moveCodeIn("https://x/?move=123")).toBeNull();
    expect(moveCodeIn("https://x/")).toBeNull();
  });

  it("records the code first, then takes the link off the URL", async () => {
    const setPendingMove = vi.fn();
    const d = deps("https://x/?move=abcdef&pair=1#top", async () => ({ setPendingMove }));
    await expect(takeMoveLink(d)).resolves.toBe("ABCDEF");
    expect(setPendingMove).toHaveBeenCalledWith("ABCDEF");
    expect(d.replaceUrl).toHaveBeenCalledWith("/?pair=1#top");
  });

  it("tries the chunk again when it fails to load, and keeps the link until it does", async () => {
    const setPendingMove = vi.fn();
    const load = vi
      .fn<MoveLinkDeps["load"]>()
      .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"))
      .mockResolvedValueOnce({ setPendingMove });
    const d = deps("https://x/?move=abcdef", load);
    await expect(takeMoveLink(d)).resolves.toBe("ABCDEF");
    expect(load).toHaveBeenCalledTimes(2);
    expect(d.wait).toHaveBeenCalledTimes(1);
    expect(d.location.href).toBe("https://x/");
  });

  it("leaves the link where a refresh will find it when the chunk never loads", async () => {
    const load = vi.fn<MoveLinkDeps["load"]>(async () => {
      throw new Error("offline");
    });
    const d = deps("https://x/?move=abcdef", load);
    await expect(takeMoveLink(d, 3)).resolves.toBeNull();
    expect(load).toHaveBeenCalledTimes(3);
    expect(d.replaceUrl).not.toHaveBeenCalled();
    expect(d.location.href).toBe("https://x/?move=abcdef");
  });
});
