/** The play:jump command line, parsed, and the nearest ids for a typo. Pure, so it is tested without a server. */

export interface Args {
  positional: string[];
  list: boolean;
  players: number;
  travel: boolean;
  flags: Record<string, boolean>;
  facts: Record<string, string | number | boolean>;
  start: boolean;
  record: number;
  every: number;
  reducedMotion: boolean;
  out?: string;
  open: boolean;
  help: boolean;
}

export function parse(argv: string[]): Args {
  const args: Args = { positional: [], list: false, players: 2, travel: false, flags: {}, facts: {}, start: false, record: 0, every: 250, reducedMotion: false, open: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--list") args.list = true;
    else if (arg === "--players") args.players = Number(value());
    else if (arg === "--travel") args.travel = true;
    else if (arg === "--flag") { const [name, on] = value().split("="); args.flags[name!] = on !== "false"; }
    else if (arg === "--fact") {
      const [name, raw = ""] = value().split("=");
      args.facts[name!] = raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
    }
    else if (arg === "--start") args.start = true;
    else if (arg === "--record") args.record = Number(value());
    else if (arg === "--every") args.every = Number(value());
    else if (arg === "--reduced-motion") args.reducedMotion = true;
    else if (arg === "--out") args.out = value();
    else if (arg === "--open") args.open = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg} (see --help)`);
    else args.positional.push(arg);
  }
  if (!Number.isInteger(args.players) || args.players < 1 || args.players > 4) throw new Error("--players is 1 to 4");
  return args;
}

/** Edit distance, for a typo's nearest ids. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}

/** The closest few ids, for a typo: containment first, then edit distance. */
export function near(wanted: string, ids: string[]): string[] {
  const score = (id: string) => (id.includes(wanted) || wanted.includes(id) ? -1 : distance(wanted, id));
  return [...ids].sort((x, y) => score(x) - score(y)).slice(0, 5);
}

