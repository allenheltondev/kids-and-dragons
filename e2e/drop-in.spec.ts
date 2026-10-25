/**
 * Drop in, drop out (#258), against the real stack: a Party Mode room, a TV
 * and two phones, and one of them steps away at every point the game waits
 * on a player. Each time the table goes on without them, the TV says who
 * stepped away (not knocked down), and the phone that comes back is in its
 * seat with its hero, told in one line what is going on. A third kid joins
 * partway and gets the same line.
 *
 * Presence runs as production has it (playwright.config.ts): heartbeats only,
 * no stream-based presence, with a shorter timeout so a test can wait for it.
 * "Stepping away" is the phone leaving the game page, which says goodbye; one
 * phone also goes silently offline, as a phone that dies does, and is noticed
 * by the timeout. Coming back is opening the room again. The scene each step needs is reached with the dev playtest jump
 * (playtest.ts), so the spec is about absence, not about the route.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { guidePicture } from "./guide-pictures";
import { openPlayerTask } from "./player-navigation";
import { API } from "./api";
import { phoneStorage, seedTable, toTheLobby, tvStorage, type StorageState } from "./seed";

const TAP = { timeout: 20_000 } as const;

interface Member {
  playerId: string;
  connected: boolean;
  ready: boolean;
  character: { id: string; name: string };
}
interface Combatant {
  id: string;
  side: "party" | "enemy";
  down: boolean;
  hp: number;
}
interface State {
  runId: string;
  seq: number;
  phase: string;
  sceneId: string | null;
  party: Member[];
  prompt: { kind: string } | null;
  encounter?: {
    combatants: Combatant[];
    order: string[];
    turnIndex: number;
    encoreActor: string | null;
    board: { actors: { id: string }[] };
  } | null;
}

/** The session this phone saved when it joined. */
async function sessionOf(page: Page, code: string): Promise<{ playerId: string; sessionToken: string }> {
  return page.evaluate((room) => {
    const saved = localStorage.getItem(`kad.session.${room}`);
    return saved ? (JSON.parse(saved) as { playerId: string; sessionToken: string }) : { playerId: "", sessionToken: "" };
  }, code);
}

/**
 * The server's state, read with a session token saved earlier: a phone that
 * has stepped away has left the page, and its storage with it, but its token
 * still names somebody in the room (room-state.ts reads it off the page).
 */
async function readState(code: string, token: string): Promise<State> {
  const response = await fetch(`${API}/api/state?code=${code}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`state for ${code}: ${response.status}`);
  return ((await response.json()) as { state: State }).state;
}

type Session = { playerId: string; sessionToken: string };

/**
 * Send an intent as this phone, with its own token. Only for the playtest
 * jump and for turns the spec is not about; everything under test is tapped.
 */
async function act(session: Session, code: string, intent: Record<string, unknown>): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await readState(code, session.sessionToken);
    const response = await fetch(`${API}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.sessionToken}` },
      body: JSON.stringify({ runId: state.runId, playerId: session.playerId, seq: state.seq, intent }),
    });
    if (response.ok) return;
    const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    // Somebody else's patch landed first: read again and resend.
    if (body.error?.code !== "STALE_SEQ") throw new Error(`${String(intent.type)}: ${JSON.stringify(body)}`);
  }
  throw new Error(`${String(intent.type)} kept losing the seq race`);
}

/** The current actor's id, as the engine's `currentActorId` reads it. */
function actorId(state: State): string | null {
  const encounter = state.encounter;
  if (!encounter) return null;
  return encounter.encoreActor ?? encounter.order[encounter.turnIndex] ?? null;
}

test.describe("drop in, drop out", () => {
  const openContexts: BrowserContext[] = [];

  async function device(
    browser: Browser,
    width = 390,
    height = 844,
    storageState?: StorageState,
  ): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height }, ...(storageState ? { storageState } : {}) });
    openContexts.push(context);
    return context.newPage();
  }

  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  test("a phone steps away and comes back at every point the game waits on it", async ({ browser }) => {
    test.setTimeout(420_000);

    // --- The TV's room, with two phones' heroes made and ready ---
    // Seeded (seed.ts): Sam first, so Sam holds the first story turn (spec §6.1).
    // Joining and making a hero are first-playable's; Pip, below, still walks them.
    const table = await seedTable({
      mode: "party",
      tv: true,
      heroes: [
        { name: "Sam", species: "unicorn" },
        { name: "Rosie", species: "griffin" },
      ],
    });
    const code = table.code;
    const tv = await device(browser, 1280, 720, tvStorage(table));
    const tvErrors: string[] = [];
    tv.on("pageerror", (e) => tvErrors.push(e.message));
    await tv.goto(`/tv/${code}`);

    async function join(page: Page): Promise<void> {
      await page.goto("/");
      await page.getByLabel(/room code/i).fill(code);
      await page.getByRole("button", { name: /join a game/i }).click();
      await expect(page).toHaveURL(new RegExp(`/p/${code}$`), TAP);
    }

    const sam = await device(browser, 390, 844, phoneStorage(table.phones[0]!));
    await sam.goto(`/p/${code}`);
    await toTheLobby(sam);
    const rosie = await device(browser, 390, 844, phoneStorage(table.phones[1]!));
    await rosie.goto(`/p/${code}`);
    await toTheLobby(rosie);

    const samSession: Session = await sessionOf(sam, code);
    const state = (): Promise<State> => readState(code, samSession.sessionToken);
    const memberNamed = async (name: string): Promise<Member> =>
      (await state()).party.find((m) => m.character.name === name)!;

    /** Off the game page: the stream closes and presence marks them away. */
    async function stepAway(page: Page, name: string): Promise<void> {
      await page.goto("about:blank");
      await expect.poll(async () => (await memberNamed(name)).connected, TAP).toBe(false);
    }
    /** Back to the room: same seat, same hero, and a line saying what is going on. */
    async function comeBack(page: Page, name: string, expectCatchUp = true): Promise<void> {
      await page.goto(`/p/${code}`);
      await expect.poll(async () => (await memberNamed(name)).connected, TAP).toBe(true);
      if (expectCatchUp) {
        await expect(page.getByTestId("catch-up")).toContainText(`Welcome back, ${name}!`, TAP);
      }
      // The TV stops saying they are away.
      await expect(tv.getByTestId("stepped-away").filter({ hasText: name })).toHaveCount(0, TAP);
    }
    const tvSaysAway = (name: string) =>
      expect(tv.getByTestId("stepped-away")).toContainText(`${name} stepped away.`, TAP);

    // --- The lobby: Begin does not wait on a friend who stepped away ---
    await expect(sam.getByRole("button", { name: /wait, not yet/i })).toBeVisible(TAP);
    await expect(rosie.getByRole("button", { name: /wait, not yet/i })).toBeVisible(TAP);
    await sam.getByRole("button", { name: /begin the adventure/i }).click(TAP);
    await expect.poll(async () => (await state()).phase, TAP).toBe("scene");

    // --- A story turn: Sam's, and Sam steps away; anyone may answer ---
    await stepAway(sam, "Sam");
    await tvSaysAway("Sam");
    await guidePicture(tv, "stepped-away");
    const firstScene = (await state()).sceneId;
    await openPlayerTask(rosie);
    await rosie.locator(".prompt .choice").first().click(TAP);
    await rosie.getByRole("button", { name: /do it!/i }).click(TAP);
    await expect.poll(async () => (await state()).sceneId, TAP).not.toBe(firstScene);
    await comeBack(sam, "Sam");
    await guidePicture(sam, "catch-up");
    // And the TV says where the party has got to (#357), with nothing tapped.
    await expect(tv.getByTestId("chapter-preface")).toHaveAttribute("data-kind", "back", TAP);
    await expect(tv.getByTestId("chapter-preface")).toContainText("Where you left off");

    // --- A phone that dies: no goodbye, it just goes quiet ---
    // Offline, its heartbeats stop; Sam's next beat after the timeout notices.
    await rosie.context().setOffline(true);
    await expect.poll(async () => (await memberNamed("Rosie")).connected, { timeout: 120_000 }).toBe(false);
    await tvSaysAway("Rosie");
    // Signal back: her next beat marks her here again, without a tap.
    await rosie.context().setOffline(false);
    await expect.poll(async () => (await memberNamed("Rosie")).connected, { timeout: 60_000 }).toBe(true);
    await expect(tv.getByTestId("stepped-away").filter({ hasText: "Rosie" })).toHaveCount(0, TAP);

    // --- A late joiner: Pip sits down partway, and is told what is going on ---
    const pip = await device(browser);
    await join(pip);
    // Mid-chapter, the dev playtest toggle sits over the creation flow's Next.
    // It does not exist in a production build; take it out of the way here.
    await pip.addStyleTag({ content: ".playtest { display: none !important; }" });
    await pip.getByRole("button", { name: /bigfoot/i }).first().click(TAP);
    await pip.getByRole("button", { name: /^next$/i }).click(TAP);
    await pip.locator("button").filter({ hasText: /thornguard|duskrunner|starweaver|songkeeper/i }).first().click(TAP);
    await pip.getByRole("button", { name: /^next$/i }).click(TAP);
    for (let i = 0; i < 12; i++) {
      const adds = pip.getByRole("button", { name: /add a point to/i });
      if ((await adds.count()) === 0) break;
      await adds.first().click(TAP);
    }
    await pip.getByRole("button", { name: /^next$/i }).click(TAP);
    await pip.getByPlaceholder("Tap to type").fill("Pip", TAP);
    await pip.getByRole("button", { name: /that's me/i }).click(TAP);
    await expect(pip.getByTestId("catch-up")).toContainText("Welcome, Pip!", TAP);
    // Pip is somebody the rest of this spec does not wait on: off they go.
    // Closing says goodbye when the browser gets it out in time; when it does
    // not, Pip simply goes quiet and the table's next beat after the timeout
    // notices. Either way Pip is away within the timeout and one heartbeat.
    await pip.context().close();
    await expect.poll(async () => (await memberNamed("Pip")).connected, { timeout: 120_000 }).toBe(false);

    // --- A vote: Sam votes, Rosie steps away, Sam closes it ---
    await act(samSession, code, { type: "PLAYTEST_GOTO", sceneId: "choice_point_path" });
    await openPlayerTask(sam);
    await sam.locator(".prompt .choice").first().click(TAP);
    await sam.getByRole("button", { name: /do it!/i }).click(TAP);
    await expect.poll(async () => Object.keys(((await state()).prompt as { votes?: object }).votes ?? {}).length, TAP).toBe(1);
    await stepAway(rosie, "Rosie");
    // Pip, away since sitting down, has not voted either, and is named too.
    await sam.getByRole("button", { name: "Decide without Rosie and Pip" }).click(TAP);
    await expect.poll(async () => (await state()).sceneId, TAP).not.toBe("choice_point_path");
    await comeBack(rosie, "Rosie");

    // --- The ready-up before a fight: Rosie drops after Sam said ready ---
    await act(samSession, code, { type: "PLAYTEST_GOTO", sceneId: "encounter_bramblewisps" });
    await openPlayerTask(sam);
    await sam.getByRole("button", { name: /i'm ready to fight/i }).click(TAP);
    await stepAway(rosie, "Rosie");
    await sam.getByRole("button", { name: "Start without Rosie and Pip" }).click(TAP);
    await expect.poll(async () => Boolean((await state()).encounter), TAP).toBe(true);

    // --- Combat turns: Rosie's comes round while she is away; Sam passes it ---
    const rosieHero = (await memberNamed("Rosie")).character.id;
    const samHero = (await memberNamed("Sam")).character.id;
    const pipHero = (await memberNamed("Pip")).character.id;
    let passed = false;
    for (let step = 0; step < 30 && !passed; step++) {
      const now = await state();
      if (!now.encounter) break;
      const on = actorId(now);
      if (on === rosieHero) {
        await expect(tv.getByTestId("stepped-away")).toContainText("Rosie stepped away. Any phone can pass their turn.", TAP);
        await openPlayerTask(sam);
        await sam.getByRole("button", { name: /^Pass Rosie.s turn$/ }).click(TAP);
        await expect.poll(async () => actorId(await state()), TAP).not.toBe(rosieHero);
        passed = true;
      } else if (on === samHero || on === pipHero) {
        // Sam's own turn, or Pip's passed as a stand-in: not what this step is about.
        await act(samSession, code, { type: "END_TURN" });
      } else {
        await sam.waitForTimeout(500);
      }
    }
    expect(passed, "Rosie's turn never came round to pass").toBe(true);

    // She comes back to the same fight, on the board, in the turn order.
    await comeBack(rosie, "Rosie");
    const back = await state();
    if (back.encounter) {
      expect(back.encounter.order).toContain(rosieHero);
      expect(back.encounter.board.actors.some((a) => a.id === rosieHero)).toBe(true);
      // And the clock comes back to her, unless the wisps knocked her down meanwhile.
      let hers = false;
      for (let step = 0; step < 30 && !hers; step++) {
        const now = await state();
        if (!now.encounter) break;
        const on = actorId(now);
        if (on === rosieHero) hers = true;
        else if (on === samHero || on === pipHero) await act(samSession, code, { type: "END_TURN" });
        else if (now.encounter.combatants.find((c) => c.id === rosieHero)?.down) break;
        else await sam.waitForTimeout(500);
      }
      if (hers) {
        await openPlayerTask(rosie);
        await expect(rosie.locator(".sheet--turn")).toContainText("Rosie", TAP);
      }
    }

    // --- A rest: nothing there waits on Rosie; Sam leads the way on ---
    await act(samSession, code, { type: "PLAYTEST_GOTO", sceneId: "rest_mossbank" });
    await stepAway(rosie, "Rosie");
    await tvSaysAway("Rosie");
    await openPlayerTask(sam);
    await sam.locator(".prompt .choice").first().click(TAP);
    await sam.getByRole("button", { name: /do it!/i }).click(TAP);
    await expect.poll(async () => (await state()).sceneId, TAP).not.toBe("rest_mossbank");
    await comeBack(rosie, "Rosie");

    // --- The chapter's end: Sam is done, Rosie leaves without saying so ---
    await act(samSession, code, { type: "PLAYTEST_GOTO", sceneId: "rest_lanternfall" });
    await expect.poll(async () => (await state()).phase, TAP).toBe("chapter_complete");
    await openPlayerTask(sam);
    await sam.getByRole("button", { name: "Back to the lobby" }).click(TAP);
    await stepAway(rosie, "Rosie");
    await expect.poll(async () => (await state()).phase, TAP).toBe("lobby");
    // Back in the lobby there is nothing to catch up on.
    await comeBack(rosie, "Rosie", false);
    await expect(rosie.getByTestId("catch-up")).toHaveCount(0);
    expect((await memberNamed("Rosie")).character.id).toBe(rosieHero);

    expect(tvErrors).toEqual([]);
  });
});
