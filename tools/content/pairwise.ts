/**
 * All-pairs selection for the generated play matrices.
 *
 * The riftlight play suites walk whole chapters for every combination of a
 * handful of axes (seats, outcome, route, ...). Almost every assertion in them
 * depends on one axis or two interacting ones, so the full product repeats the
 * same walks thousands of times. `pairwise` keeps, from a list of valid rows,
 * a small subset in which every pair of values from any two axes still appears
 * together at least once. `together` names groups of axes that must appear in
 * every combination (an outcome that depends on three axes at once). Because it picks from the rows it is given, axes that
 * constrain each other (a choice offered only for some histories) stay valid.
 *
 * Deterministic: the same rows give the same subset. `KAD_FULL_MATRIX=1` runs
 * every row, for a release check or when an axis is added.
 */
export function pairwise<T extends Record<string, unknown>>(rows: readonly T[], keys: readonly (keyof T)[], opts: { together?: readonly (readonly (keyof T)[])[] } = {}): T[] {
  if (process.env.KAD_FULL_MATRIX) return [...rows];
  const tag = (row: T, ks: readonly (keyof T)[]) => ks.map(k => `${String(k)}=${JSON.stringify(row[k])}`).join("|");
  const pairsOf = (row: T) => {
    const out: string[] = [];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) out.push(tag(row, [keys[i]!, keys[j]!]));
    // Axes that only matter together get every combination, not just every pair.
    for (const group of opts.together ?? []) out.push(tag(row, group));
    return out;
  };
  const rowPairs = rows.map(pairsOf);
  const uncovered = new Set(rowPairs.flat());
  const picked: T[] = [];
  const taken = new Set<number>();
  while (uncovered.size) {
    let best = -1, bestGain = 0;
    rowPairs.forEach((pairs, i) => {
      if (taken.has(i)) return;
      let gain = 0;
      for (const p of pairs) if (uncovered.has(p)) gain++;
      if (gain > bestGain) { best = i; bestGain = gain; }
    });
    taken.add(best);
    picked.push(rows[best]!);
    for (const p of rowPairs[best]!) uncovered.delete(p);
  }
  return picked;
}
