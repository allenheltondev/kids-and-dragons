import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { CLIP_CACHE_CONTROL } from "../../packages/shared/src/voice-clips";
import { DirClipStore, MemoryClipStore, S3ClipStore, StoreSet } from "./store";

const KEY = "ab".repeat(32);
const BYTES = Buffer.from("opus");

/** An S3 client that records its commands and answers from a script. */
function fakeS3(answer: (command: unknown) => unknown) {
  const sent: unknown[] = [];
  return {
    sent,
    client: {
      send: (command: unknown) => {
        sent.push(command);
        try {
          return Promise.resolve(answer(command));
        } catch (error) {
          return Promise.reject(error);
        }
      },
    } as never,
  };
}

const httpError = (status: number, name: string) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

describe("the S3 clip store", () => {
  it("uploads under voice/ with the immutable header, and never over an existing clip", async () => {
    const s3 = fakeS3(() => ({}));
    const store = new S3ClipStore(s3.client, "kad-site-prod-1");
    expect(await store.put(KEY, BYTES, { ms: 2500 })).toBe(true);
    const put = s3.sent[0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({
      Bucket: "kad-site-prod-1",
      Key: `voice/ab/${KEY}.webm`,
      ContentType: "audio/webm",
      CacheControl: CLIP_CACHE_CONTROL,
      Metadata: { ms: "2500" },
      IfNoneMatch: "*",
    });
    expect(CLIP_CACHE_CONTROL).toContain("immutable");
  });

  it("treats the conditional write failing as 'already there', not as an error", async () => {
    const s3 = fakeS3(() => {
      throw httpError(412, "PreconditionFailed");
    });
    expect(await new S3ClipStore(s3.client, "b").put(KEY, BYTES, { ms: 1 })).toBe(false);
  });

  it("surfaces every other failure, so a bad credential is not mistaken for a cache hit", async () => {
    const s3 = fakeS3(() => {
      throw httpError(403, "AccessDenied");
    });
    await expect(new S3ClipStore(s3.client, "b").put(KEY, BYTES, { ms: 1 })).rejects.toThrow("AccessDenied");
    await expect(new S3ClipStore(s3.client, "b").head(KEY)).rejects.toThrow("AccessDenied");
  });

  it("reads a clip's length back from its metadata, and null when it is not there", async () => {
    const there = fakeS3(() => ({ Metadata: { ms: "2500" } }));
    expect(await new S3ClipStore(there.client, "b").head(KEY)).toEqual({ ms: 2500 });
    expect(there.sent[0]).toBeInstanceOf(HeadObjectCommand);
    const missing = fakeS3(() => {
      throw httpError(404, "NotFound");
    });
    expect(await new S3ClipStore(missing.client, "b").head(KEY)).toBeNull();
  });

  it("refuses a key that is not a clip key, so it can only ever write inside voice/", async () => {
    const s3 = fakeS3(() => ({}));
    await expect(new S3ClipStore(s3.client, "b").put("../assets/x", BYTES, { ms: 1 })).rejects.toThrow("not a clip key");
    expect(s3.sent).toHaveLength(0);
  });
});

describe("the folder store", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  it("lays clips out as the bucket does, with their length, and never replaces one", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kad-clips-"));
    dirs.push(dir);
    const store = new DirClipStore(dir);
    expect(await store.head(KEY)).toBeNull();
    expect(await store.put(KEY, BYTES, { ms: 900 })).toBe(true);
    expect(fs.readFileSync(path.join(dir, `voice/ab/${KEY}.webm`))).toEqual(BYTES);
    expect(await store.head(KEY)).toEqual({ ms: 900 });
    expect(await store.put(KEY, Buffer.from("other"), { ms: 1 })).toBe(false);
    expect(fs.readFileSync(path.join(dir, `voice/ab/${KEY}.webm`))).toEqual(BYTES);
  });
});

describe("several destinations at once", () => {
  it("has a clip only when every destination does, and writes to the ones that lack it", async () => {
    const a = new MemoryClipStore();
    const b = new MemoryClipStore();
    await a.put(KEY, BYTES, { ms: 5 });
    const both = new StoreSet([a, b]);
    expect(await both.head(KEY)).toBeNull();
    expect(await both.put(KEY, BYTES, { ms: 5 })).toBe(true);
    expect(b.clips.has(KEY)).toBe(true);
    expect(await both.head(KEY)).toEqual({ ms: 5 });
  });
});
