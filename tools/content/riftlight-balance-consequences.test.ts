import { expect, it } from "vitest";
import { enterScene } from "@kad/shared";
import { chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

it.each(["success", "assisted"] as const)("an earned %s rope catch gets the party ashore without another gamble", outcome => {
  const chapter = chapters.get("riftlight-headwaters-washout")!;
  let state = enterScene(start(chapter, "manticore", "duskrunner", {}, 4), "knob_toss", context(chapter)).state;
  state = finishInteraction(state, chapter, outcome);
  const hp = state.party.map(p => p.hp);
  state = send(state, { type: "CHOOSE", choiceId: "hooked" }, chapter);
  expect(state.prompt?.kind).toBe("choice");
  state = send(state, { type: "CHOOSE", choiceId: "continue" }, chapter);
  expect(state.sceneId).toBe("ashore");
  expect(state.flags.river_escaped_early).toBe(true);
  expect(state.flags.found_a_way_out).toBe(true);
  expect(state.party.map(p => p.hp)).toEqual(hp);
});

it("missing the catch still requires an uncertain escape instead of receiving the earned route", () => {
  const chapter = chapters.get("riftlight-headwaters-washout")!;
  let state = enterScene(start(chapter, "manticore", "duskrunner"), "knob_toss", context(chapter)).state;
  state = finishInteraction(state, chapter, "failure");
  expect(state.prompt?.kind === "choice" && state.prompt.options.some(o => o.id === "hooked")).toBe(false);
  state = send(state, { type: "CHOOSE", choiceId: "grab" }, chapter);
  state = send(state, { type: "ROLL" }, chapter, 1);
  expect(state.sceneId).toBe("tree");
  expect(state.flags.river_escaped_early).not.toBe(true);
});

it.each([
  ["open", "marked_open", "Your open-pass notice sends the herders"],
  ["warn", "marked_warned", "lead the herd across in small groups"],
  ["closed", "marked_closed", "The herd will keep its longer route"],
])("the pass ending honors the party's %s decision", (choice, flag, consequence) => {
  const chapter = chapters.get("riftlight-cairnstep-pass")!;
  let state = enterScene(start(chapter, "manticore", "duskrunner"), "mark", context(chapter)).state;
  state = send(state, { type: "CHOOSE", choiceId: choice }, chapter);
  for (let step = 0; state.phase !== "chapter_complete"; step++) {
    expect(step).toBeLessThan(20);
    if (state.prompt?.kind === "interaction") state = finishInteraction(state, chapter);
    else if (state.prompt?.kind === "choice") state = send(state, { type: "CHOOSE", choiceId: state.prompt.options[0]!.id }, chapter);
    else throw new Error(`Unexpected ${state.sceneId}/${state.prompt?.kind}`);
  }
  expect(state.flags[flag!]).toBe(true);
  expect(state.narration).toContain(consequence);
  if (choice === "closed") expect(state.narration).not.toContain("safe line down its middle");
});
