/**
 * What a chapter writes into its campaign's route sets, path by path.
 *
 * A route set is a fork that survives the chapter boundary (progression.ts,
 * `routesTaken`): at most one member stands, and a member *newly* set during
 * the chapter replaces the old one. Two different members newly set on one
 * path is a content bug the engine refuses to guess about — it keeps the old
 * value, silently, and the party plays on with a road or a memory they did not
 * choose. Per-scene checks cannot see it, because the two `setFlag`s are
 * usually scenes apart. Walking the paths can.
 *
 * Walks every path from the entry to every ending, carrying the value each
 * route-set flag holds so far — `true`, or cleared to `false` — because the
 * engine judges a chapter by its final flags. Memoised on (scene, flags), and
 * a path never revisits a scene it is already on, so a loop in the graph is
 * one lap rather than forever.
 */

/** Effects a scene applies on entry. */
function onEnter(scene) {
  return scene.onEnter ?? [];
}

/** Every way out of a scene: [target, effects on that edge]. */
function exits(scene) {
  switch (scene.type) {
    case "check":
      return [
        [scene.onSuccess.goto, scene.onSuccess.effects ?? []],
        [scene.onFailure.goto, scene.onFailure.effects ?? []],
      ];
    case "encounter":
      return [
        [scene.onVictory.goto, scene.onVictory.effects ?? []],
        [scene.onDefeat.goto, scene.onDefeat.effects ?? []],
      ];
    default:
      return (scene.choices ?? []).map((choice) => [choice.goto, choice.effects ?? []]);
  }
}

/**
 * Applies a list of effects to the route-set flags a path holds, in order. A
 * `false` clears — the runtime reads the chapter's *final* flags
 * (`routesTaken`), so a path that sets one road, clears it and sets another
 * has taken one road, not two.
 */
function applyFlags(held, effects, tracked) {
  const next = new Map(held);
  for (const effect of effects) {
    if (effect.type !== "setFlag" || !tracked.has(effect.flag)) continue;
    next.set(effect.flag, effect.value !== false);
  }
  return next;
}

function keyOf(id, held) {
  return `${id}|${[...held].sort(([a], [b]) => a.localeCompare(b)).map(([f, v]) => `${v ? "" : "!"}${f}`).join(",")}`;
}

/**
 * Every distinct set of tracked flags a party can end the chapter holding,
 * one entry per reachable (ending, flags) pair.
 *
 * `routeSets` is the campaign's map of set name → members. Returns
 * `{ endings: [{ ending, flags, cleared }], truncated }`: `flags` are the
 * members standing `true` at the ending, `cleared` the ones the path set
 * `false`. `truncated` when the walk hit its budget, so a caller can say so
 * rather than pass a check it did not finish.
 */
export function routeOutcomes(chapter, routeSets, budget = 200_000) {
  const tracked = new Set(Object.values(routeSets ?? {}).flat());
  const scenes = chapter.scenes ?? {};
  const seen = new Set();
  const endings = new Map();
  let steps = 0;
  let truncated = false;

  const visit = (id, held, onPath) => {
    if (truncated) return;
    const scene = scenes[id];
    if (!scene || onPath.has(id)) return;
    const flags = applyFlags(held, onEnter(scene), tracked);
    const key = keyOf(id, flags);
    if (seen.has(key)) return;
    seen.add(key);
    if (++steps > budget) {
      truncated = true;
      return;
    }

    const out = exits(scene);
    if (out.length === 0) {
      const standing = [...flags].filter(([, v]) => v).map(([f]) => f).sort();
      const cleared = [...flags].filter(([, v]) => !v).map(([f]) => f).sort();
      endings.set(key, { ending: id, flags: standing, cleared });
      return;
    }
    onPath.add(id);
    for (const [to, effects] of out) visit(to, applyFlags(flags, effects, tracked), onPath);
    onPath.delete(id);
  };

  visit(chapter.entry, new Map(), new Set());
  return { endings: [...endings.values()], truncated };
}

/**
 * The paths that set two members of one route set — each as
 * `{ ending, set, flags }`, deduplicated.
 */
export function routeSetConflicts(chapter, routeSets) {
  const { endings, truncated } = routeOutcomes(chapter, routeSets);
  const conflicts = [];
  const reported = new Set();
  for (const { ending, flags } of endings) {
    for (const [set, members] of Object.entries(routeSets ?? {})) {
      const both = flags.filter((flag) => members.includes(flag));
      const key = `${ending}|${set}|${both.join(",")}`;
      if (both.length > 1 && !reported.has(key)) {
        reported.add(key);
        conflicts.push({ ending, set, flags: both });
      }
    }
  }
  return { conflicts, truncated };
}
