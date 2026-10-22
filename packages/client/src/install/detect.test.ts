import { describe, expect, it } from "vitest";
import {
  browserName,
  installCardVisible,
  installWay,
  isAppleTouch,
  isIosSafari,
  isStandalone,
  needsFirstLaunchChoice,
  type InstallEnv,
} from "./detect";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  // iPadOS asks for the desktop site, and says it is a Mac.
  ipadDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/126.2592.56 Mobile/15E148 Safari/605.1.15",
  iphoneInApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  desktopFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
};

const env = (userAgent: string, extra: Partial<InstallEnv> = {}): InstallEnv => ({ userAgent, ...extra });
const media = (standalone: boolean) => (query: string) => ({
  matches: standalone && query === "(display-mode: standalone)",
});

describe("standalone", () => {
  it("is the installed app's window, by display mode or by Safari's own flag", () => {
    expect(isStandalone(env(UA.androidChrome, { matchMedia: media(true) }))).toBe(true);
    expect(isStandalone(env(UA.iphoneSafari, { standalone: true }))).toBe(true);
  });

  it("is not a tab, nor a browser with nothing to ask", () => {
    expect(isStandalone(env(UA.androidChrome, { matchMedia: media(false) }))).toBe(false);
    expect(isStandalone(env(UA.iphoneSafari, { standalone: false, matchMedia: media(false) }))).toBe(false);
    expect(isStandalone(env(UA.desktopFirefox))).toBe(false);
    const broken = () => {
      throw new Error("no media queries here");
    };
    expect(isStandalone(env(UA.desktopFirefox, { matchMedia: broken }))).toBe(false);
  });
});

describe("which way to install", () => {
  it("is the browser's own Install wherever it offered one", () => {
    expect(installWay(env(UA.androidChrome), true)).toBe("prompt");
  });

  it("is Share, then Add to Home Screen, in Safari on an iPhone", () => {
    expect(isIosSafari(env(UA.iphoneSafari))).toBe(true);
    expect(installWay(env(UA.iphoneSafari), false)).toBe("ios-share");
  });

  it("knows an iPad by its touch screen, though it calls itself a Mac", () => {
    expect(isAppleTouch(env(UA.ipadDesktop, { maxTouchPoints: 5 }))).toBe(true);
    expect(installWay(env(UA.ipadDesktop, { maxTouchPoints: 5 }), false)).toBe("ios-share");
    // A real Mac: no touch, and no Add to Home Screen to point at.
    expect(isAppleTouch(env(UA.ipadDesktop, { maxTouchPoints: 0 }))).toBe(false);
    expect(installWay(env(UA.ipadDesktop, { maxTouchPoints: 0 }), false)).toBe("none");
  });

  it("says nothing for other browsers on an iPhone, whose menus are elsewhere", () => {
    for (const ua of [UA.iphoneChrome, UA.iphoneFirefox, UA.iphoneEdge, UA.iphoneInApp]) {
      expect(installWay(env(ua), false), ua).toBe("none");
    }
  });

  it("never promises a button a browser has not offered", () => {
    expect(installWay(env(UA.androidChrome), false)).toBe("none");
    expect(installWay(env(UA.desktopFirefox), false)).toBe("none");
  });
});

describe("the install card", () => {
  it("shows in a tab that can install, until it is put away", () => {
    expect(installCardVisible({ standalone: false, dismissed: false, way: "prompt" })).toBe(true);
    expect(installCardVisible({ standalone: false, dismissed: false, way: "ios-share" })).toBe(true);
    expect(installCardVisible({ standalone: false, dismissed: true, way: "prompt" })).toBe(false);
  });

  it("never shows in the installed app, nor where we have nothing true to say", () => {
    expect(installCardVisible({ standalone: true, dismissed: false, way: "ios-share" })).toBe(false);
    expect(installCardVisible({ standalone: false, dismissed: false, way: "none" })).toBe(false);
  });
});

describe("the installed app's first launch", () => {
  const empty = { standalone: true, hasIdentity: false, sharedDevice: false, answered: false };

  it("asks only in the app, with nothing in its storage yet", () => {
    expect(needsFirstLaunchChoice(empty)).toBe(true);
    expect(needsFirstLaunchChoice({ ...empty, standalone: false })).toBe(false);
  });

  it("never asks a device that is already somebody, or a family tablet", () => {
    expect(needsFirstLaunchChoice({ ...empty, hasIdentity: true })).toBe(false);
    expect(needsFirstLaunchChoice({ ...empty, sharedDevice: true })).toBe(false);
  });

  it("asks once: a fresh start is an answer", () => {
    expect(needsFirstLaunchChoice({ ...empty, answered: true })).toBe(false);
  });

  it("names Safari on an iPhone or iPad, and no browser in particular elsewhere", () => {
    expect(browserName(env(UA.iphoneSafari))).toBe("Safari");
    expect(browserName(env(UA.ipadDesktop, { maxTouchPoints: 5 }))).toBe("Safari");
    expect(browserName(env(UA.androidChrome))).toBe("your browser");
  });
});
