import { describe, expect, it, vi } from "vitest";
import type { ChannelMessage } from "@kad/shared";
import { LocalSseChannel, type SseSink } from "./room-channel.ts";

function patch(seq: number): ChannelMessage {
  return { kind: "patch", seq, runId: "r_1", patch: [{ op: "replace", path: "/seq", value: seq }] };
}

/** A fake `http.ServerResponse`, down to the close listener. */
function fakeSink(): SseSink & { chunks: string[]; close(): void; headers: Record<string, string> } {
  const chunks: string[] = [];
  let headers: Record<string, string> = {};
  const closers: (() => void)[] = [];
  return {
    chunks,
    get headers() {
      return headers;
    },
    writeHead: (_status, h) => {
      headers = h;
    },
    write: (chunk: string) => chunks.push(chunk),
    end: () => undefined,
    on: (_event, listener) => closers.push(listener),
    close: () => closers.forEach((c) => c()),
  };
}

describe("LocalSseChannel", () => {
  it("fans a publish out to every subscriber on that room only", async () => {
    const channel = new LocalSseChannel();
    const tv: ChannelMessage[] = [];
    const phone: ChannelMessage[] = [];
    const other: ChannelMessage[] = [];
    channel.subscribe("ABCD", (m) => tv.push(m));
    channel.subscribe("ABCD", (m) => phone.push(m));
    channel.subscribe("WXYZ", (m) => other.push(m));

    await channel.publish("ABCD", patch(1));

    expect(tv).toEqual([patch(1)]);
    expect(phone).toEqual([patch(1)]);
    expect(other).toEqual([]);
    expect(channel.subscriberCount("ABCD")).toBe(2);
  });

  it("keeps publishing when one subscriber throws", async () => {
    const channel = new LocalSseChannel();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const good: ChannelMessage[] = [];
    channel.subscribe("ABCD", () => {
      throw new Error("the TV went away");
    });
    channel.subscribe("ABCD", (m) => good.push(m));

    await channel.publish("ABCD", patch(1));

    expect(good).toHaveLength(1);
    warn.mockRestore();
  });

  it("replays a bounded buffer and refuses a gap it cannot cover", async () => {
    const channel = new LocalSseChannel({ replayLimit: 3 });
    for (let seq = 1; seq <= 5; seq++) await channel.publish("ABCD", patch(seq));

    expect(channel.replay("ABCD", 3)?.map((m) => m.seq)).toEqual([4, 5]);
    expect(channel.replay("ABCD", 2)?.map((m) => m.seq)).toEqual([3, 4, 5]);
    // seq 2 has already rolled out of the buffer, so this client needs a
    // snapshot from GET /state, not a partial replay (§4.3).
    expect(channel.replay("ABCD", 1)).toBeNull();
    expect(channel.replay("NOPE", 0)).toBeNull();
  });

  it("writes SSE frames with the seq as the event id", async () => {
    const channel = new LocalSseChannel();
    const sink = fakeSink();
    const detach = channel.attach("ABCD", sink);

    expect(sink.headers["Content-Type"]).toBe("text/event-stream");
    await channel.publish("ABCD", patch(7));

    const frame = sink.chunks.at(-1) ?? "";
    // `id:` is what the browser echoes back as Last-Event-ID after a drop.
    expect(frame).toContain("id: 7\n");
    expect(frame).toContain("event: patch\n");
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(JSON.parse(frame.slice(frame.indexOf("data: ") + 6))).toEqual(patch(7));

    detach();
    await channel.publish("ABCD", patch(8));
    expect(sink.chunks.at(-1)).toContain("id: 7");
  });

  it("replays the missed frames on attach, and unsubscribes when the socket closes", async () => {
    const channel = new LocalSseChannel();
    for (let seq = 1; seq <= 3; seq++) await channel.publish("ABCD", patch(seq));

    const sink = fakeSink();
    channel.attach("ABCD", sink, { sinceSeq: 1 });
    expect(sink.chunks.filter((c) => c.startsWith("id: ")).map((c) => c.slice(4, 5))).toEqual([
      "2",
      "3",
    ]);

    expect(channel.subscriberCount("ABCD")).toBe(1);
    sink.close();
    expect(channel.subscriberCount("ABCD")).toBe(0);
  });
});
