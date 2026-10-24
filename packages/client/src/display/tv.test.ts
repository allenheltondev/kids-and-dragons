import { describe, expect, it } from "vitest";
import { isTvBrowser } from "./tv";

describe("spotting a television's own browser", () => {
  it("knows the sets a household is likely to host on", () => {
    // A 2024 Samsung (Tizen 8, Chromium 108), an LG, a Fire TV stick and a Chromecast.
    expect(isTvBrowser("Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/8.0 Chrome/108.0.0.0 TV Safari/537.36")).toBe(true);
    expect(isTvBrowser("Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/94.0.4606.31")).toBe(true);
    expect(isTvBrowser("Mozilla/5.0 (Linux; Android 9; AFTKA) AppleWebKit/537.36 Chrome/106.0.0.0 Safari/537.36")).toBe(true);
    expect(isTvBrowser("Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 Chrome/108.0.0.0 CrKey/1.56 Safari/537.36")).toBe(true);
  });

  it("leaves a laptop, a phone and a tablet alone", () => {
    expect(isTvBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15")).toBe(false);
    expect(isTvBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isTvBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36")).toBe(false);
    expect(isTvBrowser(undefined)).toBe(false);
  });
});
