import { describe, expect, it } from "vitest";
import { checkManifests, checkSources, fixManifest } from "./check";
import type { Desired } from "./desired";
import type { Manifest } from "./manifest";
import { SiteClipSource } from "./sources";
import { MemoryClipStore } from "./store";

const key = (n: number): string => n.toString(16).padStart(64, "0");
const TEXT = "The hedge wall is taller than a giant's hat.";
const MS = 3000;

/** One chapter that wants one line, in one clip. */
function wants(clip = key(1), text = TEXT): Desired {
  return { lines: [{ address: "ch/scene_a/narration", chapter: "ch", campaign: "c", variant: "", segments: [{ key: clip, by: "narrator", text }] }], deviceVoice: [] };
}
const played = (clip = key(1), ms = MS): Manifest => ({ "ch/scene_a/narration": { "": [{ clip, ms }] } });
const check = (manifest: Manifest | null, desired = wants(), approved: Record<string, object> = {}) =>
  checkManifests({ manifests: new Map(manifest === null ? [] : [["ch", manifest]]), desired: new Map([["ch", desired]]), lock: { approved } });

describe("voice:verify fails on broken, never on missing (#545)", () => {
  it("passes a chapter with no clips yet", () => {
    expect(check(null).failures).toEqual([]);
    expect(check({}).failures).toEqual([]);
  });

  it("passes a manifest that plays the clips the words ask for", () => {
    const verdict = check(played());
    expect(verdict.failures).toEqual([]);
    expect([...verdict.clips]).toEqual([[key(1), MS]]);
  });

  it("fails an entry whose words changed since it was rendered, and --fix drops only that entry", () => {
    const changed = wants(key(2), `${TEXT} A frog coughs.`);
    expect(check(played(), changed).failures).toEqual([expect.objectContaining({ message: expect.stringContaining("the table would hear the old line") })]);
    const kept = { ...played(), "ch/gone/narration": { "": [{ clip: key(9), ms: MS }] } };
    expect(fixManifest(kept, changed)).toEqual({ "ch/gone/narration": { "": [{ clip: key(9), ms: MS }] } });
  });

  it("fails an entry for a line the device voice must read now", () => {
    const desired: Desired = { lines: [], deviceVoice: [{ address: "ch/scene_a/narration", chapter: "ch", reason: "stale-script" }] };
    const verdict = check(played(), desired);
    expect(verdict.failures).toEqual([expect.objectContaining({ message: expect.stringContaining("device voice must read") })]);
    expect(verdict.notes).toEqual([expect.objectContaining({ message: expect.stringContaining("stale") })]);
  });

  it("fails a broken or uncast script, and only notes a stale one", () => {
    const desired: Desired = {
      lines: [],
      deviceVoice: [
        { address: "ch/a/narration", chapter: "ch", reason: "broken-script" },
        { address: "ch/b/narration", chapter: "ch", reason: "uncast-speaker" },
        { address: "ch/c/narration", chapter: "ch", reason: "stale-script" },
      ],
    };
    const verdict = check(null, desired);
    expect(verdict.failures.map((f) => f.at)).toEqual(["ch ch/a/narration", "ch ch/b/narration"]);
    expect(verdict.notes.map((f) => f.at)).toEqual(["ch ch/c/narration"]);
  });

  it.each([
    ["not a clip key", { "ch/scene_a/narration": { "": [{ clip: "nope", ms: MS }] } }, "not a clip key"],
    ["no clips", { "ch/scene_a/narration": { "": [] } }, "has no clips"],
    ["a length that is not one", played(key(1), 0), "ms long"],
    ["far too long for its words", played(key(1), 60_000), "mostly silence"],
    ["far too short for its words", played(key(1), 400), "cut short"],
  ] as const)("fails an entry with %s", (_, manifest, message) => {
    expect(check(manifest as Manifest).failures).toEqual([expect.objectContaining({ message: expect.stringContaining(message) })]);
  });

  it("only notes an entry nothing says any more, and a manifest for nothing the game has", () => {
    const orphan = { "ch/gone/narration": { "": [{ clip: key(9), ms: MS }] } };
    const verdict = checkManifests({ manifests: new Map([["ch", orphan], ["retired", orphan]]), desired: new Map([["ch", wants()]]), lock: { approved: {} } });
    expect(verdict.failures).toEqual([]);
    expect(verdict.notes.map((n) => n.message)).toEqual([
      expect.stringContaining("not a line the game says"),
      expect.stringContaining("names no chapter"),
      expect.stringContaining("not a line the game says"),
    ]);
  });

  it("fails a lock entry that is not a clip key, and notes one no manifest plays", () => {
    const verdict = check(played(), wants(), { "not-a-key": {}, [key(7)]: {} });
    expect(verdict.failures).toEqual([expect.objectContaining({ message: expect.stringContaining("not a clip key") })]);
    expect(verdict.notes).toEqual([expect.objectContaining({ message: expect.stringContaining("no manifest plays") })]);
  });
});

describe("every clip a manifest plays is at the destination", () => {
  it("fails a clip the destination lacks, or holds at another length", async () => {
    const store = new MemoryClipStore();
    await store.put(key(1), new Uint8Array(), { ms: MS });
    await store.put(key(2), new Uint8Array(), { ms: 999 });
    const found = await checkSources(new Map([[key(1), MS], [key(2), MS], [key(3), MS]]), [store]);
    expect(found.checked).toBe(3);
    expect(found.failures.map((f) => f.message)).toEqual(expect.arrayContaining([expect.stringContaining(`has no clip ${key(3)}`), expect.stringContaining("999 ms there")]));
    expect(found.failures).toHaveLength(2);
  });

  it("reports a destination that cannot answer, rather than failing it", async () => {
    const down = { name: "down", head: () => Promise.reject(new Error("timed out")) };
    const found = await checkSources(new Map([[key(1), MS]]), [down]);
    expect(found.failures).toEqual([]);
    expect(found.notes).toEqual([expect.objectContaining({ at: "down", message: expect.stringContaining("timed out") })]);
  });
});

describe("the deployed site, asked as a browser asks", () => {
  const reply = (status: number, ms?: string) => () => Promise.resolve({ status, headers: { get: (name: string) => (name === "x-amz-meta-ms" ? ms ?? null : null) } });

  it("HEADs the clip's path on the site and reads its length", async () => {
    const asked: string[] = [];
    const site = new SiteClipSource("https://example.cloudfront.net/", (url, init) => { asked.push(`${init.method} ${url}`); return reply(200, "3000")(); });
    expect(await site.head(key(1))).toEqual({ ms: 3000 });
    expect(asked).toEqual([`HEAD https://example.cloudfront.net/voice/00/${key(1)}.webm`]);
  });

  it.each([404, 403])("reads %i as not there", async (status) => {
    expect(await new SiteClipSource("https://x", reply(status)).head(key(1))).toBeNull();
  });

  it("retries a server error, then throws rather than calling it missing", async () => {
    let calls = 0;
    const site = new SiteClipSource("https://x", () => { calls += 1; return reply(503)(); }, 3);
    await expect(site.head(key(1))).rejects.toThrow(/HTTP 503/);
    expect(calls).toBe(3);
  });
});

describe("the clips deploy.sh looks up", () => {
  it("are every well-formed clip in every manifest, and an unreadable manifest is named", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { clipsIn } = await import("./verify-site");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-manifest-"));
    fs.writeFileSync(path.join(dir, "ch.json"), JSON.stringify({ a: { "": [{ clip: key(1), ms: MS }], "party=2": [{ clip: key(2), ms: 900 }, { clip: "nope", ms: 1 }] } }));
    fs.writeFileSync(path.join(dir, "broken.json"), "{");
    expect(clipsIn(dir)).toEqual({ clips: new Map([[key(1), MS], [key(2), 900]]), unreadable: ["broken.json"] });
    expect(clipsIn(path.join(dir, "none"))).toEqual({ clips: new Map(), unreadable: [] });
  });
});

describe("the deploy's site check (#545 review)", () => {
  const manifestDir = async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-site-"));
    fs.writeFileSync(path.join(dir, "ch.json"), JSON.stringify(played()));
    return dir;
  };
  const answer = (status: number) => () => Promise.resolve({ status, headers: { get: () => null } });

  it("passes when every clip is confirmed there", async () => {
    const { verifySite } = await import("./verify-site");
    expect((await verifySite("https://x", await manifestDir(), answer(200))).code).toBe(0);
  });

  it("fails when a clip is not there", async () => {
    const { verifySite } = await import("./verify-site");
    expect((await verifySite("https://x", await manifestDir(), answer(404))).code).toBe(1);
  });

  it.each([
    ["a 503 on every try", answer(503)],
    ["a timeout", () => Promise.reject(new Error("timed out"))],
  ])("fails when a lookup never gets an answer: %s", async (_, fetcher) => {
    const { verifySite } = await import("./verify-site");
    const verdict = await verifySite("https://x", await manifestDir(), fetcher);
    expect(verdict.code).toBe(1);
    expect(verdict.lines.join("\n")).toContain("0 of 1 looked up at https://x, 0 broken, 1 unanswered");
  });

  it("passes a site with nothing to look up", async () => {
    const { verifySite } = await import("./verify-site");
    expect((await verifySite("https://x", "/nowhere", answer(503))).code).toBe(0);
  });
});
