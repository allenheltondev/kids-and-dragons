// @vitest-environment jsdom
import { beforeAll, expect, it, vi } from "vitest";
import { Assets, Texture } from "pixi.js";
import { beginEncounter, parseBoard } from "@kad/shared";
import { makeCharacter } from "../testing/fixtures";
import { makeRules } from "../../../shared/src/test-fixtures";
import { installFakeCanvas2D } from "../testing/fake-stage";
import { createWagonStage } from "./wagon-stage";
import { wagonDefense } from "../screens/wagon-defense";

beforeAll(installFakeCanvas2D);
function fight(progress = 0) {
  const state = beginEncounter({ board: parseBoard(Array(6).fill(".......")),
    party: [{ character: makeCharacter({ id: "hero", name: "Fern", stats: { might: 0, quick: 25, clever: 0, heart: 0 } }), at: { x: 3, y: 2 } }],
    enemies: [{ spec: { id: "wolf", count: 1, hp: 6, guard: 11, quick: 0, steps: 4, attack: 2 }, at: { x: 5, y: 2 } }],
    environment: { objectives: [{ id: "wagon-lane", kind: "hold", label: "Lane", tiles: [{ x: 3, y: 2 }], rounds: 2, endsFight: true }] },
  }, { rules: makeRules(), abilities: {}, rng: { next: () => .5 } });
  return { ...state, environment: { ...state.environment!, objectives: [progress] } };
}
it("reads the defender, saved progress and actual wolf plan from the board", () => {
  const state = fight(1);
  const wagon = wagonDefense(JSON.parse(JSON.stringify(state)))!;
  expect(wagon).toMatchObject({ progress: 1, target: 2, defender: { id: "hero" }, label: "Wheels turning" });
  expect(wagon.threats[0]?.targetId).toBe("hero");
  const empty = { ...state, board: { ...state.board, actors: state.board.actors.map(a => a.id === "hero" ? { ...a, x: 1 } : a) } };
  expect(wagonDefense(empty)).toMatchObject({ progress: 1, defender: null });
});
it("moves the wagon only for earned progress, and snaps under reduced motion or reload", async () => {
  const load = vi.spyOn(Assets, "load").mockResolvedValue(Texture.WHITE as unknown as Record<string, unknown>);
  const stage = createWagonStage(128);
  try {
    stage.update(fight());
    const cart = stage.container.getChildByLabel("sausage-wagon")!;
    const start = cart.x;
    stage.tick(1, false);
    expect(cart.x).toBe(start);
    stage.update(fight(1));
    stage.tick(.1, false);
    expect(cart.x).toBeGreaterThan(start);
    stage.tick(1, true);
    expect(cart.x).toBe(128 * 3.45);
    expect(cart.rotation).toBe(0);
    stage.update(fight(1));
    stage.tick(1, false);
    expect(cart.x).toBe(128 * 3.45);
    await Promise.resolve();
  } finally { stage.destroy(); load.mockRestore(); }
});
