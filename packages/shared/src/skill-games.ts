import { aimWidth, edgeScale, interactionActor, playbackOver, precisionSuccess, trackedCover, type InteractionAction, type InteractionPrompt } from "./interactions.js";

/** A round identifies the situation being acted on, including a recovery. */
export interface SkillChallenge {
  round: number;
  progress: number;
  strain: number;
  feedback: string;
  pulls: Record<string, number>;
  arrangement: string[];
  matched: number;
  excluded: string[];
}
export function skillStart(): SkillChallenge {
  return { round: 0, progress: 0, strain: 0, feedback: "", pulls: {}, arrangement: [], matched: 0, excluded: [] };
}
export function skillSteps(prompt: InteractionPrompt): number {
  return prompt.spec.kind === "balance" || prompt.spec.kind === "cooperate" ? 3 : 1;
}
export function balanceTarget(prompt: InteractionPrompt): number {
  return [0.5, 0.75, 0.25][Math.min(2, prompt.challenge?.progress ?? 0)]!;
}
export function pullTarget(prompt: InteractionPrompt): number {
  return [0.4, 0.7, 0.5][Math.min(2, prompt.challenge?.progress ?? 0)]!;
}
/** A friend's committed effort changes what the remaining hands need to supply. */
export function pullNeeded(prompt: InteractionPrompt, connected: readonly string[]): number {
  const pulls = prompt.challenge?.pulls ?? {};
  const waiting = connected.filter(id => pulls[id] === undefined).length;
  const supplied = connected.reduce((sum, id) => sum + (pulls[id] ?? 0), 0);
  return waiting ? Math.max(0, Math.min(1, (pullTarget(prompt) * connected.length - supplied) / waiting)) : pullTarget(prompt);
}
/** How far the shared lift may sit from the gold: wider relaxed, and scaled by the acting hero's edge (#567). */
export function balanceTolerance(prompt: InteractionPrompt): number { return (prompt.relaxed ? 0.17 : 0.09) * edgeScale(prompt); }
export function skillAim(prompt: InteractionPrompt) {
  const spec = prompt.spec;
  if (spec.kind !== "precision" && spec.kind !== "timing") throw Error("This game has no aiming window.");
  return spec;
}
export function skillCanStart(kind: InteractionPrompt["spec"]["kind"]): boolean { return kind !== "relay" && kind !== "play"; }
const unit = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

/** Engine-only mutation. Rejected inputs throw before changing any state. */
export function applySkillAction(prompt: InteractionPrompt, connected: readonly string[], playerId: string,
  action: InteractionAction, now: string): "success" | "failure" | undefined {
  const game = prompt.challenge!;
  const spec = prompt.spec;
  const lead = interactionActor(prompt, connected);
  if (action.action === "adjust" && spec.kind === "balance") {
    if (action.round !== game.round) throw Error("The load has shifted since that adjustment.");
    const steps = action.steps ?? 1;
    if (!["up", "down"].includes(action.direction) || !Number.isInteger(steps) || steps < 1 || steps > 4) throw Error("Choose a lift notch.");
    const levels = prompt.levels ??= {};
    levels[playerId] = Math.max(0, Math.min(1, (levels[playerId] ?? 0) + (action.direction === "up" ? 0.25 : -0.25) * steps));
    return;
  }
  if ((action.action !== "commit" && action.action !== "arrange") || action.round !== game.round) throw Error("That situation has moved on.");
  if (spec.kind !== "cooperate" && playerId !== lead) throw Error("Help your friend on their phone.");
  if (action.action === "arrange") {
    if ((spec.kind !== "sequence" && spec.kind !== "memory") || !Array.isArray(action.answer) || action.answer.length > spec.answer.length ||
      !action.answer.every(id => spec.options.some(o => o.id === id)) || (spec.kind === "memory" && !playbackOver(prompt, now))) throw Error("Choose pictures after watching.");
    let unchanged = 0;
    while (unchanged < action.answer.length && action.answer[unchanged] === game.arrangement[unchanged]) unchanged++;
    game.matched = Math.min(game.matched, unchanged);
    game.arrangement = [...action.answer];
    return;
  }
  const finishRound = () => { game.round++; game.pulls = {}; };
  const stumble = (amount: number, feedback: string) => {
    game.strain = Math.min(1, game.strain + amount); game.feedback = feedback; finishRound();
    return game.strain >= 1 ? "failure" as const : undefined;
  };
  const advance = (feedback: string) => {
    game.progress++; game.strain = Math.max(0, game.strain - 0.1); game.feedback = feedback; finishRound();
    return game.progress >= skillSteps(prompt) ? "success" as const : undefined;
  };
  if (spec.kind === "balance") {
    const lift = connected.reduce((sum, id) => sum + (prompt.levels?.[id] ?? 0), 0) / Math.max(1, connected.length);
    if (!connected.every(id => (prompt.levels?.[id] ?? 0) > 0)) throw Error("Everyone needs a hand on the load.");
    const error = Math.abs(lift - balanceTarget(prompt));
    if (error <= balanceTolerance(prompt)) return advance("Safe footing! The load shifts. Adjust before the next step.");
    return stumble(Math.max(0.2, error * (prompt.relaxed ? 0.65 : 1.2)), lift < balanceTarget(prompt)
      ? "The load dips. Lift higher before stepping again." : "The load tips up. Ease down before stepping again.");
  }
  if (spec.kind === "cooperate") {
    if (!unit(action.position) || game.pulls[playerId] !== undefined) throw Error("Choose one pull for this ledge.");
    game.pulls[playerId] = action.position;
    if (!connected.every(id => game.pulls[id] !== undefined)) return;
    const errors = connected.map(id => game.pulls[id]! - pullTarget(prompt));
    const tolerance = prompt.relaxed ? 0.22 : 0.13;
    const totalError = errors.reduce((sum, error) => sum + error, 0) / errors.length;
    const jerk = Math.max(...errors) > (prompt.relaxed ? 0.55 : 0.45);
    if (!jerk && Math.abs(totalError) <= tolerance && connected.every(id => game.pulls[id]! > 0)) return advance("Together! Your progress holds. Read the changing weight before the next effort.");
    const rough = Math.max(...errors);
    if (jerk || totalError > tolerance) return stumble(Math.max(0.25, jerk ? rough : totalError * 1.5), "A sharp jerk! The support strains. Ease your next effort into the gold.");
    game.feedback = "Not enough support to move. Your progress holds. Give a little more next time."; finishRound(); return;
  }
  if (spec.kind === "precision" || spec.kind === "timing") {
    if (!unit(action.position)) throw Error("Aim inside the playfield.");
    prompt.stopPosition = action.position;
    const aim = skillAim(prompt);
    if (precisionSuccess(aim, action.position, prompt.relaxed, edgeScale(prompt))) return advance(spec.kind === "timing" ? "Through safely!" : "Right on target!");
    const miss = Math.abs(action.position - aim.target) - aimWidth(aim, prompt) / 2;
    return stumble(Math.max(0.2, miss * 1.8), miss < 0.12 ? "Nearly! You keep your footing. Adjust and try this part again." : "A rough landing! You lose your footing. Read the opening before trying again.");
  }
  if (spec.kind === "tracking") {
    if (!Array.isArray(action.answer) || action.answer.length !== 1 || !spec.covers.some((_, i) => String(i) === action.answer![0]) ||
      game.excluded.includes(action.answer[0]!) || !playbackOver(prompt, now)) throw Error("Watch before lifting a cover.");
    prompt.submittedAnswer = [...action.answer];
    if (action.answer[0] === String(trackedCover(spec))) return "success";
    game.excluded.push(action.answer[0]!); game.feedback = "Empty! Leave that cover up. Remember the last swap and look again."; finishRound();
    return game.excluded.length >= Math.max(1, spec.covers.length - 1) ? "failure" : undefined;
  }
  if (spec.kind === "memory" || spec.kind === "sequence") {
    const answer = action.answer;
    if (!Array.isArray(answer) || !answer.length || answer.length > spec.answer.length || !answer.every(id => spec.options.some(o => o.id === id)) ||
      (spec.kind === "memory" && (answer.length !== spec.answer.length || !playbackOver(prompt, now)))) throw Error("Choose the whole pattern after watching.");
    prompt.submittedAnswer = [...answer];
    let matched = 0;
    while (matched < answer.length && answer[matched] === spec.answer[matched]) matched++;
    game.matched = matched; game.arrangement = [...answer];
    if (spec.kind === "sequence") {
      if (matched === spec.answer.length && !action.testOnly) return "success";
      if (!action.testOnly) {
        if (answer.length !== spec.answer.length) throw Error("Choose a complete path before crossing.");
        return "failure";
      }
      // Testing runs a visible mechanism, but does not commit the story outcome.
      game.feedback = matched === spec.answer.length ? "The whole path holds. Agree together, then make the crossing."
        : matched === answer.length ? "These steps hold! Add the next part of the path." : `The path stops at step ${matched + 1}. Share your clues and rearrange it.`;
      finishRound(); return;
    }
    if (matched === spec.answer.length) return "success";
    game.arrangement = answer.slice(0, matched);
    game.feedback = `The tune falters at note ${matched + 1}. Keep the opening you remembered and rebuild the rest.`;
    return stumble(0.5, game.feedback);
  }
  throw Error("This game uses different controls.");
}
