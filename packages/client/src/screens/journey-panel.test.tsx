// @vitest-environment jsdom
/**
 * JourneyPanel - a graph campaign's "where to next?" (#195).
 *
 * The rules this file holds, in the order a table meets them:
 *
 *  - a way you can take is a button; one that is drawn but blocked is plain
 *    words that say why and never what would open it (no dead controls);
 *  - an unexplored place says so, a place the party has been says so, and one
 *    that will have changed says that - each in words, not colour;
 *  - a one-way or one-time crossing asks first, "Stay here" is the easy
 *    answer, and nothing is sent until "Yes, go";
 *  - ordinary ways are one tap; a tap in flight disables the rest.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JourneyExitView, JourneyRiftActionView, JourneyView } from "@kad/shared";
import { JourneyPanel } from "./JourneyPanel";

const ORCHARD_EXITS: JourneyExitView[] = [
  {
    edge: "orchard-to-mill",
    to: "mill",
    kind: "sideways",
    label: "Along the stream to the mill",
    available: true,
    arrival: "new",
  },
  {
    edge: "orchard-to-waystone",
    to: "waystone",
    kind: "return",
    label: "Back to the waystone",
    available: true,
    arrival: "pass",
  },
  {
    edge: "orchard-to-tower",
    to: "tower",
    kind: "forward",
    label: "Through the tower door",
    available: false,
    reason: "locked",
    arrival: "new",
  },
];

function choosing(overrides: Partial<JourneyView> = {}): JourneyView {
  return {
    node: "orchard",
    title: "The Orchard",
    visit: 1,
    status: "choosing",
    chapter: "sampler-orchard",
    exits: ORCHARD_EXITS,
    places: [
      { node: "waystone", title: "The Waystone", visits: 2, completed: true },
      { node: "orchard", title: "The Orchard", visits: 1, completed: true, here: true },
    ],
    ...overrides,
  };
}

function mount(journey: JourneyView, extra: Partial<Parameters<typeof JourneyPanel>[0]> = {}) {
  const onChoose = vi.fn();
  const onContinue = vi.fn();
  const view = render(<JourneyPanel journey={journey} onChoose={onChoose} onContinue={onContinue} {...extra} />);
  return { ...view, onChoose, onContinue };
}

afterEach(() => {
  cleanup();
});

describe("the ways on", () => {
  it("says where the party is and lists each way as a button", () => {
    mount(choosing());
    expect(screen.getByRole("heading", { name: "Where to next?" })).toBeTruthy();
    expect(screen.getByText("The Orchard", { selector: "b" })).toBeTruthy();
    const list = screen.getByRole("list", { name: "Ways on from The Orchard" });
    expect(within(list).getByRole("button", { name: /Along the stream to the mill/ })).toBeTruthy();
    expect(within(list).getByRole("button", { name: /Back to the waystone/ })).toBeTruthy();
  });

  it("marks an unexplored place, and a place the party has been", () => {
    mount(choosing());
    const mill = screen.getByRole("button", { name: /Along the stream to the mill/ });
    expect(within(mill).getByText("Unexplored")).toBeTruthy();
    expect(within(mill).getByText("Side trip")).toBeTruthy();
    const waystone = screen.getByRole("button", { name: /Back to the waystone/ });
    expect(within(waystone).getByText("Been here")).toBeTruthy();
    expect(within(waystone).getByText("Head back")).toBeTruthy();
    expect(within(waystone).queryByText("Unexplored")).toBeNull();
  });

  it("says a place has changed - and only that it has", () => {
    mount(
      choosing({
        exits: [
          {
            edge: "mill-to-orchard",
            to: "orchard",
            kind: "return",
            label: "Back to the orchard",
            available: true,
            arrival: "replay",
            changed: true,
          },
        ],
      }),
    );
    const back = screen.getByRole("button", { name: /Back to the orchard/ });
    expect(within(back).getByText("It has changed")).toBeTruthy();
    expect(within(back).queryByText("Been here")).toBeNull();
  });

  it("draws a blocked way as words with a reason, not as a button", () => {
    mount(choosing());
    expect(screen.queryByRole("button", { name: /tower door/ })).toBeNull();
    const item = screen.getByText("Through the tower door").closest("li") as HTMLElement;
    expect(within(item).getByText(/Blocked\./)).toBeTruthy();
    expect(item.textContent).toContain("It's shut tight for now.");
    // The reason never says what would open it.
    expect(item.textContent).not.toMatch(/mill|wheel|key/i);
  });

  it.each([
    ["locked", "It's shut tight for now."],
    ["spent", "You've already used this way."],
    ["closed", "That place is finished, so there's no going back in."],
    ["guard", "Not yet. Something has to happen first."],
  ] as const)("explains a %s way in plain words", (reason, line) => {
    mount(
      choosing({
        exits: [
          { edge: "e", to: "x", kind: "forward", label: "The door", available: false, reason, arrival: "new" },
        ],
      }),
    );
    expect(screen.getByText(line, { exact: false })).toBeTruthy();
  });

  it("falls back to a plain sentence for a reason it does not know", () => {
    mount(
      choosing({
        exits: [
          {
            edge: "e",
            to: "x",
            kind: "forward",
            label: "The door",
            available: false,
            // A later build's reason (rifts will add some): never shown raw.
            reason: "rift-sealed" as never,
            arrival: "new",
          },
        ],
      }),
    );
    expect(screen.getByText("You can't go this way right now.", { exact: false })).toBeTruthy();
    expect(screen.queryByText(/rift-sealed/)).toBeNull();
  });

  it("takes an ordinary way in one tap", async () => {
    const user = userEvent.setup();
    const { onChoose } = mount(choosing());
    await user.click(screen.getByRole("button", { name: /Along the stream to the mill/ }));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0]![0]).toMatchObject({ edge: "orchard-to-mill" });
  });

  it("disables the ways while a tap is in flight", () => {
    mount(choosing(), { busy: true });
    expect(screen.getByRole("button", { name: /Along the stream to the mill/ }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps every way a comfortable touch target", () => {
    mount(choosing());
    for (const button of screen.getAllByRole("button", { name: /mill|waystone/ })) {
      expect(button.className).toContain("kad-tap");
    }
  });
});

describe("crossings that cannot be undone", () => {
  const ONE_WAY: JourneyExitView = {
    edge: "tower-to-dawn",
    to: "dawn-gate",
    kind: "forward",
    label: "Open the Dawn Gate",
    available: true,
    arrival: "new",
    irreversible: true,
  };
  const ONCE: JourneyExitView = {
    edge: "to-quarry",
    to: "quarry",
    kind: "forward",
    label: "Up the quarry road",
    available: true,
    arrival: "new",
    once: true,
  };

  it("labels the way before the tap", () => {
    mount(choosing({ exits: [ONE_WAY, ONCE] }));
    expect(within(screen.getByRole("button", { name: /Dawn Gate/ })).getByText("One way")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /quarry road/ })).getByText("One time")).toBeTruthy();
  });

  it("asks first, and sends nothing until the party says yes", async () => {
    const user = userEvent.setup();
    const { onChoose } = mount(choosing({ exits: [ONE_WAY] }));

    await user.click(screen.getByRole("button", { name: /Dawn Gate/ }));
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByText("You won't be able to come back this way.")).toBeTruthy();
    const group = screen.getByRole("group", { name: "Go to Open the Dawn Gate?" });
    expect(group).toBeTruthy();
    // The question has focus, so a screen reader reads it before anything else.
    expect(document.activeElement).toBe(within(group).getByRole("heading", { name: /Open the Dawn Gate/ }));

    await user.click(screen.getByRole("button", { name: "Yes, go" }));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0]![0]).toMatchObject({ edge: "tower-to-dawn" });
  });

  it("puts 'Stay here' before 'Yes, go' and goes back to the way it came from", async () => {
    const user = userEvent.setup();
    const { onChoose } = mount(choosing({ exits: [ONE_WAY] }));
    await user.click(screen.getByRole("button", { name: /Dawn Gate/ }));

    const buttons = within(screen.getByRole("group", { name: /^Go to/ })).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Stay here", "Yes, go"]);

    await user.click(screen.getByRole("button", { name: "Stay here" }));
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: /^Go to/ })).toBeNull();
    // Focus returns to the exit they were weighing.
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Dawn Gate/ })));
  });

  it("lets Escape stay put", async () => {
    const user = userEvent.setup();
    const { onChoose } = mount(choosing({ exits: [ONE_WAY] }));
    await user.click(screen.getByRole("button", { name: /Dawn Gate/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: /^Go to/ })).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("warns differently about a way that can only be taken once", async () => {
    const user = userEvent.setup();
    mount(choosing({ exits: [ONCE] }));
    await user.click(screen.getByRole("button", { name: /quarry road/ }));
    expect(screen.getByText("You can only go this way one time.")).toBeTruthy();
    expect(screen.queryByText(/come back this way/)).toBeNull();
  });

  it("forgets a half-made choice when the party has moved on", async () => {
    const user = userEvent.setup();
    const view = mount(choosing({ exits: [ONE_WAY] }));
    await user.click(screen.getByRole("button", { name: /Dawn Gate/ }));
    expect(screen.getByRole("group", { name: /^Go to/ })).toBeTruthy();

    view.rerender(
      <JourneyPanel
        journey={choosing({ node: "tower", title: "The Tower", visit: 1, exits: [] })}
        onChoose={view.onChoose}
        onContinue={view.onContinue}
      />,
    );
    expect(screen.queryByRole("group", { name: /^Go to/ })).toBeNull();
  });
});

describe("the other stops on a journey", () => {
  it("offers to play where the party is, while it is playing", async () => {
    const user = userEvent.setup();
    const { onContinue } = mount(choosing({ status: "playing", exits: [], visit: 2 }));
    expect(screen.getByRole("heading", { name: "Ready to go on?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Go back to The Orchard" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("begins an adventure nobody has played yet", () => {
    mount(choosing({ status: "playing", exits: [], title: "The Waystone", places: [{ node: "waystone", title: "The Waystone", visits: 1, completed: false, here: true }] }));
    expect(screen.getByRole("button", { name: "Begin the adventure" })).toBeTruthy();
  });

  it("names the ending it reached and offers a fresh start", async () => {
    const user = userEvent.setup();
    const { onContinue } = mount(
      choosing({ status: "ended", exits: [], reachedEnding: { node: "dawn-gate", title: "The Dawn Gate" } }),
    );
    expect(screen.getByRole("heading", { name: "You found an ending!" })).toBeTruthy();
    expect(screen.getByText("The Dawn Gate")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Start again" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe("the places you've been", () => {
  it("lists the places visited, and where the party is", () => {
    mount(choosing());
    const summary = screen.getByText(/Places you've been \(2\)/);
    expect(summary.closest("summary")).toBeTruthy();
    const list = screen.getByText("The Waystone", { selector: ".journey-place__name" }).closest("ul") as HTMLElement;
    expect(within(list).getByText("You are here")).toBeTruthy();
    expect(within(list).getByText("Visited 2 times")).toBeTruthy();
  });

  it("is absent from a view that carries none (an older server)", () => {
    mount(choosing({ places: undefined }));
    expect(screen.queryByText(/Places you've been/)).toBeNull();
  });

  it("never mentions an unexplored place", () => {
    mount(choosing());
    const places = screen.getByText(/Places you've been/).closest("details") as HTMLElement;
    expect(places.textContent).not.toMatch(/mill|tower|dawn/i);
  });
});

describe("announcing the move", () => {
  it("tells a screen reader where the party is", () => {
    mount(choosing());
    const live = document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.textContent).toBe("The party is at The Orchard.");
  });
});

describe("things the party can try (#197)", () => {
  const STEADY: JourneyRiftActionView = { action: "stabilize", edge: "storm-stair", label: "Steady the flickering stair" };
  const TURN: JourneyRiftActionView = {
    action: "redirect",
    edge: "ferry-rift",
    label: "Turn the rift toward The Hidden Cove",
    to: "cove",
  };
  const SEAL: JourneyRiftActionView = { action: "close", edge: "ferry-rift", label: "Seal the ferry", irreversible: true };

  it("draws each action as a button under the ways on, and sends it in one tap", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mount(choosing({ riftActions: [STEADY, TURN] }), { onAction });
    const list = screen.getByRole("list", { name: "Things you can try" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Steady the flickering stair",
      "Turn the rift toward The Hidden Cove",
    ]);
    await user.click(screen.getByRole("button", { name: /Turn the rift/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]![0]).toEqual(TURN);
  });

  it("draws none for a panel that cannot act (no onAction), or a view that carries none", () => {
    mount(choosing({ riftActions: [STEADY] }));
    expect(screen.queryByRole("list", { name: "Things you can try" })).toBeNull();
    cleanup();
    mount(choosing(), { onAction: vi.fn() });
    expect(screen.queryByRole("list", { name: "Things you can try" })).toBeNull();
  });

  it("asks first before a close nothing can undo, and sends nothing until yes", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    mount(choosing({ riftActions: [SEAL] }), { onAction });
    expect(within(screen.getByRole("button", { name: /Seal the ferry/ })).getByText("Can't be undone")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Seal the ferry/ }));
    expect(onAction).not.toHaveBeenCalled();
    const group = screen.getByRole("group", { name: "Seal the ferry?" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Stay here", "Yes, do it"]);
    expect(screen.getByText("Once it's shut, it won't open again.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Yes, do it" }));
    expect(onAction).toHaveBeenCalledWith(SEAL);
  });

  it("disables the actions while a tap is in flight", () => {
    mount(choosing({ riftActions: [STEADY] }), { onAction: vi.fn(), busy: true });
    expect((screen.getByRole("button", { name: /Steady/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says plainly when there is nowhere to go and nothing to try", () => {
    mount(choosing({ exits: [], stuck: true }), { onAction: vi.fn() });
    expect(screen.getByRole("status").textContent).toContain("Every way from here is shut right now.");
  });
});
