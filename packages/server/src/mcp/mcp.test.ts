import { S3Client } from "@aws-sdk/client-s3";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it } from "vitest";
import { toRequest, toResult } from "../lambda/mcp";
import { MemoryKeyStore, bearerKey, listKeys, mintKey, revokeKey, verifyKey, KeyError } from "./keys";
import { readStamp, type BlobStamp } from "../../../shared/src/asset-store";
import { mcpEndpoint } from "./handler";
import { S3UploadSigner, checksumHeader, planUploads, type UploadSigner } from "./uploads";
import { MemoryTimingStore } from "../store/timing-store";
import type { TimingNote } from "@kad/shared";
import type { ChapterIndex } from "./chapter-index";

const VERSION = "2026-07-28";
const SHA = "ab".repeat(32);
const SHA2 = "cd".repeat(32);

class FakeSigner implements UploadSigner {
  readonly stored = new Set<string>();
  readonly stamps: BlobStamp[] = [];
  has(key: string): Promise<boolean> {
    return Promise.resolve(this.stored.has(key));
  }
  presignPut(key: string, contentType: string, sha256: string, _bytes: number, stamp: BlobStamp) {
    this.stamps.push(stamp);
    return Promise.resolve({ url: `https://bucket.example/${key}?sig`, headers: { "Content-Type": contentType, "If-None-Match": "*", "x-amz-checksum-sha256": checksumHeader(sha256) } });
  }
}

describe("keys", () => {
  let store: MemoryKeyStore;
  beforeEach(() => {
    store = new MemoryKeyStore();
  });

  it("mints a key shown once, stores only a hash, and verifies it", async () => {
    const { key, info } = await mintKey(store, { label: "cloud-agent", scopes: ["assets:write"] });
    expect(key).toMatch(/^kadmcp_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/);
    const row = store.rows.get(info.id)!;
    expect(JSON.stringify(row)).not.toContain(key.split(".")[1]!);
    expect(info).not.toHaveProperty("secretHash");
    const verified = await verifyKey(store, key);
    expect(verified).toMatchObject({ id: info.id, label: "cloud-agent", scopes: ["assets:write"] });
    expect(store.rows.get(info.id)!.lastUsedAt).not.toBeNull();
  });

  it("makes ids a command line can take as they are: never starting with a dash", async () => {
    for (let i = 0; i < 300; i++) {
      const { info } = await mintKey(store, { label: `k${i}`, scopes: ["assets:read"] });
      expect(info.id).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("refuses a wrong secret, a malformed key, an expired key and a revoked one alike", async () => {
    const now = new Date("2026-11-11T00:00:00Z");
    const { key, info } = await mintKey(store, { label: "a", scopes: ["assets:read"], days: 1, now });
    const [head, secret] = key.split(".") as [string, string];
    const flipped = `${head}.${secret[0] === "A" ? "B" : "A"}${secret.slice(1)}`;
    expect(await verifyKey(store, flipped, now)).toBeNull();
    expect(await verifyKey(store, "kadmcp_nope", now)).toBeNull();
    expect(await verifyKey(store, key, new Date("2026-11-12T00:00:01Z"))).toBeNull();
    expect(await verifyKey(store, key, now)).not.toBeNull();
    await revokeKey(store, info.id);
    expect(await verifyKey(store, key, now)).toBeNull();
    await expect(revokeKey(store, info.id)).rejects.toThrow(KeyError);
  });

  it("refuses unknown scopes, no scopes, a missing label and silly lifetimes", async () => {
    await expect(mintKey(store, { label: "a", scopes: ["assets:admin"] })).rejects.toThrow(/Unknown scope/);
    await expect(mintKey(store, { label: "a", scopes: [] })).rejects.toThrow(/at least one scope/);
    await expect(mintKey(store, { label: " ", scopes: ["assets:read"] })).rejects.toThrow(/label/);
    await expect(mintKey(store, { label: "a", scopes: ["assets:read"], days: 0 })).rejects.toThrow(/days/);
    await expect(mintKey(store, { label: "a", scopes: ["assets:read"], days: 400 })).rejects.toThrow(/days/);
  });

  it("carries an agent and tags, refusing anything unfit to stamp in public", async () => {
    const { key } = await mintKey(store, { label: "cloud agent", scopes: ["assets:write"], agent: "codex", tags: ["env=codex-cloud", "repo=kids-and-dragons"] });
    expect(await verifyKey(store, key)).toMatchObject({ agent: "codex", tags: { env: "codex-cloud", repo: "kids-and-dragons" } });
    await expect(mintKey(store, { label: "a", scopes: ["assets:write"], agent: "Codex Agent" })).rejects.toThrow(/agent/);
    await expect(mintKey(store, { label: "a", scopes: ["assets:write"], tags: ["email=someone@example.com"] })).rejects.toThrow(/tag/);
    await expect(mintKey(store, { label: "a", scopes: ["assets:write"], tags: ["novalue"] })).rejects.toThrow(/key=value/);
    await expect(mintKey(store, { label: "Ann's laptop <ann@example.com>", scopes: ["assets:write"] })).rejects.toThrow(/plain words/);
    const plain = await mintKey(store, { label: "b", scopes: ["assets:read"] });
    expect(await verifyKey(store, plain.key)).toMatchObject({ agent: null, tags: {} });
  });

  it("lists keys without their hashes, oldest first", async () => {
    await mintKey(store, { label: "first", scopes: ["assets:read"], now: new Date("2026-01-01T00:00:00Z") });
    await mintKey(store, { label: "second", scopes: ["operator:read", "assets:write", "assets:write"], now: new Date("2026-02-01T00:00:00Z") });
    const keys = await listKeys(store);
    expect(keys.map((k) => k.label)).toEqual(["first", "second"]);
    expect(keys[1]!.scopes).toEqual(["assets:write", "operator:read"]);
    expect(JSON.stringify(keys)).not.toContain("secretHash");
  });

  it("reads a bearer header", () => {
    expect(bearerKey("Bearer kadmcp_x.y")).toBe("kadmcp_x.y");
    expect(bearerKey("bearer  kadmcp_x.y ")).toBe("kadmcp_x.y");
    expect(bearerKey("Basic abc")).toBeNull();
    expect(bearerKey(undefined)).toBeNull();
  });
});

describe("upload URLs", () => {
  it("answers stored, upload or refused per file", async () => {
    const signer = new FakeSigner();
    signer.stored.add(`sha256/ab/${SHA}.png`);
    const answers = await planUploads(signer, [
      { path: "assets/cast/pib/assembled.png", sha256: SHA, bytes: 10 },
      { path: "assets/audio/rain.webm", sha256: SHA2, bytes: 10 },
      { path: "assets/notes.txt", sha256: SHA2, bytes: 10 },
      { path: "assets/x.png", sha256: "nope", bytes: 10 },
      { path: "assets/x.png", sha256: SHA2, bytes: 0 },
      { path: "assets/brand/logo.svg", sha256: SHA2, bytes: 10 },
    ], { uploader: "agent", via: "mcp" });
    expect(answers.map((a) => a.status)).toEqual(["stored", "upload", "refused", "refused", "refused", "refused"]);
    expect(answers[1]).toMatchObject({ key: `sha256/cd/${SHA2}.webm`, method: "PUT", headers: { "Content-Type": "audio/webm", "If-None-Match": "*" } });
  });

  it("refuses a file whose stamp would not fit, rather than store a shortened one", async () => {
    const s3 = new S3Client({ region: "us-east-1", credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" }, requestChecksumCalculation: "WHEN_REQUIRED" });
    const signer = new S3UploadSigner("kad-asset-store-test", s3);
    signer.has = () => Promise.resolve(false);
    const [answer] = await planUploads(signer, [{ path: `assets/${"é".repeat(400)}.png`, sha256: SHA, bytes: 10 }], { uploader: "agent", via: "mcp" });
    expect(answer).toMatchObject({ status: "refused", reason: expect.stringMatching(/stamp .* over S3's 2048/) });
  });

  it("signs the write-once and checksum headers, so an uploader cannot drop them", async () => {
    const s3 = new S3Client({ region: "us-east-1", credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" }, requestChecksumCalculation: "WHEN_REQUIRED" });
    const stamp = { uploader: "cloud agent", via: "mcp" as const, agent: "codex", tags: { env: "codex-cloud" }, path: "assets/cast/pib/assembled.png", issue: 704, at: "2026-11-11T12:00:00.000Z" };
    const put = await new S3UploadSigner("kad-asset-store-test", s3).presignPut(`sha256/ab/${SHA}.png`, "image/png", SHA, 1234, stamp);
    const url = new URL(put.url);
    expect(url.hostname).toBe("kad-asset-store-test.s3.us-east-1.amazonaws.com");
    expect(url.pathname).toBe(`/sha256/ab/${SHA}.png`);
    expect(url.searchParams.get("X-Amz-SignedHeaders")!.split(";")).toEqual([
      "cache-control", "content-length", "content-type", "host", "if-none-match", "x-amz-checksum-sha256",
      // The provenance stamp (#732): signed, so the uploader can neither drop nor change it.
      "x-amz-meta-kad-agent", "x-amz-meta-kad-at", "x-amz-meta-kad-issue", "x-amz-meta-kad-path", "x-amz-meta-kad-tags", "x-amz-meta-kad-uploader", "x-amz-meta-kad-via",
    ]);
    // Nothing of the stamp rides in the query string, where it would not have to be sent.
    expect([...url.searchParams.keys()].some((k) => k.toLowerCase().startsWith("x-amz-meta"))).toBe(false);
    expect(readStamp((name) => put.headers[name])).toEqual(stamp);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(Object.fromEntries(Object.entries(put.headers).filter(([k]) => !k.startsWith("x-amz-meta-")))).toEqual({
      "Content-Length": "1234",
      "Content-Type": "image/png",
      "Cache-Control": "public,max-age=31536000,immutable",
      "If-None-Match": "*",
      "x-amz-checksum-sha256": Buffer.from(SHA, "hex").toString("base64"),
    });
  });
});

describe("the endpoint", () => {
  let keys: MemoryKeyStore;
  let signer: FakeSigner;
  let endpoint: ReturnType<typeof mcpEndpoint>;

  beforeEach(() => {
    keys = new MemoryKeyStore();
    signer = new FakeSigner();
    endpoint = mcpEndpoint({ keys, signer });
  });

  async function rpc(key: string | null, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    const res = await endpoint(
      new Request("https://kd.example/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": VERSION,
          "mcp-method": method,
          ...(method === "tools/call" ? { "mcp-name": String(params.name) } : {}),
          ...(key ? { authorization: `Bearer ${key}` } : {}),
          ...headers,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": VERSION, "io.modelcontextprotocol/clientCapabilities": {} } },
        }),
      }),
    );
    return { status: res.status, body: (await res.json()) as { result?: Record<string, unknown>; error?: { code: number; message: string } } };
  }

  const toolNames = async (key: string) => ((await rpc(key, "tools/list")).body.result!.tools as Array<{ name: string }>).map((t) => t.name).sort();

  it("refuses a request with no key, a bad key or a revoked one", async () => {
    expect((await rpc(null, "tools/list")).status).toBe(401);
    expect((await rpc("kadmcp_aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "tools/list")).status).toBe(401);
    const { key, info } = await mintKey(keys, { label: "agent", scopes: ["assets:write"] });
    expect((await rpc(key, "tools/list")).status).toBe(200);
    await revokeKey(keys, info.id);
    expect((await rpc(key, "tools/list")).status).toBe(401);
  });

  it("advertises the 2026-07-28 revision", async () => {
    const { key } = await mintKey(keys, { label: "agent", scopes: ["assets:read"] });
    const { status, body } = await rpc(key, "server/discover");
    expect(status).toBe(200);
    expect(body.result!.supportedVersions).toContain(VERSION);
  });

  it("registers only the tools a key's scopes reach", async () => {
    const write = await mintKey(keys, { label: "w", scopes: ["assets:write"] });
    const read = await mintKey(keys, { label: "r", scopes: ["assets:read"] });
    const operator = await mintKey(keys, { label: "o", scopes: ["operator:read"] });
    expect(await toolNames(write.key)).toEqual(["check_uploads", "request_uploads", "whoami"]);
    expect(await toolNames(read.key)).toEqual(["check_uploads", "whoami"]);
    expect(await toolNames(operator.key)).toEqual(["whoami"]);
    const refused = await rpc(read.key, "tools/call", { name: "request_uploads", arguments: { files: [{ path: "a.png", sha256: SHA, bytes: 1 }] } });
    expect(refused.body.error?.code ?? (refused.body.result as { isError?: boolean }).isError).toBeTruthy();
  });

  it("hands out upload URLs, and says what is already stored", async () => {
    const { key } = await mintKey(keys, { label: "agent", scopes: ["assets:write"], agent: "codex", tags: ["env=codex-cloud"] });
    signer.stored.add(`sha256/ab/${SHA}.png`);
    const { body } = await rpc(key, "tools/call", {
      name: "request_uploads",
      arguments: { files: [{ path: "assets/a.png", sha256: SHA, bytes: 3 }, { path: "assets/b.png", sha256: SHA2, bytes: 3 }], issue: 704 },
    });
    // The new blob is stamped with the key and the issue; the stored one is not re-signed.
    expect(signer.stamps).toEqual([
      expect.objectContaining({ uploader: "agent", via: "mcp", agent: "codex", tags: { env: "codex-cloud" }, path: "assets/b.png", issue: 704 }),
    ]);
    const uploads = (body.result!.structuredContent as { uploads: Array<{ status: string; url?: string }> }).uploads;
    expect(uploads.map((u) => u.status)).toEqual(["stored", "upload"]);
    expect(uploads[1]!.url).toBe(`https://bucket.example/sha256/cd/${SHA2}.png?sig`);

    const checked = await rpc(key, "tools/call", { name: "check_uploads", arguments: { files: [{ path: "assets/a.png", sha256: SHA }, { path: "assets/b.png", sha256: SHA2 }] } });
    expect((checked.body.result!.structuredContent as { files: Array<{ stored: boolean }> }).files.map((f) => f.stored)).toEqual([true, false]);

    const who = await rpc(key, "tools/call", { name: "whoami", arguments: {} });
    expect(who.body.result!.structuredContent).toMatchObject({ label: "agent", agent: "codex", tags: { env: "codex-cloud" }, scopes: ["assets:write"] });
  });

  it("rejects bad arguments as a validation error, not a crash", async () => {
    const { key } = await mintKey(keys, { label: "agent", scopes: ["assets:write"] });
    const { status, body } = await rpc(key, "tools/call", { name: "request_uploads", arguments: { files: [{ path: "a.png", sha256: "short", bytes: 1 }] } });
    expect(status).toBe(200);
    expect(body.error ?? (body.result as { isError?: boolean })?.isError).toBeTruthy();
  });

  it("refuses browser origins", async () => {
    const { key } = await mintKey(keys, { label: "agent", scopes: ["assets:read"] });
    expect((await rpc(key, "tools/list", {}, { origin: "https://evil.example" })).status).toBe(403);
  });
});

describe("the operator's timing tools", () => {
  const T0 = Date.parse("2026-11-01T18:00:00.000Z");
  const MIN = 60_000;
  let keys: MemoryKeyStore;
  let timing: MemoryTimingStore;
  let endpoint: ReturnType<typeof mcpEndpoint>;

  /** One family evening of gemfall-02: a story scene, a memory game, a fight, the end. */
  async function evening(runId: string, startMs: number, o: { game?: number; rounds?: number; close?: boolean; revision?: string; chapter?: string } = {}) {
    const chapterId = o.chapter ?? "gemfall-02";
    const notes: Array<[number, TimingNote]> = [
      [0, { kind: "start", source: "family", chapterId, campaignId: "gemfall", revision: o.revision ?? "r1", partySize: 3, prefaced: false, revisit: false, scene: "intro", type: "story" }],
      [2, { kind: "step", scene: "jar", type: "interaction", game: "memory" }],
      [3, { kind: "game", scene: "jar", phase: "play", attempt: 0 }],
      [3 + (o.game ?? 2), { kind: "game", scene: "jar", phase: "result", attempt: 0, outcome: "success" }],
    ];
    if (o.close) notes.push([4 + (o.game ?? 2), { kind: "close" }]);
    else {
      let t = 4 + (o.game ?? 2);
      notes.push([t, { kind: "step", scene: "bog", type: "encounter", result: "success" }]);
      notes.push([++t, { kind: "fight", scene: "bog", phase: "begin", round: 1, heroes: 3, foes: 2, foeKinds: ["bogling"] }]);
      for (let r = 2; r <= (o.rounds ?? 3); r++) notes.push([(t += 2), { kind: "fight", scene: "bog", phase: "round", round: r }]);
      notes.push([(t += 2), { kind: "step", scene: "after", type: "story", result: "success", fight: { outcome: "victory", round: o.rounds ?? 3 } }]);
      notes.push([t + 20, { kind: "end", outcome: "success", routes: [] }]);
    }
    for (const [i, [min, note]] of notes.entries()) {
      await timing.put({ runId, chapterId, seq: i + 1, at: new Date(startMs + min * MIN).toISOString(), timing: note });
    }
  }

  beforeEach(async () => {
    keys = new MemoryKeyStore();
    timing = new MemoryTimingStore();
    endpoint = mcpEndpoint({ keys, signer: new FakeSigner(), timing, now: () => T0 + 30 * 24 * 60 * MIN });
    for (let i = 0; i < 4; i++) await evening(`run${String(i)}`, T0 + i * 24 * 60 * MIN, { game: 5, rounds: 8 });
    await evening("left", T0 + 5 * 24 * 60 * MIN, { close: true });
  });

  async function call(key: string, name: string, args: Record<string, unknown> = {}) {
    const list = name === "tools/list";
    const res = await endpoint(
      new Request("https://kd.example/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": VERSION,
          "mcp-method": list ? "tools/list" : "tools/call",
          ...(list ? {} : { "mcp-name": name }),
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: list ? "tools/list" : "tools/call",
          params: {
            ...(list ? {} : { name, arguments: args }),
            _meta: { "io.modelcontextprotocol/protocolVersion": VERSION, "io.modelcontextprotocol/clientCapabilities": {} },
          },
        }),
      }),
    );
    const body = (await res.json()) as {
      result?: { structuredContent?: Record<string, unknown>; isError?: boolean; tools?: Array<{ name: string }> };
      error?: unknown;
    };
    if (!body.result) throw new Error(JSON.stringify(body));
    return body.result;
  }

  it("offers the read tools to operator:read, the exclusions to operator:write, and none to an asset key", async () => {
    const read = await mintKey(keys, { label: "ops read", scopes: ["operator:read"] });
    const write = await mintKey(keys, { label: "ops", scopes: ["operator:write"] });
    const assets = await mintKey(keys, { label: "agent", scopes: ["assets:write"] });
    const names = async (key: string) => (await call(key, "tools/list")).tools!.map((t) => t.name).sort();
    const reads = ["timing_activities", "timing_campaign", "timing_chapter", "timing_compare", "timing_findings", "timing_overview", "timing_sittings", "timing_trends"];
    expect(await names(read.key)).toEqual([...reads, "whoami"]);
    expect(await names(write.key)).toEqual([...reads, "timing_exclude", "timing_include", "whoami"].sort());
    expect((await names(assets.key)).filter((n) => n.startsWith("timing"))).toEqual([]);
  });

  it("answers the overview, the activities, a chapter and the findings from the timing table", async () => {
    const { key } = await mintKey(keys, { label: "ops read", scopes: ["operator:read"] });
    const overview = (await call(key, "timing_overview")).structuredContent!;
    expect(overview).toMatchObject({ sittings: 5, excluded: 0 });
    const [chapter] = overview.chapters as Array<Record<string, unknown>>;
    expect(chapter).toMatchObject({ chapter: "gemfall-02", revision: "r1", latest: true, attempts: 5, completed: 4, left_unfinished: 1 });
    expect(overview.game_kinds).toEqual([expect.objectContaining({ game: "memory", play_min: expect.objectContaining({ n: 4, median: 5 }) })]);
    expect(overview.fights).toMatchObject({ rounds: { median: 8 } });

    const acts = (await call(key, "timing_activities", { what: "fights" })).structuredContent!;
    expect(acts.fights).toEqual([
      expect.objectContaining({ scene: "bog", foes: 2, foe_kinds: ["bogling"], rounds: { n: 4, median: 8, max: 8 }, outcomes: expect.objectContaining({ victory: 4 }) }),
    ]);
    expect(acts).not.toHaveProperty("games");

    const found = (await call(key, "timing_findings")).structuredContent!;
    const kinds = (found.findings as Array<{ kind: string; scene: string | null }>).map((f) => `${f.kind}:${f.scene ?? ""}`);
    expect(kinds).toEqual(expect.arrayContaining(["fight_long:bog", "game_long:jar"]));

    const one = (await call(key, "timing_chapter", { chapter: "gemfall-02" })).structuredContent!;
    const [rev] = one.revisions as Array<Record<string, unknown>>;
    expect(rev).toMatchObject({ revision: "r1", left_at: [{ scene: "jar", attempts: 1 }] });
    expect(rev!.games).toEqual([expect.objectContaining({ scene: "jar", game: "memory", unfinished_kept_out: 1 })]);
    expect((await call(key, "timing_chapter", { chapter: "nowhere-01" })).isError).toBe(true);
  });

  describe("with the chapter index the build writes", () => {
    const index: ChapterIndex = {
      builtAt: "2026-11-13T00:00:00.000Z",
      campaigns: [{ id: "gemfall", title: "Gemfall", mode: "ordered", chapters: ["gemfall-01", "gemfall-02", "gemfall-03"] }],
      chapters: [
        { id: "gemfall-01", title: "One", campaignId: "gemfall", position: 1, revision: "x1", estimatedMinutes: 30, predictedMinutes: { shortest: 28, typical: 33 }, scenes: 40, games: [], fights: [] },
        {
          id: "gemfall-02", title: "Green Roads North", campaignId: "gemfall", position: 2, revision: "r2", estimatedMinutes: 30,
          predictedMinutes: { shortest: 37.4, typical: 40.8 }, scenes: 113,
          games: [{ scene: "jar", game: "memory" }, { scene: "hats", game: "tracking" }],
          fights: [{ scene: "bog", foes: 2, foeKinds: ["bogling"] }],
        },
        { id: "gemfall-03", title: "Three", campaignId: "gemfall", position: 3, revision: "z3", estimatedMinutes: 35, predictedMinutes: { shortest: 30, typical: 36 }, scenes: 50, games: [], fights: [] },
      ],
    };

    beforeEach(async () => {
      endpoint = mcpEndpoint({ keys, signer: new FakeSigner(), timing, chapterIndex: index, now: () => T0 + 30 * 24 * 60 * MIN });
      // The edited text: three faster evenings a week later, on r2. The old text stays most played.
      for (let i = 0; i < 3; i++) await evening(`new${String(i)}`, T0 + (7 + i) * 24 * 60 * MIN, { game: 1, rounds: 3, revision: "r2" });
      for (let i = 0; i < 2; i++) await evening(`one${String(i)}`, T0 + (8 + i) * 24 * 60 * MIN, { revision: "x1", chapter: "gemfall-01" });
    });

    it("knows the current text, the plan and the prediction, and what nobody has played yet", async () => {
      const { key } = await mintKey(keys, { label: "ops read", scopes: ["operator:read"] });
      const overview = (await call(key, "timing_overview")).structuredContent!;
      const rows = overview.chapters as Array<Record<string, unknown>>;
      expect(rows.find((c) => c.chapter === "gemfall-02" && c.revision === "r2")).toMatchObject({ latest: true, current_text: true, planned_min: 30, predicted_min: { typical: 40.8 } });
      expect(rows.find((c) => c.chapter === "gemfall-02" && c.revision === "r1")).toMatchObject({ latest: false, current_text: false });
      expect(overview.current_text_not_yet_played).toEqual(["gemfall-03"]);
      expect(overview.scene_types).toEqual(expect.arrayContaining([expect.objectContaining({ type: "encounter" })]));

      const one = (await call(key, "timing_chapter", { chapter: "gemfall-02", revision: "r2" })).structuredContent!;
      expect(one).toMatchObject({ current_revision: "r2", planned_min: 30 });
      const [rev] = one.revisions as Array<Record<string, unknown>>;
      expect(rev!.games_not_yet_seen).toEqual([{ scene: "hats", game: "tracking" }]);
      expect(rev!.fights_not_yet_seen).toEqual([]);
      expect(rev!.fresh_active_by_party_size).toMatchObject({ "3": { n: 3 } });
    });

    it("compares the edited text with the one before it", async () => {
      const { key } = await mintKey(keys, { label: "ops read", scopes: ["operator:read"] });
      const c = (await call(key, "timing_compare", { chapter: "gemfall-02" })).structuredContent!;
      expect(c).toMatchObject({ before: { revision: "r1", current_text: false }, after: { revision: "r2", current_text: true }, verdict: "shorter" });
      expect(c.games).toEqual([expect.objectContaining({ scene: "jar", before_play_min: 5, after_play_min: 1, n: [4, 3] })]);
      expect(c.fights).toEqual([expect.objectContaining({ scene: "bog", before_rounds: 8, after_rounds: 3 })]);
      expect((await call(key, "timing_compare", { chapter: "gemfall-01" })).isError).toBe(true);
    });

    it("rolls games and fights up over the same revisions the rows show, unless every revision is asked for", async () => {
      const { key } = await mintKey(keys, { label: "ops read", scopes: ["operator:read"] });
      // gemfall-02: four evenings on the old text (5-minute game, 8 rounds), three on the edited one (1 minute, 3 rounds).
      const latest = (await call(key, "timing_activities", { chapter: "gemfall-02" })).structuredContent!;
      expect(latest.rollups_cover).toMatch(/current text/);
      expect(latest.games).toEqual([expect.objectContaining({ revision: "r2" })]);
      expect(latest.game_kinds).toEqual([expect.objectContaining({ game: "memory", play_min: expect.objectContaining({ n: 3, median: 1 }) })]);
      expect(latest.all_fights).toMatchObject({ sample: "n=3, preliminary", rounds: { median: 3, max: 3 } });

      const every = (await call(key, "timing_activities", { chapter: "gemfall-02", all_revisions: true })).structuredContent!;
      expect(every.rollups_cover).toMatch(/every revision/);
      expect((every.games as Array<{ revision: string }>).map((g) => g.revision).sort()).toEqual(["r1", "r2"]);
      expect(every.game_kinds).toEqual([expect.objectContaining({ game: "memory", play_min: expect.objectContaining({ n: 7, median: 5 }) })]);
      expect(every.all_fights).toMatchObject({ sample: "n=7, preliminary", rounds: { median: 8, max: 8 } });

      // The overview's roll-ups read each chapter at its current text too.
      const overview = (await call(key, "timing_overview", { chapter: "gemfall-02" })).structuredContent!;
      expect(overview.game_kinds).toEqual([expect.objectContaining({ play_min: expect.objectContaining({ n: 3 }) })]);
    });

    it("walks a campaign in order, with a rough reach by counts", async () => {
      const { key } = await mintKey(keys, { label: "ops read", scopes: ["operator:read"] });
      const list = (await call(key, "timing_campaign")).structuredContent!;
      expect(list.campaigns).toEqual([expect.objectContaining({ campaign: "gemfall", chapters: 3, chapters_played: 2, first_chapter_fresh_attempts: 2 })]);
      const camp = (await call(key, "timing_campaign", { campaign: "gemfall" })).structuredContent!;
      const rows = camp.chapters as Array<Record<string, unknown>>;
      expect(rows.map((x) => [x.chapter, x.fresh_attempts, x.reach_pct])).toEqual([["gemfall-01", 2, 100], ["gemfall-02", 8, 400], ["gemfall-03", 0, 0]]);
      expect(rows[1]).toMatchObject({ read_revision: "r2", current_text: true, completion_pct: 88, left_most_at: [{ scene: "jar", attempts: 1 }] });
      expect((await call(key, "timing_campaign", { campaign: "nope" })).isError).toBe(true);
    });

    it("buckets sittings by week", async () => {
      const { key } = await mintKey(keys, { label: "ops read", scopes: ["operator:read"] });
      const t = (await call(key, "timing_trends", { chapter: "gemfall-02" })).structuredContent!;
      const periods = t.periods as Array<{ from: string; started: number; fresh_active_min: { median: number | null } }>;
      expect(periods.reduce((n, p) => n + p.started, 0)).toBe(8);
      expect(periods.map((p) => p.from.slice(0, 10))).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
    });
  });

  it("answers without an index, and says the latest revision is a guess", async () => {
    const { key } = await mintKey(keys, { label: "ops read", scopes: ["operator:read"] });
    expect((await call(key, "timing_overview")).structuredContent!.chapter_index).toMatch(/absent/);
    expect((await call(key, "timing_campaign")).isError).toBe(true);
  });

  it("excludes a sitting from every figure, lists it as excluded, and counts it again on include", async () => {
    const { key } = await mintKey(keys, { label: "ops", scopes: ["operator:write"] });
    const sittings = (await call(key, "timing_sittings", { status: "closed" })).structuredContent!;
    expect(sittings.sittings).toEqual([expect.objectContaining({ id: "left:1", last_scene: "jar" })]);

    expect((await call(key, "timing_exclude", { sitting_id: "nope:1", reason: "a test" })).isError).toBe(true);
    const done = (await call(key, "timing_exclude", { sitting_id: "left:1", reason: "a developer test on prod", chapter: "gemfall-02" })).structuredContent!;
    expect(done).toMatchObject({ excluded: { sittingId: "left:1", by: "ops" }, chapter: "gemfall-02" });
    expect((await call(key, "timing_overview")).structuredContent).toMatchObject({ sittings: 4, excluded: 1 });
    const listed = (await call(key, "timing_sittings", { excluded: true })).structuredContent!;
    expect(listed.sittings).toEqual([expect.objectContaining({ id: "left:1", excluded: expect.objectContaining({ reason: "a developer test on prod" }) })]);

    expect((await call(key, "timing_include", { sitting_id: "left:1" })).structuredContent).toMatchObject({ was_excluded: true });
    expect((await call(key, "timing_overview")).structuredContent).toMatchObject({ sittings: 5, excluded: 0 });
  });
});

describe("the Lambda adapter", () => {
  it("turns an HTTP API v2 event into the request the endpoint reads, and back", async () => {
    const event = {
      rawPath: "/api/mcp",
      rawQueryString: "a=1",
      headers: { host: "kd.example", authorization: "Bearer kadmcp_x.y", "content-type": "application/json" },
      requestContext: { http: { method: "POST" }, domainName: "abc.execute-api.us-east-1.amazonaws.com" },
      body: Buffer.from('{"jsonrpc":"2.0"}').toString("base64"),
      isBase64Encoded: true,
    } as unknown as APIGatewayProxyEventV2;
    const request = toRequest(event);
    expect(request.url).toBe("https://kd.example/api/mcp?a=1");
    expect(request.headers.get("authorization")).toBe("Bearer kadmcp_x.y");
    expect(await request.text()).toBe('{"jsonrpc":"2.0"}');
    const result = await toResult(new Response("ok", { status: 201, headers: { "x-a": "b" } }));
    expect(result).toEqual({ statusCode: 201, headers: { "x-a": "b", "content-type": "text/plain;charset=UTF-8" }, body: "ok" });
  });
});
