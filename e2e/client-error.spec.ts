/**
 * A thrown error on the phone, the TV and the tablet each sends one scrubbed
 * report to our own endpoint, and the server accepts it (#317). The server's
 * log line is the same scrubbed body (handlers/client-error.test.ts).
 */

import { test, expect, type Page } from "@playwright/test";

const LAYOUTS = [
  { layout: "phone", path: "/", size: { width: 390, height: 844 } },
  { layout: "tablet", path: "/", size: { width: 820, height: 1180 } },
  { layout: "tv", path: "/tv/ABCD", size: { width: 1920, height: 1080 } },
] as const;

async function throwOutsideReact(page: Page): Promise<void> {
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("tripped on 'Maya the Brave' in room WXYZ for maya@example.com");
    }, 0);
  });
}

for (const { layout, path, size } of LAYOUTS) {
  test(`a thrown error on the ${layout} sends one scrubbed report`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto(path);
    await page.waitForLoadState("networkidle");

    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/client-error")) requests.push(r.postData() ?? "");
    });
    const response = page.waitForResponse((r) => r.url().endsWith("/api/client-error"));
    await throwOutsideReact(page);

    expect((await response).status()).toBe(204);
    await page.waitForTimeout(500);
    expect(requests).toHaveLength(1);
    const body = JSON.parse(requests[0]!) as Record<string, unknown>;
    expect(body).toMatchObject({ message: "Error: other", layout, route: path === "/" ? "/" : "/tv/:code" });
    expect(requests[0]).not.toMatch(/maya|WXYZ|example\.com|ABCD/i);
  });
}

// The listener is the first import in main.tsx, so a lazy chunk that fails to
// load (the sound engine, #318) is reported as a kind of failure, not lost.
test("a lazy chunk that fails to load is reported", async ({ page }) => {
  await page.route(/\/(?:src\/audio\/(?:engine|AudioControl)\.tsx?|bundle\/audio-[^/]*\.js)(?:\?|$)/, (route) =>
    route.abort(),
  );
  const response = page.waitForResponse((r) => r.url().endsWith("/api/client-error"));
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/client-error"));
  await page.goto("/");

  expect((await response).status()).toBe(204);
  const body = JSON.parse((await sent).postData() ?? "{}") as Record<string, unknown>;
  expect(body).toMatchObject({ message: expect.stringMatching(/^\w*Error: a chunk failed to load$/), route: "/" });
});
