/**
 * Losing the signal in the middle of a room (#413), against the real stack: a
 * TV, and a phone whose story question is on screen.
 *
 *   - Offline, the phone says it is reconnecting and offers no answer at all:
 *     a tap does nothing, and nothing reaches the server. The story moves on
 *     without it. Back online, it catches up to the question that is open now,
 *     and only then offers answers again.
 *   - A tap already on its way when the story moved on (held here at the
 *     network) is never applied to the next question, even one that offers
 *     the very same choice: the phone says the story moved on, and asks again.
 *
 * The story is moved on as the dev playtest jump moves it (playtest.ts),
 * sent by the test with the phone's own token, so the spec is about the
 * phone, not about the route.
 */

import { test, expect, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import { createCharacter } from "./characters";
import { openPlayerTask } from "./player-navigation";

const TAP = { timeout: 20_000 } as const;
const API = "http://localhost:8787";

interface State {
  runId: string;
  seq: number;
  phase: string;
  sceneId: string | null;
  visited?: string[];
  prompt: { kind: string; options?: { id: string; label: string }[] } | null;
}
type Session = { playerId: string; sessionToken: string };

async function sessionOf(page: Page, code: string): Promise<Session> {
  return page.evaluate((room) => {
    const saved = localStorage.getItem(`kad.session.${room}`);
    return saved ? (JSON.parse(saved) as Session) : { playerId: "", sessionToken: "" };
  }, code);
}

/** The server's state, read from the test runner (which the phone's offline switch does not touch). */
async function readState(code: string, token: string): Promise<State> {
  const response = await fetch(`${API}/api/state?code=${code}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`state for ${code}: ${response.status}`);
  return ((await response.json()) as { state: State }).state;
}

/** Move the story on as the phone's player, from the test runner. */
async function jump(session: Session, code: string, sceneId: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await readState(code, session.sessionToken);
    const response = await fetch(`${API}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.sessionToken}` },
      body: JSON.stringify({
        runId: state.runId,
        playerId: session.playerId,
        seq: state.seq,
        intent: { type: "PLAYTEST_GOTO", sceneId },
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: { code?: string } };
    if (body.ok) return;
    if (body.error?.code !== "STALE_SEQ") throw new Error(`jump to ${sceneId}: ${JSON.stringify(body)}`);
  }
  throw new Error(`jump to ${sceneId} kept losing the seq race`);
}

test.describe("losing the signal in a room", () => {
  const openContexts: BrowserContext[] = [];

  async function device(browser: Browser, width = 390, height = 844): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height } });
    openContexts.push(context);
    return context.newPage();
  }

  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  test("offers no answer while away, catches up after, and never lands a stale tap", async ({ browser }) => {
    test.setTimeout(240_000);

    // --- A TV opens the room; one phone joins and begins ---
    const tv = await device(browser, 1280, 720);
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/);
    const code = new URL(tv.url()).pathname.split("/").pop()!;

    const sam = await device(browser);
    const samErrors: string[] = [];
    sam.on("pageerror", (e) => samErrors.push(e.message));
    await sam.goto("/");
    await sam.getByLabel(/room code/i).fill(code);
    await sam.getByRole("button", { name: /join a game/i }).click();
    await expect(sam).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    await createCharacter(sam, "unicorn", "Sam");
    const session = await sessionOf(sam, code);
    const state = (): Promise<State> => readState(code, session.sessionToken);

    await sam.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect.poll(async () => (await state()).sceneId, TAP).toBe("scene_hedge_wall");
    await openPlayerTask(sam);
    const choices = sam.locator(".prompt .choice");
    await expect(choices.filter({ hasText: "Listen first" })).toBeEnabled(TAP);

    // --- Offline: it says so, and offers nothing ---
    await sam.context().setOffline(true);
    // Offline, the banner says so in its own words (#460), not "Reconnecting".
    await expect(sam.getByText("No signal. Waiting for Wi-Fi…")).toBeVisible(TAP);
    await expect(choices.filter({ hasText: "Listen first" })).toBeDisabled(TAP);
    expect(await choices.evaluateAll((buttons) => buttons.filter((b) => !(b as HTMLButtonElement).disabled).length)).toBe(0);

    // A tap does nothing: no pick, no confirm, nothing sent.
    const before = await state();
    await choices.filter({ hasText: "Listen first" }).click({ force: true });
    await expect(sam.getByRole("button", { name: /do it!/i })).toBeHidden();
    expect((await state()).seq).toBe(before.seq);

    // The story moves on without this phone.
    await jump(session, code, "scene_first_clearing");
    expect((await state()).sceneId).toBe("scene_first_clearing");

    // --- Back online: it catches up to the question open now, then offers it ---
    await sam.context().setOffline(false);
    await expect(sam.getByText("No signal. Waiting for Wi-Fi…")).toBeHidden(TAP);
    await expect(sam.getByText("Reconnecting…")).toBeHidden(TAP);
    await openPlayerTask(sam);
    await expect(choices.filter({ hasText: "Say hello" })).toBeEnabled(TAP);
    await expect(choices.filter({ hasText: "Listen first" })).toHaveCount(0);
    expect((await state()).sceneId).toBe("scene_first_clearing");

    // --- A tap on its way while the story moves on: never the next question's answer ---
    await jump(session, code, "scene_hedge_wall");
    await openPlayerTask(sam);
    await expect(choices.filter({ hasText: "Listen first" })).toBeEnabled(TAP);

    // Hold this phone's next answer at the network, as a slow signal would.
    let held: Route | null = null;
    await sam.route("**/api/action", async (route) => {
      if (held === null && route.request().postDataJSON()?.intent?.type === "CHOOSE") {
        held = route;
        return;
      }
      await route.continue();
    });
    await choices.filter({ hasText: "Listen first" }).click(TAP);
    await sam.getByRole("button", { name: /do it!/i }).click(TAP);
    await expect.poll(() => held !== null, TAP).toBe(true);

    // Meanwhile the party goes on and comes back round to the hedge: a new
    // question that offers the very same "Listen first".
    const trail = (await state()).visited?.length ?? 0;
    await jump(session, code, "scene_humming");
    await jump(session, code, "scene_hedge_wall");
    const revisit = await state();
    expect(revisit.sceneId).toBe("scene_hedge_wall");
    expect(revisit.visited?.length).toBe(trail + 2);

    // The held tap arrives late. It is not this question's answer.
    await (held as unknown as Route).continue();
    await expect(sam.getByRole("alert").filter({ hasText: "The story moved on. Choose again." })).toBeVisible(TAP);
    const after = await state();
    expect(after.seq).toBe(revisit.seq);
    expect(after.sceneId).toBe("scene_hedge_wall");
    expect(after.visited?.length).toBe(trail + 2);

    // And the question open now is there to answer.
    await sam.unroute("**/api/action");
    await openPlayerTask(sam);
    await choices.filter({ hasText: "Listen first" }).click(TAP);
    await sam.getByRole("button", { name: /do it!/i }).click(TAP);
    await expect.poll(async () => (await state()).sceneId, TAP).toBe("scene_humming");

    expect(samErrors).toEqual([]);
  });

  test("says there is no signal while offline, then catches up", async ({ browser }) => {
    test.setTimeout(180_000);

    const tv = await device(browser, 1280, 720);
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/);
    const code = new URL(tv.url()).pathname.split("/").pop()!;

    const sam = await device(browser);
    await sam.goto("/");
    await sam.getByLabel(/room code/i).fill(code);
    await sam.getByRole("button", { name: /join a game/i }).click();
    await expect(sam).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    await createCharacter(sam, "unicorn", "Sam");
    const session = await sessionOf(sam, code);

    await sam.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect.poll(async () => (await readState(code, session.sessionToken)).sceneId, TAP).toBe("scene_hedge_wall");
    await openPlayerTask(sam);
    const choices = sam.locator(".prompt .choice");
    await expect(choices.filter({ hasText: "Listen first" })).toBeEnabled(TAP);

    // Offline: the banner names the missing signal and offers no retry.
    await sam.context().setOffline(true);
    await expect(sam.getByText("No signal. Waiting for Wi-Fi…")).toBeVisible(TAP);
    await expect(sam.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(choices.filter({ hasText: "Listen first" })).toBeDisabled(TAP);

    // The story moves on without this phone.
    await jump(session, code, "scene_first_clearing");

    // Back online: the room catches up and the banner goes.
    await sam.context().setOffline(false);
    await expect(sam.getByText("No signal. Waiting for Wi-Fi…")).toBeHidden(TAP);
    await expect(sam.getByText("Reconnecting…")).toBeHidden(TAP);
    await openPlayerTask(sam);
    await expect(choices.filter({ hasText: "Say hello" })).toBeEnabled(TAP);
    await expect(choices.filter({ hasText: "Listen first" })).toHaveCount(0);
  });

  test("a room gone while the phone was offline says so, and leads home (#470)", async ({ browser }) => {
    test.setTimeout(180_000);
    // --- A TV opens the room; a phone joins with a hero ---
    const tv = await device(browser, 1280, 720);
    await tv.goto("/");
    await tv.getByRole("button", { name: /host a game/i }).click();
    await tv.getByText("Party Mode").click();
    await tv.getByRole("button", { name: /open the lobby here/i }).click();
    await expect(tv).toHaveURL(/\/tv\/[A-Z]{4}$/);
    const code = new URL(tv.url()).pathname.split("/").pop()!;
    const guest = await device(browser);
    await guest.goto("/");
    await guest.getByLabel(/room code/i).fill(code);
    await guest.getByRole("button", { name: /join a game/i }).click();
    await expect(guest).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    await createCharacter(guest, "unicorn", "Rosie");
    await expect(guest.getByRole("button", { name: "You", exact: true })).toBeVisible(TAP);

    // --- The guest drops off the network ---
    await guest.context().setOffline(true);
    await expect(guest.getByText("No signal. Waiting for Wi-Fi…")).toBeVisible(TAP);

    // --- Meanwhile the room expires: the server no longer knows it. (A host
    // closing the room is a different case: the state itself says `closed`,
    // and every screen leaves. This is the room being gone altogether, which
    // only the catch-up fetch can find out.) ---
    await guest.route("**/api/state**", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "No such room." } }) }),
    );
    await guest.route("**/events/**", (route) => route.abort());

    // --- The guest comes back: not "Reconnecting" forever, but the truth ---
    // (Playwright's offline switch flips `navigator.onLine` but fires no
    // `online` event; a real phone does, so it is dispatched here.)
    await guest.context().setOffline(false);
    await guest.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(guest.getByText("This game has ended or the phone was signed out.")).toBeVisible(TAP);
    await expect(guest.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(guest.getByText("Reconnecting…")).toBeHidden();

    // --- "Back to the start" lands on the home screen ---
    await guest.getByRole("button", { name: "Back to the start" }).click();
    await expect(guest).toHaveURL(/\/$/, TAP);
    await expect(guest.getByRole("button", { name: /host a game/i })).toBeVisible(TAP);
  });
});
