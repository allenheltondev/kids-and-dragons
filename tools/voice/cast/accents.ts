/**
 * Accents to suggest on the cast pages (docs/voice-cast.md). The sheet's accent is General American, because the
 * game is for American children, and a character can have their own: not everyone in the realm needs to sound
 * like the narrator. These are the accents the pages offer, and ideas for which suit where a character's
 * people live on the map.
 *
 * They are ideas to hear and judge, not rules: the accent field takes any words, and what is typed there is what
 * Gemini is told. Every one is a regional accent of English that a storyteller could read aloud warmly to children;
 * nothing here is another language's English, which too easily becomes a caricature.
 */

export type AccentGroup = "American" | "British and Irish" | "Elsewhere";

export interface Accent {
  /** What goes in the accent field: plain words Gemini understands. */
  label: string;
  group: AccentGroup;
  /** A few words on how it sounds, to help choose by reading. */
  note: string;
}

export const ACCENTS: readonly Accent[] = [
  { label: "General American", group: "American", note: "the neutral, widely understood American voice" },
  { label: "Midwestern American", group: "American", note: "flat, friendly, unhurried" },
  { label: "Southern American", group: "American", note: "warm and drawling, with long vowels" },
  { label: "Appalachian American", group: "American", note: "hill-country, plain-spoken, a little musical" },
  { label: "Texan", group: "American", note: "wide open vowels, easy and confident" },
  { label: "New England American", group: "American", note: "clipped, dry, with softened r sounds" },
  { label: "New York American", group: "American", note: "quick, bright and direct" },
  { label: "Pacific Northwest American", group: "American", note: "soft, level and calm" },
  { label: "Received Pronunciation (BBC English)", group: "British and Irish", note: "the classic storyteller: precise and warm" },
  { label: "West Country English", group: "British and Irish", note: "rural, rolling and cheerful" },
  { label: "Cockney (London)", group: "British and Irish", note: "quick and cheeky, with dropped consonants" },
  { label: "Yorkshire", group: "British and Irish", note: "blunt, dry and kind underneath" },
  { label: "Welsh", group: "British and Irish", note: "lilting, with a rise at the ends of phrases" },
  { label: "Scottish (Highland)", group: "British and Irish", note: "soft and measured, with rolled r sounds" },
  { label: "Scottish (Lowland)", group: "British and Irish", note: "brisk and rounded" },
  { label: "Irish", group: "British and Irish", note: "musical and storytelling, quick to smile" },
  { label: "Canadian", group: "Elsewhere", note: "close to General American, with rounder vowels" },
  { label: "Australian", group: "Elsewhere", note: "easygoing and bright" },
  { label: "New Zealand", group: "Elsewhere", note: "gentle and clipped, with narrower vowels" },
];

export const ACCENT_LABELS: readonly string[] = ACCENTS.map((accent) => accent.label);

/**
 * Accents that might suit people who live in each place on the realm's map, with a few words on why. Keyed by the
 * biome's canon id (canon/biomes.yaml). A guess to try, with the plainest reason that suggested it.
 */
export const REGION_IDEAS: Readonly<Record<string, { why: string; accents: readonly string[] }>> = {
  "biome.sky_islands": { why: "windswept islands far from the mainland", accents: ["Scottish (Highland)", "Pacific Northwest American"] },
  "biome.enchanted_woods": { why: "an old, quiet forest", accents: ["West Country English", "Irish"] },
  "biome.whispering_marsh": { why: "a misty, drowned wetland", accents: ["Southern American", "Irish"] },
  "biome.red_sky_foothills": { why: "volcanic hill country of caves and crystal", accents: ["Welsh", "Appalachian American"] },
  "biome.plains": { why: "open country crossed by roads and caravans", accents: ["General American", "Midwestern American", "Texan"] },
  "biome.sunward_fields": { why: "farms, orchards and village cooperatives", accents: ["Midwestern American", "West Country English", "New Zealand"] },
  "biome.glacier_of_origins": { why: "a cold, remote and ancient glacier", accents: ["Scottish (Highland)", "Canadian"] },
  "biome.frostfang_peaks": { why: "high frozen mountains and griffin aeries", accents: ["Scottish (Highland)", "Pacific Northwest American", "Canadian"] },
  "biome.eastern_plains": { why: "wide open country and pride routes", accents: ["Australian", "Texan"] },
  "biome.mermaid_cove": { why: "a warm southern cove of coral reefs", accents: ["Australian", "Southern American"] },
  "biome.open_sea": { why: "sailors and the wide water", accents: ["Irish", "West Country English", "Scottish (Lowland)"] },
  "biome.sallow_wastelands": { why: "brackish mudflats where the river meets the sea", accents: ["Cockney (London)", "Southern American"] },
};

export interface AccentIdea {
  accent: Accent;
  /** Where on the map each idea came from, in the plain words above. */
  because: string[];
}

/**
 * Ideas for a character whose people live in these places, most-suggested first: an accent that suits two of their
 * places comes before one that suits one. Places the table has no idea for (the Expanse, say) add nothing.
 */
export function accentIdeas(biomeIds: readonly string[], titleOf: (biomeId: string) => string = (id) => id): AccentIdea[] {
  const found = new Map<string, string[]>();
  for (const biome of new Set(biomeIds)) {
    const idea = REGION_IDEAS[biome];
    if (!idea) continue;
    for (const label of idea.accents) found.set(label, [...(found.get(label) ?? []), `${titleOf(biome)}: ${idea.why}`]);
  }
  return [...found]
    .map(([label, because]) => ({ accent: ACCENTS.find((accent) => accent.label === label)!, because }))
    .sort((a, b) => b.because.length - a.because.length || ACCENT_LABELS.indexOf(a.accent.label) - ACCENT_LABELS.indexOf(b.accent.label));
}
