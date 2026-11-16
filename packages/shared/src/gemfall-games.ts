import { aimWidth, interactionActor, skillCompletions, type InteractionAction, type InteractionPrompt } from "./interactions.js";
import { skillSteps } from "./skill-games.js";

const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const unit = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

/** Find the support point first. Working away from it wastes force and strains the subject. */
export function steadySituation(prompt: InteractionPrompt) {
  if (prompt.spec.kind !== "precision") throw Error("This action needs a steady hand.");
  const progress = prompt.challenge?.progress ?? 0;
  return { support: clamp(prompt.spec.target + [0, .16, -.12, .08][progress % 4]!, .25, .75),
    load: [.45, .65, .5, .6][progress % 4]!,
    tolerance: Math.min(.25, aimWidth(prompt.spec, prompt) / 2 + ((prompt.challenge?.strain ?? 0) > 0 ? .04 : 0)) };
}
export function steadyReading(prompt: InteractionPrompt, grip: number, effort: number) {
  const s = steadySituation(prompt);
  const offset = Math.abs(grip - s.support);
  const supported = offset <= s.tolerance;
  const lift = effort * (1 - offset * .7);
  return { ...s, offset, supported, lift, safe: supported && Math.abs(lift - s.load) <= s.tolerance };
}

/** The near rope has more leverage. A friend's chosen effort changes your remaining share. */
export function haulWeight(prompt: InteractionPrompt, id: string): number {
  return (prompt.challenge?.participants ?? prompt.playerIds).indexOf(id) % 2 === 0 ? 1.5 : 1;
}
export function haulTarget(prompt: InteractionPrompt): number { return [.4, .65, .45][Math.min(2, prompt.challenge?.progress ?? 0)]!; }
export function haulWindow(prompt: InteractionPrompt, connected: readonly string[], id: string) {
  const pulls = prompt.challenge?.pulls ?? {};
  const total = connected.reduce((sum, p) => sum + haulWeight(prompt, p), 0);
  const supplied = connected.reduce((sum, p) => sum + (p === id ? 0 : (pulls[p] ?? 0) * haulWeight(prompt, p)), 0);
  const waiting = connected.filter(p => p === id || pulls[p] === undefined).reduce((sum, p) => sum + haulWeight(prompt, p), 0);
  return { effort: (haulTarget(prompt) * total - supplied) / Math.max(1, waiting),
    tolerance: (prompt.relaxed ? .2 : .12) * total / Math.max(1, waiting) };
}
export function haulNeeded(prompt: InteractionPrompt, connected: readonly string[], id: string): number { return clamp(haulWindow(prompt, connected, id).effort); }

/** Gemfall v4: static deliberate placement and shared weighted hauling, never a disguised toss. */
export function applyGemfallAction(prompt: InteractionPrompt, connected: readonly string[], playerId: string, action: InteractionAction): "success" | "failure" | undefined {
  const game = prompt.challenge!;
  if (!connected.includes(playerId) || action.action !== "commit" || action.round !== game.round) throw Error("That load has moved on.");
  if (!unit(action.position)) throw Error("Choose your effort.");
  let good: boolean, damage: number, feedback: string;
  if (prompt.spec.kind === "precision") {
    if (playerId !== interactionActor(prompt, connected)) throw Error("Help your friend find the support point.");
    if (!unit(action.angle)) throw Error("Choose where to support it.");
    const read = steadyReading(prompt, action.angle, action.position);
    const hum = prompt.spec.handling === "hum";
    prompt.stopPosition = action.position;
    game.lastAngle = action.angle;
    good = read.safe;
    const miss = Math.max(read.offset - read.tolerance, Math.abs(read.lift - read.load) - read.tolerance);
    damage = miss < .12 ? .2 : .4;
    feedback = !read.supported && hum ? "The note wanders. Find the steady pitch before adding more voice."
      : read.supported && !good && hum ? read.lift < read.load ? "The pitch holds. Add a little voice." : "The hum swells too strongly. Keep the pitch and ease your voice."
      : good ? "Steady! The weight moves. Find the next support point."
      : !read.supported ? "Off the support point. Move your grip toward the gold before adding effort."
      : read.lift < read.load ? "Supported, but not moving yet. Add a little effort."
      : "Too much pressure. Ease your effort; keep your grip where it is.";
  } else if (prompt.spec.kind === "cooperate") {
    game.pulls[playerId] = action.position;
    if (!connected.every(id => game.pulls[id] !== undefined)) return;
    const total = connected.reduce((sum, id) => sum + haulWeight(prompt, id), 0);
    const effort = connected.reduce((sum, id) => sum + game.pulls[id]! * haulWeight(prompt, id), 0) / total;
    const error = effort - haulTarget(prompt);
    const tolerance = prompt.relaxed ? .2 : .12;
    good = Math.abs(error) <= tolerance && connected.every(id => game.pulls[id]! > 0);
    damage = error > tolerance ? Math.max(.25, error) : 0;
    feedback = good ? "The load moves safely. The next stretch changes the weight."
      : error > tolerance ? "The cords strain. Ease your combined effort on the next pull."
      : "The load stays put. Share more of the weight; your safe progress holds.";
    game.pulls = {};
  } else throw Error("This game uses different controls.");
  game.feedback = feedback;
  game.round++;
  if (good) {
    if (prompt.spec.kind === "precision") {
      game.completed = { ...skillCompletions(prompt) };
      game.completed[playerId] = (game.completed[playerId] ?? 0) + 1;
      const roster = game.participants ?? prompt.playerIds;
      game.nextParticipant = (roster.indexOf(playerId) + 1) % Math.max(1, roster.length);
    }
    game.progress++;
    game.strain = Math.max(0, game.strain - .15);
    return game.progress >= skillSteps(prompt, connected) ? "success" : undefined;
  }
  game.strain = Math.min(1, game.strain + damage);
  return game.strain >= 1 ? "failure" : undefined;
}
