// @vitest-environment jsdom
/**
 * The rift on the shared screen (#201 follow-up): the clock big enough for the
 * sofa, the ways out and the captive in the phone's words, a caption for each
 * thing the place just did — and nothing at all in an ordinary fight.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EncounterContext, EncounterEnvironment, EncounterState, EnemySpec, RulesContent } from "@kad/shared";
import { beginEncounter, makeRng, parseBoard } from "@kad/shared";
import { useGameStore } from "../store";
import { makeCharacter, makeState } from "../testing/fixtures";
import { RiftStatus, riftCaption } from "./RiftStatus";

const WISP: EnemySpec = { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 11, quick: 0, steps: 5, attack: 3 };

const FERRY: EncounterEnvironment = {
  clock: { rounds: 3, label: "The rift closes", onExpire: "collapse" },
  exits: [{ id: "tear", label: "The tear", tiles: [{ x: 3, y: 0 }], opensRound: 2 }],
  rescue: { name: "Pip", at: { x: 0, y: 3 } },
};

function fight(environment?: EncounterEnvironment): EncounterState {
  const character = makeCharacter({ id: "c_1", name: "Sparklehoof", stats: { might: 2, quick: 25, clever: 3, heart: 5 } });
  const ctx: EncounterContext = { rules: { version: 1 } as unknown as RulesContent, abilities: {}, rng: makeRng("rift-status") };
  return beginEncounter(
    {
      board: parseBoard(["....", "....", "....", "...."]),
      party: [{ character, at: { x: 0, y: 0 } }],
      enemies: [{ spec: WISP, at: { x: 3, y: 3 } }],
      ...(environment ? { environment } : {}),
    },
    ctx,
  );
}

function show(encounter: EncounterState): void {
  act(() => {
    useGameStore.setState({ state: makeState({ phase: "encounter", encounter }), presentation: null } as never);
  });
}

beforeEach(() => {
  useGameStore.setState({ state: null, presentation: null } as never);
});

afterEach(cleanup);

describe("RiftStatus", () => {
  it("shows nothing in a fight without an environment", () => {
    show(fight());
    const { container } = render(<RiftStatus />);
    expect(container.innerHTML).toBe("");
  });

  it("puts the clock up big, with the ways out and the captive under it", () => {
    show(fight(FERRY));
    render(<RiftStatus />);
    const clock = screen.getByRole("status");
    expect(clock.textContent).toContain("The rift closes in 3 rounds.");
    expect(clock.querySelector("b")!.textContent).toBe("3");
    expect(clock.className).toContain("rift-status__clock--calm");
    expect(screen.getByText("The tear opens next round.")).toBeTruthy();
    expect(screen.getByText("Free Pip: end your turn next to them. 3 rounds left.")).toBeTruthy();
  });

  it("says the last round loudly, and the rift acting louder", () => {
    const encounter = fight(FERRY);
    show({ ...encounter, round: 3 });
    render(<RiftStatus />);
    expect(screen.getByRole("status").className).toContain("rift-status__clock--urgent");
    expect(screen.getByRole("status").querySelector("b")!.textContent).toBe("!");

    show({ ...encounter, round: 4, environment: { ...encounter.environment!, expired: true } });
    expect(screen.getByRole("status").className).toContain("rift-status__clock--expired");
    expect(screen.getByRole("status").textContent).toContain("The rift closes — now!");
  });

  it("captions a round's environmental beats, and only those", () => {
    const encounter = fight(FERRY);
    show(encounter);
    render(<RiftStatus />);
    expect(document.querySelector(".rift-status__caption")).toBeNull();

    act(() => {
      useGameStore.setState({
        presentation: {
          seq: 9,
          presentation: {
            kind: "COMBAT_SEQUENCE",
            events: [
              { type: "damage", actorId: "wisp#1", amount: 1, hp: 5 },
              { type: "freed", byId: "c_1" },
              { type: "escaped", actorId: "c_1", exitId: "tear" },
            ],
          },
        },
      } as never);
    });
    const caption = document.querySelector(".rift-status__caption")!;
    expect([...caption.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Sparklehoof freed Pip!",
      "Sparklehoof steps through the rift!",
    ]);
  });
});

describe("riftCaption", () => {
  it("keeps the newest three lines of a busy round", () => {
    const encounter = fight(FERRY);
    const lines = riftCaption(
      [
        { type: "riftClock", onExpire: "collapse" },
        { type: "captiveLost" },
        { type: "hazard", actorId: "wisp#1", hazardId: "f", label: "Rift fire" },
        { type: "surge", amount: 1 },
      ],
      encounter,
    );
    expect(lines).toEqual([
      "Pip is lost to the rift.",
      "Rift fire gets Bramblewisp 1!",
      "The rift surges: everyone still here loses 1.",
    ]);
  });
});
