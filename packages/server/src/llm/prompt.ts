/**
 * The prompt, laid out for the cache — architecture §6.3.
 *
 * ---------------------------------------------------------------------------
 * THE GOTCHA THIS FILE IS SHAPED AROUND
 *
 * Claude's prompt cache is a **prefix match**, and the minimum cacheable prefix
 * on Haiku 4.5 is **4096 tokens**. Under that there is no error — caching
 * silently does nothing and full input price is paid on every call. §6.3 calls
 * it "the one real gotcha" and it is the reason this file exists at all rather
 * than the strings being built where they are used.
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS DEPARTS FROM §6.3, AND WHY
 *
 * §6.3 sketches three cache breakpoints:
 *
 *   system  [cached] : tone, vocabulary, forbidden topics, format, few-shots
 *   system  [cached] : the party                       ← changes ~once a session
 *   messages[cached] : chapter context + scene text    ← changes per scene
 *   messages         : the moment being narrated       ← changes every call
 *
 * Built and measured, two of those three do not survive contact with the floor:
 *
 * 1. **The first block does not reach 4096 tokens on its own.** Tone rules plus
 *    a generous set of few-shots comes to roughly 1300. A breakpoint there is
 *    not a smaller saving, it is *no* saving — under the minimum, marking a
 *    prefix does nothing at all. The unit test beside this file measures it, so
 *    the number is checked rather than assumed.
 * 2. **The party block cannot sit inside the cached prefix**, because it says
 *    who is hurt. §6.3 calls it "changes ~once a session", which is true of
 *    names and levels and false of hit points — and hit points are the half a
 *    narrator actually needs. A block that changes every fight, placed in front
 *    of the scene text, invalidates the scene text on every fight.
 *
 * So: **one breakpoint**, at the end of everything that is stable for a whole
 * session — the global writing rules and examples, the cast, this chapter's
 * tone, and this chapter's scenes as background. That comes to ~4.3k tokens,
 * clears the floor, and is written once and read on every call after. The
 * party, the scene and the moment sit behind it, uncached and small.
 *
 * The prefix is filled with **real context rather than padding**. Reaching a
 * token floor by writing more words is a trap: it would cost quality to buy a
 * discount. Everything in there earns its place — the cast blurbs are what a
 * unicorn songkeeper *is*, and the chapter background is what lets a line know
 * the party has been here before.
 *
 * ---------------------------------------------------------------------------
 * THE OTHER RULE
 *
 * **Nothing volatile may sit in front of something stable.** §6.3: never
 * interpolate a timestamp, UUID or request id into the prefix — it invalidates
 * everything behind it, silently, and the only evidence is the bill. There is
 * no clock and no id anywhere in this file, and `promptIsStable()` below is a
 * test hook that proves it rather than a comment claiming it.
 */

import type { Chapter, RulesContent, Scene, SceneId } from "@kad/shared";
import type { NarrationRequest, PartyBrief, RecapRequest } from "./port.ts";

/** Haiku 4.5's minimum cacheable prefix. Under this, caching silently no-ops. */
export const CACHE_FLOOR_TOKENS = 4096;

/**
 * Characters per token, for a *conservative* estimate.
 *
 * English prose runs about 4 characters to the token. Using 4 here means the
 * estimate is roughly true rather than optimistic, and the margin below is what
 * covers the error — the alternative, a divisor tuned until the current text
 * passes, would be a number that means nothing the next time the text changes.
 */
const CHARS_PER_TOKEN = 4;

/**
 * How far over the floor the first block must sit before the test is happy.
 *
 * 15%. The estimate is a heuristic and the floor is a cliff with no warning on
 * the other side of it, so landing at 4100 estimated tokens is not a pass — it
 * is a coin flip that pays full price when it loses.
 */
export const CACHE_MARGIN = 1.15;

export function estimateTokens(text: string): number {
  return Math.floor(text.length / CHARS_PER_TOKEN);
}

/**
 * The few-shot examples.
 *
 * They do two jobs and it is worth being honest that the second one is why
 * there are this many. The first is the real one: showing the register beats
 * describing it, and every rule in `validate.ts` is easier to learn from an
 * example that obeys it than from a sentence about it. The second is that this
 * block is the bulk of what gets the cached prefix over 4096 tokens, and a
 * prefix under the floor costs money on every call for the rest of the project.
 *
 * Both jobs want the same thing — more, varied, correct examples — which is the
 * only reason it is acceptable for one of them to be about token count.
 */
const EXAMPLES: { moment: string; good: string; bad: string; why: string }[] = [
  {
    moment: "The party squeezes through a gap in a thorn hedge. Pib the bramble sprite is watching.",
    good: "Pib winces as the last of you pops through. \"That gap is MINE,\" he says, then immediately offers you a leaf to sit on.",
    bad: "You squeeze through the gap. Roll a d20 to see if you get scratched.",
    why: "The bad one invents a mechanic. The game decides what is rolled, never the narration.",
  },
  {
    moment: "The party chose to knock on a small door instead of opening it.",
    good: "The door makes a tiny startled sound. \"Nobody knocks,\" it whispers, sounding thrilled and a bit embarrassed about being thrilled.",
    bad: "Say 'open sesame' out loud and see what happens!",
    why: "The bad one promises something the game cannot hear. She will try it, and nothing will happen.",
  },
  {
    moment: "A bramblewisp has just been knocked down in a fight.",
    good: "The bramblewisp sits down hard in the leaves and looks extremely put out about it. It is fine. It is just very annoyed.",
    bad: "The bramblewisp collapses, bleeding into the dirt, and does not get up again.",
    why: "Nothing dies here and nothing bleeds. A defeated thing is embarrassed, not destroyed.",
  },
  {
    moment: "The party rests at a camp after a long day.",
    good: "Somebody has arranged the packs into what is either a very small fort or a very large pillow. Nobody admits to it.",
    bad: "Here is a description of the camp: the party rests and recovers their strength.",
    why: "The bad one answers the request instead of doing the job, and says nothing that was not already known.",
  },
  {
    moment: "The party finds a shrine they have already visited once before.",
    good: "The shrine looks exactly as you left it, except the little stone fox has definitely turned to face the other way.",
    bad: "You arrive at the shrine for the first time, filled with wonder.",
    why: "Continuity. The flags say they have been here; a line that contradicts the run is worse than no line.",
  },
  {
    moment: "A check failed — the party did not manage to climb the wall quietly.",
    good: "The wall wins. Loudly. Somewhere above, a great many small birds decide all at once to be somewhere else.",
    bad: "You fail. Try again by going back to the previous scene.",
    why: "There is no going back and no retrying. A failure is a different road, not a punishment.",
  },
  {
    moment: "The party gives a found trinket to a nervous NPC.",
    good: "The sprite holds the acorn with both hands, the way you hold something breakable, and does not seem able to say anything at all.",
    bad: "The sprite thanks you. You gain 50 XP and the Generous badge!",
    why: "Rewards are the game's to announce, on its own screens, in its own numbers.",
  },
  {
    moment: "The party enters a clearing at dusk, having freed a trapped creature earlier.",
    good: "The clearing is doing that trick where the light goes gold and everything looks kinder than it is. Something small and recently-freed is following you, badly.",
    bad: "The clearing is a place of terrible dread, and you feel a cold hand close around your heart.",
    why: "A little spooky is the ceiling. Dread is over it, and there is nobody at the table to walk it back.",
  },
  {
    moment: "The party walks down an ordinary corridor. Nothing has happened. Nobody chose anything unusual.",
    good: "PASS",
    bad: "The corridor stretches onward, long and grey and full of quiet menace, as corridors so often are.",
    why: "Nothing happened, so there is nothing to add. PASS is a good answer and costs the table nothing — the authored line is already there.",
  },
  {
    moment: "A unicorn in the party walks through a thorn bush. Unicorns are never scratched by thorns.",
    good: "The brambles lean back out of Sparklehoof's way like a crowd letting someone important through. She does not appear to notice this happening.",
    bad: "Sparklehoof pushes through the thorns and takes 2 damage from the scratches.",
    why: "The species sheet says thorns lean away from a unicorn, and the game already decided about damage. Write what is true of *this* party.",
  },
  {
    moment: "Two players trade items at a rest scene — an acorn for a length of blue string.",
    good: "The trade is conducted with enormous seriousness, as though it were treaty business, and both of them are visibly delighted with what they got.",
    bad: "Windstep gives the acorn to Thistle and receives the blue string. The trade is complete.",
    why: "The bad one narrates the mechanic back. The screens already showed the trade; write the bit that was not on them.",
  },
  {
    moment: "A character has just reached a new tier and their appearance has changed.",
    good: "Thistle is taller. Nobody says anything about it, but everybody has noticed, and Thistle is trying very hard to seem normal about having a mane now.",
    bad: "Congratulations! Thistle has reached level 4 and unlocked a new ability. Well done!",
    why: "Levels, abilities and congratulations are the game's, on the game's screens. Yours is what it feels like at the table.",
  },
  {
    moment: "The party helps a knocked-down friend back up in the middle of a fight.",
    good: "Windstep hauls Thistle upright with a grunt that suggests Thistle is much heavier than Thistle looks. Thistle is deeply offended by the grunt.",
    bad: "You revive your fallen ally, restoring them to 1 hit point. They may act again next round.",
    why: "Nobody is fallen and nothing is revived — they got knocked over and a friend picked them up. Say that, and no numbers.",
  },
  {
    moment: "The party arrives at the shrine again, this time by the muddy road rather than the ridge.",
    good: "The muddy way in is much less impressive than the ridge was. The shrine seems to know, and to be enjoying it.",
    bad: "You arrive at the shrine, having taken the ridge path, and the view is magnificent.",
    why: "How they got here is the one thing the authored line could not know. Getting it wrong is worse than not mentioning it.",
  },
  {
    moment: "The chapter ends well. The party got through the hedge and out the other side.",
    good: "The hedge closes up behind you, sulking. Somewhere back in there, a very small door is telling everyone it knew you would make it.",
    bad: "You have completed the chapter! Final score: 100 XP. Would you like to continue to the next chapter?",
    why: "Never a menu, never a score, never a question. The game asks the questions; you write the last picture.",
  },
  {
    moment: "The chapter ends badly — the party never found the way through and had to turn back.",
    good: "You go home the long way, muddy and out of snacks, with a hedge behind you that is definitely going to be smug about this for a while.",
    bad: "You have failed. The quest is lost forever and the Bramblewood keeps its secret.",
    why: "Nothing is lost forever and nobody failed. A setback is a story with a shrug in it, not a punishment.",
  },
  {
    moment: "A quiet scene: an empty riverbank, nobody around, nothing to fight.",
    good: "The river is going about its business. A heron considers you at length, decides you are not interesting, and goes back to work.",
    bad: "The riverbank is peaceful and serene. You feel a sense of calm wash over you as you take in the beautiful scenery.",
    why: "One concrete thing beats three adjectives. Never tell them what they feel — that is theirs.",
  },
  {
    moment: "The party solves a puzzle after getting it wrong twice.",
    good: "It works. It works exactly the way it was going to work the first two times, which somebody is going to have to be gracious about.",
    bad: "Well done! You solved the puzzle on your third attempt. That's persistence!",
    why: "No praise from the narration. It is not a teacher; it is the world, and the world does not hand out marks.",
  },
  {
    moment: "The party gives up on a locked gate and goes around instead.",
    good: "The gate stays shut, pleased with itself. The way around is longer and involves a hill that nobody discusses.",
    bad: "You decide to go around. Perhaps you could come back later with the right key, if you find one?",
    why: "Never suggest what to do next. The choices are buttons on the phones, and inventing a fifth one is the cruellest thing you can do.",
  },
  /*
   * One per species, because "give each of the six species something only they
   * can do" is the spec's own rule and a species-gated choice is the shape of
   * scene the layer is worth the most on. A small model writes the generic
   * version of every ability unless it has been shown the specific one.
   */
  {
    moment: "A dragonling glides the party across a chasm nobody could have walked around.",
    good: "Two trips, because nobody trusted three at once. The second load spent the whole crossing pretending not to be looking down.",
    bad: "The dragonling flaps mightily and soars across the chasm, wings beating against the wind.",
    why: "The good one is about the party. The bad one is a stock dragon and could be any dragon in any book.",
  },
  {
    moment: "A griffin flies up to scout the road ahead and comes back down.",
    good: "Windstep lands, thinks about it, and says \"it's fine\" in the voice of somebody who has seen something and is choosing the order to say it in.",
    bad: "Windstep soars into the sky and sees three hazards and a treasure chest to the north.",
    why: "The game shows what scouting found, on its own screen. Yours is the landing and the pause before the answer.",
  },
  {
    moment: "A bigfoot carries a friend who cannot make the climb.",
    good: "Thistle picks Sparklehoof up like a bag of shopping. Sparklehoof maintains, throughout, that this was her idea.",
    bad: "Thistle uses Smash to carry Sparklehoof up the cliff, using their great strength.",
    why: "Never name the ability. The ability already happened; write the bag of shopping.",
  },
  {
    moment: "A kitsune talks a guard into letting the party past.",
    good: "Whatever was said took about nine seconds and the guard now seems to believe the whole thing was his suggestion. He waves. He is still waving.",
    bad: "The kitsune casts Beguile on the guard, charming him and allowing you to slip past unseen.",
    why: "The good one shows the aftermath, which is funnier and does not read like a spell list.",
  },
  {
    moment: "A manticore drops down from a high ledge to reach the party below.",
    good: "The landing is much louder than a landing needs to be, and is followed by a silence in which nobody says anything about it.",
    bad: "The manticore leaps down from the ledge, landing gracefully and unharmed thanks to their natural agility.",
    why: "\"Unharmed\" is the game's business. The silence afterwards is yours.",
  },
  {
    moment: "A bramblewisp turns out to be friendly and joins the party for a while.",
    good: "The bramblewisp attaches itself to the group with no discussion whatsoever, bobbing along behind Windstep and rhyming quietly about lunch.",
    bad: "The bramblewisp joins your party! It has 6 HP and will fight alongside you in the next encounter.",
    why: "The chapter decides who is in the party and what they can do. You get the rhyming and the lunch.",
  },
];

function renderExamples(): string {
  return EXAMPLES.map(
    (example, index) =>
      [
        `### Example ${String(index + 1)}`,
        `Moment: ${example.moment}`,
        `Good: ${example.good}`,
        `Bad: ${example.bad}`,
        `Why: ${example.why}`,
      ].join("\n"),
  ).join("\n\n");
}

/**
 * Block one — the rules and the examples. The most stable thing in the prompt
 * and the one that has to clear 4096 tokens by itself.
 *
 * Takes the chapter's `llmHints` because tone is authored per chapter, and
 * takes nothing else: a chapter is stable for a whole session, so this block is
 * written once and read from cache on every call after the first.
 */
export function toneBlock(chapter: Chapter): string {
  const hints = chapter.llmHints;
  return [
    "You write one line of flavour narration for Kids & Dragons — a tabletop-style adventure",
    "played by three people, two adults and an eight-year-old, on a television, with phones as",
    "controllers. Every line you write will be read aloud by a text-to-speech voice in a living",
    "room. Write for that room.",
    "",
    "## What you are adding, and what you are not",
    "",
    "The game already has an authored line for this moment, written by the person who wrote the",
    "chapter. It is good. It will be used if you produce nothing, and nothing is lost when that",
    "happens. Your job is the one thing the author could not write in advance: a reaction to how",
    "*this* party got *here*, this time.",
    "",
    "You are not the game. You do not decide anything:",
    "",
    "- **No mechanics.** You never call for a roll, name a number, award experience, deal damage,",
    "  grant or remove an item, or say whether something succeeded. The game has already decided",
    "  all of that and is showing it on its own screens.",
    "- **No choices.** You never offer options or suggest what to do next. The choices are",
    "  buttons, they are already on the phones, and inventing a fifth one that is not there is",
    "  the cruellest thing you can do to a player.",
    "- **No instructions to the room.** Nothing can be typed, spoken aloud, shaken, swiped, or",
    "  held down. There is no undo and no going back. If you tell an eight-year-old to say a",
    "  magic word out loud, she will say it, and the game will not hear her.",
    "",
    "## Tone",
    "",
    hints ? `- ${hints.tone}` : "- warm, playful, a little spooky but never scary",
    hints ? `- Vocabulary: ${hints.vocabulary}. Short sentences. Read every line aloud in your head first.` : "- Vocabulary: age-8. Short sentences.",
    "- Funny is better than grand. Specific is better than atmospheric. One concrete detail beats",
    "  three adjectives.",
    "- Nobody is ever in real danger, and nothing is ever lost for good. A defeated thing is",
    "  embarrassed. A failure is a different road.",
    "",
    hints && hints.forbidden.length > 0
      ? `**Never mention:** ${hints.forbidden.join(", ")}.`
      : "**Never mention:** death, blood, permanent loss.",
    "",
    ...(hints?.npcVoices && Object.keys(hints.npcVoices).length > 0
      ? [
          "## Voices in this chapter",
          "",
          ...Object.entries(hints.npcVoices).map(([id, voice]) => `- **${id}** — ${voice}`),
          "",
        ]
      : []),
    "## Format",
    "",
    "Reply with the narration and nothing else. No preamble, no quotation marks around the whole",
    "line, no JSON, no markdown, no explanation of what you wrote or why. One to three sentences,",
    `at most ${String(240)} characters. If you have nothing worth adding to the authored line,`,
    "reply with exactly: PASS",
    "",
    "## Examples",
    "",
    renderExamples(),
  ].join("\n");
}

/**
 * The cast — what a unicorn songkeeper actually is.
 *
 * The most stable thing in the whole prompt: it is the same for every chapter
 * and every session, so it goes in front of the per-chapter tone. And it is
 * genuinely the context a narrator is missing without it — "Gentle, stubborn,
 * and impossible to scratch. Thorns lean away when a unicorn walks by." is a
 * line that changes how a hedge scene gets written.
 *
 * Read off `content/rules.json` rather than restated here, for the reason
 * `balance.ts` reads its constants: a species blurb edited in content must not
 * need a matching edit in a prompt nobody remembers exists.
 */
export function castBlock(rules: RulesContent): string {
  const species = Object.values(rules.species);
  const classes = Object.values(rules.classes);
  return [
    "## Who the players can be",
    "",
    "The six species. Each one's own thing is the thing to write about:",
    "",
    ...species.map((each) =>
      [
        `- **${each.name}** — ${each.blurb}`,
        `  Out of a fight: ${each.worldAbility.name}. ${each.worldAbility.text}`,
        `  In a fight: ${each.combatAction.name}. ${each.combatAction.text}`,
      ].join("\n"),
    ),
    "",
    "The classes — what they do at the table, not what their numbers are:",
    "",
    ...classes.map((each) =>
      [
        `- **${each.name}** (${each.role}) — ${each.blurb}`,
        `  Signature move: ${each.signature.name}. ${each.signature.text}`,
      ].join("\n"),
    ),
  ].join("\n");
}

/**
 * This chapter's other scenes, as background.
 *
 * Continuity is the thing a per-call prompt cannot buy. A line that knows the
 * party has already been to the shrine, or that the hedge is what stands
 * between them and the door, reads like it was written by someone who had read
 * the chapter — because it was.
 *
 * Authored text only, never the branch targets or the effects. What the model
 * needs is the *world*; what it must not have is the machinery, because a
 * narrator that can see `goto` starts telling players where to go.
 */
export function chapterBackground(chapter: Chapter): string {
  const lines: string[] = [];
  for (const [sceneId, scene] of Object.entries(chapter.scenes)) {
    const authored = scene.type === "check" ? (scene.narration ?? scene.prompt) : (scene.narration ?? "");
    if (authored.trim().length === 0) continue;
    lines.push(`- **${sceneId}** (${scene.type}) — ${authored.replace(/\s+/g, " ").trim()}`);
  }
  return [
    "## The whole chapter, for continuity",
    "",
    "Every scene in this chapter and its authored line. This is background so that you know where",
    "the party has been and what is around them. **Never tell them what is coming** — a scene they",
    "have not reached is not something anybody in the room knows.",
    "",
    ...lines,
  ].join("\n");
}

/**
 * Everything stable for a session, as one cached block.
 *
 * The single cache breakpoint goes at the end of this. Order is most stable
 * first, so that a party who plays two chapters in one sitting still matches
 * the global half of the prefix across the change.
 */
export function cachedPrefix(rules: RulesContent, chapter: Chapter): string {
  return [toneBlock(chapter), "", castBlock(rules), "", chapterBackground(chapter)].join("\n");
}

/** Block two — the party. Changes about once a session. */
export function partyBlock(party: PartyBrief[]): string {
  if (party.length === 0) return "## The party\n\nNobody has made a character yet.";
  return [
    "## The party",
    "",
    ...party.map((member) => {
      const health =
        member.down
          ? "knocked down right now"
          : member.hp <= member.maxHp / 2
            ? `hurt (${String(member.hp)} of ${String(member.maxHp)})`
            : "fine";
      return `- **${member.name}** — a level ${String(member.level)} ${member.species} ${member.class}, ${health}`;
    }),
  ].join("\n");
}

/**
 * Block three — the chapter and the scene. Changes per scene, which is why it
 * is a message rather than a system block: it sits behind both cached system
 * blocks, so a new scene invalidates only itself.
 */
export function sceneBlock(chapter: Chapter, sceneId: SceneId, scene: Scene, flags: Record<string, boolean>): string {
  const set = Object.entries(flags)
    .filter(([, value]) => value)
    .map(([key]) => key);
  return [
    `## Chapter: ${chapter.title}`,
    "",
    `Biome: ${chapter.biome}.`,
    "",
    `## Where they are: ${sceneId} (${scene.type})`,
    "",
    "The authored line for this scene, which is what you are decorating:",
    "",
    scene.type === "check" ? (scene.narration ?? scene.prompt) : (scene.narration ?? "(none)"),
    "",
    ...(scene.type === "encounter"
      ? ["In this fight:", "", ...scene.enemies.map((e) => `- ${String(e.count)}× ${e.name ?? e.id}`), ""]
      : []),
    ...(set.length > 0 ? ["What has already happened in this run:", "", ...set.map((flag) => `- ${flag}`), ""] : []),
  ].join("\n");
}

/** Block four — the moment. The only part that changes every call. */
export function momentBlock(request: NarrationRequest): string {
  return request.via === null
    ? "They have just arrived here. Write the line."
    : `They got here by choosing: "${request.via}". Write the line.`;
}

/** The recap's one-off prompt. Not cached — it happens once, at the end. */
export function recapPrompt(request: RecapRequest): string {
  return [
    `They have just finished "${request.chapter.title}".`,
    "",
    partyBlock(request.party),
    "",
    `Scenes they went through, in order: ${request.visited.join(" → ")}`,
    ...(request.outcome ? ["", `How it ended: ${request.outcome}`] : []),
    ...(Object.keys(request.flags).filter((key) => request.flags[key]).length > 0
      ? ["", `Things they did: ${Object.keys(request.flags).filter((key) => request.flags[key]).join(", ")}`]
      : []),
    "",
    "Write the story of their session back to them, out loud, at the table — the way you would",
    "tell someone what happened in a film they were in. Name them. Pick the two or three moments",
    `that were actually the good bits. At most ${String(400)} characters. No preamble, no lists.`,
  ].join("\n");
}

/**
 * Whether a rendered block is safe to sit in front of the cache.
 *
 * A test hook for §6.3's "never interpolate a timestamp, UUID, or request id" —
 * the rule is easy to state, invisible when broken (a cache that silently never
 * hits), and one careless interpolation away at all times. So it is checked
 * rather than remembered: this looks for the shapes that would do it.
 */
export function promptIsStable(block: string): { stable: true } | { stable: false; found: string } {
  const volatile: [string, RegExp][] = [
    ["ISO timestamp", /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/],
    ["UUID", /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i],
    ["run id", /\br_[a-z0-9]{6,}/i],
    ["epoch millis", /\b1[6-9]\d{11}\b/],
  ];
  for (const [name, pattern] of volatile) {
    const hit = pattern.exec(block);
    if (hit) return { stable: false, found: `${name}: ${hit[0]}` };
  }
  return { stable: true };
}
