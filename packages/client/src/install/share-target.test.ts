import { describe, expect, it } from "vitest";
import { roomCodeFromShare, shareDestination } from "./share-target";

describe("the share target", () => {
  it("finds the room in a shared join link", () => {
    expect(roomCodeFromShare({ url: "https://kad.example/p/ABCD" })).toBe("ABCD");
    expect(roomCodeFromShare({ text: "Join us! https://kad.example/tv/AB1C?x=1 see you" })).toBe("AB1C");
    expect(roomCodeFromShare({ url: "https://kad.example/p/abcd" })).toBe("ABCD");
  });

  it("finds a visitor code's six", () => {
    expect(roomCodeFromShare({ url: "https://kad.example/p/ABCDXY" })).toBe("ABCDXY");
  });

  it("finds a bare code in the words", () => {
    expect(roomCodeFromShare({ text: "Our room code is QRST!" })).toBe("QRST");
    expect(roomCodeFromShare({ title: "K9ZZ" })).toBe("K9ZZ");
  });

  it("prefers a link over a bare code", () => {
    expect(roomCodeFromShare({ text: "WORD", url: "https://kad.example/p/ABCD" })).toBe("ABCD");
  });

  it("finds nothing in ordinary shares", () => {
    expect(roomCodeFromShare({})).toBeNull();
    expect(roomCodeFromShare({ text: "Look at this lovely dragon", url: "https://example.com/news" })).toBeNull();
    expect(roomCodeFromShare({ text: "ABCDE" })).toBeNull();
    expect(roomCodeFromShare({ url: "https://kad.example/p/ABC" })).toBeNull();
  });

  it("sends a room to its join route and everything else home", () => {
    expect(shareDestination("?title=&text=&url=https%3A%2F%2Fkad.example%2Fp%2FABCD")).toBe("/p/ABCD");
    expect(shareDestination("?text=Join%20QRST")).toBe("/p/QRST");
    expect(shareDestination("?text=hello+there")).toBe("/");
    expect(shareDestination("")).toBe("/");
  });
});
