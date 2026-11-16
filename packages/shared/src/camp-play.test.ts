import { describe, expect, it } from "vitest";
import { fetchResult, fetchWords, readCampPlay } from "./camp-play.js";
const toss = { activity: "fetch" as const, friendId: "bun", aim: 70, strength: 60, target: 70 };
describe("camp free play", () => {
  it("makes aim and distance matter, with recoverable near misses", () => {
    expect(fetchResult(toss)).toBe("catch");
    expect(fetchResult({ ...toss, aim: 50 })).toBe("chase");
    expect(fetchResult({ ...toss, strength: 10 })).toBe("search");
    expect(fetchResult({ ...toss, aim: 10 })).toBe("search");
    expect(fetchResult({ ...toss, aim: 70, strength: 60 })).toBe("catch");
    expect(fetchWords("Bun", "bun", "search")).toContain("chewed leaf");
    expect(fetchWords("Duckling", "duckling", "search")).toContain("feather");
  });
  it("accepts only bounded known inputs and copies their safe fields", () => {
    expect(readCampPlay({ ...toss, heroId: "somebody-else" })).toEqual(toss);
    for (const aim of [NaN, Infinity, -1, 91, 10.5, "70", null]) expect(readCampPlay({ ...toss, aim })).toBeNull();
    expect(readCampPlay({ activity: "music", instrument: "bells" })).toEqual({ activity: "music", instrument: "bells" });
    expect(readCampPlay({ activity: "music", instrument: "siren" })).toBeNull();
    expect(readCampPlay(null)).toBeNull();
  });
});
