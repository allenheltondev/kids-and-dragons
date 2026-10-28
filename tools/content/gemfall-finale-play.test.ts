import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { enterScene } from "@kad/shared";
import type { Chapter, CheckScene, RunState } from "@kad/shared";
import { context, send, start } from "./riftlight-test-support.ts";
import { act, landed, miss, promptOf, solve } from "./interaction-play.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const chapter = read<Chapter>("content/chapters/gemfall-08.json");
const legacy = read<Record<string, CheckScene>>("tools/content/fixtures/gemfall-finale-legacy-checks.json");
const sizes = [1, 2, 4];
const outcomes = ["success", "assisted"] as const;

function initial(size: number, flags: Record<string, boolean> = {}, items: string[] = []): RunState {
  const state = start(chapter, "manticore", "duskrunner", flags, size);
  state.campaignId = "gemfall";
  for (const member of state.party) member.character.questItems = member.character.questItems.filter(id => id !== "listening_chime");
  state.party[0]!.character.questItems.push(...items);
  return state;
}

function at(size: number, sceneId: string, flags: Record<string, boolean> = {}, items: string[] = []) {
  const opened = enterScene(initial(size, flags, items), sceneId, context(chapter));
  expect(opened.error).toBeUndefined();
  return opened.state;
}

const offered = (state: RunState, id: string) =>
  state.prompt?.kind === "choice" && state.prompt.options.some(option => option.id === id);

function choose(state: RunState, id: string) {
  expect(offered(state, id), `${state.sceneId}: ${id} should be offered`).toBe(true);
  return send(state, { type: "CHOOSE", choiceId: id }, chapter);
}

function finish(state: RunState, outcome: "success" | "assisted" | "miss") {
  const prompt = promptOf(state);
  const resolved = outcome === "success" ? solve(chapter, state)
    : outcome === "assisted" ? act(chapter, state, { action: "assist" }, prompt.playerIds.at(-1)!)
    : miss(chapter, state);
  expect(resolved, `${state.sceneId} supports a real ${outcome}`).not.toBeNull();
  const done = resolved!;
  expect(promptOf(done).outcome).toBe(outcome === "miss" ? "failure" : outcome);
  return landed(chapter, done, promptOf(done).resolvedActorId ?? promptOf(done).actorId);
}

it.each(sizes)("The four final philosophies remain available to %i-player parties", size => {
  const state = at(size, "scene_seal_chamber");
  for (const choice of ["restore", "destroy", "leash", "keystone"]) {
    expect(offered(state, choice), choice).toBe(true);
  }
  expect(chapter.scenes.encounter_dragon?.type).toBe("encounter");
  expect(chapter.scenes.encounter_gallery?.type).toBe("encounter");
});

it.each(sizes.flatMap(size => outcomes.map(outcome => ({ size, outcome }))))
  ("Finale verdict: $size / $outcome each hero can contribute without a persuasion roll", ({ size, outcome }) => {
    const decision = at(size, "scene_verdict");
    expect(offered(decision, "honest")).toBe(true); // historical die route remains
    const interaction = choose(decision, "each_voice");
    expect(interaction.sceneId).toBe("interaction_verdict_council");
    expect(promptOf(interaction).spec.kind).toBe("play");
    const after = finish(interaction, outcome);
    expect(after.sceneId).toBe("scene_seal_cracks");
    expect(after.flags.dragon_satisfied).toBe(true);
    expect(chapter.scenes.check_verdict?.type).toBe("check");
  });

it.each(sizes)("The verdict cannot be completed without the party contributing at %i seats", size => {
  const state = choose(at(size, "scene_verdict"), "each_voice");
  expect(state.flags.dragon_satisfied).not.toBe(true);
  expect(state.sceneId).toBe("interaction_verdict_council");
});

it.each(sizes.flatMap(size => ["success", "miss", "assisted"].map(outcome => ({ size, outcome }))))
  ("Restore: $size / $outcome fits carried stones, including a supported miss", ({ size, outcome }) => {
    const noStone = at(size, "scene_restore_begin");
    expect(offered(noStone, "fit")).toBe(true);
    expect(offered(noStone, "hold")).toBe(true);
    expect(offered(noStone, "match_by_hum")).toBe(false);

    const withStone = at(size, "scene_restore_begin", {}, ["facet_ember"]);
    const prepared = choose(withStone, "match_by_hum");
    expect(prepared.sceneId).toBe("interaction_restore_fit");
    expect(promptOf(prepared).spec.kind).toBe("sequence");
    const after = finish(prepared, outcome as "success" | "assisted" | "miss");
    expect(after.sceneId).toBe("scene_restore_last_gap");
  });

it.each(sizes.flatMap(size => ["success", "miss", "assisted"].map(outcome => ({ size, outcome }))))
  ("Destroy: $size / $outcome can release the latch through a precision job", ({ size, outcome }) => {
    const scene = at(size, "scene_destroy_begin");
    expect(offered(scene, "turn")).toBe(true);
    expect(offered(scene, "latch")).toBe(true);
    const opened = choose(scene, "steady_latch");
    expect(promptOf(opened).spec.kind).toBe("precision");
    const after = finish(opened, outcome as "success" | "assisted" | "miss");
    expect(after.sceneId).toBe("scene_titan_goes");
  });

it.each(sizes.flatMap(size => outcomes.map(outcome => ({ size, outcome }))))
  ("Control: $size / $outcome gets a prepared handover when wardens were told", ({ size, outcome }) => {
    const without = at(size, "scene_tether");
    expect(offered(without, "call_voss")).toBe(false);
    expect(offered(without, "wardens")).toBe(true);
    const withNotice = at(size, "scene_tether", { told_wardens: true });
    const voss = choose(withNotice, "call_voss");
    expect(voss.sceneId).toBe("scene_tether_call_voss");
    const handover = choose(voss, "on");
    expect(handover.sceneId).toBe("interaction_leash_transfer");
    expect(promptOf(handover).spec.kind).toBe("relay");
    const after = finish(handover, outcome);
    expect(after.sceneId).toBe("scene_cage_closes");
    const unprepared = choose(at(size, "scene_wardens_come"), "on");
    expect(unprepared.sceneId).toBe("check_pass_leash");
  });

it("All 27 legacy finale rolls are byte-for-byte equivalent in content", () => {
  expect(Object.keys(legacy)).toHaveLength(27);
  for (const [id, old] of Object.entries(legacy)) {
    expect(chapter.scenes[id], id).toEqual(old);
  }
});

it.each(sizes.flatMap(size => [1, 20].map(face => ({ size, face }))))
  ("Legacy finale saves resume old check prompts at $size seats with face $face", ({ size, face }) => {
    for (const [id, old] of Object.entries(legacy)) {
      let state = at(size, id);
      state = JSON.parse(JSON.stringify(state)) as RunState;
      for (let i = 0; state.sceneId === id; i++) {
        expect(i, `${id}: complete the original roll prompt`).toBeLessThan(size + 2);
        state = send(state, { type: "ROLL" }, chapter, face);
      }
      expect(state.sceneId, `${id}: retained branch`).toBe((face === 20 ? old.onSuccess : old.onFailure).goto);
    }
  });

it("Confrontation interaction art uses registered existing assets", () => {
  const manifest = read<{ sceneIllustrations: string[]; storyProps: { ids: string[] } }>("assets/manifest.json");
  for (const id of ["interaction_verdict_council", "interaction_restore_fit", "interaction_wheel_latch", "interaction_leash_transfer"]) {
    const scene = chapter.scenes[id];
    expect(scene?.type, id).toBe("interaction");
    if (scene?.art) {
      expect(manifest.sceneIllustrations,id).toContain(scene.art);
      expect(fs.existsSync(path.join(root, "assets", scene.art + ".webp"))).toBe(true);
    }
    for (const prop of chapter.presentation?.interactions?.[id]?.props ?? []) {
      expect(manifest.storyProps.ids, id).toContain(prop);
      expect(fs.existsSync(path.join(root, "assets", "story-props", prop + ".webp"))).toBe(true);
    }
  }
});
