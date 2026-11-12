import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { startCountingProxy } from "../../e2e/counting-proxy";

it("waits for asset bodies but can settle while the event stream keeps sending heartbeats", async () => {
  let finishedAsset = false;
  let heartbeats = 0;
  const upstream = createServer((req, res) => {
    if (req.url === "/events/room") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const timer = setInterval(() => { heartbeats++; res.write(": heartbeat\n\n"); }, 5);
      res.on("close", () => clearInterval(timer));
    } else {
      res.writeHead(200);
      res.write("first");
      setTimeout(() => { finishedAsset = true; res.end("last"); }, 100);
    }
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const proxy = await startCountingProxy(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`);
  const controller = new AbortController();
  try {
    await fetch(`${proxy.url}/events/room`, { signal: controller.signal });
    const asset = await fetch(`${proxy.url}/assets/scene.webp`);
    await proxy.settled(30, 2_000);
    expect(finishedAsset).toBe(true);
    expect(heartbeats).toBeGreaterThan(1);
    expect(await asset.text()).toBe("firstlast");
    expect(proxy.report().art.bodies).toBe(1);
  } finally {
    controller.abort();
    upstream.closeAllConnections();
    await proxy.close();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});
