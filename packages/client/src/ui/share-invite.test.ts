import { describe, expect, it, vi } from "vitest";
import { chooseShareMethod, inviteData, inviteText, joinUrl, shareInvite } from "./share-invite";

const url = "https://play.example/p/ABCD";
const data = inviteData(url);

describe("share invite", () => {
  it("builds the join link and the words", () => {
    expect(joinUrl("ABCD", "https://play.example")).toBe(url);
    expect(inviteText(url)).toBe(`Join our Kids & Dragons game: ${url}`);
    expect(data).toEqual({ title: "Kids & Dragons", text: inviteText(url), url });
  });

  it("prefers share, then copy, then show", () => {
    const share = vi.fn();
    const writeText = vi.fn();
    expect(chooseShareMethod({ share, clipboard: { writeText } }, data)).toBe("share");
    expect(chooseShareMethod({ share, canShare: () => true }, data)).toBe("share");
    expect(chooseShareMethod({ share, canShare: () => false, clipboard: { writeText } }, data)).toBe("copy");
    expect(chooseShareMethod({ clipboard: { writeText } }, data)).toBe("copy");
    expect(chooseShareMethod({}, data)).toBe("show");
    expect(chooseShareMethod({ canShare: () => true, clipboard: {} }, data)).toBe("show");
  });

  it("shares the data, copies the bare url, and falls through on failure", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareInvite({ share }, data)).toBe("shared");
    expect(share).toHaveBeenCalledWith(data);

    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareInvite({ clipboard: { writeText } }, data)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(url);

    const abort = Object.assign(new Error("closed"), { name: "AbortError" });
    expect(await shareInvite({ share: vi.fn().mockRejectedValue(abort), clipboard: { writeText } }, data)).toBe("cancelled");
    expect(await shareInvite({ share: vi.fn().mockRejectedValue(new Error("no")), clipboard: { writeText } }, data)).toBe("copied");
    expect(await shareInvite({ share: vi.fn().mockRejectedValue(new Error("no")) }, data)).toBe("shown");
    expect(await shareInvite({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } }, data)).toBe("shown");
    expect(await shareInvite({}, data)).toBe("shown");
  });
});
