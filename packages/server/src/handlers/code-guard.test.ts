import { describe, expect, it } from "vitest";
import { makeHarness } from "../test-support.ts";
import {
  CODE_MISS_LIMIT,
  CODE_MISS_WINDOW_MS,
  clientKeyFor,
  admitCodeLookup,
  retryAfterSeconds,
} from "./code-guard.ts";

describe("clientKeyFor", () => {
  it("keys IPv4 by the address", () => {
    expect(clientKeyFor("192.0.2.1")).toBe("192.0.2.1");
    expect(clientKeyFor(" 192.0.2.1 ")).toBe("192.0.2.1");
  });

  it("reads an IPv4 client on a dual-stack socket as IPv4", () => {
    expect(clientKeyFor("::ffff:192.0.2.1")).toBe("192.0.2.1");
  });

  it("keys IPv6 by its /64, so a fresh address per guess is the same client", () => {
    // One home gets a whole /64. Keying by address would give a guesser 2^64 budgets.
    const a = clientKeyFor("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd");
    const b = clientKeyFor("2001:db8:1234:5678::1");
    expect(a).toBe("2001:db8:1234:5678::/64");
    expect(b).toBe(a);
    expect(clientKeyFor("2001:db8:1234:5679::1")).not.toBe(a);
  });

  it("spells one /64 one way, however the address was written", () => {
    expect(clientKeyFor("2001:0DB8:0000:0001::1")).toBe("2001:db8:0:1::/64");
    expect(clientKeyFor("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientKeyFor("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("puts every client it cannot read into one shared budget, never none", () => {
    for (const address of [undefined, "", "not an address", "1:2:3", "1::2::3", "12345::1"]) {
      expect(clientKeyFor(address), String(address)).toBe("unknown");
    }
  });
});

describe("the wrong-code budget", () => {
  it(`refuses a client after ${CODE_MISS_LIMIT} misses, and only that client`, async () => {
    const { deps } = makeHarness();
    for (let i = 0; i < CODE_MISS_LIMIT; i++) {
      expect(await admitCodeLookup("192.0.2.1", deps), `miss ${i}`).not.toBeNull();
    }
    expect(await admitCodeLookup("192.0.2.1", deps)).toBeNull();
    expect(await admitCodeLookup("192.0.2.2", deps)).not.toBeNull();
  });

  it("never charges a lookup that found a room", async () => {
    const { deps } = makeHarness();
    for (let i = 0; i < CODE_MISS_LIMIT * 3; i++) {
      const lookup = await admitCodeLookup("192.0.2.1", deps);
      expect(lookup, `lookup ${i}`).not.toBeNull();
      await lookup?.hit();
    }
  });

  it("admits a parallel burst of guesses only up to the limit", async () => {
    const { deps } = makeHarness();
    const admitted = await Promise.all(
      Array.from({ length: CODE_MISS_LIMIT * 2 }, () => admitCodeLookup("192.0.2.1", deps)),
    );
    expect(admitted.filter((l) => l !== null)).toHaveLength(CODE_MISS_LIMIT);
  });

  it("forgives a client once the window turns over", async () => {
    const { deps, clock } = makeHarness();
    for (let i = 0; i < CODE_MISS_LIMIT; i++) await admitCodeLookup("192.0.2.1", deps);
    expect(await admitCodeLookup("192.0.2.1", deps)).toBeNull();

    clock.advance(CODE_MISS_WINDOW_MS);
    expect(await admitCodeLookup("192.0.2.1", deps)).not.toBeNull();
  });

  it("tells a refused client how long until the window turns over", () => {
    const start = 40 * CODE_MISS_WINDOW_MS;
    expect(retryAfterSeconds(start)).toBe(CODE_MISS_WINDOW_MS / 1000);
    expect(retryAfterSeconds(start + CODE_MISS_WINDOW_MS - 500)).toBe(1);
  });
});
