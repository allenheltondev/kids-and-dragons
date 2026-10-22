import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installPromptReady,
  listenForInstallPrompt,
  promptInstall,
  resetInstallPrompt,
  subscribeInstallPrompt,
} from "./prompt";
import { dismissInstallCard, firstLaunchAnswered, installCardDismissed, startFresh } from "./remember";
import type { KeyValueStorage } from "../store/persistence";

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
    expect(firstLaunchAnswered(storage)).toBe(false);
    dismissInstallCard(storage);
    startFresh(storage);
    expect(installCardDismissed(storage)).toBe(true);
    expect(firstLaunchAnswered(storage)).toBe(true);
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
