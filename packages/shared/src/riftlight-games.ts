import { aimWidth, edgeScale, interactionActor, precisionSuccess, skillCompletions, type InteractionAction, type InteractionPrompt } from "./interactions.js";
import { skillSteps } from "./skill-games.js";

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const unit = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

/** A new footing changes the opening; a slip gives a slower, wider recovery. */
export function crossingWindow(prompt: InteractionPrompt) {
  if (prompt.spec.kind !== "timing") throw Error("Not a crossing.");
  const game = prompt.challenge!;
  const recovery = game.strain > 0;
  const center = clamp(prompt.spec.target + [0, 0.12, -0.1, 0.06][game.progress % 4]!, 0.3, 0.7);
  const width = Math.min(center * 2, (1 - center) * 2, clamp(aimWidth(prompt.spec, prompt) + (recovery ? 0.08 : 0), 0.24, 0.65));
  const travel = Math.min(width * 0.65, (prompt.spec.durationMs ?? 650) / prompt.spec.periodMs) * (prompt.relaxed ? 0.65 : 1);
  return { start: center - width / 2, end: center + width / 2, travel,
    periodMs: prompt.spec.periodMs * (prompt.relaxed ? 1.5 : 1) * (recovery ? 1.25 : 1) };
}
export function crossingOpenings(prompt: InteractionPrompt): { start: number; end: number }[] {
  const w = crossingWindow(prompt);
  if (prompt.spec.kind !== "timing" || prompt.spec.setting !== "rift") return [w];
  const short = Math.min(w.travel * 0.45, w.start * 0.16);
  return [{ start: w.start * 0.15, end: w.start * 0.15 + short },
    { start: w.start * 0.55, end: w.start * 0.55 + short }, w];
}
export function crossingPhase(prompt: InteractionPrompt, now: number): number {
  const { periodMs } = crossingWindow(prompt);
  return ((Math.max(0, now - Date.parse(prompt.startedAt ?? "")) % periodMs) / periodMs);
}
export function crossingSafe(prompt: InteractionPrompt, phase: number): boolean {
  const w = crossingWindow(prompt);
  return unit(phase) && crossingOpenings(prompt).some(opening => phase >= opening.start && phase + w.travel <= opening.end);
}

/** Strength controls reach; elevation trades clearance for wind exposure. */
export function throwSituation(prompt: InteractionPrompt) {
  if (prompt.spec.kind !== "precision") throw Error("Not a throw.");
  const game = prompt.challenge!;
  const target = clamp(prompt.spec.target + [0, 0.1, -0.08, 0.04][game.progress % 4]!, 0.3, 0.72);
  const wind = [0.07, -0.1, 0.12, -0.06][game.progress % 4]!;
  const clearance = target * [0.22, 0.32, 0.27, 0.35][game.progress % 4]!;
  return { target, wind, clearance, width: Math.min(0.45, aimWidth(prompt.spec, prompt) + (game.strain > 0 ? 0.06 : 0)) };
}
export function throwFlight(prompt: InteractionPrompt, strength: number, angle: number) {
  const situation = throwSituation(prompt);
  const radians = (25 + angle * 40) * Math.PI / 180;
  const landing = strength * Math.sin(2 * radians) + situation.wind * (0.4 + angle);
  const peak = strength * (0.22 + angle * 0.5);
  const atEdge = landing > 0 ? Math.min(1, situation.target / (2 * landing)) : 1;
  return { landing, peak, clearance: 4 * peak * atEdge * (1 - atEdge) };
}

/** Two real supports: raising one end changes tilt in the opposite direction. Solo has a prop. */
export function carryState(prompt: InteractionPrompt, connected: readonly string[]) {
  const roster = prompt.challenge?.participants ?? prompt.playerIds;
  const side = (id: string) => Math.max(0, roster.indexOf(id)) % 2;
  const left = connected.filter(id => side(id) === 0);
  const right = connected.filter(id => side(id) === 1);
  const average = (ids: readonly string[]) => ids.length ? ids.reduce((sum, id) => sum + (prompt.levels?.[id] ?? 0), 0) / ids.length : 0.5;
  const shift = [0, 0.25, -0.25][Math.min(2, prompt.challenge?.progress ?? 0)]!;
  const tilt = average(left) - average(right) - shift;
  const tolerance = (prompt.relaxed ? 0.2 : 0.13) * edgeScale(prompt);
  const joined = connected.length > 0 && connected.every(id => (prompt.levels?.[id] ?? 0) > 0);
  return { left, right, shift, tilt, tolerance, joined, safe: joined && Math.abs(tilt) <= tolerance };
}

/** Version 3 only. Older games and already-started saves retain their original rules. */
export function applyRiftlightAction(prompt: InteractionPrompt, connected: readonly string[], playerId: string,
  action: InteractionAction, _now: string): "success" | "failure" | undefined {
  const game = prompt.challenge!;
  const kind = prompt.spec.kind;
  if (!connected.includes(playerId)) throw Error("Join your friends first.");
  if (!(action.action === "commit" || action.action === "adjust") || action.round !== game.round) throw Error("That situation has moved on.");
  if (action.action === "adjust") {
    const steps = action.steps ?? 1;
    if (kind !== "balance" || !["up", "down"].includes(action.direction) || !Number.isInteger(steps) || steps < 1 || steps > 4) throw Error("Choose a lifting grip.");
    const levels = prompt.levels ??= {};
    levels[playerId] = clamp((levels[playerId] ?? 0) + (action.direction === "up" ? 1 : -1) * 0.25 * steps, 0, 1);
    return;
  }
  if (playerId !== interactionActor(prompt, connected)) throw Error("Help your friend on their phone.");
  let good = false;
  let damage = 0;
  let feedback = "";
  if (kind === "timing") {
    if (!unit(action.position)) throw Error("Choose a moment in this opening.");
    const w = crossingWindow(prompt);
    prompt.stopPosition = action.position;
    good = crossingSafe(prompt, action.position);
    const gap = action.position < w.start ? w.start - action.position : Math.max(0, action.position + w.travel - w.end);
    damage = gap < 0.09 ? 0.2 : 0.45;
    feedback = good ? "Across! Read the next opening from this safe footing." : action.position < w.start
      ? "Too soon. You catch the edge. The next opening slows down so you can recover."
      : "The gap closed before you were through. You catch the edge. Start earlier in the next opening.";
  } else if (kind === "precision") {
    if (!unit(action.position) || !unit(action.angle)) throw Error("Choose both strength and height.");
    const target = throwSituation(prompt);
    const flight = throwFlight(prompt, action.position, action.angle);
    prompt.stopPosition = flight.landing;
    game.lastAngle = action.angle;
    good = flight.clearance >= target.clearance && precisionSuccess({ ...target, kind: "precision", cue: "", actionLabel: "", periodMs: 1 }, flight.landing, false);
    const miss = Math.max(0, Math.abs(flight.landing - target.target) - target.width / 2);
    damage = miss < 0.1 ? 0.2 : 0.45;
    feedback = good ? "Landed! Your friend takes the next position. Read the new wind."
      : flight.clearance < target.clearance ? "Too low: it clips the edge. Raise the arc and check the wind."
      : flight.landing < target.target ? "Short of the landing. Add strength or lower the arc."
      : "Past the landing. Ease your strength or raise the arc.";
    game.lastThrow = { landing: flight.landing, peak: flight.peak, good };
  } else if (kind === "balance") {
    const carry = carryState(prompt, connected);
    if (!carry.joined) throw Error("Everyone needs a hand on the beam.");
    good = carry.safe;
    damage = Math.abs(carry.tilt) < 0.3 ? 0.2 : 0.4;
    feedback = good ? "Safe footing! The ground changes height. Balance both ends before stepping."
      : carry.tilt > 0 ? "The right end dips. Lift that end or ease the left. Your safe footing holds."
      : "The left end dips. Lift that end or ease the right. Your safe footing holds.";
  } else throw Error("This game uses different controls.");
  game.feedback = feedback;
  game.round++;
  if (good) {
    if (kind === "precision" || kind === "timing") {
      game.completed = { ...skillCompletions(prompt) };
      game.completed[playerId] = (game.completed[playerId] ?? 0) + 1;
      const roster = game.participants ?? prompt.playerIds;
      game.nextParticipant = (roster.indexOf(playerId) + 1) % Math.max(1, roster.length);
    }
    game.progress++;
    game.strain = Math.max(0, game.strain - 0.15);
    return game.progress >= skillSteps(prompt, connected) ? "success" : undefined;
  }
  game.strain = Math.min(1, game.strain + damage);
  return game.strain >= 1 ? "failure" : undefined;
}
