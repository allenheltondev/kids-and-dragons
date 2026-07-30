#!/usr/bin/env node
/**
 * Kids & Dragons — rig contract verifier.
 *
 * `art-pipeline.md` §6.1 claimed this file enforced the rig interface for
 * months before it existed. It does now, and the first thing worth being clear
 * about is where the edge is, because a tool that overstates itself is how the
 * original claim happened:
 *
 *     `compareRigToContract()` is complete and tested, and `introspectRiv()`
 *     runs the real Rive runtime headlessly (see its note for how, and for the
 *     false claim that used to live there). What is *not* yet proven is the
 *     pairing of the two against a rig somebody actually delivered — no `.riv`
 *     exists in the tree, so the first delivery is still the first full
 *     rehearsal, and introspection fails loudly rather than passing a rig it
 *     could not read.
 *
 * Everything decidable from the manifest and the files that exist today is
 * enforced, and that turns out to be most of what actually bites:
 *
 *   1. **The contract is coherent.** Every clip in a set is defined, every
 *      event tick lands inside its clip, no input is declared twice, and the
 *      clip names and the trigger names do not drift apart.
 *   2. **The contract fits the turn budget.** §9.2 derives 45 ticks of motion
 *      per turn from spec §7.1's six-minute encounter, and the arithmetic there
 *      is load-bearing: a clip that grows silently is a turn that grows
 *      silently, and the cost lands on an eight-year-old's attention.
 *   3. **The effects and the clips agree.** Which sheet fires on which clip
 *      event is contract, not code: every entry in `manifest.effects[]` carries
 *      `startsOn: { clip, event }` (or `startsOn: null` for an ambient loop),
 *      and every declared pairing is checked — the event exists, the sheet runs
 *      on the contract's tick clock. A sheet is allowed to keep playing after
 *      its clip ends — burst_star's tail does, by design — but the tail is not
 *      waved through: it is charged against the turn budget in check #2, tick
 *      for tick, and so is a concurrent clip (`revive`) that overhangs the clip
 *      that hosts it.
 *   4. **A rig that ships is compared against the contract, clip by clip** —
 *      missing clips, clips nobody asked for, clip lengths that disagree with
 *      the tick table, missing or wrongly-typed state-machine inputs. And if the
 *      file cannot be read, that is a failure and not a pass: the previous state
 *      of the world was silence, and silence is what let §6.1 lie.
 *
 * Usage:
 *     npm run art:verify:rig
 *     node tools/art/verify-rig.ts            # same thing
 *     node tools/art/verify-rig.ts --strict   # missing rigs fail too
 *
 * Sibling of `tools/art/verify.py` (pixels) and `tools/content/validate.mjs`
 * (content). Same convention as verify.py: undelivered work is reported and
 * tolerated, broken work fails.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Whether this file was run, or imported.
 *
 * `main()` calls `process.exit`, which `verify-rig.test.ts` — importing
 * `compareRigToContract` — would rather it did not.
 */
const IS_ENTRY =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MANIFEST = join(ROOT, "assets", "manifest.json");
const CHARACTERS = join(ROOT, "assets", "characters");

const tty = process.stdout.isTTY;
const RED = tty ? "[31m" : "";
const GREEN = tty ? "[32m" : "";
const YELLOW = tty ? "[33m" : "";
const DIM = tty ? "[2m" : "";
const BOLD = tty ? "[1m" : "";
const RESET = tty ? "[0m" : "";

// ---------------------------------------------------------------------------
// The shape of the contract, as this tool reads it
// ---------------------------------------------------------------------------

/**
 * A start declared against a host clip's event — how a concurrent clip
 * (`hurt`, `revive`) and every one-shot effect sheet say when they begin.
 * For an effect, `null` is the ambient case (the tier auras): it starts with
 * the figure, not with an event, and says so rather than saying nothing.
 */
interface StartsOn {
  clip: string;
  event: string;
}

interface Clip {
  ticks: number;
  /** Event name → the tick it fires on, or several ticks. */
  events?: Record<string, number | number[]>;
  loop?: boolean;
  /** A hold clip ends on its last pose and stays there. `guard`. */
  hold?: boolean;
  /** A one-shot that hands off to a loop of this length. `down`. */
  loopTicks?: number;
  /** The name of the loop it hands off to — a second Rive animation, required
   *  alongside its host wherever a set requires the host. `down` → `down_loop`. */
  loopClip?: string;
  /** Plays outside a turn, so it is not charged against the turn budget. */
  outOfCombat?: boolean;
  /** The action this clip plays for is preceded by a d20 (dice.ts). */
  rolls?: boolean;
  /** Overlaps another clip rather than following it. `hurt`, `revive`. */
  concurrent?: boolean;
  /** The host event that starts a concurrent clip. Required with `concurrent`,
   *  because without it the clip's overhang past its host is unmeasurable. */
  startsOn?: StartsOn;
  /** Not this commission. Absence from a rig is not a failure. */
  deferred?: boolean;
}

export interface RigContract {
  tickFps: number;
  inputs: { triggers: string[]; booleans: string[]; numbers: string[] };
  clips: Record<string, Clip>;
  sets: Record<string, string[]>;
  turnBudgetTicks: number;
}

export interface EffectEntry {
  id: string;
  frames: number;
  fps: number;
  size: number;
  tileScoped?: boolean;
  loop?: boolean;
  outOfCombat?: boolean;
  /** The clip event that fires this sheet, or null for an ambient loop. */
  startsOn?: StartsOn | null;
}

interface Manifest {
  tiers: string[];
  species: { id: string }[];
  effects: EffectEntry[];
  rigContract?: RigContract;
}

/**
 * The tick a `startsOn` fires at, or undefined when the host clip or event does
 * not exist — a fact the *caller* turns into a failure, because "the pairing is
 * broken" is a different message in a sync check than in a budget check.
 * A multi-tick event starts the consumer at its first firing.
 */
function startsOnTick(contract: RigContract, s: StartsOn): number | undefined {
  const at = contract.clips[s.clip]?.events?.[s.event];
  if (at === undefined) return undefined;
  return Array.isArray(at) ? Math.min(...at) : at;
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

/**
 * Exported, and the writer is injectable, for one reason: the effect-sync and
 * turn-budget checks are judged by tests against a Report they can read without
 * this file printing through the test run.
 */
export class Report {
  passed = 0;
  readonly failures: string[] = [];
  readonly warnings: string[] = [];

  // Not a parameter property — Node runs this file with type stripping, and
  // strip-only mode refuses `constructor(private ...)` because it is code.
  private readonly log: (line: string) => void;

  constructor(log: (line: string) => void = (line) => console.log(line)) {
    this.log = log;
  }

  ok(label: string): void {
    this.passed += 1;
    this.log(`  ${GREEN}pass${RESET}  ${label}`);
  }

  fail(label: string, expected: string, actual: string, hint?: string): void {
    this.failures.push(label);
    this.log(`  ${RED}FAIL${RESET}  ${label}`);
    this.log(`        expected: ${expected}`);
    this.log(`        actual:   ${actual}`);
    if (hint) this.log(`        ${DIM}${hint}${RESET}`);
  }

  warn(label: string, detail?: string): void {
    this.warnings.push(label);
    this.log(`  ${YELLOW}warn${RESET}  ${label}`);
    if (detail) this.log(`        ${detail}`);
  }

  /** A dim aside — something deliberately skipped, said out loud. Not a pass. */
  note(label: string): void {
    this.log(`  ${DIM}${label}${RESET}`);
  }
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

/**
 * The clock itself is data, so it is checked like data.
 *
 * Every downstream number is derived from `tickFps` (the roll's 1.5s becomes
 * ticks by multiplying it) or compared against `turnBudgetTicks`. Arithmetic on
 * a zero, a negative or a fraction does not crash — it produces failures that
 * *look* like clip problems, which is worse. So the clock is checked first, and
 * `checkTurnBudget` declines to measure against a clock this check has failed.
 */
function checkContractClock(rep: Report, contract: RigContract): void {
  let ok = true;
  for (const [name, value] of [
    ["tickFps", contract.tickFps],
    ["turnBudgetTicks", contract.turnBudgetTicks],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      rep.fail(
        `rigContract.${name}`,
        "a positive whole number",
        String(value),
        "Every other number in the contract is stated in ticks of this clock. A broken clock breaks them all at once.",
      );
      ok = false;
    }
  }
  if (ok) rep.ok(`clock  ${contract.tickFps}fps tick, ${contract.turnBudgetTicks}-tick turn budget`);
}

/** Every tick in the contract is a whole number of frames, and positive. */
function checkClipTicks(rep: Report, contract: RigContract): void {
  let ok = true;
  for (const [name, clip] of Object.entries(contract.clips)) {
    if (!Number.isInteger(clip.ticks) || clip.ticks < 1) {
      rep.fail(`clip ${name}  ticks`, "a positive whole number of frames", String(clip.ticks));
      ok = false;
      continue;
    }
    if (clip.loopTicks !== undefined && (!Number.isInteger(clip.loopTicks) || clip.loopTicks < 1)) {
      rep.fail(`clip ${name}  loopTicks`, "a positive whole number of frames", String(clip.loopTicks));
      ok = false;
    }
    // A clip cannot both loop and hold: one ends where it started, the other
    // stops where it finished, and a rigger reading both would have to guess.
    if (clip.loop && clip.hold) {
      rep.fail(`clip ${name}  loop and hold`, "one or the other", "both");
      ok = false;
    }
    // Nor can loopTicks coexist with either. loopTicks means "play once, then
    // hand off to a loop this long" (`down`) — a clip that already loops never
    // reaches the hand-off, and a clip that holds is *defined* by not handing
    // off. Both combinations are two contradictory instructions to one rigger.
    if (clip.loopTicks !== undefined && (clip.loop || clip.hold)) {
      rep.fail(
        `clip ${name}  ${clip.loop ? "loop" : "hold"} and loopTicks`,
        "one or the other",
        "both",
        "loopTicks is the one-shot-into-loop pattern. A looping or holding clip has nothing to hand off to.",
      );
      ok = false;
    }
    // A hand-off loop is a second Rive animation, so it needs a name *and* a
    // length. loopTicks without loopClip is the unnamed animation that would
    // make the first correct `down` delivery fail as an unknown clip; loopClip
    // without loopTicks is a required animation nobody knows the length of.
    if ((clip.loopClip !== undefined) !== (clip.loopTicks !== undefined)) {
      rep.fail(
        `clip ${name}  ${clip.loopClip !== undefined ? "loopClip without loopTicks" : "loopTicks without loopClip"}`,
        "loopClip and loopTicks together — the hand-off loop's name and its length",
        clip.loopClip !== undefined ? `loopClip "${clip.loopClip}", no length` : `loopTicks ${clip.loopTicks}, no name`,
        "The loop is its own animation in the rig. A contract that names it without a length, or times it without a name, is a clip a rigger has to guess at.",
      );
      ok = false;
    }
    if (clip.loopClip !== undefined && clip.loopClip in contract.clips) {
      rep.fail(
        `clip ${name}  loopClip "${clip.loopClip}"`,
        "a name no other clip already owns",
        "also an entry in rigContract.clips",
        "The companion requirement and the set requirement would fight over one animation.",
      );
      ok = false;
    }
  }
  if (ok) rep.ok(`clip timings  ${Object.keys(contract.clips).length} clips, whole ticks, no loop/hold conflict`);
}

/**
 * An event has to fire *during* the clip that owns it.
 *
 * Off-by-one here is the difference between an impact effect that lands on the
 * swing and one that plays after the figure has already gone back to idle. Ticks
 * are 1-based, matching how §9.2 quotes them ("impact event at tick 3").
 */
function checkEventTicks(rep: Report, contract: RigContract): void {
  let ok = true;
  let counted = 0;
  for (const [name, clip] of Object.entries(contract.clips)) {
    for (const [event, at] of Object.entries(clip.events ?? {})) {
      for (const tick of Array.isArray(at) ? at : [at]) {
        counted += 1;
        if (!Number.isInteger(tick) || tick < 1 || tick > clip.ticks) {
          rep.fail(
            `clip ${name}  event "${event}"`,
            `a tick in 1..${clip.ticks}`,
            String(tick),
            "An event outside its clip never fires, so whatever it was meant to trigger never plays.",
          );
          ok = false;
        }
      }
    }
  }
  if (ok) rep.ok(`event ticks  ${counted} event(s), all inside their clip`);
}

/** No name declared twice across triggers, booleans and numbers. */
function checkInputs(rep: Report, contract: RigContract): void {
  const { triggers, booleans, numbers } = contract.inputs;
  const all = [...triggers, ...booleans, ...numbers];
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const name of all) {
    if (seen.has(name)) dupes.add(name);
    seen.add(name);
  }
  if (dupes.size > 0) {
    rep.fail(
      "inputs  duplicate names",
      "each input declared once",
      [...dupes].join(", "),
      "Rive keys inputs by name; two kinds sharing one name is one input and a silent loser.",
    );
    return;
  }
  rep.ok(`inputs  ${triggers.length} trigger(s), ${booleans.length} bool(s), ${numbers.length} number(s), no collisions`);
}

/**
 * Every clip a set requires is defined, and every clip defined is in some set.
 *
 * The second half is the one worth having. A clip nobody's set requires is a
 * clip no rigger is told to author and no reviewer is told to look for — it is
 * a line in a table that means nothing, which is how the `verify-rig` claim
 * itself survived so long.
 */
function checkSets(rep: Report, contract: RigContract): void {
  let ok = true;
  const inSomeSet = new Set<string>();
  for (const [kind, clips] of Object.entries(contract.sets)) {
    if (clips.length === 0) {
      rep.fail(`set ${kind}`, "at least one clip", "empty");
      ok = false;
    }
    const seen = new Set<string>();
    for (const name of clips) {
      inSomeSet.add(name);
      if (seen.has(name)) {
        rep.fail(`set ${kind}`, `"${name}" listed once`, "listed twice");
        ok = false;
      }
      seen.add(name);
      if (!(name in contract.clips)) {
        rep.fail(
          `set ${kind}  clip "${name}"`,
          "an entry in rigContract.clips",
          "not defined",
          "A required clip with no timing is a clip every rigger guesses the length of.",
        );
        ok = false;
      }
    }
  }
  for (const name of Object.keys(contract.clips)) {
    if (!inSomeSet.has(name)) {
      rep.fail(
        `clip ${name}  unused`,
        "listed in at least one set",
        "in no set",
        "Nothing requires it, so no rig is checked for it and no reviewer looks for it. Add it to a set or delete it.",
      );
      ok = false;
    }
  }
  if (ok) {
    const summary = Object.entries(contract.sets)
      .map(([kind, clips]) => `${kind} ${clips.length}`)
      .join(", ");
    rep.ok(`clip sets  ${summary}; every required clip defined, every clip required`);
  }
}

/**
 * Every trigger drives a clip, and every clip that needs driving has a trigger.
 *
 * `idle` is the default state and has no trigger, and `down` is driven by the
 * `knockedDown` boolean rather than a trigger — those two are the documented
 * exceptions (art-pipeline §6.1, asset-brief §9.3) and they are named here so a
 * third one cannot be added by accident. A concurrent clip with a `startsOn`
 * (`hurt`, `revive`) needs no entry: the contract itself says its host's event
 * starts it, and data the contract carries beats a list this file remembers.
 */
function checkTriggerCoverage(rep: Report, contract: RigContract): void {
  const NO_TRIGGER: Record<string, string> = {
    idle: "the default state",
    down: "driven by the knockedDown boolean",
  };
  // §6.1 names the walk trigger `move`, and the clip is `walk`.
  const CLIP_FOR_TRIGGER: Record<string, string> = { move: "walk", helpUp: "lift" };

  let ok = true;
  const driven = new Set<string>();
  for (const trigger of contract.inputs.triggers) {
    const clip = CLIP_FOR_TRIGGER[trigger] ?? trigger;
    driven.add(clip);
    if (!(clip in contract.clips)) {
      rep.fail(
        `trigger ${trigger}`,
        `a clip "${clip}" in rigContract.clips`,
        "no such clip",
        "A trigger with nothing to play is an input the client can fire into silence.",
      );
      ok = false;
    }
  }
  for (const [name, clip] of Object.entries(contract.clips)) {
    if (driven.has(name) || name in NO_TRIGGER) continue;
    // Started by its host clip's event, not by the state machine — checked for
    // coherence in checkTurnBudget, which is where the start tick is load-bearing.
    if (clip.concurrent && clip.startsOn) continue;
    rep.fail(
      `clip ${name}  unreachable`,
      "a trigger, or a documented reason not to have one",
      "neither",
      "Add the trigger, or add it to NO_TRIGGER in this file with the reason.",
    );
    ok = false;
  }
  for (const [name, why] of Object.entries(NO_TRIGGER)) {
    if (!(name in contract.clips)) {
      rep.warn(`clip ${name} is exempted from needing a trigger (${why}) but is not defined`);
    }
  }
  if (ok) rep.ok(`triggers  every trigger plays a clip, every clip is reachable`);
}

/**
 * §9.2's turn budget, re-derived rather than quoted.
 *
 * The worst realistic turn is the one the brief works out: a move, the longest
 * action, the roll if that action takes one, and whatever tail the action's
 * effect sheet has left running. If that exceeds the budget the fix is never
 * "raise the budget" — it is spec §7.1's six minutes, and the six minutes are
 * the design.
 *
 * `rolls`, `concurrent` and every start tick come off the contract rather than
 * out of this function, and the first version of this check is why. It charged
 * the roll's 18 ticks against every clip, which put Help Up 2 ticks over budget
 * for a d20 it never throws — a failure invented by the measurement. Which clip
 * follows a roll is an engine fact (`dice.ts`), so it belongs next to the clip;
 * which event starts an effect or a concurrent clip is `startsOn` in the
 * manifest, so the tails and overhangs measured here are the manifest's own.
 *
 * A concurrent clip is excluded from the action list but not from the bill: it
 * overlaps its host, and any part of it past the host's end is time the turn
 * still has to wait for. `hurt` (impact tick 3 + 5 ticks) ends inside the
 * attack; `revive` (contact tick 6 + 10 ticks) ends at 15 where the lift ends
 * at 10, and those 5 ticks are charged to the Help Up turn. The first version
 * excluded `concurrent` unconditionally — harmless at 2026's numbers, invisible
 * the day someone retimed `lift`, which is the failure mode this tool exists
 * to prevent.
 */
export function checkTurnBudget(rep: Report, contract: RigContract, effects: EffectEntry[]): void {
  if (
    !Number.isInteger(contract.tickFps) ||
    contract.tickFps < 1 ||
    !Number.isInteger(contract.turnBudgetTicks) ||
    contract.turnBudgetTicks < 1
  ) {
    // checkContractClock has already failed the run. Deriving ROLL_TICKS from a
    // broken tickFps would only bury that one real failure under arithmetic
    // noise dressed up as clip problems.
    return;
  }

  const ticks = (name: string) => contract.clips[name]?.ticks ?? 0;

  // The dice roll takes 1.5s of the turn and owns the screen while it does
  // (§2.2). Quoted in ticks on the contract's own clock.
  const ROLL_TICKS = Math.round(1.5 * contract.tickFps);
  // A Duskrunner's six steps is the longest move in the game (rules.json
  // baseSteps), and `walk` is one two-step cycle.
  const MOVE_TICKS = 3 * ticks("walk");

  // Concurrent clips first: each must say what starts it, or its overhang is
  // unmeasurable and the budget is back to taking `concurrent` on faith.
  let startsOk = true;
  const overhangs = new Map<string, { name: string; ticks: number }>();
  for (const [name, clip] of Object.entries(contract.clips)) {
    if (!clip.concurrent) continue;
    const s = clip.startsOn;
    const from = s ? startsOnTick(contract, s) : undefined;
    if (!s || from === undefined) {
      rep.fail(
        `turn budget  concurrent clip "${name}"`,
        'startsOn naming a real host event, e.g. { "clip": "lift", "event": "contact" }',
        s ? `startsOn names "${s.clip}.${s.event}", which does not exist` : "no startsOn",
        "A concurrent clip with no measurable start is an overhang charged to nothing — the unverifiable assertion this field replaced.",
      );
      startsOk = false;
      continue;
    }
    const over = from + clip.ticks - 1 - ticks(s.clip);
    const prior = overhangs.get(s.clip);
    if (over > 0 && (!prior || over > prior.ticks)) {
      overhangs.set(s.clip, { name, ticks: over });
    }
  }
  if (!startsOk) return;

  // `walk` needs no special case: it is `loop: true` and loops are excluded,
  // because a loop has no length of its own — the move already charges it above
  // as MOVE_TICKS, cycle by cycle.
  const actionClips = Object.entries(contract.clips).filter(
    ([, c]) => !c.outOfCombat && !c.loop && !c.concurrent,
  );
  if (actionClips.length === 0) {
    rep.fail("turn budget", "at least one action clip to measure", "none");
    return;
  }

  let worst = { total: 0, detail: "" };
  for (const [name, clip] of actionClips) {
    // An effect fired by this clip's event runs from that tick; anything past
    // the clip's own end is tail the turn still has to wait for. Same for a
    // concurrent clip riding on this one — both run at once after the host
    // ends, so the turn waits for whichever runs longer, not for the sum.
    let tail = 0;
    let tailNote = "effect tail";
    for (const effect of effects) {
      const s = effect.startsOn;
      if (!s || s.clip !== name) continue;
      const from = startsOnTick(contract, s);
      if (from === undefined) continue; // a broken pairing is checkEffectSync's failure, once
      tail = Math.max(tail, from + effect.frames - 1 - clip.ticks);
    }
    const over = overhangs.get(name);
    if (over && over.ticks > tail) {
      tail = over.ticks;
      tailNote = `${over.name} overhang`;
    }
    const roll = clip.rolls ? ROLL_TICKS : 0;
    const total = roll + MOVE_TICKS + clip.ticks + Math.max(0, tail);
    if (total > worst.total) {
      worst = {
        total,
        detail:
          `${roll > 0 ? `roll ${roll} + ` : ""}move ${MOVE_TICKS} + ${name} ${clip.ticks}` +
          `${tail > 0 ? ` + ${tail} tick(s) of ${tailNote}` : ""}`,
      };
    }
  }

  if (worst.total > contract.turnBudgetTicks) {
    rep.fail(
      "turn budget",
      `≤ ${contract.turnBudgetTicks} ticks (${(contract.turnBudgetTicks / contract.tickFps).toFixed(2)}s)`,
      `${worst.total} ticks — ${worst.detail}`,
      "§9.2: if a clip needs to grow, something else in the same turn has to shrink. Say which, and why.",
    );
    return;
  }
  rep.ok(
    `turn budget  worst turn ${worst.total}/${contract.turnBudgetTicks} ticks  (${worst.detail})`,
  );
}

/**
 * An effect that syncs to a clip event runs on the same clock as the clip.
 *
 * The pairings come from the manifest — every entry in `manifest.effects[]`
 * declares `startsOn: { clip, event }`, or `startsOn: null` for an ambient
 * loop — so coverage is every delivered sheet, not the three a hardcoded table
 * used to know about. Three things can be wrong. The entry can dodge the
 * question by declaring no `startsOn` at all, which is the old silence back.
 * The named clip or event can be missing, in which case the sheet has nothing
 * to start it and the renderer would have to guess. Or the sheet can run at a
 * different fps from the contract's tick, in which case the two drift —
 * slowly, and only visibly on the third or fourth swing, which is the worst
 * way for a timing bug to present.
 *
 * The reverse direction is a warning, not a failure: a clip event no effect
 * consumes (`leap`'s `dust`) is usually a sheet that has not been commissioned
 * yet (asset-brief §9.7 item 1), and this tool tolerates undelivered work.
 */
export function checkEffectSync(rep: Report, contract: RigContract, effects: EffectEntry[]): void {
  let ok = true;
  // Counted so the pass line cannot claim more than was verified — a pass line
  // that says "5 sheet(s)" after checking four is the same overstatement in
  // miniature that this file exists to stop.
  let checked = 0;
  const ambient: string[] = [];
  for (const effect of effects) {
    const s = effect.startsOn;
    if (s === null) {
      // Declared ambient: it starts with the figure, not with an event.
      ambient.push(effect.id);
      continue;
    }
    if (s === undefined) {
      rep.fail(
        `effect sync  ${effect.id}`,
        'startsOn: { "clip", "event" } — or startsOn: null for an ambient loop',
        "no startsOn at all",
        "Which event fires which sheet is contract, not code. An entry that answers neither way is a sheet nothing checks.",
      );
      ok = false;
      continue;
    }
    checked += 1;
    const clip = contract.clips[s.clip];
    if (!clip) {
      rep.fail(`effect sync  ${effect.id}`, `a clip "${s.clip}"`, "no such clip");
      ok = false;
      continue;
    }
    const at = clip.events?.[s.event];
    if (at === undefined) {
      rep.fail(
        `effect sync  ${effect.id}`,
        `${s.clip} exposes an event "${s.event}"`,
        `${s.clip} exposes ${Object.keys(clip.events ?? {}).join(", ") || "no events"}`,
        "art-pipeline §6.1: the impact frame is exposed as an event so effects sync. Without it the renderer guesses.",
      );
      ok = false;
      continue;
    }
    if (effect.fps !== contract.tickFps) {
      rep.fail(
        `effect sync  ${effect.id}`,
        `${contract.tickFps}fps, the contract's tick`,
        `${effect.fps}fps`,
        "A sheet on a different clock drifts against the clip that fired it — invisibly at first.",
      );
      ok = false;
    }
  }

  // Events nothing consumes — no effect and no concurrent clip starts on them.
  // A warning, because the usual reason is a sheet §9.7 specifies that nobody
  // has commissioned yet; the day it lands with its startsOn, this goes quiet.
  const consumed = new Set<string>();
  for (const effect of effects) {
    if (effect.startsOn) consumed.add(`${effect.startsOn.clip}.${effect.startsOn.event}`);
  }
  for (const clip of Object.values(contract.clips)) {
    if (clip.concurrent && clip.startsOn) {
      consumed.add(`${clip.startsOn.clip}.${clip.startsOn.event}`);
    }
  }
  for (const [clipName, clip] of Object.entries(contract.clips)) {
    for (const event of Object.keys(clip.events ?? {})) {
      if (consumed.has(`${clipName}.${event}`)) continue;
      rep.warn(
        `event ${clipName}.${event} has no consumer`,
        "No effect or concurrent clip starts on it. Fine while its sheet (asset-brief §9.7 item 1) is uncommissioned; dead weight if that never lands.",
      );
    }
  }

  if (ambient.length > 0) {
    rep.note(`effect sync  ${ambient.length} ambient loop(s) skipped (startsOn: null): ${ambient.join(", ")}`);
  }
  // Nothing checked is not a pass, however clean the nothing was.
  if (ok && checked > 0) {
    rep.ok(`effect sync  ${checked} sheet(s) declare their start, hit a real event, and share the tick`);
  }
}

// ---------------------------------------------------------------------------
// Rig introspection
// ---------------------------------------------------------------------------

/** What a `.riv` has to tell us. Deliberately small and free of Rive types. */
export interface RigIntrospection {
  clips: { name: string; ticks: number; loop: boolean }[];
  /**
   * `null` means the default artboard has no state machine at all — a
   * different fact from a machine with zero inputs (`[]`), and it gets a
   * different failure: "add a state machine" is one fix, "add eleven inputs"
   * is eleven, and only one of them is what actually happened.
   */
  inputs: { name: string; kind: "trigger" | "boolean" | "number" }[] | null;
}

/** One thing wrong with a rig, ready to hand to `Report.fail`. */
export interface RigProblem {
  label: string;
  expected: string;
  actual: string;
  hint?: string;
}

/**
 * The whole judgement, as a pure function.
 *
 * Split out from the file reading on purpose. Everything hard lives here — what
 * counts as a missing clip, how much a tick count may disagree, which inputs a
 * kind needs — and it is all unit-tested against fabricated introspections
 * (`verify-rig.test.ts`), because the alternative is logic whose first exercise
 * is the first rig somebody delivers.
 *
 * `kind` selects the set: a hero rig needs all twelve clips, an enemy rig five
 * (§9.5.2) — plus, for either kind, the hand-off loop of any set clip that
 * names one (`down` → `down_loop`), because a one-shot into a loop is two Rive
 * animations however the set counts it. A clip marked `deferred` in the
 * contract may be absent — that is `transform`, which is Chapter 5's — but if
 * a rig ships it anyway it is still checked, because a wrong `transform` is
 * worse than no `transform`.
 */
export function compareRigToContract(
  rig: RigIntrospection,
  contract: RigContract,
  kind: string,
): RigProblem[] {
  const problems: RigProblem[] = [];
  const required = contract.sets[kind];
  if (!required) {
    return [
      {
        label: `set "${kind}"`,
        expected: `one of ${Object.keys(contract.sets).join(", ")}`,
        actual: "not in rigContract.sets",
      },
    ];
  }

  // Rive is perfectly happy to store two animations with one name, and the
  // Map below would keep whichever the rigger exported last — so a duplicate
  // of a correct clip would shadow a wrong one, or the other way round, and
  // which of the two this tool judged would be export order. Caught here,
  // before the Map flattens the evidence.
  const seenClipNames = new Set<string>();
  for (const clip of rig.clips) {
    if (seenClipNames.has(clip.name)) {
      problems.push({
        label: `clip "${clip.name}"  duplicated`,
        expected: "one animation per name",
        actual: "the rig defines it more than once",
        hint: "Only one of them can ever be checked or played, and which one is export order. Delete or rename the others.",
      });
    }
    seenClipNames.add(clip.name);
  }

  const byName = new Map(rig.clips.map((c) => [c.name, c]));

  // Hand-off loops. `down` is a one-shot into a 24-tick loop, which Rive
  // expresses as two animations — so the contract names the second one
  // (`loopClip: "down_loop"`) and it is required wherever its host is, at
  // `loopTicks` long, looping. Named here so the unknown-clip check below can
  // recognise it: the first *correct* `down` delivery must not fail for
  // shipping an animation the contract demanded.
  const companions = new Map<string, { host: string; spec: Clip }>();
  for (const name of required) {
    const spec = contract.clips[name];
    if (spec?.loopClip) companions.set(spec.loopClip, { host: name, spec });
  }
  for (const [name, { host, spec }] of companions) {
    const found = byName.get(name);
    if (!found) {
      // A deferred host may be absent with its loop; a delivered host without
      // its loop is a figure that falls and then freezes — §9.3's corpse.
      if (spec.deferred && !byName.has(host)) continue;
      problems.push({
        label: `clip "${name}"`,
        expected: `present (${spec.loopTicks ?? "?"} ticks) — the loop "${host}" hands off to`,
        actual: "missing",
        hint: `The contract's ${host}.loopClip names it: a one-shot into a loop is two Rive animations, and the loop ships with its host. Without it the figure freezes on ${host}'s last frame, which §9.3 forbids.`,
      });
      continue;
    }
    if (spec.loopTicks !== undefined && found.ticks !== spec.loopTicks) {
      problems.push({
        label: `clip "${name}"  length`,
        expected: `${spec.loopTicks} ticks at ${contract.tickFps}fps`,
        actual: `${found.ticks} ticks`,
        hint: "§9.2 derives every tick count from the turn budget. Changing one is a budget change, not a rig detail.",
      });
    }
    if (!found.loop) {
      problems.push({
        label: `clip "${name}"  loop`,
        expected: "looping",
        actual: "one-shot",
        hint: `A hand-off loop that plays once is a breathing figure that stops breathing — the frozen ${host} pose §9.3 forbids, one loop later.`,
      });
    }
  }

  for (const name of required) {
    const spec = contract.clips[name];
    const found = byName.get(name);
    if (!found) {
      // A deferred clip is allowed to be absent, and only that.
      if (spec?.deferred) continue;
      problems.push({
        label: `clip "${name}"`,
        expected: `present (${spec?.ticks ?? "?"} ticks)`,
        actual: "missing",
        hint: "art-pipeline §6.1: game code never special-cases a species, so every clip in the set is required on every rig — including rigs whose species has no ability that fires it.",
      });
      continue;
    }
    if (!spec) continue;

    // Ticks are quoted as whole frames at 12fps and authored to that grid, so
    // this is an equality check and not a tolerance. A clip that is one tick
    // long in the wrong direction desynchronises the effect that rides on it,
    // and "close enough" is how a drift becomes permanent.
    if (found.ticks !== spec.ticks) {
      problems.push({
        label: `clip "${name}"  length`,
        expected: `${spec.ticks} ticks at ${contract.tickFps}fps`,
        actual: `${found.ticks} ticks`,
        hint: "§9.2 derives every tick count from the turn budget. Changing one is a budget change, not a rig detail.",
      });
    }

    // `loop` and `hold` are opposites and both are stated in the contract, so a
    // rig that loops a hold clip (or holds a loop) is checkable. `down` is
    // neither: it is a one-shot that hands off to a loop, which Rive expresses
    // as two clips — the hand-off half (`down_loop`) is judged in the companion
    // block above, and the fall's own flag stays unasserted here.
    const wantsLoop = spec.loop === true;
    const wantsHold = spec.hold === true;
    if ((wantsLoop || wantsHold) && found.loop !== wantsLoop) {
      problems.push({
        label: `clip "${name}"  loop`,
        expected: wantsLoop ? "looping" : "one-shot, ending on its last pose",
        actual: found.loop ? "looping" : "one-shot",
        hint: wantsHold
          ? "A hold clip that loops replays its wind-up forever. Brace is a plant and a hold (§9.2)."
          : "A loop that plays once leaves the figure frozen on its last frame.",
      });
    }
  }

  // Clips nobody asked for. A warning would be the polite call and a failure is
  // the right one: an extra clip is either a name that does not match the
  // contract (so the required clip is *also* reported missing, and this is the
  // reason why) or work nobody costed.
  for (const clip of rig.clips) {
    if (required.includes(clip.name)) continue;
    // A named hand-off loop is contract, not surplus — judged above.
    if (companions.has(clip.name)) continue;
    if (clip.name in contract.clips) {
      problems.push({
        label: `clip "${clip.name}"  not in the ${kind} set`,
        expected: `one of ${required.length} clips for a ${kind} rig`,
        actual: "a clip the contract defines for the other kind",
        hint: "§9.5.2 lists a reason for every clip an enemy does not get. If one of them now applies, change the contract first.",
      });
      continue;
    }
    problems.push({
      label: `clip "${clip.name}"  unknown`,
      expected: "a clip named in rigContract",
      actual: "not in the contract at all",
      hint: "Either a typo against a required clip — check whether one is reported missing above — or a clip nobody asked for.",
    });
  }

  // Inputs. Every declared input has to be there and be the right kind: the
  // client fires these by name, and a trigger the rig calls a boolean is a tap
  // that does nothing.
  //
  // No state machine at all is its own failure, reported once. Reporting it as
  // eleven missing inputs would be technically true and practically useless —
  // the rigger's fix is one machine, and the message should be the fix.
  if (rig.inputs === null) {
    problems.push({
      label: "state machine",
      expected: "a state machine on the default artboard, exposing the contract's inputs",
      actual: "the default artboard has no state machine",
      hint: "The client drives every rig through the default artboard's first state machine (art-pipeline §6.1). Without one there is nothing to fire an input at.",
    });
    return problems;
  }
  const inputByName = new Map(rig.inputs.map((i) => [i.name, i]));
  for (const [kindName, names] of [
    ["trigger", contract.inputs.triggers],
    ["boolean", contract.inputs.booleans],
    ["number", contract.inputs.numbers],
  ] as const) {
    for (const name of names) {
      const found = inputByName.get(name);
      if (!found) {
        problems.push({
          label: `input "${name}"`,
          expected: `a ${kindName} input`,
          actual: "missing",
          hint: "The client fires state-machine inputs by name. One the rig does not expose is a tap into silence.",
        });
        continue;
      }
      if (found.kind !== kindName) {
        problems.push({
          label: `input "${name}"  kind`,
          expected: kindName,
          actual: found.kind,
        });
      }
    }
  }

  return problems;
}

/**
 * Rive's SMIInput type codes, read off the runtime instead of memorised.
 *
 * An earlier version hardcoded `{56: number, 59: trigger, 122: boolean}` —
 * two of the three were wrong for the runtime actually installed (2.39.1 says
 * bool=59, number=56, trigger=58), and nothing could have noticed, because the
 * codes are private to a build and the introspection never ran (see
 * `introspectRiv`'s note). The runtime publishes them as `SMIInput.bool`,
 * `.number` and `.trigger` statics precisely so nobody has to know them, so
 * this asks. Pure and exported for the unit tests; the statics themselves
 * arrive from wasm at the one call site.
 */
export function riveInputKinds(smi: {
  bool: number;
  number: number;
  trigger: number;
}): Record<number, "trigger" | "boolean" | "number"> {
  return { [smi.trigger]: "trigger", [smi.bool]: "boolean", [smi.number]: "number" };
}

/**
 * A Rive animation's playable length, restated on the contract's tick clock.
 *
 * Rive quotes `duration` in frames at the animation's own `fps`, so a rig
 * authored at 60fps is comparable to a tick table written at 12. But duration
 * is not always the playable length: an animation can set a *work area* —
 * `workStart`/`workEnd`, in frames — and then only that window plays, with the
 * frames outside it being the animator's scratch space. A rig that keeps its
 * blocking poses after the work area would otherwise measure as "too long" for
 * a clip that plays exactly to spec.
 *
 * The 2.39.1 runtime signals a set work area with the `enableWorkArea` flag;
 * the published `.d.ts` omits that flag, so where it is absent this falls back
 * to the other signal the API has, `workEnd > 0` (an unset work area reads 0).
 *
 * Pure and exported for the unit tests. `tickFps` is a parameter rather than a
 * read off the contract because `introspectRiv` deliberately knows nothing
 * about the contract, so that `compareRigToContract` is the only thing with an
 * opinion.
 */
export function riveClipTicks(
  anim: {
    duration: number;
    fps: number;
    workStart: number;
    workEnd: number;
    enableWorkArea?: boolean;
  },
  tickFps: number,
): number {
  const workAreaSet =
    anim.enableWorkArea === undefined ? anim.workEnd > 0 : anim.enableWorkArea === true;
  const frames = workAreaSet ? anim.workEnd - anim.workStart : anim.duration;
  return anim.fps > 0 ? Math.round((frames / anim.fps) * tickFps) : 0;
}

/** The runtime's animation timing surface, as `riveClipTicks` wants it. */
interface RiveAnimTiming {
  duration: number;
  fps: number;
  workStart: number;
  workEnd: number;
  enableWorkArea?: boolean;
}

/**
 * A `.riv` → `RigIntrospection`, or an explanation of why not.
 *
 * This comment used to claim the runtime **cannot initialise headlessly** —
 * that it is a WebGL build which dies compiling shaders, and that fixing it
 * means `headless-gl` or a Mesa context in CI. That was false, and worth being
 * precise about because the falsehood shaped this file: `canvas-advanced` is
 * the *Canvas2D* build, and under plain Node a missing WebGL context costs one
 * printed warning ("Image mesh will not be drawn") — which is about rendering
 * image meshes, and this function renders nothing. The claim survived because
 * the import's catch below used to blame *every* failure on the package not
 * being installed, so the real error was never seen. Two small things are
 * genuinely needed headlessly:
 *
 *   1. A `document` stub, installed **before** the module is imported — the
 *      emscripten preamble reads `document.currentScript` at module-eval time,
 *      and the factory later touches `createElement`, `body` and
 *      `addEventListener`. (Installed once, module-wide; this is a CLI, so it
 *      is not restored.)
 *   2. The wasm handed over as bytes (`wasmBinary`) rather than as a path via
 *      `locateFile` — the path gets `fetch()`ed, and Node's fetch does not
 *      read local files.
 *
 * Everything from `runtime.load` onward is wrapped per call: a corrupt-but-
 * parseable `.riv` must come back as a reason string for `checkRigFiles` to
 * fail *that* rig with, not as an unhandled rejection that takes every other
 * rig down with it. And every wasm handle is deleted in the `finally`, because
 * these are refcounted C++ objects, not garbage-collected JS.
 *
 * An unreadable rig is still a **failure**, not a pass — that part of the
 * original design stands. An unreadable rig must cost somebody a red build,
 * because the alternative — the state this file replaced — is a document
 * claiming a check that never ran.
 */
export async function introspectRiv(
  bytes: Uint8Array,
  tickFps: number,
): Promise<RigIntrospection | string> {
  // (1) above. The stub must predate the import, not just the factory call.
  const g = globalThis as { document?: unknown };
  if (typeof g.document === "undefined") {
    g.document = {
      currentScript: null,
      createElement: () => ({ style: {}, getContext: () => null, addEventListener: () => {} }),
      body: { appendChild: () => {}, removeChild: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }

  let Rive: typeof import("@rive-app/canvas-advanced").default;
  try {
    ({ default: Rive } = await import("@rive-app/canvas-advanced"));
  } catch (err) {
    // Only a resolution failure means "not installed". Blaming the install for
    // every error is how the headless-GL myth above went unquestioned: the one
    // message everybody saw was about npm, so nobody read the real exception.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      return "@rive-app/canvas-advanced is not installed (npm install)";
    }
    return `@rive-app/canvas-advanced failed to load: ${(err as Error).message}`;
  }

  let runtime: Awaited<ReturnType<typeof Rive>>;
  try {
    const wasmPath = fileURLToPath(
      new URL("../../node_modules/@rive-app/canvas-advanced/rive.wasm", import.meta.url),
    );
    const wasm = readFileSync(wasmPath);
    runtime = await Rive({
      // (2) above: the bytes, not the path. `locateFile` is still passed
      // because the options type requires it — with `wasmBinary` present the
      // runtime never calls it.
      locateFile: () => wasmPath,
      wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer,
    });
  } catch (err) {
    return `the Rive runtime failed to start: ${(err as Error).message}`;
  }

  // Every wasm object taken from here on is registered and deleted in the
  // finally, newest first. `delete()` is probed for rather than typed, because
  // the published types under-declare it and a leak is worse than a cast.
  const handles: unknown[] = [];
  const track = <T>(h: T): T => {
    handles.push(h);
    return h;
  };

  try {
    const file = track(await runtime.load(bytes));
    if (!file) return "not a readable Rive file";

    const artboard = track(file.defaultArtboard());

    const clips: RigIntrospection["clips"] = [];
    for (let i = 0; i < artboard.animationCount(); i++) {
      const anim = track(artboard.animationByIndex(i));
      // Where the timing lives depends on who you ask: the 2.39.1 runtime puts
      // `duration`/`fps`/`workStart`/`workEnd` on the *animation*, its own
      // `.d.ts` swears they are on the *instance*. Reading the wrong object is
      // a silent `undefined`, so ask the animation first and fall back to an
      // instance if it does not answer.
      let timing = anim as unknown as RiveAnimTiming;
      if (typeof timing.duration !== "number") {
        timing = track(
          new runtime.LinearAnimationInstance(anim, artboard),
        ) as unknown as RiveAnimTiming;
      }
      clips.push({
        name: anim.name,
        ticks: riveClipTicks(timing, tickFps),
        loop: anim.loopValue !== 0,
      });
    }

    // The contract's inputs are read off the *first state machine of the
    // default artboard*. That is not a shortcut, it is the contract: the client
    // drives every rig identically (art-pipeline §6.1), so machine 0 of the
    // default artboard is the one interface it will ever bind, until the docs
    // say otherwise. `inputs` stays `null` when there is no machine at all —
    // `compareRigToContract` turns that into its own single failure instead of
    // one per missing input.
    let inputs: RigIntrospection["inputs"] = null;
    if (artboard.stateMachineCount() > 0) {
      const machine = track(
        new runtime.StateMachineInstance(track(artboard.stateMachineByIndex(0)), artboard),
      );
      const kinds = riveInputKinds(runtime.SMIInput);
      inputs = [];
      for (let i = 0; i < machine.inputCount(); i++) {
        const input = track(machine.input(i));
        // An unrecognised code maps to "number" on purpose: it then fails the
        // kind check loudly instead of vanishing, and the failure names the rig.
        inputs.push({ name: input.name, kind: kinds[input.type] ?? "number" });
      }
    }

    return { clips, inputs };
  } catch (err) {
    // A .riv Rive can parse but this code cannot walk — a wasm abort, a handle
    // that came back null, an API drift. One bad file must report as one bad
    // file, not abandon the rigs after it in the loop.
    return `introspection failed: ${(err as Error).message}`;
  } finally {
    for (const h of handles.reverse()) {
      const candidate = h as { delete?: () => void } | null | undefined;
      if (candidate && typeof candidate.delete === "function") {
        try {
          candidate.delete();
        } catch {
          // A handle that will not delete cleanly must not mask the result the
          // try block already produced.
        }
      }
    }
  }
}

/**
 * Which rigs exist, and how each one measures up.
 *
 * A `.riv` that cannot be read is a **failure**, not a pass. Printing nothing
 * and exiting 0 is exactly the state that let `art-pipeline.md` claim this file
 * enforced an interface it never saw.
 */
async function checkRigFiles(
  rep: Report,
  mf: Manifest,
  contract: RigContract,
  strict: boolean,
): Promise<{ found: number; read: number }> {
  const found: { rel: string; path: string }[] = [];
  let dirs = 0;
  for (const sp of mf.species) {
    for (const tier of mf.tiers) {
      dirs += 1;
      const dir = join(CHARACTERS, sp.id, tier);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".riv"))) {
        found.push({ rel: `assets/characters/${sp.id}/${tier}/${file}`, path: join(dir, file) });
      }
    }
  }

  if (found.length === 0) {
    if (strict) {
      rep.fail(
        "rig files",
        "at least one .riv under assets/characters/ (--strict: undelivered work fails)",
        `none in any of ${dirs} species/tier directories`,
      );
    } else {
      // Tolerated, but not a *pass*: nothing was verified, and counting
      // "nothing to verify" as a passed check is the same overstatement in
      // miniature that let §6.1 claim a check nobody ran. The exit code stays
      // 0 — undelivered work is reported and tolerated — but the summary line
      // must count only checks that checked something.
      console.log(
        `  ${DIM}not yet delivered  no .riv in any of ${dirs} species/tier directories; the contract above is checked and waiting${RESET}`,
      );
    }
    return { found: 0, read: 0 };
  }

  let read = 0;
  for (const { rel, path } of found) {
    // Every character rig is a hero rig. Enemy rigs will live somewhere else and
    // pick the other set; there is nowhere to put one yet (asset-brief §9.7).
    const rig = await introspectRiv(readFileSync(path), contract.tickFps);
    if (typeof rig === "string") {
      rep.fail(
        `rig ${rel}`,
        "clips and inputs checked against rigContract",
        `not read — ${rig}`,
        "Review it against rigContract by hand and say so in the PR. This is a failure on purpose: a rig that ships unchecked must not be silent.",
      );
      continue;
    }
    read += 1;
    const problems = compareRigToContract(rig, contract, "hero");
    for (const p of problems) rep.fail(`rig ${rel}  ${p.label}`, p.expected, p.actual, p.hint);
    if (problems.length === 0) {
      rep.ok(
        `rig ${rel}  ${rig.clips.length} clips, ${rig.inputs?.length ?? 0} inputs, matches the hero set`,
      );
    }
  }
  return { found: found.length, read };
}

// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const strict = process.argv.includes("--strict");

  if (!existsSync(MANIFEST)) {
    console.error(`error: no manifest at ${MANIFEST}`);
    return 2;
  }
  // Malformed JSON is the same class of problem as a missing manifest — the
  // tool has nothing to check — so it gets the same exit (2, "could not run")
  // and a message, not a stack trace an artist has to decode.
  let mf: Manifest;
  try {
    mf = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
  } catch (err) {
    console.error(`error: assets/manifest.json is not valid JSON: ${(err as Error).message}`);
    return 2;
  }

  console.log(`${BOLD}Kids & Dragons - rig verify${RESET}`);
  console.log(`${DIM}manifest: assets/manifest.json   contract: asset-brief.md §9.2${RESET}`);

  const contract = mf.rigContract;
  if (!contract) {
    console.log(`\n  ${RED}FAIL${RESET}  assets/manifest.json has no rigContract`);
    console.log(`        ${DIM}asset-brief.md §9.7 item 6. Without it there is no interface to check a rig against.${RESET}`);
    return 1;
  }

  const rep = new Report();

  console.log(`\n${BOLD}contract${RESET}`);
  checkContractClock(rep, contract);
  checkClipTicks(rep, contract);
  checkEventTicks(rep, contract);
  checkInputs(rep, contract);
  checkSets(rep, contract);
  checkTriggerCoverage(rep, contract);

  console.log(`\n${BOLD}budget & sync${RESET}`);
  checkTurnBudget(rep, contract, mf.effects ?? []);
  checkEffectSync(rep, contract, mf.effects ?? []);

  console.log(`\n${BOLD}rigs${RESET}`);
  const rigs = await checkRigFiles(rep, mf, contract, strict);

  console.log(`\n${BOLD}${"-".repeat(60)}${RESET}`);
  const warn = rep.warnings.length ? `   ${YELLOW}${rep.warnings.length} warnings${RESET}` : "";
  const bad = rep.failures.length ? `   ${RED}${rep.failures.length} FAILED${RESET}` : "";
  console.log(`${GREEN}${rep.passed} passed${RESET}${warn}${bad}`);

  if (rep.failures.length > 0) {
    console.log(`\n${RED}${BOLD}FAILED${RESET} - the rig contract is broken, or a rig shipped unchecked.`);
    return 1;
  }
  const rigNote =
    rigs.found === 0
      ? "No rig has been delivered, so nothing was introspected."
      : `${rigs.read}/${rigs.found} rig(s) read and compared clip by clip.`;
  console.log(
    `\n${GREEN}${BOLD}PASS${RESET} - the contract is coherent and inside the turn budget.` +
      `\n${DIM}${rigNote} See this file's header for where the edge is.${RESET}`,
  );
  return 0;
}

if (IS_ENTRY) process.exit(await main());
