/**
 * A display that is not a laptop (#264), against the real stack.
 *
 * Smart TVs and streaming sticks are where WebGL, the Wake
 * Lock API and unlocked audio go missing. CI's Chromium has all of them, so the
 * specs take them away before the page loads and check what the table still
 * gets: a chapter that plays from the lobby to its first check on still art
 * and a plain board, a sound prompt that appears only while sound is blocked,
 * and a report that says honestly what the screen can do.
 */

import { test, expect, type Browser, type Page } from "@playwright/test";
import { createCharacter } from "./characters";
import { openPlayerTask } from "./player-navigation";
import { roomState } from "./room-state";

const TAP = { timeout: 20_000 } as const;

/** Taken away before any page script runs, the way a TV browser never had them. */
function withoutModernApis(): void {
  const noContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]): RenderingContext | null {
    if (/webgl/i.test(kind)) return null;
    return original.call(this, kind as "2d", ...(rest as [])) as RenderingContext | null;
  };
  const original = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) => RenderingContext | null;
  HTMLCanvasElement.prototype.getContext = noContext as typeof HTMLCanvasElement.prototype.getContext;
  Reflect.deleteProperty(window, "WebAssembly");
  Object.defineProperty(navigator, "wakeLock", { value: undefined, configurable: true });
  Reflect.deleteProperty(window, "AudioContext");
  Reflect.deleteProperty(window, "webkitAudioContext");
}

/** A TV whose browser creates the audio context but holds it until `allowSound()`. */
function withBlockedSound(): void {
  const listeners = new Set<() => void>();
  let allowed = false;
  class BlockedContext {
    currentTime = 0;
    sampleRate = 48_000;
    destination = {};
    state: "suspended" | "running" = "suspended";
    addEventListener(_: string, fn: () => void): void { listeners.add(fn); }
    removeEventListener(_: string, fn: () => void): void { listeners.delete(fn); }
    createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {} }; }
    createBufferSource() { return { connect() {}, start() {}, stop() {}, loop: false, buffer: null }; }
    createOscillator() { return { type: "sine", frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    createBuffer() { return { getChannelData: () => new Float32Array(1) }; }
    decodeAudioData() { return Promise.reject(new Error("no decoder")); }
    resume(): Promise<void> {
      if (allowed) { this.state = "running"; for (const fn of listeners) fn(); }
      return Promise.resolve();
    }
    close(): Promise<void> { return Promise.resolve(); }
  }
  Object.defineProperty(window, "AudioContext", { value: BlockedContext, configurable: true });
  (window as unknown as { allowSound(): void }).allowSound = () => { allowed = true; };
}

test.describe("a display that is not a laptop", () => {
  const open: { close(): Promise<void> }[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function device(browser: Browser, width: number, height: number, init?: () => void): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height } });
    open.push(context);
    if (init) await context.addInitScript(init);
    return context.newPage();
  }

  async function openLobby(tv: Page): Promise<string> {
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/);
    return new URL(tv.url()).pathname.split("/").pop()!;
  }

  test("with no WebGL, wake lock or sound, a chapter still plays to its first check", async ({ browser }) => {
    test.setTimeout(240_000);
    const tv = await device(browser, 1280, 720, withoutModernApis);
    const tvErrors: string[] = [];
    tv.on("pageerror", (e) => tvErrors.push(e.message));
    const code = await openLobby(tv);

    const phone = await device(browser, 390, 844);
    await phone.goto("/");
    await phone.getByLabel(/room code/i).fill(code);
    await phone.getByRole("button", { name: /join a game/i }).click();
    await expect(phone).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    await createCharacter(phone, "unicorn", "Sparklehoof");

    // The still board stands in for the stage, with the hero on it.
    const board = tv.getByTestId("static-stage");
    await expect(board).toBeVisible(TAP);
    await expect(board.getByText("Sparklehoof")).toBeAttached(TAP);
    await expect(tv.locator(".kad-stage canvas")).toHaveCount(0);
    await expect(tv.getByRole("status").filter({ hasText: /something went wrong/i })).toBeVisible();

    await expect(phone.getByRole("button", { name: /wait, not yet/i })).toBeVisible();
    await phone.getByRole("button", { name: /begin the adventure/i }).click(TAP);

    // Whoever is asked, answers, until the first check comes up.
    let phase = "";
    for (let turn = 0; turn < 60 && phase !== "check"; turn++) {
      phase = (await roomState<{ phase: string }>(phone, code)).phase;
      if (phase === "check") break;
      await openPlayerTask(phone);
      const options = phone.locator(".prompt .choice");
      if ((await options.count()) > 0) {
        await options.first().click({ timeout: 5_000 }).catch(() => {});
        await phone.getByRole("button", { name: /do it!|yes, do that/i }).first().click({ timeout: 3_000 }).catch(() => {});
      }
      await phone.waitForTimeout(900);
    }
    expect(phase, "the chapter never reached a check").toBe("check");

    // The story is on the TV in words, over still art, and the check can be rolled.
    await expect(tv.locator(".narration__body")).toBeVisible(TAP);
    await expect(board).toBeVisible();
    await openPlayerTask(phone);
    await phone.getByRole("button", { name: /^roll/i }).first().click(TAP);
    await expect.poll(async () => (await roomState<{ phase: string }>(phone, code)).phase, { timeout: 30_000 }).not.toBe("check");

    // Nothing needed a thing the screen does not have, and nothing said otherwise.
    await tv.getByRole("button", { name: "About this screen" }).click();
    const rows = tv.locator("[data-capability]");
    await expect(rows).toHaveCount(4, TAP);
    for (const id of ["webgl", "wakeLock", "audio"]) {
      await expect(tv.locator(`[data-capability="${id}"]`)).toHaveAttribute("data-ok", "false");
    }
    // No sound is no prompt: a tap cannot mend a browser with no audio.
    await expect(tv.getByRole("button", { name: "Tap for sound" })).toHaveCount(0);
    expect(tvErrors).toEqual([]);
  });

  test("a TV that blocks sound is asked once, in plain words, and play never waits on it", async ({ browser }) => {
    const tv = await device(browser, 1280, 720, withBlockedSound);
    await openLobby(tv);
    const ask = tv.getByRole("button", { name: "Tap for sound" });
    await expect(ask).toHaveCount(1, TAP);
    // The rest of the screen is playable with the ask still up.
    await expect(tv.getByText(/room code/i).first()).toBeVisible();

    await tv.evaluate(() => (window as unknown as { allowSound(): void }).allowSound());
    await ask.click();
    await expect(ask).toHaveCount(0, TAP);
  });

  test("the report on a laptop's Chromium says what it proves", async ({ browser }) => {
    const tv = await device(browser, 1280, 720);
    await openLobby(tv);
    await tv.getByRole("button", { name: "About this screen" }).click();
    await expect(tv.locator('[data-capability="webgl"]')).toHaveAttribute("data-ok", /true|false/, TAP);
    await expect(tv.locator('[data-capability="serviceWorker"]')).toHaveCount(1);
  });
});
