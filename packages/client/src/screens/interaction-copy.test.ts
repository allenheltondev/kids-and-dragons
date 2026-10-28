import { describe, expect, it } from "vitest";
import { createRunState, resolveCharacter } from "@kad/shared";
import type { InteractionPrompt, InteractionSpec, PartyMember } from "@kad/shared";
import { makeCharacter, makeItems, makeRules } from "../../../shared/src/test-fixtures";
import { GAME, phoneJob, tvStatus, type TableView } from "./interaction-copy";

const precision: InteractionSpec = { kind: "precision", cue: "Loosen the packed rim in the supported interval.", actionLabel: "Loosen the mud", target: 0.5, width: 0.3, periodMs: 6000 };
const cooperate: InteractionSpec = { kind: "cooperate", cue: "Hold", supportLabel: "Hold the sling sides", actionLabel: "Set the sling" };
const relay: InteractionSpec = { kind: "relay", cue: "Pass", actionLabel: "Pass the mat", objectLabel: "the stiff mat" };
const memory: InteractionSpec = { kind: "memory", cue: "Echo", actionLabel: "Show what we saw", options: [{ id: "a", label: "A", icon: "eye" }], answer: ["a", "a"], stepMs: 1000 };

function table(spec: InteractionSpec, names: string[], extra: Partial<InteractionPrompt> = {}): TableView {
  const state = createRunState({ runId: "r", roomCode: "TEST", mode: "party", now: new Date().toISOString() });
  const party: PartyMember[] = names.map((name, index) => ({
    playerId: `p${index}`,
    character: resolveCharacter(makeCharacter({ id: `c${index}`, ownerPlayerId: `p${index}`, name }), makeRules(), makeItems()),
    connected: true, ready: true, down: false, hp: 10,
  }));
  state.party = party;
  const now = Date.now();
  const prompt: InteractionPrompt = { kind: "interaction", sceneId: "s", openedSeq: 1, attempt: 0, spec, playerIds: party.map((m) => m.playerId), actorId: "p0", phase: "active", relaxed: false, supports: {}, startedAt: new Date(now - 10_000).toISOString(), ...extra };
  return { prompt, party, connected: party.map((m) => m.playerId), now };
}

describe("what a game says about itself", () => {
  it("names every kind in plain words", () => {
    for (const kind of ["precision", "timing", "memory", "sequence", "tracking", "balance", "relay", "cooperate", "play"] as const) {
      expect(GAME[kind].name.length).toBeGreaterThan(0);
      expect(GAME[kind].icon.length).toBeGreaterThan(0);
    }
  });
  it("tells the TV whose phone matters, by name, and which button", () => {
    const view = table(precision, ["Aster", "Fern"]);
    expect(tvStatus(view)).toBe('Aster: watch the marker. Tap "Loosen the mud" on your phone when it is in the gold.');
    expect(tvStatus({ ...view, prompt: { ...view.prompt, phase: "ready" } })).toContain("Aster: tap \"We're ready\"");
    expect(tvStatus({ ...view, prompt: { ...view.prompt, phase: "result", outcome: "success" } })).toContain("See what happens next");
  });
  it("gives the lead and a helper different jobs, and says where to look", () => {
    const view = table(precision, ["Aster", "Fern"]);
    expect(phoneJob(view, "p0")).toMatchObject({ headline: "Tap when the marker is in the gold!", lookAt: "phone" });
    expect(phoneJob(view, "p1")).toMatchObject({ headline: "Aster is aiming.", lookAt: "tv" });
  });
  it("follows the lead to a connected phone when the nominee is away", () => {
    const view = table(precision, ["Aster", "Fern"]);
    const away = { ...view, connected: ["p1"] };
    expect(tvStatus(away)).toContain("Fern: watch the marker");
    expect(phoneJob(away, "p1").lookAt).toBe("phone");
  });
  it("gives every friend the same job and calls out who has yet to join", () => {
    const view = table(cooperate, ["Aster", "Fern", "Moss"]);
    expect(tvStatus(view)).toContain('Aster, Fern and Moss: press and hold "Hold the sling sides"');
    expect(phoneJob(view, "p1").headline).toBe("Press and hold together!");
    expect(phoneJob(view, "p0").headline).toBe("Press and hold together!");
    const held = { ...view, prompt: { ...view.prompt, supports: { p0: null, p1: null, p2: null } } };
    expect(tvStatus(held)).toBe("Keep holding together. Watch it rise to the star!");
    expect(phoneJob(held, "p0").headline).toBe("Your prop is holding!");
  });
  it("names the catcher in a relay with the real button names", () => {
    const view = table(relay, ["Aster", "Fern"]);
    expect(tvStatus(view)).toBe('Aster: touch the stiff mat on your phone to catch it!');
    expect(phoneJob(view, "p0").detail).toBe('Touch the arriving object on your phone.');
    const caught = { ...view, prompt: { ...view.prompt, caughtBy: "p0" } };
    expect(tvStatus(caught)).toBe('Aster: slide the stiff mat up to send it to Fern.');
    expect(phoneJob(caught, "p1").headline).toBe("Aster has it. Your turn is coming.");
    const done = { ...view, prompt: { ...view.prompt, passed: ["p0", "p1"] } };
    expect(tvStatus(done)).toBe('Delivered! It made it all the way.');
  });
  it("sends everyone's eyes to the TV while a pattern plays, then to the lead's phone", () => {
    const playing = table(memory, ["Aster", "Fern"], { startedAt: new Date(Date.now() - 500).toISOString() });
    expect(phoneJob(playing, "p0")).toMatchObject({ headline: "Watch the TV!", lookAt: "tv" });
    expect(tvStatus(playing)).toBe("Everyone: watch the pattern and remember the order!");
    const after = table(memory, ["Aster", "Fern"]);
    expect(phoneJob(after, "p0")).toMatchObject({ headline: "Tap the pictures in the same order.", lookAt: "phone" });
    expect(phoneJob(after, "p1").headline).toBe("Help Aster remember the order.");
  });
});
