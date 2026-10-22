import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installPromptReady,
  listenForInstallPrompt,
  promptInstall,
  resetInstallPrompt,
  subscribeInstallPrompt,
} from "./prompt";
import { dismissInstallCard, firstLaunch, installCardDismissed, recordFirstLaunch, startFresh } from "./remember";
import type { InstallEnv } from "./detect";
import { DEVICE_IDENTITY_KEY, SHARED_DEVICE_KEY, type KeyValueStorage } from "../store/persistence";

function offer(outcome: "accepted" | "dismissed" = "accepted") {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome }),
  });
  return event;
}

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  resetInstallPrompt();
});

describe("Chromium's install offer", () => {
  it("is held back from the browser's own bar, and kept for the card", () => {
    const target = new EventTarget() as unknown as Window;
    stop = listenForInstallPrompt(target);
    const heard = vi.fn();
    const unsubscribe = subscribeInstallPrompt(heard);
    const event = offer();
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(installPromptReady()).toBe(true);
    expect(heard).toHaveBeenCalled();
    unsubscribe();
  });

  it("is shown once, and spent whatever the answer", async () => {
    const target = new EventTarget() as unknown as Window;
    stop = listenForInstallPrompt(target);
    const event = offer("dismissed");
    target.dispatchEvent(event);
    await expect(promptInstall()).resolves.toBe("dismissed");
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(installPromptReady()).toBe(false);
    await expect(promptInstall()).resolves.toBe("unavailable");
  });

  it("goes once the app is installed some other way", () => {
    const target = new EventTarget() as unknown as Window;
    stop = listenForInstallPrompt(target);
    target.dispatchEvent(offer());
    target.dispatchEvent(new Event("appinstalled"));
    expect(installPromptReady()).toBe(false);
  });

  it("ignores an event that is no offer", () => {
    const target = new EventTarget() as unknown as Window;
    stop = listenForInstallPrompt(target);
    target.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true }));
    expect(installPromptReady()).toBe(false);
  });
});

describe("what this device remembers", () => {
  function memory(): KeyValueStorage {
    const map = new Map<string, string>();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
    };
  }

  it("keeps a put-away card put away, and a fresh start answered", () => {
    const storage = memory();
    expect(installCardDismissed(storage)).toBe(false);
    expect(firstLaunch(storage)).toBeNull();
    dismissInstallCard(storage);
    startFresh(storage);
    expect(installCardDismissed(storage)).toBe(true);
    expect(firstLaunch(storage)).toBe("fresh");
  });

  const app: InstallEnv = { userAgent: "iPhone", standalone: true };

  it("records the app's first launch at boot, before anything is anybody", () => {
    const storage = memory();
    recordFirstLaunch(app, storage);
    expect(firstLaunch(storage)).toBe("pending");
    // A TV's room then mints an identity; the next boot keeps it pending.
    storage.setItem(DEVICE_IDENTITY_KEY, JSON.stringify({ householdId: "hh_1", playerId: "p_1", screenOnly: true }));
    recordFirstLaunch(app, storage);
    expect(firstLaunch(storage)).toBe("pending");
    startFresh(storage);
    recordFirstLaunch(app, storage);
    expect(firstLaunch(storage)).toBe("fresh");
  });

  it("records nothing in a tab, on a device already somebody, or on a family tablet", () => {
    const tab = memory();
    recordFirstLaunch({ userAgent: "iPhone", standalone: false }, tab);
    expect(firstLaunch(tab)).toBeNull();

    const played = memory();
    played.setItem(DEVICE_IDENTITY_KEY, JSON.stringify({ householdId: "hh_1", playerId: "p_1", deviceToken: "dev_1" }));
    recordFirstLaunch(app, played);
    expect(firstLaunch(played)).toBeNull();

    const tablet = memory();
    tablet.setItem(SHARED_DEVICE_KEY, JSON.stringify({ token: "sh_1", householdId: "hh_1" }));
    recordFirstLaunch(app, tablet);
    expect(firstLaunch(tablet)).toBeNull();
  });

  it("never throws where storage does", () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => undefined,
    };
    expect(() => dismissInstallCard(broken)).not.toThrow();
    expect(installCardDismissed(broken)).toBe(false);
  });
});
