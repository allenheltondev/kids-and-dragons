// @vitest-environment jsdom
/**
 * The Field Guide quiz in the adventure book (GuideQuiz.tsx; docs/trivia.md):
 * a Quiz button beside the guide's progress line; a round over each
 * question's picture with four options; a right answer that glows and
 * chimes; a wrong one that says only "Not this time." and points at the
 * guide, keeping the rest of the round; the empty-pool words; a reward said
 * at once; and a family tablet asking whose quiz it is.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { emptyTriviaRecord, type FieldGuide as FieldGuideData, type JournalResponse, type JournalTriviaResponse, type TriviaAnswer, type TriviaLadder, type TriviaQuestion, type TriviaRecord } from "@kad/shared";

const cues = vi.hoisted(() => [] as string[]);
vi.mock("../audio/cue", async (load) => {
  const real = await load<typeof import("../audio/cue")>();
  return { ...real, cue: (id: string | null) => { if (id) cues.push(id); } };
});

import { FieldGuide } from "./FieldGuide";
import { QuizButton, QuizOverlay } from "./GuideQuiz";
import { resetFieldGuideCache, resetTriviaContentCache } from "./content";
import { setFieldGuideDiscoveries } from "../store/field-guide-discoveries";
import { usePlayerNavigation, selectGuideEntry } from "../store/player-navigation";
import { resetQuiz } from "../store/trivia-round";
import { dropTriviaQueue, loadTriviaQueue } from "../store/trivia-queue";
import { resetBookTriviaSync } from "../store/book-trivia-sync";
import { saveIdentity } from "../store/persistence";
import { useGameStore } from "../store";

const GUIDE: FieldGuideData = {
  version: 1,
  entries: {
    "creature.bone_crawler": { id: "creature.bone_crawler", category: "creatures", kind: "creature", title: "Bone Crawler", art: "/assets/entities/bone_crawler/assembled.png" },
    "biome.sallow_wastelands": { id: "biome.sallow_wastelands", category: "places", kind: "biome", title: "The Sallow Wastelands", art: "/assets/biomes/sallow_wastelands/bg.webp" },
  },
};

const SHELL: TriviaQuestion = {
  id: "creature.bone_crawler.shell",
  entry: "creature.bone_crawler",
  ask: "What does a bone crawler build its shell from?",
  answer: "Old fossil pieces",
  wrong: ["River pebbles", "Broken pots", "Dragon scales", "Woven seaweed", "Acorn caps"],
  also: [],
  link: "entry",
};
const NAME: TriviaQuestion = {
  id: "biome.sallow_wastelands.name",
  entry: "biome.sallow_wastelands",
  ask: "Which place is covered in pale, dry dust?",
  answer: "The Sallow Wastelands",
  wrong: ["Mossy Hollow", "Glimmer Marsh", "Sunward Fields", "Cloud Ridge", "Ember Steps"],
  also: [],
  link: "shelf",
};

const LADDER: TriviaLadder = { rungs: [{ at: 1, badge: { id: "trivia-1", name: "Curious Reader", blurb: "One right." } }], firstTry: [] };

const FOUND = {
  "creature.bone_crawler": { firstFoundBy: "p_1", foundAt: "2026-11-01T00:00:00.000Z" },
  "biome.sallow_wastelands": { firstFoundBy: "p_1", foundAt: "2026-11-02T00:00:00.000Z" },
};

function book(over: Partial<JournalResponse> = {}): JournalResponse {
  return { heroes: [], fieldGuide: FOUND, finders: {}, whereabouts: null, ...over };
}

const posted: { headers: Record<string, string>; answers: TriviaAnswer[] }[] = [];
function serve(bank: TriviaQuestion[], ladder: TriviaLadder = LADDER): void {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url === "/content/field-guide.json") return json(GUIDE);
    if (url === "/content/trivia/ladder.json") return json(ladder);
    if (url === "/content/trivia/creatures.json") return json({ questions: bank.filter((q) => q.entry.startsWith("creature.")) });
    if (url === "/content/trivia/biomes.json") return json({ questions: bank.filter((q) => q.entry.startsWith("biome.")) });
    if (url.startsWith("/content/trivia/")) return json({ questions: [] });
    if (url === "/api/journal/trivia") {
      const body = JSON.parse(String(init?.body)) as { answers: TriviaAnswer[] };
      posted.push({ headers: init?.headers as Record<string, string>, answers: body.answers });
      const response: JournalTriviaResponse = { trivia: emptyTriviaRecord(), verdicts: [], granted: [], badges: [] };
      return json(response);
    }
    throw new TypeError(`unexpected ${url}`);
  });
}

function Quiz({ journal, onTrivia = () => undefined }: { journal: JournalResponse; onTrivia?: (r: TriviaRecord) => void }) {
  return (
    <div className="kad-surface kad-surface--player">
      <FieldGuide backToBag={false} quiz={<QuizButton journal={journal} onTrivia={onTrivia} />} />
      <QuizOverlay journal={journal} onTrivia={onTrivia} />
    </div>
  );
}

const optionButtons = (): HTMLElement[] => within(screen.getByRole("group", { name: /./ })).getAllByRole("button");

beforeEach(() => {
  saveIdentity({ householdId: "h_1", playerId: "p_1", displayName: "Ada", deviceToken: "dev_1" } as Parameters<typeof saveIdentity>[0]);
  resetFieldGuideCache();
  resetTriviaContentCache();
  resetQuiz();
  resetBookTriviaSync();
  dropTriviaQueue();
  selectGuideEntry(null);
  setFieldGuideDiscoveries(FOUND);
  posted.length = 0;
  cues.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setFieldGuideDiscoveries(null);
  useGameStore.setState({ session: null });
});

describe("the quiz in the guide", () => {
  it("offers a Quiz button beside the progress line, and asks over the page's picture with four options", async () => {
    serve([SHELL]);
    render(<Quiz journal={book()} />);
    const open = await screen.findByRole("button", { name: "Quiz" });
    expect(open.closest(".field-guide__summary-row")?.textContent).toContain("2 of 2 found");
    fireEvent.click(open);
    const card = await screen.findByTestId("quiz-question");
    expect(within(card).getByRole("heading", { name: SHELL.ask })).toBeTruthy();
    expect(card.querySelector(".quiz__figure img")?.getAttribute("src")).toBe("/assets/entities/bone_crawler/assembled.png");
    const options = optionButtons().map((b) => b.textContent);
    expect(options).toHaveLength(4);
    expect(options).toContain(SHELL.answer);
    expect(new Set(options).size).toBe(4);
    expect(card.textContent).toContain("Question 1 of 1");
  });

  it("glows and chimes on a right answer, and queues it for the server with the options shown", async () => {
    serve([SHELL]);
    render(<Quiz journal={book()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Quiz" }));
    await screen.findByTestId("quiz-question");
    const shown = optionButtons().map((b) => b.textContent!);
    fireEvent.click(screen.getByRole("button", { name: SHELL.answer }));
    expect(screen.getByRole("button", { name: SHELL.answer }).className).toContain("quiz__option--right");
    expect(screen.getByTestId("quiz-verdict").textContent).toBe("That's it!");
    expect(cues).toContain("chime-echo");
    // No second pick.
    fireEvent.click(screen.getByRole("button", { name: shown.find((o) => o !== SHELL.answer)! }));
    expect(document.querySelectorAll(".quiz__option--wrong")).toHaveLength(0);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.headers["x-kad-device-token"]).toBe("dev_1");
    expect(posted[0]!.answers).toEqual([expect.objectContaining({ questionId: SHELL.id, optionsShown: shown, picked: SHELL.answer })]);
    expect(loadTriviaQueue("dev_1")).toEqual([]);
  });

  it("says the first reward at once", async () => {
    serve([SHELL]);
    render(<Quiz journal={book()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Quiz" }));
    await screen.findByTestId("quiz-question");
    fireEvent.click(screen.getByRole("button", { name: SHELL.answer }));
    expect(screen.getByTestId("quiz-reward").textContent).toContain("You earned the Curious Reader badge!");
  });

  it("on a miss says only 'Not this time.', marks no right answer, and sends her to the page, keeping the rest of the round", async () => {
    serve([SHELL, NAME]);
    render(<Quiz journal={book()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Quiz" }));
    const card = await screen.findByTestId("quiz-question");
    const isShell = card.textContent!.includes(SHELL.ask);
    const question = isShell ? SHELL : NAME;
    const wrong = optionButtons().find((b) => b.textContent !== question.answer)!;
    fireEvent.click(wrong);
    expect(screen.getByTestId("quiz-verdict").textContent).toBe("Not this time.");
    expect(wrong.className).toContain("quiz__option--wrong");
    expect(document.querySelectorAll(".quiz__option--right")).toHaveLength(0);
    expect(cues).not.toContain("chime-echo");
    expect(card.textContent).not.toMatch(/the answer was|correct answer/i);
    fireEvent.click(screen.getByRole("button", { name: "Read about it in the Field Guide" }));
    expect(screen.queryByTestId("quiz")).toBeNull();
    const nav = usePlayerNavigation.getState();
    if (isShell) {
      // "entry": the page itself.
      expect(nav.guideEntry).toBe("creature.bone_crawler");
      act(() => selectGuideEntry(null));
    } else {
      // "shelf": the page's tab, never the page (its name is the answer).
      expect(nav.guideEntry).toBeNull();
      expect(nav.guideTab).toBe("places");
    }
    // The rest of the round waits for her.
    fireEvent.click(await screen.findByRole("button", { name: "Back to your quiz" }));
    const next = await screen.findByTestId("quiz-question");
    expect(next.textContent).toContain("Question 2 of 2");
    expect(next.textContent).toContain(isShell ? NAME.ask : SHELL.ask);
    // A place is asked over its backdrop.
    if (isShell) expect(next.querySelector(".quiz__backdrop img")?.getAttribute("src")).toBe("/assets/biomes/sallow_wastelands/bg.webp");
  });

  it("says why when there is nothing to ask", async () => {
    serve([SHELL]);
    const all: TriviaRecord = { ...emptyTriviaRecord(), mastered: { [SHELL.id]: { at: "2026-11-03T00:00:00.000Z", firstTry: true } } };
    render(<Quiz journal={book({ trivia: all })} />);
    expect((await screen.findByTestId("quiz-empty")).textContent).toBe("You've answered everything you've found. Go find more!");
    expect(screen.queryByRole("button", { name: "Quiz" })).toBeNull();
  });

  it("holds back a question whose picture is not on the phone, offline", async () => {
    serve([SHELL]);
    vi.stubGlobal("caches", { match: async () => undefined });
    const online = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    try {
      render(<Quiz journal={book()} />);
      expect((await screen.findByTestId("quiz-empty")).textContent).toBe("Some questions need their pictures. Open your book with a signal, then come back.");
    } finally {
      // Back to the prototype's getter.
      delete (navigator as unknown as Record<string, unknown>)["onLine"];
      if (online) expect(navigator.onLine).toBe(true);
    }
  });

  it("is not offered when the build has no questions", async () => {
    serve([]);
    render(<Quiz journal={book()} />);
    expect(await screen.findByText("2 of 2 found")).toBeTruthy();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("quiz-open")).toBeNull();
    expect(screen.queryByTestId("quiz-empty")).toBeNull();
  });

  it("on a family tablet asks whose quiz it is first, and sends with the seat's session", async () => {
    serve([SHELL]);
    saveIdentity({ householdId: "h_1" } as Parameters<typeof saveIdentity>[0]);
    useGameStore.setState({ session: { runId: "r_1", roomCode: "WXYZ", playerId: "p_2", mode: "party", sessionToken: "seat_2" } });
    render(<Quiz journal={book({ profile: { displayName: "Bo", badges: [], finds: { count: 0, recent: [] }, flair: { v: 1 } } })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Quiz" }));
    const whose = screen.getByRole("radiogroup", { name: "Whose quiz" });
    fireEvent.click(within(whose).getByRole("radio", { name: "It's Bo's" }));
    await screen.findByTestId("quiz-question");
    fireEvent.click(screen.getByRole("button", { name: SHELL.answer }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.headers["authorization"]).toBe("Bearer seat_2");
    expect(posted[0]!.headers["x-kad-device-token"]).toBeUndefined();
  });

  it("ends a round with how she did, and the way to another", async () => {
    serve([SHELL]);
    render(<Quiz journal={book()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Quiz" }));
    await screen.findByTestId("quiz-question");
    fireEvent.click(screen.getByRole("button", { name: SHELL.answer }));
    fireEvent.click(screen.getByRole("button", { name: /See how you did/ }));
    expect(screen.getByTestId("quiz-done").textContent).toContain("All 1 right!");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.queryByTestId("quiz")).toBeNull();
  });
});
