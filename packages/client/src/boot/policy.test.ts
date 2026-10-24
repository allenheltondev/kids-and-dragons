import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { markBooted } from "./booted";
import {
  BOOT_ATTEMPTS_KEY,
  BOOT_GIVE_UP_MESSAGE,
  BOOT_GLOBAL,
  BOOT_HEALS_KEY,
  BOOT_TIMEOUT_MS,
  GIVE_UP_AT_ATTEMPT,
  HEAL_AT_ATTEMPT,
  stepAfterFailure,
} from "./policy";

describe("stepAfterFailure", () => {
  it("retries once, heals on the second failure, then gives up", () => {
    expect(stepAfterFailure(1)).toBe("retry");
    expect(stepAfterFailure(2)).toBe("heal");
    expect(stepAfterFailure(3)).toBe("give-up");
  });
  it("never loops on odd input", () => {
    expect(stepAfterFailure(99)).toBe("give-up");
    expect(stepAfterFailure(Number.NaN)).toBe("give-up");
  });
  it("heals before it gives up", () => {
    expect(HEAL_AT_ATTEMPT).toBeLessThan(GIVE_UP_AT_ATTEMPT);
  });
});

describe("markBooted", () => {
  it("calls the watchdog and tolerates its absence or a throw", () => {
    let calls = 0;
    markBooted({ [BOOT_GLOBAL]: { booted: () => (calls += 1) } });
    expect(calls).toBe(1);
    expect(() => markBooted({})).not.toThrow();
    expect(() =>
      markBooted({
        [BOOT_GLOBAL]: {
          booted: () => {
            throw new Error("x");
          },
        },
      }),
    ).not.toThrow();
  });
});

describe("index.html watchdog", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  const constant = (name: string): string => new RegExp(`var ${name} = ([^;]+);`).exec(inline)?.[1]?.trim() ?? "";

  it("is inline and runs before the module script", () => {
    expect(inline).not.toBe("");
    expect(html.indexOf(inline)).toBeLessThan(html.indexOf('type="module"'));
  });
  it("uses the same keys, constants and words as policy.ts", () => {
    expect(constant("ATTEMPTS_KEY")).toBe(JSON.stringify(BOOT_ATTEMPTS_KEY));
    expect(constant("HEALS_KEY")).toBe(JSON.stringify(BOOT_HEALS_KEY));
    expect(constant("GLOBAL_NAME")).toBe(JSON.stringify(BOOT_GLOBAL));
    expect(constant("TIMEOUT_MS")).toBe(String(BOOT_TIMEOUT_MS));
    expect(constant("HEAL_AT")).toBe(String(HEAL_AT_ATTEMPT));
    expect(constant("GIVE_UP_AT")).toBe(String(GIVE_UP_AT_ATTEMPT));
    expect(constant("MESSAGE")).toBe(JSON.stringify(BOOT_GIVE_UP_MESSAGE));
  });
  it("never touches localStorage", () => {
    expect(inline).not.toMatch(/localStorage|indexedDB/);
  });
});
