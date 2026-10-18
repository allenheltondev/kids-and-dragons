import { describe, expect, it } from "vitest";
import { lastUsed, tabletName } from "./tablet-label";

const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

describe("tablet labels", () => {
  it("names a tablet from its user agent", () => {
    expect(tabletName(IPAD)).toBe("iPad");
    expect(tabletName("Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe(
      "Android tablet",
    );
    expect(tabletName("Mozilla/5.0 (Linux; Android 13; Pixel 7) Chrome/120 Mobile Safari/537.36")).toBe("Android phone");
    expect(tabletName(undefined)).toBe("Tablet");
  });

  it("says when it was last used", () => {
    const now = new Date(2026, 9, 18, 15, 0).getTime(); // a Sunday afternoon
    expect(lastUsed(new Date(2026, 9, 18, 8, 0).toISOString(), now)).toBe("today");
    expect(lastUsed(new Date(2026, 9, 17, 22, 0).toISOString(), now)).toBe("yesterday");
    expect(lastUsed(new Date(2026, 9, 13, 10, 0).toISOString(), now)).toBe("Tuesday");
    expect(lastUsed(new Date(2026, 8, 1, 10, 0).toISOString(), now)).toBe("Sep 1");
    expect(lastUsed("garbage", now)).toBe("a while ago");
  });
});
