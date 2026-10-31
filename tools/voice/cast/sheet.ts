/**
 * The cast voice sheet (docs/voice-cast.md): every character in the game, the
 * voice they speak with, and real lines of theirs to audition it on.
 *
 * Built from what the content already says about people:
 *  - each chapter's `voiceGuide.npcVoices` (a key and how they talk);
 *  - each scene's `cast` (a name and a figure, who is physically there);
 *  - canon/individuals.yaml (`speech_register`, `pronouns`), for the people a
 *    place owns.
 * The same person in several chapters is one entry, so they keep one voice.
 *
 * Audition lines are quotes from the narration that a speech tag gives to
 * the character ("…," says Pib), so a voice is judged on words it will say.
 *
 * Voices are assigned provisionally, and never twice in one chapter: a voice
 * a person has chosen (status "approved", or any voice set by hand) is kept
 * as it is on every rebuild, and only new or provisional characters are
 * (re)assigned around it.
 *
 * Pure: content in, sheet out. build.ts reads and writes the files.
 */

import { GEMINI_VOICES } from "../gemini-voices.ts";

/** Google's prebuilt Gemini voices: the word Google gives each, and whether it reads as a woman's or a man's voice. */
export const GEMINI_VOICE_TRAITS: Record<string, { gender: "f" | "m"; traits: string[] }> = {
  Zephyr: { gender: "f", traits: ["bright", "young"] },
  Puck: { gender: "m", traits: ["upbeat", "young"] },
  Charon: { gender: "m", traits: ["informative", "old", "big"] },
  Kore: { gender: "f", traits: ["firm"] },
  Fenrir: { gender: "m", traits: ["excitable", "young"] },
  Leda: { gender: "f", traits: ["youthful", "young", "small"] },
  Orus: { gender: "m", traits: ["firm", "big"] },
  Aoede: { gender: "f", traits: ["breezy"] },
  Callirrhoe: { gender: "f", traits: ["easy-going"] },
  Autonoe: { gender: "f", traits: ["bright", "young"] },
  Enceladus: { gender: "m", traits: ["breathy", "soft"] },
  Iapetus: { gender: "m", traits: ["clear"] },
  Umbriel: { gender: "m", traits: ["easy-going"] },
  Algieba: { gender: "m", traits: ["smooth"] },
  Despina: { gender: "f", traits: ["smooth"] },
  Erinome: { gender: "f", traits: ["clear"] },
  Algenib: { gender: "m", traits: ["gravelly", "old", "big"] },
  Rasalgethi: { gender: "m", traits: ["informative"] },
  Laomedeia: { gender: "f", traits: ["upbeat", "young"] },
  Achernar: { gender: "f", traits: ["soft", "small"] },
  Alnilam: { gender: "m", traits: ["firm", "big"] },
  Schedar: { gender: "m", traits: ["even", "old"] },
  Gacrux: { gender: "f", traits: ["mature", "old"] },
  Pulcherrima: { gender: "f", traits: ["forward"] },
  Achird: { gender: "m", traits: ["friendly"] },
  Zubenelgenubi: { gender: "m", traits: ["casual"] },
  Vindemiatrix: { gender: "f", traits: ["gentle", "soft", "old"] },
  Sadachbia: { gender: "m", traits: ["lively", "young"] },
  Sadaltager: { gender: "m", traits: ["knowledgeable", "old"] },
  Sulafat: { gender: "f", traits: ["warm"] },
};

/** The narrator's voice, which nobody else gets: they speak in every chapter. */
export const NARRATOR_VOICE = "Sulafat";

/** Whose voices the cast pages are choosing from. Gemini's are what the game ships with; ElevenLabs' are an alternative to audition and pick. */
export type VoiceProvider = "gemini" | "elevenlabs";
export const VOICE_PROVIDERS: readonly VoiceProvider[] = ["gemini", "elevenlabs"];

export type Kind = "narrator" | "party" | "character" | "group" | "creature";

/** How a character's voice should read. "nonbinary" (they/them) and "unknown" can be either a woman's or a man's voice. */
export type Gender = "female" | "male" | "nonbinary" | "unknown";
export const GENDERS: readonly Gender[] = ["female", "male", "nonbinary", "unknown"];

/** Where a gender came from: canon's pronouns, the narration's speech tags, words in the notes, or a person on the cast page. */
export type GenderFrom = "canon" | "narration" | "notes" | "person" | "none";

export interface AuditionLine {
  /** The words alone, as the character says them (no quotation marks). */
  text: string;
  /** Where they come from, as voice:cost and the bake-off address lines. */
  address: string;
}

export interface CastEntry {
  name: string;
  kind: Kind;
  /** How they sound, in a sentence: from the chapter's voice notes and canon. */
  who: string;
  /** "she/her", "he/him", "they/them", or unknown. Drives nothing but the voice guess. */
  pronouns?: string;
  /** Where the pronouns came from: canon's entry, or the narration's speech tags. */
  pronounsFrom?: "canon" | "narration";
  /** Whether the voice should read as a woman's or a man's. Set by a person, it survives rebuilds and steers the voice. */
  gender?: Gender;
  genderFrom?: GenderFrom;
  /** The figure the scenes draw them with ("cast/coralie_fenn"), when they have one. */
  figure?: string;
  /** The canon individual they are (`individual.pib`), when canon has them. */
  canon?: string;
  /** Which chapters' `voiceGuide.npcVoices` describe them, and under which key: where their voice notes live. */
  voiceNotes?: { chapter: string; key: string }[];
  chapters: string[];
  /** Other names the content uses for them (cast names, npcVoices keys). */
  aliases: string[];
  /** Overrides the sheet's accent for this one character. */
  accent?: string;
  /** A person's direction for the voice model, told after who they are ("a touch quicker than usual"). Kept on every rebuild. */
  direction?: string;
  gemini: { voice: string };
  /**
   * The voice they have on ElevenLabs, from the account's own voices, when a person has picked one. Kept on every rebuild.
   * Nothing assigns it: there are no traits to match an account's voices by, so it is chosen by ear.
   */
  elevenlabs?: ElevenVoice;
  /** Up to three real lines of theirs, found in the narration, to audition the voice on. */
  lines: AuditionLine[];
  /**
   * How many lines the game gives them to speak: every quote the narration's speech tags give them, in every chapter,
   * counted once per place it is said. `lines` is only the few of these worth auditioning on, so it is never this number.
   * Refreshed from the content on every rebuild. The narrator's is every narration line (they read them all), and
   * the party's the "you say" lines the storyteller reads for the heroes.
   */
  lineCount?: number;
  /** How many of `lineCount` are a guess: a quote nobody is tagged for, in a scene with only this one speaker. */
  guessedLines?: number;
  /** Whether they talk at all. Some only bleat or sigh. */
  speaks: boolean;
  /** "provisional": assigned by the builder and free to change. "approved": chosen by a person, never touched. */
  status: "provisional" | "approved";
  notes?: string;
  /** Every approval and rejection, oldest first: what was heard, what was decided, and why. */
  history?: Decision[];
}

/** One ElevenLabs voice: its id for the API, and the name the account gives it. */
export interface ElevenVoice {
  voiceId: string;
  name?: string;
  /** A person approved this voice for them (the Gemini voice's approval is `status`). */
  approved?: boolean;
}

export interface Decision {
  decision: "approved" | "rejected";
  /** Whose voice it was: Gemini's when this is absent, as every decision before ElevenLabs was. */
  provider?: VoiceProvider;
  /** The voice the decision was about: Gemini's name for it, or an ElevenLabs voice id. */
  voice: string;
  /** An ElevenLabs voice's name, kept beside its id so the history reads. */
  voiceName?: string;
  /** What the listener said: why it works, or what is wrong with it. */
  notes?: string;
  /** The model the auditions were heard on. */
  model?: string;
  /** ISO time. */
  at: string;
}

export interface CastSheet {
  $comment?: string;
  /** Everyone's accent unless an entry sets its own. */
  accent: string;
  speakers: Record<string, CastEntry>;
}

export interface ChapterLike {
  id: string;
  campaignId?: string;
  voiceGuide?: { npcVoices?: Record<string, string> };
  scenes?: Record<string, unknown>;
}

export interface IndividualLike {
  id: string;
  title: string;
  pronouns?: string;
  speech_register?: string;
  short_description?: string;
}

/** A line of narration with its address, from tools/voice/inventory.ts. */
export interface NarrationLine {
  address: string;
  chapter: string;
  text: string;
}

const TITLES = /^(Professor|Postmaster|Madame|Mrs\.?|Mr\.?|Innkeeper|Captain|Sergeant|Clerk|Corporal|Master|Lady|Engineer|Cadet|Warden)\s+/i;

/** A name's identity, without its title: "Master Orin Vale" and "Orin Vale" are one person. */
const identity = (name: string): string => slug(name.replace(TITLES, ""));

export const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/['’]s\b/g, "s")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const titleCase = (key: string): string => key.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** "Professor Marrow Tidewell, a selkie scholar…" names its subject before the first comma. */
function nameFromNotes(key: string, notes: string): string {
  const lead = notes.split(",")[0]!.trim();
  if (/^[A-Z][\w'’.-]*(\s+[A-Z][\w'’.-]*)*$/.test(lead) && lead.length <= 40) return lead;
  return titleCase(key);
}

const GROUP = /\b(flock|crew|family|families|choir|crowd|troupe|expedition|cousins|travelers|campers|workers|engineers|readers|skywardens|ducklings|cubs|queue)\b|^(sheeple|sprites|prospectors|brassbuckles|brackens|red_scarves|kettle_campers|gullets_cousins)$/i;
const CREATURE = /\b(donkey|mule|pony|duckling|ducklings|goat|whale|wyrm|drakes?)\b/i;
const SILENT = /\bnever speaks\b|\bonly bleats\b|\bdoes not speak\b|\bwithout words\b/i;

function kindOf(id: string, name: string, who: string): Kind {
  if (GROUP.test(id) || GROUP.test(name) || /\b(all talk at once|never fewer than)\b/i.test(who)) return "group";
  if (CREATURE.test(name) && !/\bdriver\b/i.test(name)) return "creature";
  return "character";
}

/** Guesses whether a voice should read as a woman's or a man's, from pronouns and words in the notes. Null when nothing says. */
export function genderOf(entry: Pick<CastEntry, "name" | "who" | "pronouns">): "f" | "m" | null {
  if (entry.pronouns?.startsWith("she")) return "f";
  if (entry.pronouns?.startsWith("he")) return "m";
  if (entry.pronouns?.startsWith("they")) return null;
  const text = `${entry.name} ${entry.who}`;
  const count = (re: RegExp): number => (text.match(re) ?? []).length;
  const f = count(/\b(she|her|hers|herself|woman|girl|grandmother|grandma|granny|gran|nana|mother|ma|madame|mrs\.?|lady|aunt|nan|queen|witch|sister|daughter|ferrywoman|elder sefa)\b/gi);
  const m = count(/\b(he|him|his|himself|man|boy|grandfather|father|mister|mr\.?|sir|lord|king|uncle|brother|son|ferryman|master)\b/gi);
  if (f > m) return "f";
  if (m > f) return "m";
  return null;
}

/** A character's gender as the content tells it, and where from: pronouns first (canon's, or the narration's tags), then the notes' words. */
export function derivedGender(entry: Pick<CastEntry, "name" | "who" | "pronouns">, pronounsFrom: "canon" | "narration" = "canon"): { gender: Gender; genderFrom: GenderFrom } {
  if (entry.pronouns?.startsWith("she")) return { gender: "female", genderFrom: pronounsFrom };
  if (entry.pronouns?.startsWith("he")) return { gender: "male", genderFrom: pronounsFrom };
  if (entry.pronouns?.startsWith("they")) return { gender: "nonbinary", genderFrom: pronounsFrom };
  const guess = genderOf(entry);
  return guess ? { gender: guess === "f" ? "female" : "male", genderFrom: "notes" } : { gender: "unknown", genderFrom: "none" };
}

/** The voice gender a character wants: the gender on the sheet when there is one, else the guess. Null for either. */
export function voiceGenderOf(entry: Pick<CastEntry, "name" | "who" | "pronouns" | "gender">): "f" | "m" | null {
  if (entry.gender === "female") return "f";
  if (entry.gender === "male") return "m";
  if (entry.gender) return null;
  return genderOf(entry);
}

/** What a character's notes ask of a voice: young or small, old, big. */
export function traitsOf(entry: Pick<CastEntry, "name" | "who">): string[] {
  const text = `${entry.name} ${entry.who}`.toLowerCase();
  const traits: string[] = [];
  if (/\b(tiny|small|little|kid|cub|cubs|young|girl|boy|squeaky|sprite|teapot|child|youngest|littlest|cadet)\b/.test(text)) traits.push("young", "small");
  if (/\b(old|elder|eldest|grand|granny|grandmother|ancient|very old|aged|oldest|great-gran)\b/.test(text)) traits.push("old");
  if (/\b(troll|yeti|giant|dragon|huge|booming|deep|drake|wyrm|manticore|enormous|big)\b/.test(text)) traits.push("big");
  if (/\b(gentle|soft|whisper|whispery|quiet|shy|embarrassed)\b/.test(text)) traits.push("soft");
  if (/\b(cheerful|bright|delighted|giggly|bouncy|excit|quick|fast)\b/.test(text)) traits.push("bright", "upbeat", "lively", "excitable");
  return traits;
}

const SPEECH_VERBS = "says|said|asks|adds|croaks|squawks|whispers|calls|shouts|booms|sighs|laughs|mutters|sings|grumbles|answers|replies|bellows|squeaks|hums|announces|explains|tells you|puffs|rumbles|snaps|chirps|cries|murmurs|declares|beams|grins|wheezes|honks|bleats|purrs|say|ask|whisper|call|shout|answer|groans|corrects|decides|promises|insists|warns|urges|offers|suggests|agrees|admits|demands|complains|grunts|gasps|yells|exclaims|remarks|continues|reminds|pleads|scolds|teases|hisses|growls|chuckles|giggles|cheers|moans|sniffs|barks|croak|groan|cry|mutter|explain|tells|repeats|echoes|states|notes|observes|wonders|insists|adds|growls|squeals|calls out|cheers|roars|howls|thunders|screeches|trills|coos|yelps|screams|warbles|rasps|writes|jots|scribbles|reads";
const QUOTE = /["“]([^"”]{2,400})["”]/g;
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface Speaker {
  id: string;
  names: readonly string[];
  /** Answers only to its names as written ("Wisp", never the noun "wisp"): a name that is also a common word. */
  exact?: boolean;
  /** The pronoun the sheet already has for them ("she", "he", "they", "it"), when it does. */
  pronoun?: "she" | "he" | "they" | "it";
  /** In the scene being read, which is who "she says" can mean when nobody is named. */
  here?: boolean;
}

/** "she/her" is "she". */
export const pronounWord = (pronouns: string | undefined): Speaker["pronoun"] => {
  const word = pronouns?.split("/")[0]?.trim().toLowerCase();
  return word === "she" || word === "he" || word === "they" || word === "it" ? word : undefined;
};

/**
 * What the prose calls someone in the scene they are in: the last word of their name ("the keeper" for the Lookout
 * keeper, "a cousin" for Gullet's Cousins). It names them only where no one else in the scene ends in the same word,
 * which is how a reader knows who "the drover says" means. Anyone not in the scene keeps just their names.
 */
export function withSceneRoles(present: readonly Speaker[], inScene: ReadonlySet<string> | undefined, nameOf: ReadonlyMap<string, string>): Speaker[] {
  if (!inScene || inScene.size < 1) return present.map((speaker) => ({ ...speaker, here: false }));
  const owners = new Map<string, string[]>();
  for (const id of inScene) {
    const words = nameOf.get(id)?.toLowerCase().replace(/['’]s\b/g, "").split(/\s+/) ?? [];
    const last = words[words.length - 1];
    if (!last || last.length < 4) continue;
    // The last word ("the keeper"), and any other word of the name that is a role ("the elder" for the Elder Unicorn).
    const named = new Set([last, last.length > 4 ? last.replace(/s$/, "") : last, ...words.filter((word) => word.length >= 4 && ROLE_WORDS.test(word)).map((word) => word.replace(/s$/, ""))]);
    for (const word of named) owners.set(word, [...(owners.get(word) ?? []), id]);
  }
  return present.map((speaker) => {
    const mine = [...owners].filter(([, ids]) => ids.length === 1 && ids[0] === speaker.id).map(([word]) => word);
    const here = inScene.has(speaker.id);
    return mine.length > 0 ? { ...speaker, here, names: [...new Set([...speaker.names, ...mine])] } : { ...speaker, here };
  });
}

/** A quote nobody was tagged for, with the words either side of it. */
export interface LooseQuote {
  words: string;
  before: string;
  after: string;
}

/** The party speaking, within a few words of a quote: "you say", "you sing the verse back", "you reply kindly". */
const PARTY_NEAR = /\byou(?:'ll|'d)?\s+(?:\w+\s+){0,2}?(?:say|said|ask|reply|answer|sing|whisper|call|shout|tell|add|offer|announce|read|try|hum)\b/i;
/** Words that say a quote is something shown or sold, not said: "sells "slightly used rumors."", "a sign that reads "…"". */
const SHOWN_NOT_SAID = /\b(?:sells?|sold|sign|plaque|label|labeled|banner|reads?|written|spells?|spelled|carved|painted|stamped|called|named|nicknamed|word|words|phrase)\b[^"“”.!?]{0,35}$/i;

/**
 * Whether a quote nobody was tagged for is probably spoken by the one speaker in its scene, and so worth counting
 * for them as a guess. Not a fragment (it starts a sentence and has more than one word), not the party's (a "you
 * say" beside it), and not something shown or sold ("sells "slightly used rumors."").
 */
export function looksSpoken(quote: LooseQuote): boolean {
  if (!/^[A-Z“"'‘]/.test(quote.words) || quote.words.split(/\s+/).length < 2) return false;
  if (PARTY_NEAR.test(quote.before.slice(-50)) || PARTY_NEAR.test(quote.after.slice(0, 50))) return false;
  return !SHOWN_NOT_SAID.test(quote.before);
}

/**
 * Who says each quote in a narration string:
 *  - a speech tag naming someone ("…," says Pib / Pib says, "…") gives it to them;
 *  - a tag with a pronoun ("…," he croaks) gives it to whoever was named last before it;
 *  - "you say" gives it to the party;
 *  - with no tag, an action beat just before it ("The keeper shakes her head.") gives it to the one speaker the beat is about;
 *  - a quote right after an attributed one, with no new speaker tagged between, is the same speaker's.
 * Quotes nobody can be sure of are left out of the result, and, if `unattributed` is given, their words are added to it.
 * `from` is where the words being counted begin: the text before it is only context for "he" and "she" (a scene variant
 * continues the scene's own narration), and its quotes are read but not returned.
 */
export function attributeQuotes(text: string, speakers: readonly Speaker[], unattributed?: LooseQuote[], from = 0): { id: string; words: string; pronoun?: string }[] {
  const named = speakers
    // "Seal Keeper" is "Seal-Keeper" in the prose, and the other way about.
    .map((speaker) => ({ id: speaker.id, names: speaker.names.filter((n) => n.length >= 3).map((n) => escape(n).replace(/[ -]/g, "[\\s-]+")) }))
    .filter((speaker) => speaker.names.length > 0);
  // A name that only counts as written is hidden wherever the text spells it any other way, so "a wisp line" is not Wisp.
  // Same length, so every position still means the same place in the text.
  const exactNames = speakers.filter((speaker) => speaker.exact).flatMap((speaker) => speaker.names.filter((n) => n.length >= 3));
  const context = exactNames.length === 0 ? text : text.replace(new RegExp(`\\b(?:${exactNames.map(escape).join("|")})\\b`, "gi"), (found) => (exactNames.includes(found) ? found : "_".repeat(found.length)));
  const mentions: { at: number; id: string }[] = [];
  for (const speaker of named) {
    for (const match of context.matchAll(new RegExp(`\\b(?:${speaker.names.join("|")})\\b`, "gi"))) mentions.push({ at: match.index!, id: speaker.id });
  }
  mentions.sort((a, b) => a.at - b.at);
  const tagAfter = (tail: string): string | null => {
    for (const speaker of named) {
      const name = `(?:(?:the|a|an|one)\\s+)?(?:${speaker.names.join("|")})`;
      if (new RegExp(`^\\s*,?\\s*(?:${SPEECH_VERBS})\\s+${name}\\b|^\\s*,?\\s*${name}\\s+(?:${SPEECH_VERBS})\\b`, "i").test(tail)) return speaker.id;
    }
    if (new RegExp(`^\\s*,?\\s*you\\s+(?:${SPEECH_VERBS})\\b`, "i").test(tail)) return "you";
    const pronoun = new RegExp(`^\\s*,?\\s*(he|she|they|it)\\s+(?:${SPEECH_VERBS})\\b`, "i").exec(tail);
    if (pronoun) return `pronoun:${pronoun[1]!.toLowerCase()}`;
    return null;
  };
  const tagBefore = (head: string): string | null => {
    for (const speaker of named) {
      if (new RegExp(`\\b(?:${speaker.names.join("|")})\\s+(?:${SPEECH_VERBS})[^"“”.]{0,30}[:,]?\\s*$`, "i").test(head)) return speaker.id;
    }
    const pronoun = new RegExp(`\\b(he|she|they|it)\\s+(?:${SPEECH_VERBS})[^"“”.]{0,30}[:,]\\s*$`, "i").exec(head);
    if (pronoun) return `pronoun:${pronoun[1]!.toLowerCase()}`;
    return null;
  };
  // An action beat: the sentence just before the quote is about one named speaker, who starts it
  // ("The keeper shakes her head. "…""). Its she/her or he/his is that speaker's too.
  const beatBefore = (start: number): { id: string; pronoun?: string } | null => {
    const head = context.slice(Math.max(0, start - 200), start);
    if (!/[.!?]["”]?\s+$/.test(head)) return null;
    const sentence = /(?:^|[.!?]["”]?\s+)([^.!?"“”]+[.!?])\s+$/.exec(head)?.[1];
    if (!sentence) return null;
    let subject: { id: string } | undefined;
    let rest = "";
    for (const speaker of named) {
      const at = new RegExp(`^(?:(?:the|a|an|one)\\s+)?(?:${speaker.names.join("|")})\\b`, "i").exec(sentence);
      if (at) {
        subject = speaker;
        rest = sentence.slice(at[0].length);
        break;
      }
    }
    if (!subject) {
      // "She stops at the sight of the kid." is the scene's one she, whoever else it mentions.
      const lead = /^(she|he|they)\s/i.exec(sentence)?.[1]?.toLowerCase();
      const only = lead ? inSceneWith(lead) : null;
      return only && lead ? { id: only, pronoun: lead } : null;
    }
    const others = named.filter((speaker) => speaker.id !== subject.id && new RegExp(`\\b(?:${speaker.names.join("|")})\\b`, "i").test(sentence));
    if (others.length > 0) return null;
    // Their own: "shakes her head", or a later "she"; not "reaches toward her hand", which is someone else's.
    const own = /^\s+\w+\s+(her|his)\b/i.exec(rest)?.[1] ?? /\b(she|he)\b/i.exec(rest)?.[1];
    const pronoun = own ? (/^(?:her|she)$/i.test(own) ? "she" : "he") : undefined;
    return { id: subject.id, ...(pronoun ? { pronoun } : {}) };
  };

  // "she says" with nobody named: the one she in the scene, when there is exactly one.
  const inSceneWith = (pronoun: string): string | null => {
    const found = speakers.filter((speaker) => speaker.here && speaker.pronoun === pronoun);
    return found.length === 1 ? found[0]!.id : null;
  };
  const introducedIn = (words: string): string | null => {
    for (const speaker of named) {
      if (new RegExp(`\\b(?:I am|I'm|I’m|my name is|call me)\\s+(?:the\\s+)?(?:${speaker.names.join("|")})\\b`, "i").test(words)) return speaker.id;
    }
    return null;
  };

  const found: { id: string; words: string; pronoun?: string }[] = [];
  let previous: { id: string; end: number } | null = null;
  for (const match of text.matchAll(QUOTE)) {
    const start = match.index!;
    const end = start + match[0].length;
    const lastNamed = [...mentions].reverse().find((m) => m.at < start)?.id ?? null;
    const tag = tagAfter(context.slice(end, end + 80)) ?? tagBefore(context.slice(Math.max(0, start - 80), start));
    let id: string | null = null;
    let pronoun: string | undefined;
    if (tag === "you") id = "party";
    else if (tag?.startsWith("pronoun:")) {
      // "I am Corvane," he says: with nobody named before it, the quote names its own speaker.
      pronoun = tag.slice("pronoun:".length);
      // Named last is who "she" is, unless the sheet knows that one is a he: then the scene's one she.
      const lastKnown = speakers.find((speaker) => speaker.id === lastNamed)?.pronoun;
      const byScene = inSceneWith(pronoun);
      id = lastNamed !== null && !(lastKnown && lastKnown !== pronoun && byScene) ? lastNamed : (introducedIn(match[1]!) ?? byScene);
    } else if (tag !== null) id = tag;
    // "I'm Orin Vale." names its own speaker, and that is stronger than the sentence before it being about someone else.
    else if (introducedIn(match[1]!) !== null) id = introducedIn(match[1]!);
    else if (beatBefore(start)) ({ id, pronoun } = beatBefore(start)!);
    else if (previous !== null && start - previous.end <= 60) {
      // Untagged right after an attributed quote: theirs, unless someone new is named between.
      const between = mentions.filter((m) => m.at > previous!.end && m.at < start && m.id !== previous!.id);
      if (between.length === 0) id = previous.id;
    }
    if (id !== null) {
      if (start >= from) found.push({ id, words: match[1]!.trim(), ...(pronoun ? { pronoun } : {}) });
      previous = { id, end };
    } else {
      previous = null;
      if (start >= from) unattributed?.push({ words: match[1]!.trim(), before: text.slice(Math.max(0, start - 80), start), after: text.slice(end, end + 80) });
    }
  }
  return found;
}

/** The quotes a narration string gives to one speaker (attributeQuotes, for a single name list). */
export function quotesFor(text: string, names: readonly string[]): string[] {
  return attributeQuotes(text, [{ id: "them", names }]).filter((q) => q.id === "them").map((q) => q.words);
}

/** The best few audition lines: distinct, not too short, not too long, shortest of the good ones first. */
function pickLines(candidates: AuditionLine[], limit = 3): AuditionLine[] {
  const seen = new Set<string>();
  const good = candidates.filter((line) => {
    const key = line.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return line.text.length >= 12 && line.text.length <= 220;
  });
  const pool = good.length > 0 ? good : candidates.filter((line) => line.text.length >= 4);
  return [...pool].sort((a, b) => Math.abs(a.text.length - 80) - Math.abs(b.text.length - 80)).slice(0, limit);
}

export interface Sources {
  chapters: ChapterLike[];
  individuals: IndividualLike[];
  narration: NarrationLine[];
}

interface Draft {
  id: string;
  name: string;
  who: string;
  pronouns?: string;
  pronounsFrom?: "canon" | "narration";
  canon?: string;
  voiceNotes: { chapter: string; key: string }[];
  figures: Map<string, number>;
  chapters: Set<string>;
  campaigns: Set<string>;
  aliases: Set<string>;
  /** Named only by what they are ("Wisp", "Drover"): never the target of a fuzzy name match. */
  generic: boolean;
}

/** npcVoices keys are ids (`old_wick`) in most chapters and display names ("Orin Vale") in some. */
const idOfKey = (key: string): string => (/[A-Z\s]/.test(key) ? identity(key) : key);

/** Who is physically in each scene: chapter id, then scene id, to the ids of the characters in its cast. */
export type SceneCasts = Map<string, Map<string, Set<string>>>;

/**
 * Every character the content names, merged across chapters and sources. Narrator and party not included.
 * `scenes`, if given, is filled with who is in each scene, resolved to the same characters.
 */
export function collectCharacters(sources: Sources, scenes?: SceneCasts): Draft[] {
  const drafts = new Map<string, Draft>();
  const get = (id: string, name: string, who: string, generic: boolean): Draft => {
    let draft = drafts.get(id);
    if (!draft) {
      draft = { id, name, who, chapters: new Set(), campaigns: new Set(), aliases: new Set(), generic, voiceNotes: [], figures: new Map() };
      drafts.set(id, draft);
    }
    if (!draft.who && who) draft.who = who;
    return draft;
  };

  for (const chapter of sources.chapters) {
    for (const [key, notes] of Object.entries(chapter.voiceGuide?.npcVoices ?? {})) {
      const id = idOfKey(key);
      const name = /[A-Z\s]/.test(key) ? key : nameFromNotes(key, notes);
      // A one-word key whose notes open on "a"/"the" is what someone is, not who: "wisp", "drover".
      const generic = !/[A-Z\s_]/.test(key) && name === titleCase(key) && /^(an?|the)\b/i.test(notes.trim());
      const draft = get(id, name, notes, generic);
      draft.voiceNotes.push({ chapter: chapter.id, key });
      draft.chapters.add(chapter.id);
      if (chapter.campaignId) draft.campaigns.add(chapter.campaignId);
    }
  }

  for (const chapter of sources.chapters) {
    const keyed = Object.entries(chapter.voiceGuide?.npcVoices ?? {}).map(([key, notes]) => ({ id: idOfKey(key), notes }));
    const keys = keyed.map((k) => k.id);
    const names = new Map<string, Map<string, number>>(); // name → figure → scenes
    for (const scene of Object.values(chapter.scenes ?? {})) {
      for (const member of (scene as { cast?: { name?: string; figure?: string }[] }).cast ?? []) {
        if (!member.name) continue;
        const figures = names.get(member.name) ?? new Map<string, number>();
        if (member.figure) figures.set(member.figure, (figures.get(member.figure) ?? 0) + 1);
        names.set(member.name, figures);
      }
    }
    const resolved = new Map<string, string>(); // a cast name, in this chapter → the character it is
    for (const [name, figures] of names) {
      const s = identity(name);
      const parts = s.split("_");
      // The chapter's own voice notes, if they are about this person: same key, or one inside the other's name.
      // The figure names them too ("cast/nan_rummage"), and survives a rename of the display name.
      const key =
        keys.find((k) => k === s) ??
        keys.find((k) => figures.has(`cast/${k}`)) ??
        keys.find((k) => parts.includes(k) || k.split("_").every((part) => parts.includes(part)) || (!isRoleName(name) && parts.every((part) => k.split("_").includes(part)))) ??
        keyed.find((k) => identity(nameFromNotes(k.id, k.notes)) === s)?.id;
      // Elsewhere in the game under a fuller or shorter form of the same proper name: "Madame Fenn" is "Coralie Fenn".
      // Only within one campaign, and only between real names: Riftlight's "Seren Wisp" is not Bramblewood's wisp.
      const sameName = (d: Draft): boolean => {
        const theirs = identity(d.name).split("_");
        return parts.every((p) => theirs.includes(p)) || theirs.every((p) => parts.includes(p));
      };
      const known = key
        ? undefined
        : drafts.get(s) ??
          (isRoleName(name) ? undefined : [...drafts.values()].find((d) => !d.generic && !isRoleName(d.name) && chapter.campaignId !== undefined && d.campaigns.has(chapter.campaignId) && sameName(d)));
      const draft = key ? drafts.get(key)! : (known ?? get(s, name, "", false));
      resolved.set(name, draft.id);
      draft.chapters.add(chapter.id);
      if (chapter.campaignId) draft.campaigns.add(chapter.campaignId);
      if (name !== draft.name) draft.aliases.add(name);
      for (const [figure, count] of figures) draft.figures.set(figure, (draft.figures.get(figure) ?? 0) + count);
      if (key && draft.name === titleCase(key) && name.length > draft.name.length) {
        draft.aliases.add(draft.name);
        draft.name = name;
      }
    }
    if (scenes) {
      const inChapter = new Map<string, Set<string>>();
      for (const [sceneId, scene] of Object.entries(chapter.scenes ?? {})) {
        const present = new Set<string>();
        for (const member of (scene as { cast?: { name?: string }[] }).cast ?? []) {
          const id = member.name ? resolved.get(member.name) : undefined;
          if (id) present.add(id);
        }
        inChapter.set(sceneId, present);
      }
      scenes.set(chapter.id, inChapter);
    }
  }

  for (const person of sources.individuals) {
    const key = person.id.replace(/^individual\./, "");
    const draft = drafts.get(key) ?? [...drafts.values()].find((d) => slug(d.name) === slug(person.title));
    if (!draft) continue;
    draft.canon = person.id;
    if (person.pronouns) {
      draft.pronouns = person.pronouns;
      draft.pronounsFrom = "canon";
    }
    if (person.speech_register) {
      const register = person.speech_register.replace(/\s+/g, " ").trim();
      if (!draft.who.includes(register)) draft.who = draft.who ? `${draft.who}. ${register}` : register;
    }
  }
  return [...drafts.values()];
}

/** Names a speech tag might use for this character: their name, their aliases, and a titled name's last word. */
function namesFor(draft: Pick<Draft, "name" | "aliases">): string[] {
  const names = new Set<string>([draft.name, ...draft.aliases]);
  for (const name of [draft.name, ...draft.aliases]) {
    const words = name.split(/\s+/);
    if (words.length > 1 && /^(Professor|Postmaster|Madame|Mrs\.?|Mr\.?|Innkeeper|Old|Elder|Granny|Mother|Captain|Sergeant|Clerk|Corporal|Master|Lady|Engineer|Aunt|Great-Gran|Grandmother|Cadet|Warden)$/i.test(words[0]!)) {
      names.add(words.slice(1).join(" "));
      const last = words[words.length - 1]!;
      if (last.length >= 4) names.add(last);
    } else if (words.length > 1 && /^[A-Z]/.test(words[0]!) && /^[A-Z]/.test(words[1]!) && !isRoleName(name)) {
      // "Tobble Reedpipe" is "Tobble" in the prose.
      names.add(words[0]!);
    }
  }
  return [...names];
}

// Jobs and roles, never peoples: "the merfolk" in a chapter with two merfolk is anybody's.
const ROLE_WORDS = /^(captain|keeper|guide|grandmother|drover|ferrier|runner|cook|prospector|driver|seller|leader|warden|tree|beech|voice|door|postmaster|innkeeper|fishmonger|boy|girl|elder|clerk|courier|lamplighter|scholar|cobbler|foreman|provisioner|ladler|actor|grocer|toll-taker|ferryman|ferrywoman|engineer|sergeant|corporal|archivist|messenger|watcher|herder|builder|pilot|singer|student|worker|boss|carter|claimant|expert|gatherer)s?$/i;

/** The pronoun the sheet already has for someone: canon's or the last build's, else the one their notes imply ("warm once she decides you matter"). */
function knownPronoun(draft: Pick<Draft, "name" | "who" | "pronouns">, before: string | undefined): Speaker["pronoun"] {
  const stated = pronounWord(draft.pronouns ?? before);
  if (stated) return stated;
  const guess = genderOf({ name: draft.name, who: draft.who, pronouns: undefined });
  return guess === "f" ? "she" : guess === "m" ? "he" : undefined;
}

/** A name for several of them ("Gullet's Cousins", "Marker Movers"): its last word is a plural. */
export function isGroupName(name: string): boolean {
  const last = name.trim().split(/\s+/).pop() ?? "";
  return /[a-z]{3,}s$/i.test(last) && !/(ss|us|is)$/i.test(last);
}

/** A name that is a description, not a name: "Lighthouse Keeper", "Egg Faun". */
function isRoleName(name: string): boolean {
  const words = name.toLowerCase().split(/\s+/);
  return ROLE_WORDS.test(words[words.length - 1]!);
}

/**
 * What the prose calls someone who has no name of their own: the last word of
 * a role name ("the keeper"), and the head of the notes' opening phrase
 * ("the yeti captain of…" → "captain"). Used only where it picks out one
 * speaker in a chapter.
 */
function roleWords(draft: Pick<Draft, "name" | "aliases" | "who">): string[] {
  const words = new Set<string>();
  for (const name of [draft.name, ...draft.aliases]) {
    if (isRoleName(name)) {
      // "Beech Tree" is "the tree" and "the beech": each word of a role name that is a role word.
      for (const word of name.toLowerCase().split(/\s+/)) if (ROLE_WORDS.test(word)) words.add(word.replace(/s$/, ""));
      words.add(name.toLowerCase().split(/\s+/).pop()!.replace(/s$/, ""));
    }
  }
  const lead = /^(?:an?|the)\s+((?:[a-z-]+\s+){0,3}?[a-z-]+?)(?:\s+(?:of|in|on|with|who|from|at|that|whose)\b|[;,.(]|$)/i.exec(draft.who.trim());
  if (lead) {
    const head = lead[1]!.split(/\s+/).pop()!;
    if (ROLE_WORDS.test(head)) words.add(head.toLowerCase().replace(/s$/, ""));
  }
  return [...words];
}

export interface Hints {
  gender: "f" | "m" | null;
  want: string[];
  avoid: string[];
}

/**
 * What a listener's rejection notes ask of the next voice: "too old" wants a
 * younger one, "needs to be deeper" a bigger one, "should be a woman" a
 * woman's. Only plain words are read; anything else stays for a person.
 */
export function noteHints(notes: readonly string[]): Hints {
  const text = notes.join(" ").toLowerCase();
  const hints: Hints = { gender: null, want: [], avoid: [] };
  const rules: [RegExp, string[], string[]][] = [
    [/\b(younger|more youthful|too old|childlike|more like a kid|smaller voice)\b/, ["young", "small"], ["old"]],
    [/\b(older|more mature|too young|wiser|elderly|grandparent)\b/, ["old", "mature"], ["young"]],
    [/\b(deeper|bigger|heavier|too thin|too light|more gravel|gravellier|rumblier|boom(?:ier)?)\b/, ["big", "gravelly"], ["small"]],
    [/\b(lighter|too deep|too heavy|too big)\b/, ["small", "bright"], ["big"]],
    [/\b(softer|gentler|quieter|too harsh|too loud|too firm)\b/, ["soft", "gentle"], ["firm"]],
    [/\b(brighter|bouncier|more energy|livelier|more excited|too flat|too dull|too sleepy|too serious)\b/, ["bright", "upbeat", "lively", "excitable"], []],
    [/\b(calmer|slower|too excited|too much energy|too bouncy|too chipper)\b/, ["even", "easy-going", "gentle"], ["excitable", "lively"]],
    [/\b(warmer|kinder|friendlier|too cold|too stern)\b/, ["warm", "friendly", "gentle"], ["firm"]],
    [/\b(firmer|stronger|more authority|too soft|too timid)\b/, ["firm"], ["soft"]],
  ];
  for (const [pattern, want, avoid] of rules) {
    if (pattern.test(text)) {
      hints.want.push(...want);
      hints.avoid.push(...avoid);
    }
  }
  if (/\b(a woman|woman's|female|feminine|girl's)\b/.test(text)) hints.gender = "f";
  if (/\b(a man|man's|male|masculine|boy's)\b/.test(text) && !/\bfemale\b/.test(text)) hints.gender = hints.gender === "f" ? null : "m";
  return hints;
}

/** The voices a character has been rejected in, on one provider: never offered to them again. */
export const rejectedVoices = (entry: CastEntry, provider: VoiceProvider = "gemini"): Set<string> =>
  new Set((entry.history ?? []).filter((d) => d.decision === "rejected" && (d.provider ?? "gemini") === provider).map((d) => d.voice));

/** The voice a character has on a provider (a Gemini voice's name, or an ElevenLabs voice id), or "" when they have none yet. */
export const voiceOf = (entry: CastEntry, provider: VoiceProvider = "gemini"): string => (provider === "elevenlabs" ? (entry.elevenlabs?.voiceId ?? "") : entry.gemini.voice);

/** Whether a person has approved a character's voice on a provider. */
export const approvedOn = (entry: CastEntry, provider: VoiceProvider = "gemini"): boolean => (provider === "elevenlabs" ? entry.elevenlabs?.approved === true : entry.status === "approved");

/**
 * The best voice for one character, given which voices are already speaking in
 * which chapters. The character's gender and traits decide, the listener's
 * rejection notes push it further, and a voice they were rejected in, a voice
 * already in one of their chapters, or the narrator's is never chosen while
 * any other is left.
 */
function bestVoice(entry: CastEntry, byChapter: ReadonlyMap<string, ReadonlyMap<string, string>>, uses: ReadonlyMap<string, number>): string {
  const rejected = rejectedVoices(entry, "gemini");
  // Only Gemini's own rejections steer Gemini's next voice: a note about an ElevenLabs voice ("too deep, a woman's voice")
  // says nothing about these.
  const hints = noteHints((entry.history ?? []).filter((d) => d.decision === "rejected" && (d.provider ?? "gemini") === "gemini").map((d) => d.notes ?? ""));
  const gender = hints.gender ?? voiceGenderOf(entry);
  const wants = [...traitsOf(entry), ...hints.want];
  let best = "";
  let bestScore = -Infinity;
  for (const voice of GEMINI_VOICES.map((v) => v.id)) {
    if (voice === NARRATOR_VOICE) continue;
    const traits = GEMINI_VOICE_TRAITS[voice]!;
    let score = rejected.has(voice) ? -1000 : 0;
    if (gender !== null) score += traits.gender === gender ? 4 : -6;
    if (hints.gender !== null) score += traits.gender === hints.gender ? 6 : -10;
    for (const want of wants) if (traits.traits.includes(want)) score += 2;
    for (const avoid of hints.avoid) if (traits.traits.includes(avoid)) score -= 3;
    score -= entry.chapters.filter((c) => byChapter.get(c)?.has(voice)).length * 20;
    score -= (uses.get(voice) ?? 0) * 0.5;
    if (score > bestScore || (score === bestScore && voice < best)) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

function occupancy(entries: Record<string, CastEntry>, include: (id: string) => boolean) {
  const byChapter = new Map<string, Map<string, string>>(); // chapter → voice → speaker
  const uses = new Map<string, number>();
  const take = (id: string, entry: CastEntry): void => {
    for (const chapter of entry.chapters) {
      const voices = byChapter.get(chapter) ?? new Map<string, string>();
      voices.set(entry.gemini.voice, id);
      byChapter.set(chapter, voices);
    }
    uses.set(entry.gemini.voice, (uses.get(entry.gemini.voice) ?? 0) + 1);
  };
  for (const [id, entry] of Object.entries(entries)) if (include(id)) take(id, entry);
  return { byChapter, uses, take };
}

/** Picks a voice for each provisional character, never one already speaking in any of their chapters. */
export function assignVoices(entries: Record<string, CastEntry>, fixed: (id: string) => boolean): void {
  const { byChapter, uses, take } = occupancy(entries, fixed);
  // Recurring characters first: they have the fewest voices left to them.
  const open = Object.entries(entries)
    .filter(([id]) => !fixed(id))
    .sort(([a, x], [b, y]) => y.chapters.length - x.chapters.length || a.localeCompare(b));
  for (const [id, entry] of open) {
    entry.gemini = { voice: bestVoice(entry, byChapter, uses) };
    take(id, entry);
  }
}

/** The next voice for one character after a rejection, around everybody else as they are. */
export function nextVoice(entries: Record<string, CastEntry>, id: string): string {
  const { byChapter, uses } = occupancy(entries, (other) => other !== id && entries[other]!.kind !== "narrator" && entries[other]!.kind !== "party");
  return bestVoice(entries[id]!, byChapter, uses);
}

/**
 * Records a listener's decision on a character's current voice. Approving
 * pins it. Rejecting remembers the voice and the notes, and moves the
 * character to the next best voice at once, so it can be heard right away.
 *
 * On ElevenLabs there is no trait table to find a next best voice by, so a
 * rejection clears the choice instead (and remembers the voice, which the page
 * then leaves out of what it offers): the next one is picked by ear.
 */
export function decide(sheet: CastSheet, id: string, decision: Decision["decision"], notes: string | undefined, model: string | undefined, at = new Date().toISOString(), provider: VoiceProvider = "gemini"): CastEntry {
  const entry = sheet.speakers[id];
  if (!entry) throw new Error(`nobody called ${id} in the sheet`);
  if (provider === "elevenlabs") {
    const voice = entry.elevenlabs;
    if (!voice?.voiceId) throw new Error(`${entry.name} has no ElevenLabs voice to ${decision === "approved" ? "approve" : "reject"} yet`);
    const record: Decision = { decision, provider, voice: voice.voiceId, ...(voice.name ? { voiceName: voice.name } : {}), ...(notes ? { notes } : {}), ...(model ? { model } : {}), at };
    entry.history = [...(entry.history ?? []), record];
    if (decision === "approved") entry.elevenlabs = { ...voice, approved: true };
    else delete entry.elevenlabs;
    return entry;
  }
  const record: Decision = { decision, voice: entry.gemini.voice, ...(notes ? { notes } : {}), ...(model ? { model } : {}), at };
  entry.history = [...(entry.history ?? []), record];
  if (decision === "approved") {
    entry.status = "approved";
    return entry;
  }
  entry.status = "provisional";
  entry.gemini = { voice: nextVoice(sheet.speakers, id) };
  return entry;
}

/** Two speakers with one voice in the same chapter: what the sheet warns about. Someone with no voice yet on the provider clashes with nobody. */
export function voiceClashes(sheet: CastSheet, provider: VoiceProvider = "gemini"): { chapter: string; voice: string; speakers: string[] }[] {
  const clashes: { chapter: string; voice: string; speakers: string[] }[] = [];
  const byChapter = new Map<string, Map<string, string[]>>();
  for (const [id, entry] of Object.entries(sheet.speakers)) {
    const voice = voiceOf(entry, provider);
    if (entry.kind === "narrator" || entry.kind === "party" || (provider !== "gemini" && voice === "")) continue;
    for (const chapter of entry.chapters) {
      const voices = byChapter.get(chapter) ?? new Map<string, string[]>();
      voices.set(voice, [...(voices.get(voice) ?? []), id]);
      byChapter.set(chapter, voices);
    }
  }
  for (const [chapter, voices] of byChapter) for (const [voice, speakers] of voices) if (speakers.length > 1) clashes.push({ chapter, voice, speakers });
  // The narrator speaks everywhere, so a character with the narrator's voice clashes in each of their chapters.
  const narrator = sheet.speakers.narrator === undefined ? "" : voiceOf(sheet.speakers.narrator, provider);
  for (const [id, entry] of Object.entries(sheet.speakers)) {
    const voice = voiceOf(entry, provider);
    if (entry.kind !== "narrator" && entry.kind !== "party" && voice !== "" && voice === narrator) {
      for (const chapter of entry.chapters) clashes.push({ chapter, voice, speakers: ["narrator", id] });
    }
  }
  return clashes.sort((a, b) => a.chapter.localeCompare(b.chapter) || a.voice.localeCompare(b.voice));
}

const NARRATOR_LINES: AuditionLine[] = [
  { address: "bramblewood-01/scene_hedge_wall/narration", text: "The path ends at a wall of thorns twice your height. Somewhere on the other side, something is humming a little tune, and it is definitely not a bird." },
];

/**
 * Builds the sheet from the content, keeping everything a person has set on
 * the previous sheet: status, voice, a gender they set, accent, direction,
 * notes and decision history. What the content says (name, aliases, notes on
 * who they are, pronouns, figure, chapters, lines) is refreshed for everyone,
 * approved or not, so clash checks see an approved character in a chapter
 * written after the approval.
 */
/** A quote the sheet could not give to anyone by its tags: where it is, who is in the scene, and whether it was counted as a guess. */
export interface UntaggedQuote extends LooseQuote {
  address: string;
  /** The characters in the scene's cast: who the quote can be tagged for. */
  scene: string[];
  /** Counted for the scene's only speaker as a guess. */
  guessed: boolean;
}

/** `untagged`, if given, is filled with every quote nobody was tagged for (voice:untagged reports it). */
export function buildSheet(sources: Sources, previous: CastSheet | null, untagged?: UntaggedQuote[]): CastSheet {
  const accent = previous?.accent ?? "General American, the way a warm American storyteller reads aloud";
  const scenes: SceneCasts = new Map();
  const drafts = collectCharacters(sources, scenes);
  const speakers: Record<string, CastEntry> = {};

  speakers.narrator = previous?.speakers.narrator ?? {
    name: "Narrator",
    kind: "narrator",
    who: "A warm grown-up storyteller reading to eight-year-olds: unhurried, smiling, a little spooky on the quiet bits, never scary.",
    chapters: [],
    aliases: [],
    gemini: { voice: NARRATOR_VOICE },
    lines: NARRATOR_LINES,
    speaks: true,
    status: "provisional",
  };
  speakers.party = previous?.speakers.party ?? {
    name: "The party",
    kind: "party",
    who: "The heroes themselves (\"you say\"), read by the storyteller so no child is cast as a stranger's voice.",
    chapters: [],
    aliases: [],
    gemini: { voice: NARRATOR_VOICE },
    lines: [{ address: "gemfall-08/scene_keeper_came_to_help/narration", text: "We didn't bring any. We came to help." }],
    speaks: true,
    status: "provisional",
  };

  const nameOf = new Map(drafts.map((draft) => [draft.id, draft.name]));
  const baseOf = new Map(sources.narration.map((line) => [line.address, line.text]));
  const narrationByChapter = new Map<string, NarrationLine[]>();
  for (const line of sources.narration) narrationByChapter.set(line.chapter, [...(narrationByChapter.get(line.chapter) ?? []), line]);

  // Every quote in a chapter, given to whichever of that chapter's characters says it.
  const heard = new Map<string, AuditionLine[]>();
  // The party's "you say" lines are the storyteller's to read, so they are counted but not auditioned.
  let partyLines = 0;
  // Quotes nobody was tagged for, in a scene where one character is the only one who could be speaking.
  const guessed = new Map<string, number>();
  // The pronouns the narration's own speech tags use for each speaker ("…," she says).
  const tagged = new Map<string, Record<string, number>>();
  const inChapter = new Map<string, Speaker[]>();
  for (const draft of drafts) for (const chapter of draft.chapters) inChapter.set(chapter, [...(inChapter.get(chapter) ?? []), { id: draft.id, names: namesFor(draft), pronoun: kindOf(draft.id, draft.name, draft.who) === "creature" ? undefined : knownPronoun(draft, previous?.speakers[draft.id]?.pronouns) }]);
  // A role word ("the captain") names someone only where nobody else in the chapter answers to it.
  for (const [chapter, present] of inChapter) {
    const roles = new Map<string, string[]>();
    for (const draft of drafts.filter((d) => d.chapters.has(chapter))) for (const word of roleWords(draft)) roles.set(word, [...(roles.get(word) ?? []), draft.id]);
    inChapter.set(chapter, present.map((speaker) => {
      const mine = [...roles].filter(([, ids]) => ids.length === 1 && ids[0] === speaker.id).map(([word]) => word);
      return { ...speaker, names: [...speaker.names, ...mine] };
    }));
  }
  // Someone the campaign names who is not cast in this chapter can still be tagged in it ("says Voss"): the narration
  // names them. Only by their own name, never a role word, and never a name someone else in the chapter answers to.
  const campaignOf = new Map(sources.chapters.map((chapter) => [chapter.id, chapter.campaignId]));
  for (const chapter of narrationByChapter.keys()) {
    const campaign = campaignOf.get(chapter);
    const here = inChapter.get(chapter) ?? [];
    const taken = new Set(here.flatMap((speaker) => speaker.names.map((name) => name.toLowerCase())));
    const visiting: Speaker[] = [];
    const prose = (narrationByChapter.get(chapter) ?? []).map((line) => line.text).join(" ");
    for (const draft of drafts) {
      if (draft.chapters.has(chapter) || campaign === undefined || !draft.campaigns.has(campaign)) continue;
      // Someone known only by what they are ("the beech") can speak in a chapter that does not cast them, but only when
      // nobody else in the campaign is that thing: "the keeper" is far too many people to be anyone.
      if (isRoleName(draft.name)) {
        const mine = roleWords(draft).filter((word) => !taken.has(word) && drafts.filter((other) => other !== draft && other.campaigns.has(campaign) && roleWords(other).includes(word)).length === 0);
        const names = mine.filter((word) => word.length >= 4);
        if (names.length > 0) visiting.push({ id: draft.id, names });
        continue;
      }
      if (draft.generic) continue;
      // A name this chapter also uses as a plain noun ("a wisp line") is not safe to take for the person.
      const names = namesFor(draft).filter((name) => name.length >= 4 && /^[A-Z]/.test(name) && !taken.has(name.toLowerCase()) && !new RegExp(`\\b${escape(name.toLowerCase())}\\b`).test(prose));
      if (names.length > 0) visiting.push({ id: draft.id, names, exact: true });
    }
    if (visiting.length > 0) inChapter.set(chapter, [...here, ...visiting]);
  }
  for (const [chapter, lines] of narrationByChapter) {
    const present = inChapter.get(chapter) ?? [];
    for (const line of lines) {
      // A speech tag mid-sentence splits one line in two ("Rush prices, darlings," … "rush prices!"): join a speaker's run back up.
      const runs: { id: string; words: string[] }[] = [];
      const loose: LooseQuote[] = [];
      const inScene = scenes.get(chapter)?.get(line.address.split("/")[1] ?? "");
      const here = withSceneRoles(present, inScene, nameOf);
      // A scene variant carries on from the scene's own narration: "he reads" there is whoever that narration last named.
      const base = line.address.includes("/variants/") ? baseOf.get(line.address.replace(/\/variants\/.*$/, "/narration")) : undefined;
      const attributed = attributeQuotes(base ? `${base} ${line.text}` : line.text, here, loose, base ? base.length + 1 : 0);
      if (inScene?.size === 1) {
        const only = [...inScene][0]!;
        // Someone else named right beside the quote may be the one speaking, so it is no guess for this scene's only speaker.
        const namesOf = (exact: boolean): string[] => here.filter((speaker) => speaker.id !== only && !!speaker.exact === exact).flatMap((speaker) => speaker.names.filter((name) => name.length >= 3).map(escape));
        const others = namesOf(false);
        const exactOthers = namesOf(true);
        const nearby = [others.length === 0 ? null : new RegExp(`\\b(?:${others.join("|")})\\b`, "i"), exactOthers.length === 0 ? null : new RegExp(`\\b(?:${exactOthers.join("|")})\\b`)].filter((found): found is RegExp => found !== null);
        for (const quote of loose) {
          const counted = looksSpoken(quote) && !nearby.some((found) => found.test(quote.before.slice(-60)) || found.test(quote.after.slice(0, 40)));
          if (counted) guessed.set(only, (guessed.get(only) ?? 0) + 1);
          untagged?.push({ ...quote, address: line.address, scene: [...inScene], guessed: counted });
        }
      } else {
        for (const quote of loose) untagged?.push({ ...quote, address: line.address, scene: [...(inScene ?? [])], guessed: false });
      }
      for (const quote of attributed) {
        if (quote.pronoun && quote.pronoun !== "it") {
          const counts = tagged.get(quote.id) ?? {};
          counts[quote.pronoun] = (counts[quote.pronoun] ?? 0) + 1;
          tagged.set(quote.id, counts);
        }
        const last = runs[runs.length - 1];
        if (last && last.id === quote.id) last.words.push(quote.words);
        else runs.push({ id: quote.id, words: [quote.words] });
      }
      for (const run of runs) {
        if (run.id === "party") {
          partyLines += 1;
          continue;
        }
        // The comma before a speech tag ends the sentence when the next quote starts a new one.
        const joined = run.words
          .map((words, i) => (words.endsWith(",") && (i === run.words.length - 1 || /^[A-Z]/.test(run.words[i + 1]!)) ? `${words.slice(0, -1)}.` : words))
          .join(" ");
        const text = joined.replace(/\{party\}/g, "both of you").replace(/\{facets\}/g, "three");
        heard.set(run.id, [...(heard.get(run.id) ?? []), { text, address: line.address }]);
      }
    }
  }

  for (const draft of drafts) {
    const old = previous?.speakers[draft.id];
    const chapters = [...draft.chapters].sort();
    const candidates = heard.get(draft.id) ?? [];
    const kind = kindOf(draft.id, draft.name, draft.who);
    const lines = pickLines(candidates);
    const guess = guessed.get(draft.id) ?? 0;
    const lineCount = candidates.length + guess;
    // Canon's pronouns win; otherwise the ones the narration uses, when it is clear.
    const counts = tagged.get(draft.id) ?? {};
    const [top, second] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const heardPronoun = top && (!second || top[1] > second[1]) ? { she: "she/her", he: "he/him", they: "they/them" }[top[0]] : undefined;
    // A group ("Gullet's Cousins") is not a she or a he because one of them was. What the narration once told us is
    // kept: a rebuild that moves a quote to someone else does not take back a trait that was already established.
    const group = isGroupName(draft.name);
    // What the notes say outright is not overturned by a "he" the counter heard: one of them is wrong, and it is the counter.
    const fromNotes = genderOf({ name: draft.name, who: draft.who, pronouns: undefined });
    const contradicts = (fromNotes === "f" && heardPronoun === "he/him") || (fromNotes === "m" && heardPronoun === "she/her");
    if (!draft.pronouns && heardPronoun && !group && !contradicts) {
      draft.pronouns = heardPronoun;
      draft.pronounsFrom = "narration";
    } else if (!draft.pronouns && old?.pronouns && old.pronounsFrom === "narration") {
      draft.pronouns = old.pronouns;
      draft.pronounsFrom = "narration";
    }
    const who = draft.who || `${draft.name}.`;
    // A gender a person set is theirs; otherwise it follows the content.
    const gender = old?.genderFrom === "person" && old.gender ? { gender: old.gender, genderFrom: "person" as const } : derivedGender({ name: draft.name, who, pronouns: draft.pronouns }, draft.pronounsFrom);
    const figure = [...draft.figures].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    speakers[draft.id] = {
      name: draft.name,
      kind,
      who,
      ...(draft.pronouns ? { pronouns: draft.pronouns, ...(draft.pronounsFrom ? { pronounsFrom: draft.pronounsFrom } : {}) } : {}),
      ...gender,
      ...(figure ? { figure } : {}),
      ...(draft.canon ? { canon: draft.canon } : {}),
      ...(draft.voiceNotes.length ? { voiceNotes: draft.voiceNotes } : {}),
      chapters,
      aliases: [...draft.aliases].sort(),
      ...(old?.accent ? { accent: old.accent } : {}),
      ...(old?.direction ? { direction: old.direction } : {}),
      gemini: old?.gemini ?? { voice: "" },
      ...(old?.elevenlabs ? { elevenlabs: old.elevenlabs } : {}),
      lines,
      lineCount,
      ...(guess > 0 ? { guessedLines: guess } : {}),
      speaks: !SILENT.test(draft.who) && (lines.length > 0 || kind !== "creature"),
      // What a person decided carries over; everything else above is refreshed from the content,
      // so an approved character's chapters stay current and a new clash is still seen.
      status: old?.status ?? "provisional",
      ...(old?.notes ? { notes: old.notes } : {}),
      ...(old?.history?.length ? { history: old.history } : {}),
    };
  }

  // The narrator and the party are kept whole from the previous sheet, so what is counted is refreshed on them here.
  speakers.narrator.lineCount = sources.narration.length;
  speakers.party.lineCount = partyLines;

  // A provisional entry keeps a voice it already had; only empty ones are (re)assigned.
  assignVoices(speakers, (id) => speakers[id]!.status === "approved" || speakers[id]!.gemini.voice !== "");
  return { accent, speakers };
}
