/**
 * Every line the game would record, read straight from `content/`
 * (docs/voice-narration-plan.md §1).
 *
 * Pure: content objects in, lines out. `voice:cost` counts them today; the
 * extractor and the generator will walk the same list, so what gets priced is
 * what gets rendered.
 *
 * What is collected, and what is deliberately not:
 *  - scene and branch narration, their variants, check prompts, interaction
 *    cues, hints, the goal ("Your goal: …"), chapter plates, the prologue, the
 *    epilogues, the "Last time…" opener and lines, and help.json;
 *  - choice labels, as their own kind: in Party Mode a phone reads its own
 *    choices with the device voice, so they are priced separately;
 *  - never anything a player typed (turns, decision lines, the fight log) or
 *    text the client composes at run time (the field guide's spoken entry).
 *
 * `{party}` has four forms and `{facets}` one per count the party can hold, so
 * a line carrying either is rendered once per value (`renders`).
 */

export type LineKind =
  | "narration"
  | "prompt"
  | "cue"
  | "hint"
  | "goal"
  | "plate"
  | "prologue"
  | "epilogue"
  | "last-time"
  | "help"
  | "choice";

export interface VoiceLine {
  /** Where the words live, e.g. `gemfall-01/scene_docks/onSuccess/narration`. */
  address: string;
  campaign: string;
  /** The chapter id, or `@campaign` / `@help` for text outside a chapter. */
  chapter: string;
  kind: LineKind;
  /** The authored words, tokens unfilled. */
  text: string;
  /** How many clips the line becomes once its tokens are expanded. */
  renders: number;
}

export interface InventoryOptions {
  /** The most great stones a party can hold: `{facets}` renders 0 through this. */
  facetsMax: number;
}

export interface ContentSet {
  chapters: readonly Record<string, unknown>[];
  campaigns: readonly Record<string, unknown>[];
  help?: Record<string, unknown>;
}

type Json = unknown;

const PARTY_FORMS = 4;

export function rendersOf(text: string, options: InventoryOptions): number {
  let renders = 1;
  if (text.includes("{party}")) renders *= PARTY_FORMS;
  if (text.includes("{facets}")) renders *= options.facetsMax + 1;
  return renders;
}

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: Json): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * A scene's spoken strings, wherever they sit in it: `narration`, `prompt` and
 * `hint` at any depth (a branch is `onSuccess`, `onVictory`, …), a variant's
 * `text`, an interaction's `cue`, and the labels of its `choices`.
 */
function sceneStrings(node: Json, at: string, out: { path: string; kind: LineKind; text: string }[]): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => sceneStrings(child, `${at}/${String(i)}`, out));
    return;
  }
  if (!isObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    const here = `${at}/${key}`;
    const text = str(value);
    if (text !== null) {
      if (key === "narration") out.push({ path: here, kind: "narration", text });
      else if (key === "prompt") out.push({ path: here, kind: "prompt", text });
      else if (key === "hint") out.push({ path: here, kind: "hint", text });
      else if (key === "cue") out.push({ path: here, kind: "cue", text });
      continue;
    }
    if (key === "variants" && Array.isArray(value)) {
      value.forEach((variant, i) => {
        const words = isObject(variant) ? str(variant.text) : null;
        if (words !== null) out.push({ path: `${here}/${String(i)}`, kind: "narration", text: words });
      });
      continue;
    }
    if (key === "choices" && Array.isArray(value)) {
      value.forEach((choice, i) => {
        if (!isObject(choice)) return;
        const label = str(choice.label);
        const id = str(choice.id) ?? String(i);
        if (label !== null) out.push({ path: `${here}/${id}/label`, kind: "choice", text: label });
        // A choice's own effects or nested data never carry spoken words, but walk it anyway.
        sceneStrings({ ...choice, label: undefined }, `${here}/${id}`, out);
      });
      continue;
    }
    sceneStrings(value, here, out);
  }
}

export function chapterLines(chapter: Record<string, Json>, options: InventoryOptions): VoiceLine[] {
  const id = String(chapter.id);
  const campaign = typeof chapter.campaignId === "string" ? chapter.campaignId : "none";
  const lines: VoiceLine[] = [];
  const push = (address: string, kind: LineKind, text: string): void => {
    lines.push({ address, campaign, chapter: id, kind, text, renders: rendersOf(text, options) });
  };

  const plate = isObject(chapter.plate) ? str(chapter.plate.narration) : null;
  if (plate !== null) push(`${id}/@plate`, "plate", plate);
  const goal = isObject(chapter.goal) ? str(chapter.goal.text) : null;
  // Read as "Your goal: …" (NarrationPanel), so the clip carries the lead-in.
  if (goal !== null) push(`${id}/@goal`, "goal", `Your goal: ${goal}`);

  if (isObject(chapter.scenes)) {
    for (const [sceneId, scene] of Object.entries(chapter.scenes)) {
      const found: { path: string; kind: LineKind; text: string }[] = [];
      sceneStrings(scene, `${id}/${sceneId}`, found);
      for (const line of found) push(line.path, line.kind, line.text);
    }
  }
  return lines;
}

export function campaignLines(campaign: Record<string, Json>, options: InventoryOptions): VoiceLine[] {
  const id = String(campaign.id);
  const lines: VoiceLine[] = [];
  const push = (address: string, kind: LineKind, text: string): void => {
    lines.push({ address, campaign: id, chapter: "@campaign", kind, text, renders: rendersOf(text, options) });
  };
  const prologue = isObject(campaign.prologue) ? campaign.prologue.plates : undefined;
  if (Array.isArray(prologue)) {
    prologue.forEach((plate, i) => {
      const words = isObject(plate) ? str(plate.narration) : null;
      if (words !== null) push(`${id}/@prologue/${String(i)}`, "prologue", words);
    });
  }
  const epilogues = Array.isArray(campaign.epilogues) ? campaign.epilogues : [];
  for (const epilogue of epilogues) {
    if (!isObject(epilogue) || !Array.isArray(epilogue.plates)) continue;
    epilogue.plates.forEach((plate, i) => {
      const words = isObject(plate) ? str(plate.narration) : null;
      if (words !== null) push(`${id}/@epilogue/${String(epilogue.id)}/${String(i)}`, "epilogue", words);
    });
  }
  if (isObject(campaign.lastTime)) {
    const opener = str(campaign.lastTime.opener);
    if (opener !== null) push(`${id}/@lastTime/opener`, "last-time", opener);
    if (isObject(campaign.lastTime.lines)) {
      for (const [flag, line] of Object.entries(campaign.lastTime.lines)) {
        const words = str(line);
        if (words !== null) push(`${id}/@lastTime/${flag}`, "last-time", words);
      }
    }
  }
  return lines;
}

/** help.json: every `text`, at any depth. Spoken when the help sheet opens. */
export function helpLines(help: Record<string, Json>, options: InventoryOptions): VoiceLine[] {
  const lines: VoiceLine[] = [];
  const walk = (node: Json, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${at}/${String(i)}`));
      return;
    }
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      const text = key === "text" ? str(value) : null;
      if (text !== null) {
        lines.push({ address: at, campaign: "help", chapter: "@help", kind: "help", text, renders: rendersOf(text, options) });
      } else {
        walk(value, `${at}/${key}`);
      }
    }
  };
  walk(help, "help");
  return lines;
}

export function inventory(content: ContentSet, options: InventoryOptions): VoiceLine[] {
  return [
    ...content.campaigns.flatMap((campaign) => campaignLines(campaign, options)),
    ...content.chapters.flatMap((chapter) => chapterLines(chapter, options)),
    ...(content.help ? helpLines(content.help, options) : []),
  ];
}

/** The characters a provider is billed for: one render per token value. */
export function billedChars(line: VoiceLine): number {
  return line.text.length * line.renders;
}

/** Characters inside double quotes: the share of a line a cast member, not the narrator, says. */
export function quotedChars(text: string): number {
  let total = 0;
  for (const match of text.matchAll(/["“]([^"”]*)["”]/g)) total += (match[1] ?? "").length;
  return total;
}
