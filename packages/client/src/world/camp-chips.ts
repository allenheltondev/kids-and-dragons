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
 * No layout input leaves it without an answer (#620): moving one spot a
 * little must never empty the panel. Where the search finds no rows that keep
 * every rule, the chips step down one a row; where not even that can, they
 * stand in a plain tidy list with no lines (`chipRows`).
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
  /** Where its line drops, px across the panel; null in the plain list, where no line is drawn. */
  x: number | null;
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

/** The most rows the search tries before it falls back to a staircase (`stairs`). */
const MAX_SEARCH_ROWS = 4;
/** How many ways to draw one row's lines the search tries before it gives that row up. */
const ROW_TRIES = 64;

/**
 * The chips for these spots on a panel `paneWidth` px wide, in the fewest rows
 * that keep every rule. Every input gets an answer: where no arrangement of up
 * to `MAX_SEARCH_ROWS` rows keeps the rules, a staircase of one chip a row
 * (`stairs`); where even that cannot (the spots' lines cannot be kept apart,
 * or every chip is too wide for the gaps between them), a plain tidy list with
 * no lines, each chip in the order of its spot across the picture (`listed`).
 */
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
  for (let rows = 1; rows <= Math.min(n, MAX_SEARCH_ROWS) && !best; rows++) {
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
  const wrappedWidths = twoLines.map((label) => chipWidth(longestLine(label), paneWidth, charPx));
  return best?.chips ?? stairs(spots, twoLines, wrappedWidths, paneWidth) ?? listed(spots, twoLines, wrappedWidths, paneWidth);

  /**
   * Rows from the bottom up: a chip's line passes up through every row above
   * its own, so each row is laid out clear of the lines of the rows under it.
   * Each row tries its lines nearest their spots first, then the other places
   * across their pieces, until its chips fit around the lines below.
   */
  function solve(assignment: number[], rows: number): { chips: Chip[]; cost: number } | null {
    const xs = new Array<number>(n);
    const lefts = new Array<number>(n);
    const through: number[] = [];
    for (let row = rows - 1; row >= 0; row--) {
      const members = assignment.map((r, i) => (r === row ? i : -1)).filter((i) => i >= 0);
      const found = placeLines(members, through);
      if (!found) return null;
      members.forEach((i, k) => {
        xs[i] = found.lines[k]!;
        lefts[i] = found.lefts[k]!;
      });
      through.push(...found.lines);
    }
    const chips = spots.map((s, i) => ({ id: s.id, label: labels[i]!, x: xs[i]!, left: lefts[i]!, width: widths[i]!, row: assignment[i]! }));
    // Nearest its spot, and the nearer spots in the upper rows.
    const cost = chips.reduce((sum, chip, i) => sum + Math.abs(chip.x - spots[i]!.x) * 2 + Math.abs(chip.left + chip.width / 2 - chip.x) + chip.row * 0.5 * Math.abs(spots[i]!.x - paneWidth / 2) / paneWidth, 0);
    return { chips, cost };
  }

  /** One row's lines, each kept apart from the others and from the lines below, and its chips placed around them; null when no way tried fits. */
  function placeLines(members: number[], through: readonly number[]): { lines: number[]; lefts: number[] } | null {
    let tries = 0;
    const chosen: number[] = [];
    const walk = (k: number): { lines: number[]; lefts: number[] } | null => {
      if (k === members.length) {
        tries++;
        const lefts = placeRow(members.map((i, j) => ({ spot: spots[i]!, x: chosen[j]!, width: widths[i]! })), through, paneWidth);
        return lefts ? { lines: [...chosen], lefts } : null;
      }
      for (const x of candidates[members[k]!]!) {
        if (tries >= ROW_TRIES) return null;
        if (![...through, ...chosen].every((t) => Math.abs(t - x) >= LINES_APART)) continue;
        chosen.push(x);
        const found = walk(k + 1);
        chosen.pop();
        if (found) return found;
      }
      return null;
    };
    return walk(0);
  }
}

/**
 * Lines for these spots kept `LINES_APART` apart, each across its own piece
 * where that can be done at all: placed left to right in the order their
 * pieces end, each as near its spot as the lines before it allow (the
 * earliest-ending-first order finds room for every line whenever there is
 * any). Null where the pieces leave no room.
 */
export function apartLines(spots: readonly ChipSpot[], paneWidth: number): number[] | null {
  const span = spots.map((s) => {
    const lo = Math.max(EDGE + INSET, Math.min(s.x, s.x0 ?? s.x));
    const hi = Math.min(paneWidth - EDGE - INSET, Math.max(s.x, s.x1 ?? s.x));
    return { lo: Math.min(lo, hi), hi };
  });
  const order = spots.map((_, i) => i).sort((a, b) => span[a]!.hi - span[b]!.hi || span[a]!.lo - span[b]!.lo);
  const out = new Array<number>(spots.length);
  let last = -Infinity;
  for (const i of order) {
    const x = Math.ceil(Math.max(span[i]!.lo, last + LINES_APART));
    if (x > span[i]!.hi) return null;
    out[i] = x;
    last = x;
  }
  return out;
}

/**
 * One chip a row, its line across its piece, every chip clear of the lines of
 * the rows under it: the top row's chip is one that fits between all the other
 * lines, the next one that fits between the lines still under it, and so on
 * down. Null where at some row no chip left fits.
 */
function stairs(spots: readonly ChipSpot[], labels: readonly string[], widths: readonly number[], paneWidth: number): Chip[] | null {
  const lines = apartLines(spots, paneWidth);
  if (!lines) return null;
  const left = spots.map((_, i) => i);
  const out = new Array<Chip>(spots.length);
  for (let row = 0; left.length > 0; row++) {
    let pick: { i: number; at: number; off: number } | null = null;
    for (const i of left) {
      const others = left.filter((j) => j !== i).map((j) => lines[j]!);
      const at = soloLeft(lines[i]!, widths[i]!, others, paneWidth);
      if (at === null) continue;
      const off = Math.abs(at + widths[i]! / 2 - lines[i]!);
      if (!pick || off < pick.off) pick = { i, at, off };
    }
    if (!pick) return null;
    out[pick.i] = { id: spots[pick.i]!.id, label: labels[pick.i]!, x: lines[pick.i]!, left: pick.at, width: widths[pick.i]!, row };
    left.splice(left.indexOf(pick.i), 1);
  }
  return out;
}

/** Where a chip alone in its row may stand: its line `x` inside it, on the panel, clear of `through`, as near centred as that allows; null where nowhere. */
function soloLeft(x: number, width: number, through: readonly number[], paneWidth: number): number | null {
  const lo = Math.max(EDGE, x + INSET - width);
  const hi = Math.min(paneWidth - EDGE - width, x - INSET);
  if (lo > hi) return null;
  const want = Math.min(hi, Math.max(lo, x - width / 2));
  const clear = (left: number) => through.every((t) => t <= left - CLEAR || t >= left + width + CLEAR);
  const options = [want, lo, hi, ...through.flatMap((t) => [t + CLEAR, t - CLEAR - width])].filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9 && clear(v));
  if (options.length === 0) return null;
  return options.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
}

/**
 * The last resort: a plain tidy list, the chips in the order of their spots
 * across the picture, as many to a row as fit, with no lines (`x` null). Every
 * chip still names its spot.
 */
function listed(spots: readonly ChipSpot[], labels: readonly string[], widths: readonly number[], paneWidth: number): Chip[] {
  const order = spots.map((_, i) => i).sort((a, b) => spots[a]!.x - spots[b]!.x);
  const out = new Array<Chip>(spots.length);
  let row = 0;
  let left = EDGE;
  for (const i of order) {
    if (left > EDGE && left + widths[i]! > paneWidth - EDGE) {
      row++;
      left = EDGE;
    }
    out[i] = { id: spots[i]!.id, label: labels[i]!, x: null, left, width: widths[i]!, row };
    left += widths[i]! + GAP;
  }
  return out;
}
