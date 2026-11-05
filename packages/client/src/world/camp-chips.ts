/**
 * The chips under a phone's Camp picture (docs/camp.md §6.1, §12.6; #620):
 * one per pickable spot, big enough for a child's finger, each joined to its
 * spot by a thin line straight up. Laid out so it reads tidily on a 390 px
 * phone: no two chips touch, every line ends inside its own chip and never
 * runs through another chip on its way up, and no two lines run together.
 * As few rows as that allows, each chip as near its spot as it can be.
 *
 * A line may drop from anywhere across its piece (`x0` to `x1`, its painted
 * box on the picture), so two spots stacked one behind the other (the awning
 * behind the cookfire) can each have a line of their own.
 *
 * Pure: StillCamp.tsx draws what this returns, and camp-chips.test.ts holds it
 * to the rules at every phone width.
 */

export interface ChipSpot {
  id: string;
  label: string;
  /** Where its line would best drop (its spot's x), px across the panel. */
  x: number;
  /** How far across its piece the line may drop instead, px; absent, only at `x`. */
  x0?: number;
  x1?: number;
}

/** A chip: its spot's line x, its left edge, width and row. */
export interface Chip {
  id: string;
  /** Its name, on one line or two (split by a newline). */
  label: string;
  /** Where its line drops, px across the panel. */
  x: number;
  left: number;
  width: number;
  row: number;
}

/** The gap between two chips in a row, the room a line keeps from another chip, and a chip's margin at the panel's edges, px. */
const GAP = 6;
const CLEAR = 4;
const EDGE = 4;
/** How far inside its chip's ends a line lands, and how far apart two lines keep, px. */
const INSET = 9;
const LINES_APART = 10;

/** A name on two lines, split at the space nearest its middle; a one-word name as it is. */
export function wrapLabel(label: string): string {
  const words = label.split(" ");
  if (words.length < 2) return label;
  let best = 1;
  const gap = (cut: number) => Math.abs(words.slice(0, cut).join(" ").length - words.slice(cut).join(" ").length);
  for (let i = 2; i < words.length; i++) if (gap(i) < gap(best)) best = i;
  return `${words.slice(0, best).join(" ")}\n${words.slice(best).join(" ")}`;
}
const longestLine = (label: string): string => label.split("\n").reduce((a, b) => (b.length > a.length ? b : a), "");

/** A chip's width for its label: Nunito bold 15px is about `charPx` a letter, plus its padding and border. */
export function chipWidth(label: string, paneWidth: number, charPx = 8.6): number {
  return Math.min(paneWidth - 2 * EDGE, Math.max(44, label.length * charPx + 28));
}

/** Where each spot's line may drop, as candidate xs: its own x first, then across its piece. */
function lineCandidates(spot: ChipSpot, paneWidth: number): number[] {
  const lo = Math.max(EDGE + INSET, Math.min(spot.x, spot.x0 ?? spot.x));
  const hi = Math.min(paneWidth - EDGE - INSET, Math.max(spot.x, spot.x1 ?? spot.x));
  const at = Math.min(hi, Math.max(lo, spot.x));
  const out = [at];
  for (let i = 0; i <= 8; i++) out.push(lo + ((hi - lo) * i) / 8);
  return [...new Set(out.map((v) => Math.round(v)))];
}

/**
 * One row's chips, left to right by their lines, kept clear of the lines
 * that pass up through this row (`through`): each chip as near centred on its
 * line as the row allows. Null when they do not fit.
 */
function placeRow(row: { spot: ChipSpot; x: number; width: number }[], through: readonly number[], paneWidth: number): number[] | null {
  const lefts: number[] = [];
  let right = EDGE - GAP;
  for (const chip of [...row].sort((a, b) => a.x - b.x)) {
    // Its line inside it, INSET in from each end; clear of the chip before it and of the panel's edge.
    let lo = Math.max(right + GAP, chip.x + INSET - chip.width, EDGE);
    const hi = Math.min(chip.x - INSET, paneWidth - EDGE - chip.width);
    if (lo > hi) return null;
    let left = Math.min(hi, Math.max(lo, chip.x - chip.width / 2));
    // Off any line passing up through the row: slide right past it, or failing that left.
    for (let tries = 0; tries < 8; tries++) {
      const hit = through.find((t) => t > left - CLEAR && t < left + chip.width + CLEAR);
      if (hit === undefined) break;
      const rightward = hit + CLEAR;
      const leftward = hit - CLEAR - chip.width;
      if (rightward <= hi && (rightward - left <= left - leftward || leftward < lo)) left = rightward;
      else if (leftward >= lo) left = leftward;
      else return null;
      lo = Math.max(lo, EDGE);
    }
    if (through.some((t) => t > left - CLEAR && t < left + chip.width + CLEAR)) return null;
    lefts.push(left);
    right = left + chip.width;
  }
  // Back in the order given.
  const order = [...row].map((c, i) => ({ c, i })).sort((a, b) => a.c.x - b.c.x);
  const out = new Array<number>(row.length);
  order.forEach(({ i }, k) => (out[i] = lefts[k]!));
  return out;
}

/** The chips for these spots on a panel `paneWidth` px wide, in the fewest rows that keep every rule. */
export function chipRows(spots: readonly ChipSpot[], paneWidth: number, charPx = 8.6): Chip[] {
  const n = spots.length;
  if (n === 0) return [];
  // A two-word name may take two lines (a chip is tall enough for them) rather than a row of its own.
  const oneLine = spots.map((s) => s.label);
  const twoLines = spots.map((s) => wrapLabel(s.label));
  let labels = oneLine;
  let widths = labels.map((label) => chipWidth(longestLine(label), paneWidth, charPx));
  const candidates = spots.map((s) => lineCandidates(s, paneWidth));
  let best: { chips: Chip[]; cost: number } | null = null;
  for (let rows = 1; rows <= n && !best; rows++) {
    for (const wrap of [false, true]) {
      if (best) break;
      labels = wrap ? twoLines : oneLine;
      widths = labels.map((label) => chipWidth(longestLine(label), paneWidth, charPx));
      const assignment = new Array<number>(n).fill(0);
      const total = rows ** n;
      for (let code = 0; code < total; code++) {
        let c = code;
        for (let i = 0; i < n; i++) {
          assignment[i] = c % rows;
          c = Math.floor(c / rows);
        }
        if (new Set(assignment).size !== rows) continue;
        const placed = solve(assignment, rows);
        if (placed && (!best || placed.cost < best.cost)) best = placed;
      }
    }
  }
  return best?.chips ?? spots.map((s, i) => ({ id: s.id, label: s.label, x: s.x, left: EDGE, width: chipWidth(s.label, paneWidth, charPx), row: i }));

  /**
   * Rows from the bottom up: a chip's line passes up through every row above
   * its own, so each row is laid out clear of the lines of the rows under it.
   * Each line takes the candidate nearest its spot that still fits.
   */
  function solve(assignment: number[], rows: number): { chips: Chip[]; cost: number } | null {
    const xs = new Array<number>(n);
    const lefts = new Array<number>(n);
    const through: number[] = [];
    for (let row = rows - 1; row >= 0; row--) {
      const members = assignment.map((r, i) => (r === row ? i : -1)).filter((i) => i >= 0);
      // Lines in this row: each the first candidate that keeps apart from every line already chosen.
      const chosen = new Map<number, number>();
      for (const i of members) {
        const taken = [...through, ...chosen.values()];
        const x = candidates[i]!.find((v) => taken.every((t) => Math.abs(t - v) >= LINES_APART));
        if (x === undefined) return null;
        chosen.set(i, x);
      }
      const layout = placeRow(members.map((i) => ({ spot: spots[i]!, x: chosen.get(i)!, width: widths[i]! })), through, paneWidth);
      if (!layout) return null;
      members.forEach((i, k) => {
        xs[i] = chosen.get(i)!;
        lefts[i] = layout[k]!;
      });
      through.push(...chosen.values());
    }
    const chips = spots.map((s, i) => ({ id: s.id, label: labels[i]!, x: xs[i]!, left: lefts[i]!, width: widths[i]!, row: assignment[i]! }));
    // Nearest its spot, and the nearer spots in the upper rows.
    const cost = chips.reduce((sum, chip, i) => sum + Math.abs(chip.x - spots[i]!.x) * 2 + Math.abs(chip.left + chip.width / 2 - chip.x) + chip.row * 0.5 * Math.abs(spots[i]!.x - paneWidth / 2) / paneWidth, 0);
    return { chips, cost };
  }
}
