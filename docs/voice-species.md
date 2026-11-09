# Species casting for ElevenLabs

**Status: the accents are decided, the voices are being cast.** Everyone's accent now comes from where their people live ([Accents by region](#accents-by-region)), whatever was typed by hand, and only the narrator's voice is locked. `content/voice/casting.json` holds who shares which voice, and `npm run voice:library` does the casting ([Casting with the tool](#casting-with-the-tool)). The prompts below are for rows the library cannot fill; try them on the [cast pages](./voice-cast.md#elevenlabs-mode). Built from the sheet as it stood (202 speakers then, 206 now: the four new ones do not speak, 2,208 lines for characters, not counting the narrator's or the party's). The ElevenLabs behaviour described here comes from this repo's own notes and general knowledge, not a live call: [the test at the end](#try-this-first) is how to find out what holds.

## The short version

Designing 202 voices would be daunting and would not even help, because most characters speak a handful of lines. The speech is concentrated:

| Phase | Voices to design | Speakers served | Character lines | Running total |
|---|---:|---:|---:|---:|
| 0. The narrator | 1 | 2 (narrator, party) | 6,277 narrator and party lines | the game's main voice |
| A. Principals: their own voice | 14 | 21 | 1,263 | 57% |
| B. Species voices: shared, one per kind of sound | 15 | 85 | 600 | 84% |
| C. The long tail: shared, low stakes | 14 | 69 | 304 | 98% |
| Library or premade (merfolk, trees, animals, one unicorn) | 0 | 11 | 41 | 100% |
| No voice (they only bleat, sigh or nod) | 0 | 14 | 0 | |

That is **44 designed voices in three stopping points**: 14 principals carry 57% of what characters say, and the first 30 voices (narrator, A and B) cover 84%. You can stop after either phase and the rest keeps whatever voice it has today.

**Every character still gets their own sound** by layering three things, cheapest last:

1. **A voice made from a Voice Design prompt.** The principals each get one. Every species gets one or two, named `kad-<species>-<kind>` so the voice picker's search box finds them (search `kad-yeti`).
2. **A short tag per character**, in the sheet's existing `direction` field (80 characters or fewer, no brackets). On Eleven v3 and later the cast tool wraps it as `[slow, rumbling, kind]` in front of each of their lines. 57 are written below, and none overwrites a direction you already wrote.
3. **An accent**, in the sheet's `accent` field. You have already been doing this by hand for 34 characters, which is the same idea as this plan. Keep the *shared species* voices accent-neutral (General American) and put each character's accent in their `accent` field, so the two stack cleanly. The principals are the exception: their prompts bake in the accent you already chose, because the voice is theirs alone, so clear their `accent` field to avoid saying it twice.

## Accents by region

One accent per place, so a place is recognisable by ear. A people takes the accent of the first place canon gives them. It lives in `REGION_ACCENTS` in `tools/voice/cast/accents.ts`, so changing a place is one line, then `npm run voice:library -- accents --write`.

| Place | Accent | Who |
|---|---|---|
| Glacier of Origins | Alaskan Inuit English | yeti |
| Frostfang Peaks | Pacific Northwest American | griffins |
| Sky Islands | Californian American | kitsune |
| Red Sky Foothills | Appalachian American | dragonlings |
| The Plains | Texan | centaurs, sheeple |
| Eastern Plains | Southwestern American | manticores, stone trolls |
| Sunward Fields | Midwestern American | fauns, burrowfolk, harvest sprites |
| Whispering Marsh | Southern American | frogfolk, boggarts, witches |
| Enchanted Woods | New England American | unicorns, and bigfoot (MossHome is inside the Woods) |
| Sallow Wastelands | Cockney (London) | skupper |
| Mermaid Cove, Open Sea | Australian | merfolk, selkies |
| An order, not a place | New York American | Skywardens |

Whoever canon cannot place gets a varied American, the same one every time (`americanFor`). The narrator and the party take no accent. An accent is a tag in front of each line, so it steers a voice rather than replaces it; for Cockney and Australian the shortlist also looks for voices that have it natively.

## Casting with the tool

```bash
npm run voice:library -- slots
```

```bash
npm run voice:library -- shortlist
```

`shortlist` reads your account and the library, spends nothing, and writes `test-results/voice-shortlist/`: a page to hear each row's candidates, and `picks.json` with the first pick for every row. Change any on the page and save over that file, or keep them.

It asks the library for each search word on its own, since a whole phrase mostly finds nothing, and ranks what comes back: a point per word the voice's description shares, one for a voice made for stories or characters, one off for an ad or social voice, two off for the wrong age. Horror, ASMR and anything seductive never show. A voice already on your account counts only in the row's accent (George is British, so he never voices a Pacific Northwest griffin), and one that shares none of the row's words waits at the end as a free stand-in. Rows with most lines pick first and spend the free slots; after that a row takes a voice already on your account, and its accent and direction tags carry it. When those run out too, a row shares a voice another row already has, in an accent that voice does not speak yet (another accent is another sound, and it spends no slot). Listen to those shares: a voice that ignores its accent tag sounds like the row it borrowed from. A row left with nothing is designed on the cast page, which needs a slot.

```bash
npm run voice:library -- add --yes
```

```bash
npm run voice:library -- assign
```

```bash
npm run voice:library -- listen
```

`add` puts the library picks on your account, which uses voice slots; a voice two rows share takes one. When the picks need more slots than are free, `add --fit` keeps the library voices for the rows with most lines and moves each row past the slots to a free voice from its own shortlist (one on your account no row uses, or a kept voice in an accent it does not speak yet), and prints every move. It writes the trimmed picks only with `--yes`. `assign` gives each pick to everyone on its row, unapproved. `listen` renders one real line per speaker to `test-results/voice-listen/`, with no manifest and no bucket; `--row a,b` keeps it to those rows and `--per-row 1` to the speaker with most lines on each, for a handful of clips. When they sound right, `assign --approve` approves them: `voice:generate` renders only approved voices.

## How ElevenLabs lets you vary a voice

You asked whether to make a voice per species or reuse one existing voice with a different prompt per character. They are different tools, and the honest answer is a mix, because **a prompt on top of a fixed voice cannot change who the voice is.**

| Lever | What it really changes | Cost | Where it lives here |
|---|---|---|---|
| **Voice Design prompt** | Makes a *new voice*: age, gender, pitch, texture, accent, pace | One of your plan's custom-voice slots, plus a few cents of preview audio | **Design a new voice** in a character's voice picker |
| **Audio tag** in front of a line (v3 and later) | *Delivery*: pace, mood, breathiness, energy. It nudges timbre a little but will not turn a woman into a troll | Free | `direction` and `accent` on the sheet |
| **A premade or Library voice** | Whatever that voice already is | Premade is free. A Library voice you add uses a slot and has its own usage terms, so read them before shipping | The picker, and **Find more voices in the ElevenLabs library** |

That is why two characters of one species *in the same scene* are the risk. Tags make Hummock slow and Flurry nervous, but if they share a base voice a listener may still hear one yeti. So species with several characters in one chapter get two base voices (a deep one and a soft one). The worst case in your content is **six bigfoot in `gemfall-05b`**, then four yetis, dragonlings, centaurs and Skywardens together in other chapters.

Three conventions this plan follows because the repo already does:

- **Adult performers, never a child's voice.** `design.ts` ends every description with an adult-performer line, so young characters (Pip, Pebble, Nim, Posy) are *youthful-sounding adults*. Every prompt below ends with the same line.
- **No character names in prompts**, so the model cannot reach for a real person's voice. The prompts describe the sound.
- **Limits**: a description is 20 to 1,000 characters (these run 210 to 343) and the sample text is 100 to 1,000. Leave the page's prefilled sample text alone: it is the character's own lines.

## Who is what

Species comes from the **painted figure's `basis`** in `assets/manifest.json` (the art decision), then the cast notes where there is no figure. Two disagreements, both resolved by the notes: Tamsin (notes say kitsune, her figure is a griffin) and Tib (notes mention centaurs, he is burrowfolk).

| Species | Speakers | Speak | Lines | Voices that serve them |
|---|---:|---:|---:|---|
| griffin | 11 | 10 | 292 | `kad-griffin-fussy`, `kad-griffin-young`, `kad-orin`, `kad-skerry` |
| yeti | 13 | 12 | 252 | `kad-yeti-deep`, `kad-yeti-gentle`, `kad-yeti-herder` |
| kitsune | 6 | 6 | 230 | `kad-tamsin`, `kad-seren`, `kad-kitsune-keeper`, `kad-folk-man-warm`, `kad-juniper` |
| dragonling | 15 | 14 | 194 | `kad-dragonling-brisk`, `kad-dragonling-grandmother`, `kad-tally`, `kad-folk-man-warm` |
| manticore | 5 | 4 | 187 | `kad-manticore-elder`, `kad-pip` |
| skupper | 3 | 3 | 159 | `kad-puddle` |
| Skywardens (an order) | 11 | 9 | 158 | `kad-folk-man-dry`, `kad-pellam`, `kad-brask`, `kad-skywarden-captain` |
| frogfolk | 11 | 9 | 126 | `kad-ossley`, `kad-frogfolk-woman`, `kad-folk-man-warm` |
| centaur | 17 | 14 | 89 | `kad-centaur-unhurried`, `kad-centaur-brisk`, `kad-centaur-man` |
| unicorn | 3 | 3 | 79 | `(library or premade)`, `kad-olivia` |
| legend dragon | 1 | 1 | 78 | `kad-seal-keeper` |
| bigfoot | 11 | 10 | 69 | `kad-bigfoot-woman`, `kad-bigfoot-man` |
| faun | 15 | 7 | 68 | `kad-faun-woman`, `kad-faun-man` |
| selkie | 4 | 4 | 32 | `kad-selkie` |
| harvest sprite | 3 | 3 | 31 | `kad-sprite` |
| burrowfolk | 20 | 13 | 29 | `kad-burrowfolk-man`, `kad-burrowfolk-woman` |
| animals | 11 | 5 | 21 | `(no voice: sound effects)`, `(library or premade)` |
| witch order | 3 | 3 | 21 | `kad-witch` |
| stone troll | 3 | 3 | 18 | `kad-troll` |
| no species in canon | 12 | 8 | 17 | `kad-folk-woman-brisk`, `kad-folk-man-warm`, `kad-folk-man-dry` |
| boggart | 3 | 3 | 16 | `kad-boggart` |
| sheeple | 3 | 3 | 16 | `kad-sheeple` |
| wisp | 2 | 2 | 13 | `kad-wisp` |
| merfolk | 4 | 3 | 8 | `(library or premade)` |
| boughkin | 1 | 1 | 5 | `(library or premade)` |
| magic things | 2 | 0 | 0 | `kad-sprite`, `(no voice: sound effects)` |
| legendary creatures | 5 | 0 | 0 | `(no voice: sound effects)` |
| monsters | 2 | 0 | 0 | `(no voice: sound effects)` |

Notes on the odd rows. **Skywardens** are an order of knights, and canon never says what species they are (Pellam is drawn as a faun, the two cadets as griffins, a clerk as frogfolk), so they sound like the order: dry and exact, in four voices rather than by species. **No species in canon** are the twelve road folk, kids and tradespeople whom canon never places (Dilly, Alder, the cook). Canon says no human people exist, so they take the three generic folk voices.

## The voice bank

Each entry: the name to save the voice under, the prompt to paste, the character to open **Design a new voice** from (so the sample text is theirs), who will use it with their line counts, and what to type in the Library search if you would rather find one than make one. Every one of the 202 speakers on the sheet is assigned to exactly one place below (checked by script).

### Phase 0: the narrator

Do this first. The narrator is 6,214 lines, more than everyone else together, and is also the party's voice ("you say"). No ElevenLabs narrator is picked yet. Gemini's is Sulafat, and the sheet leaves the narrator's gender open, so audition a woman's and a man's candidate. Pick something that sounds unlike every principal below: the narrator must never be confusable with a character.

#### `kad-narrator` · any gender · open from **Narrator**

```text
A warm grown-up storyteller reading aloud to eight-year-olds. A rounded, gentle voice with an unhurried pace and a smile you can hear. Clear diction and an easy rhythm; playful on funny details, hushed and a little mysterious on the quiet bits, never scary. Intimate, like a bedtime story. General American.
```

Used by: Narrator 6214 · The party 63.

Library search instead: `warm storyteller audiobook children`.

### Phase A: the principals

Each of these gets a voice of their own, even when they have species-mates, because they are the characters children will remember. Where the sheet already has a person-written accent or direction, the prompt folds it in (Brask's German, Puddle's Slavic-tinged American, Ossley's Louisiana drawl, Orin's British). Edit any of them that were Gemini-era experiments.

#### `kad-pip` · a man's voice · open from **Pip Thistledown**

```text
A man's voice that sounds young and still settling, a light baritone that cracks upward on excited words, some words dropping low and others jumping high. Eager, earnest and quick, a little out of breath, proud when he gets something right, desperate to impress. General American. Adult performer, warm and clear, never scary.
```

Used by: Pip Thistledown 175 · Manticore Cubs 1.

Library search instead: `young male eager energetic`.

#### `kad-skerry` · a woman's voice · open from **Skerry**

```text
A woman's voice in her thirties, bright and carrying, mid-high pitch with a clear, slightly sharp edge on stressed words, like a bird call. Brisk and warm with a flair for the dramatic, projecting as if calling down from a height. Quick pace, big expressive swings, affectionate. General American. Adult performer, warm and clear, never scary.
```

Used by: Skerry 170.

Library search instead: `bright female dramatic confident`.

#### `kad-puddle` · a woman's voice · open from **Puddle**

```text
A young woman's voice, slightly nasal and clipped, with a Slavic-tinged American accent. Pensive and slow, then abruptly blunt: short sentences that stop dead, dry deadpan humor, sudden bursts of cheerfulness. Curious and matter-of-fact about everything strange. Adult performer, warm and clear, never scary.
```

Used by: Puddle 152 · Grandmother Winkle 5 · Dab 2.

Library search instead: `young woman deadpan slavic`.

#### `kad-yeti-herder` · a woman's voice · open from **Yeti herder**

```text
A woman's voice in her fifties, low and raspy, like warm gravel in a cold room. Slow, patient and unhurried, dry humor delivered perfectly flat, practical and quietly caring. Comfortable with silence, never rushed. General American. Adult performer, warm and clear, never scary.
```

Used by: Yeti herder 133.

Library search instead: `raspy older woman low`.

#### `kad-tally` · a woman's voice · open from **Tally**

```text
A woman's voice in her thirties, light and quick with crisp consonants and a precise bookkeeper's rhythm. Cheerful and exact, counting numbers aloud in a steady beat, speeding up and rising in pitch when upset. Brisk, proud of getting it right. General American. Adult performer, warm and clear, never scary.
```

Used by: Tally 46 · Tally 32.

Library search instead: `precise cheerful young woman`.

#### `kad-seal-keeper` · any gender · open from **Seal Keeper**

```text
A vast, very old voice, gender-neutral, deep and resonant with a dry, ashy texture. Slow, rolling cadence and long thoughtful pauses. Amused and patient, a teacher who already knows the answers and asks anyway, generous with praise. Gravelly warmth beneath, never growling or threatening. General American. Warm and clear, never scary.
```

Used by: Seal Keeper 78.

Library search instead: `ancient deep resonant wise`.

#### `kad-orin` · a man's voice · open from **Master Orin Vale**

```text
A man's voice in his sixties, a warm baritone with a dry, dusty texture and a gentle, educated British accent. Studious and curious, delighted by small discoveries, with a quiet sadness underneath. Measured pace that quickens when excited, kind and a little absent-minded. Adult performer, warm and clear, never scary.
```

Used by: Master Orin Vale 73 · Cloaked griffin.

Library search instead: `british professor warm older`.

#### `kad-juniper` · a woman's voice · open from **Keeper Juniper**

```text
A woman's voice in her forties, clear and bright with a musical lilt, mid-range pitch. Brisk, practical and warm, with a sing-song rise when she gives instructions, as if every task were a little song. Cheerful, confident, quick on her feet. General American. Adult performer, warm and clear, never scary.
```

Used by: Keeper Juniper 72.

Library search instead: `warm musical female cheerful`.

#### `kad-olivia` · a woman's voice · open from **Lady Olivia**

```text
A young woman's voice, bright and certain, with a crisp, confident edge and the quiet power of someone sure she is right, and real kindness underneath. Speeds up with excitement when imagining possibilities, softens and puzzles when she hears no. Clear mezzo, precise diction. General American. Adult performer, warm and clear, never scary.
```

Used by: Lady Olivia 71 · Cloaked unicorn 1.

Library search instead: `young confident female commanding`.

#### `kad-pellam` · a man's voice · open from **Pellam**

```text
A man's voice in his thirties, dry and precise, with a slightly nasal clerk's diction. Nervous and fast, clipped sentences, deadpan, like a pen scratching in a ledger, with a hidden flicker of delight whenever something is irregular but legal. General American. Adult performer, warm and clear, never scary.
```

Used by: Pellam 59.

Library search instead: `dry nervous clerk male`.

#### `kad-brask` · a man's voice · open from **Engineer Brask**

```text
A man's voice in his fifties, a gruff baritone with a strong German accent. Blunt and matter-of-fact, flat delivery of numbers and unwelcome news, pauses to work out arithmetic aloud. Honest and never unkind, with a dry warmth. Adult performer, warm and clear, never scary.
```

Used by: Engineer Brask 55.

Library search instead: `gruff german male`.

#### `kad-seren` · a woman's voice · open from **Seren Wisp**

```text
A woman's voice in her forties, soft and serene, a calm mid-low pitch. Slow, clear and steady, like a patient teacher who never raises her voice. Gentle, reassuring, with a trace of mystery, holding firm without hardness. General American. Adult performer, warm and clear, never scary.
```

Used by: Seren Wisp 53.

Library search instead: `calm teacher soft female`.

#### `kad-tamsin` · a woman's voice · open from **Tamsin Three-Cards**

```text
A young woman's voice, playful and quick, with a husky laugh never far from the surface. Upbeat and teasing, you can hear the smile, cheeky swoops in pitch, delighted rather than sore when caught out. Mid-range, a card-sharp's easy patter. General American. Adult performer, warm and clear, never scary.
```

Used by: Tamsin Three-Cards 44.

Library search instead: `playful husky young woman laughing`.

#### `kad-ossley` · a man's voice · open from **Old Ossley**

```text
An old man's voice, deep and croaky, with a slow Louisiana drawl. Very few words, long unhurried pauses, a low rumble like a bullfrog at dusk. Warm and wise, answers the question you meant rather than the one you asked, never rushed. Adult performer, warm and clear, never scary.
```

Used by: Old Ossley 40 · Old Wick 1.

Library search instead: `old man southern drawl deep`.

### Phase B: species voices

Shared by everyone of that kind and sound. Open each from the named anchor character, save the voice, then give it to the others with the picker's search box (`kad-yeti-deep`). Do not use **Use this voice for the other N of their people** here: it copies one voice to a whole species and these species have two.

#### `kad-griffin-young` · any gender · open from **Pebble**

```text
A light, youthful-sounding voice, any gender, bright with a slightly squawky sparkle on excited words. Eager and earnest, a little nervous, speeding up and rising when flustered, tumbling over words and then recovering with pride. Quick pace. General American. Adult performer, warm and clear, never scary.
```

Used by: Pebble 19 · Tumble 9 · Fenwick 4 · Corporal Tibbet 3 · Courier Griffin 2 · Cadet Linnet 1.

Library search instead: `young energetic bright nervous`.

#### `kad-griffin-fussy` · a woman's voice · open from **Tilly**

```text
A woman in her fifties, mid-high and flustered, fussy and warm and a little dramatic. Worried, counts things under her breath and loses count, squawks on sudden worries, then begins again. Kind underneath. General American. Adult performer, warm and clear, never scary.
```

Used by: Tilly 10 · Postmaster Quill 1.

Library search instead: `flustered middle-aged woman dramatic`.

#### `kad-yeti-deep` · a man's voice · open from **Hummock**

```text
A big, deep, slow man's voice, a rumbling bass-baritone with soft edges. A gentle giant: unhurried and kind, warm rounded vowels and long breaths, naming everything with fondness as if every rock were a friend. General American. Adult performer, warm and clear, never scary.
```

Used by: Hummock 32 · Yeti builders 14 · Fishmonger 2 · Young yeti singer 2 · Memory readers 1 · Orange Captain 1 · Grit seller.

Library search instead: `deep gentle giant bass`.

#### `kad-yeti-gentle` · a woman's voice · open from **Elder Murmur**

```text
A woman's soft, low, slightly breathy voice, slow and calm, hushed like someone speaking in a snow-quiet room. Kind and quietly funny, never hurried, with a little shyness. General American. Adult performer, warm and clear, never scary.
```

Used by: Flurry 28 · Elder Murmur 27 · Fish seller 5 · Grandma Drift 4 · Aunt Bellow 3.

Library search instead: `soft breathy low whisper woman`.

#### `kad-dragonling-brisk` · a woman's voice · open from **Bryn**

```text
A young woman's voice, light and quick with crisp consonants, chirpy and a little sassy and proud. Brave and earnest, fast pace with sudden pauses to think, sounds younger than she is. General American. Adult performer, warm and clear, never scary.
```

Used by: Bryn 14 · Bell Courier 8 · Nim 7 · Young Gatherer 6 · Bell-Code Expert 5 · Bryony 5 · Professor Nettle 3 · Small Dragonling 3 · Dragonling Runner.

Library search instead: `chirpy young woman sassy`.

#### `kad-dragonling-grandmother` · a woman's voice · open from **Grandmother**

```text
An elderly woman's voice, warm and slightly creaky, brisk and cozy. Doting and a little bossy, tender but unarguable; says nothing to worry about in a way that makes you worry. General American. Warm and clear, never scary.
```

Used by: Grandmother 32 · Great-Grandma Ashby 20 · Grandmother Tull 6.

Library search instead: `elderly grandmother warm cozy`.

#### `kad-kitsune-keeper` · a woman's voice · open from **Keeper Sorrel**

```text
A woman's voice in her thirties or forties, clear and calm, mid pitch with a light melody. Brisk, kind and unflappable, practical and a little amused, unbothered by wind or trouble. General American. Adult performer, warm and clear, never scary.
```

Used by: Keeper Sorrel 26 · Captain Thimble 12.

Library search instead: `calm brisk kind woman`.

#### `kad-centaur-brisk` · a woman's voice · open from **Relay Runner**

```text
A fast, plain-spoken woman's voice, mid pitch, slightly breathless like someone talking over her shoulder at a canter. Practical, fair and deadpan, says a lot by saying little. General American. Adult performer, warm and clear, never scary.
```

Used by: Relay Runner 12 · Brisk 6 · Road Boss 5 · Centaur drover 4 · Road-Warden 4 · Fennick Longstride 2 · Centaur Relay 1 · Tour Guide · Waystation Centaur.

Library search instead: `fast practical woman breathless`.

#### `kad-centaur-unhurried` · a woman's voice · open from **Hesper Longstride**

```text
A woman's voice in her fifties, calm, low and unhurried, stating distances and weather and trouble in the same even tone. Few words, listens to the whole answer, kind but busy, never repeats a warning. General American. Adult performer, warm and clear, never scary.
```

Used by: Caravan Master 9 · Hesper Longstride 9 · Marda Thorn 5.

Library search instead: `calm low woman measured`.

#### `kad-centaur-man` · a man's voice · open from **Rush drover**

```text
A man's voice, a strong, carrying baritone, a road-worn singer's chest voice. Warm, brash or weary depending on the day, big and open, the kind of voice that fills a camp. Plain-spoken and good-humored. General American. Adult performer, warm and clear, never scary.
```

Used by: Rush drover 14 · Bracken Swiftmile 10 · Old Corran 4 · Perrin Nine-Verse 4 · Kettle Campers.

Library search instead: `strong baritone male folk singer`.

#### `kad-bigfoot-man` · a man's voice · open from **Bram Lock**

```text
An old man's voice, large and slow, a calm deep bass with a gentle, shaggy texture. Quiet and observant, kind and proud of small things, long pauses, patient as moss. General American. Warm and clear, never scary.
```

Used by: Bram Lock 15 · Path Keeper 5 · Dob 2 · Oldest Archivist 2.

Library search instead: `old calm deep man kind`.

#### `kad-bigfoot-woman` · a woman's voice · open from **MossHome Runner**

```text
A woman's voice, low and large, brisk and a little fussy with a warm practical tone. Particular about details, then warm once she decides you matter. Slightly out of breath, mid-low pitch. General American. Adult performer, warm and clear, never scary.
```

Used by: Archivist 14 · MossHome Runner 14 · Flood Warden 5 · The Eldest 5 · Mosshome Runner 4 · Hollis 3 · Door Archivist.

Library search instead: `fussy warm practical woman`.

#### `kad-faun-woman` · a woman's voice · open from **Tansy**

```text
A woman's voice, warm and rhythmic, forever half-singing. Patient, cheerful and encouraging, turns any answer into a little tune or an anecdote. Mid pitch, musical lilt, open vowels. General American. Adult performer, warm and clear, never scary.
```

Used by: Tansy 27 · Tired carter 5 · Littlest Bracken 1 · Brackens · Egg Faun · Flute Faun · Mother Bracken.

Library search instead: `musical warm female encouraging`.

#### `kad-faun-man` · a man's voice · open from **Corvane**

```text
A man's voice, warm and rhythmic, a mid baritone half-singing as he talks. Cheerful, a bit shameless and charming, turns every answer into an anecdote and every price into a verse, and can slow into something courtly and old. General American. Adult performer, warm and clear, never scary.
```

Used by: Corvane 23 · Burdock 7 · Hob Thistledown 3 · Tobble Reedpipe 2 · Faun Claimant · Faun drover · Faun prospector · Rope-shop boy.

Library search instead: `warm baritone charming musical`.

#### `kad-frogfolk-woman` · a woman's voice · open from **Gullet**

```text
A woman's voice, unhurried and slightly husky, humming between sentences. Few words, long pauses that are not hesitation, quietly proud, never says the worrying thing out loud. Mid-low pitch, slow, with a dry marsh warmth. General American. Adult performer, warm and clear, never scary.
```

Used by: Dock worker 16 · Gullet 16 · Wend 10 · Fen 8 · Gullet's Cousins 7 · Dock workers 2 · Ferrier · Frogfolk student.

Library search instead: `husky slow woman humming`.

### Phase C: the long tail

Small peoples and generic folk, mostly under 20 lines each. For these a premade voice plus a tag is a fair shortcut if you would rather spend the slots elsewhere. For the single-voice peoples (sprite, troll, boggart, witch, sheeple, selkie, wisp) **Use this voice for the other N of their people** is the right button; it skips anyone who would clash in a chapter, so finish those by hand.

#### `kad-manticore-elder` · a woman's voice · open from **Sefa Tallgrass**

```text
An elderly woman's voice like warm gravel, formal and kind, low and slow, with the dignity of a pride elder. Quietly worried underneath; says the important thing once and stops. General American. Warm and clear, never scary.
```

Used by: Sefa Tallgrass 8 · Granny Ash 3 · Marker Movers.

Library search instead: `elderly woman gravelly formal`.

#### `kad-selkie` · a woman's voice · open from **Professor Marrow Tidewell**

```text
A woman's voice, easy and quick, mid pitch, switching register with the company, from scholarly to street-smart. Tells the truth in a way that sounds like a joke, talks fast when excited, smiling. General American. Adult performer, warm and clear, never scary.
```

Used by: Professor Marrow Tidewell 15 · Noodle seller 11 · Selkie Grandmother 3 · Soup Woman 3.

Library search instead: `quick expressive woman scholar`.

#### `kad-sprite` · any gender · open from **Hessa Wren**

```text
A tiny, earnest, high-pitched voice, any gender, a bright adult voice that sounds very small. Over-explains, offers things nobody asked for, hurt for about four seconds when refused and then offers something else. Quick, squeaky warmth. General American. Warm and clear, never scary.
```

Used by: Hessa Wren 22 · Pib 8 · Sprites 1 · Door Voice.

Library search instead: `tiny high-pitched earnest`.

#### `kad-witch` · a woman's voice · open from **Mother Thrum**

```text
A woman's voice in her sixties, dry and careful, mid-low, peering over her glasses. Instructive and patient, kind underneath; asks one question and means it. A little crackle. General American. Warm and clear, never scary.
```

Used by: Mother Thrum 9 · Mother Thrum 7 · Stall Witch 5.

Library search instead: `dry older woman witch`.

#### `kad-troll` · a man's voice · open from **Old Lintel**

```text
A very deep, very slow man's voice, a rumbling bass like stones settling. Immensely slow to begin and then complete, weighs each question out loud, final and gentle; mostly moss and patience. General American. Warm and clear, never scary.
```

Used by: Old Lintel 9 · Mortar 8 · Innkeeper Flint 1.

Library search instead: `very deep slow bass`.

#### `kad-boggart` · any gender · open from **Boggart**

```text
A sly, sidelong, delighted voice, any gender, mid pitch with a conspiratorial rasp. Never says anything straight, says it twice, trades in what it has overheard, giggling at secrets. General American. Adult performer, warm and clear, never scary.
```

Used by: Boggart 9 · Nana Rummage 6 · Boggart prospector 1.

Library search instead: `sly conspiratorial raspy`.

#### `kad-sheeple` · a woman's voice · open from **Lady Fleecewick**

```text
A warm, agreeable, gracious voice, mid-high, genteel and thrilled by everything, a little prim. Always checking in with the others, repeating the last good thing approvingly, with a soft bleat of a lilt. Never sore about losing. General American. Adult performer, warm and clear, never scary.
```

Used by: Lady Fleecewick 9 · Mrs. Tuft 5 · Sheeple 2.

Library search instead: `genteel gracious upbeat woman`.

#### `kad-burrowfolk-man` · a man's voice · open from **Dunmore**

```text
A man's voice, earthy and warm, mid-low, a gruff-cozy roll. Easily delighted, embarrassed, stubborn and polite, means well; practical and companionable. General American. Adult performer, warm and clear, never scary.
```

Used by: Dunmore 4 · Odo 4 · Burrowfolk prospector 2 · Rush prospector 2 · Brassbuckle recordkeeper 1 · Brassbuckles 1 · Muddy prospector 1 · Prospectors 1 · Travelers 1 · Brassbuckle scout · Burrowfolk Claimant · Cart Driver · Claim Pair · Feathered Hat · Hedge Prospectors · Tib.

Library search instead: `earthy warm male gruff cozy`.

#### `kad-burrowfolk-woman` · a woman's voice · open from **Ma Ruddle**

```text
A woman's voice, earthy and warm, mid pitch, plainspoken and companionable. Tired, blunt or brave depending on the day, and able to sound small and serious when asked. General American. Adult performer, warm and clear, never scary.
```

Used by: Corbin and Posy 5 · Ma Ruddle 3 · Masked choir singer 2 · Rook 2.

Library search instead: `earthy plainspoken woman`.

#### `kad-wisp` · any gender · open from **Flick**

```text
A tiny, squeaky voice, any gender, high and quick, boastful and bright, speaking in little bursts. A terrible loser for about two seconds, then delighted again; stutters or rhymes when excited. General American. Adult performer, warm and clear, never scary.
```

Used by: Flick 12 · Wisp 1.

Library search instead: `tiny squeaky boastful`.

#### `kad-skywarden-captain` · a woman's voice · open from **Captain Voss**

```text
A woman's voice in her forties, rigid and honest, low-mid, with a crisp military cadence. Never wastes a word, says acceptable losses as calmly as ordering lunch; stern with a thread of fairness. General American. Adult performer, warm and clear, never scary.
```

Used by: Captain Voss 18 · Apprentice 3 · Captain 3 · Flag Warden 2.

Library search instead: `stern fair woman commander`.

#### `kad-folk-man-dry` · a man's voice · open from **Sergeant Holloway**

```text
A man's voice, dry and flat, mid pitch, precise and tired. Rigid and honest, counts everything, stamps things; deadpan with tiny hints of feeling. General American. Adult performer, warm and clear, never scary.
```

Used by: Sergeant Holloway 10 · Skywardens 6 · Clerk Pennywhistle 4 · Master Dunnick 4 · Warden Clerk 2 · Warden Engineers · Warden Sergeant.

Library search instead: `dry flat deadpan male`.

#### `kad-folk-man-warm` · a man's voice · open from **Barge pilot**

```text
A man's voice, warm and expressive, mid baritone, friendly and a little fussy. Chatty and kind, brave when it counts, talks to animals and barges; easy to like. General American. Adult performer, warm and clear, never scary.
```

Used by: Barge pilot 26 · Keeper Clove 23 · Farmer Gourd 7 · Alder 1 · Red Scarves 1 · Sausage Seller 1 · Map Seller · Parsnip Driver · Rumor Ring · Wagon Driver.

Library search instead: `warm friendly male expressive`.

#### `kad-folk-woman-brisk` · a woman's voice · open from **Troupe Leader**

```text
A woman's voice, brisk and expressive, mid pitch, grand or dramatic when she wants to be. Practical and quick, talks in bursts, warm and a little theatrical. General American. Adult performer, warm and clear, never scary.
```

Used by: Troupe Leader 4 · Cook 1 · Dilly 1.

Library search instead: `theatrical brisk woman`.

### Library or premade, no design

Too few lines to spend a slot on. Pick a premade voice and lean on the tag.

The gull 8 · Elder Unicorn 7 · Madame Coralie Fenn 6 · Beech Tree 5 · Goat kid 5 · The crows 5 · Mustard 2 · Ducklings 1 · Lighthouse Keeper 1 · Madame Coralie Fenn 1 · Crying gem-buyer.

| Who | Look for |
|---|---|
| Madame Coralie Fenn, the Lighthouse Keeper, the gem-buyer (merfolk; Coralie is on the sheet twice, see below) | a grand, theatrical older woman with a Transatlantic lilt. Your current accent, "Cruella DeVille", names a film character, so swap it for "Transatlantic" |
| Elder Unicorn | a calm older woman, few words, gentle authority |
| Beech Tree | an old, whispery, slow voice, breath in it |
| The gull | nasal, deadpan, put-upon |
| The crows | a gruff caw; consider a sound effect instead of a voice |
| Goat kid, Mustard, the ducklings | small, squeaky, comic |

### No voice

Bones · Bun (silent) · Cart donkey (silent) · Carter's mule (silent) · Cloud whale (silent) · Drake (silent) · Dumpling · Echo Hunter (silent) · Frost wyrm (silent) · Mire Mimic (silent) · Road mule (silent) · Tib's pony (silent) · Titan · Young river drake (silent).

None has a spoken line on the sheet: they huff, bleat, sigh and nod. Those sounds belong to the sound-effect pipeline rather than this one.

## One tag per character

Paste into **your direction for the model** on the profile page. They are delivery words, not personality essays: that is what a tag can actually do. All are valid for the code (80 characters or fewer, no brackets), and none overwrites a direction already on the sheet.

| Speaker | Voice | Direction |
|---|---|---|
| The gull (`the_gull`) | premade | indignant, literal, chilly |
| The crows (`the_crows`) | premade | curt, cawing together |
| Goat kid (`goat_kid`) | premade | squeaky, bleating |
| MossHome Runner (`runner`) | `kad-bigfoot-woman` | cheerful, breathless, jogging while talking |
| The Eldest (`eldest`) | `kad-bigfoot-woman` | mild, unhurried, sips tea between sentences |
| Path Keeper (`path_keeper`) | `kad-bigfoot-man` | slow, kind, proud of his visitors' book |
| Boggart (`boggart`) | `kad-boggart` | sidelong, delighted, says everything twice |
| Nana Rummage (`nan_rummage`) | `kad-boggart` | dreamy, talks sideways to lost things |
| Beech Tree (`beech_tree`) | premade | old, slow, whispering |
| Relay Runner (`relay_runner`) | `kad-centaur-brisk` | fast, plain, practical, out of breath |
| Hesper Longstride (`hesper`) | `kad-centaur-unhurried` | few words, listens to the whole answer, kind but busy |
| Caravan Master (`caravan_master`) | `kad-centaur-unhurried` | exhausted, practical, flat |
| Brisk (`brisk`) | `kad-centaur-brisk` | fast-talking, fair, deadpan |
| Marda Thorn (`marda`) | `kad-centaur-unhurried` | unhurried, warm, asks one question and waits |
| Road Boss (`road_boss`) | `kad-centaur-brisk` | gruff, puffing, good-humored |
| Tally (`tally`) | `kad-tally` | brisk, exact, counts aloud, faster when upset |
| Grandmother (`grandmother`) | `kad-dragonling-grandmother` | cozy, brisk, doting, counts everything |
| Great-Grandma Ashby (`great_gran_ashby`) | `kad-dragonling-grandmother` | very old, brisk, tender, unarguable |
| Nim (`nim`) | `kad-dragonling-brisk` | quick, proud, a little sassy |
| Farmer Gourd (`farmer_gourd`) | `kad-folk-man-warm` | cheerful, hurried, round and breathless |
| Young Gatherer (`young_gatherer`) | `kad-dragonling-brisk` | small, brave, insists she is not lost |
| Tansy (`tansy`) | `kad-faun-woman` | patient, cheerful, encouraging |
| Corvane (`corvane`) | `kad-faun-man` | courtly, old, confused, patient, sad |
| Old Ossley (`old_ossley`) | `kad-ossley` | very few words, long unhurried pauses |
| Gullet (`gullet`) | `kad-frogfolk-woman` | unhurried, hums between sentences, proud |
| Dock worker (`dock_worker`) | `kad-frogfolk-woman` | practical, short dockside speech |
| Fen (`fen`) | `kad-frogfolk-woman` | brisk, practical |
| Skerry (`skerry`) | `kad-skerry` | brisk, warm, a little dramatic, calling from above |
| Pebble (`pebble`) | `kad-griffin-young` | small, nervous, quick, a little squeaky |
| Tilly (`tilly`) | `kad-griffin-fussy` | worried, dramatic, counts and loses count |
| Tumble (`tumble`) | `kad-griffin-young` | fast, cheerful, breathless |
| Pib (`pib`) | `kad-sprite` | earnest, over-explaining, hurt when refused |
| Keeper Juniper (`keeper_juniper`) | `kad-juniper` | brisk, warm, sing-song when giving instructions |
| Seren Wisp (`seren_wisp`) | `kad-seren` | gentle, patient, teacherly |
| Keeper Sorrel (`keeper_sorrel`) | `kad-kitsune-keeper` | brisk, kind, unflappable |
| Keeper Clove (`keeper_clove`) | `kad-folk-man-warm` | fussy, kind, brave when it counts |
| Seal Keeper (`seal_keeper`) | `kad-seal-keeper` | ancient, unhurried, dry, amused |
| Pip Thistledown (`pip_thistledown`) | `kad-pip` | eager, quick, voice cracks when excited |
| Sefa Tallgrass (`sefa_tallgrass`) | `kad-manticore-elder` | warm gravel, formal, kind, quietly worried |
| Granny Ash (`granny_ash`) | `kad-manticore-elder` | bossy, delighted, grandmotherly |
| Madame Coralie Fenn (`coralie_fenn`) | premade | grand, theatrical, calls everyone darlings |
| Professor Marrow Tidewell (`tidewell`) | `kad-selkie` | fast, excited, thinking out loud |
| Noodle seller (`noodle_seller`) | `kad-selkie` | brisk, generous, talks to her pot |
| Lady Fleecewick (`lady_fleecewick`) | `kad-sheeple` | gracious, thrilled, never sore about losing |
| Mrs. Tuft (`mrs_tuft`) | `kad-sheeple` | brisk, a little prim, everything in jars |
| Captain Voss (`voss`) | `kad-skywarden-captain` | rigid, honest, never wastes a word |
| Old Lintel (`old_lintel`) | `kad-troll` | very slow, hears everything, mossy and calm |
| Mortar (`mortar`) | `kad-troll` | one slow turn before every answer, few words |
| Flick (`flick`) | `kad-wisp` | tiny, squeaky, boastful, a sore loser for two seconds |
| Mother Thrum (`ford_witch`) | `kad-witch` | dry, careful, kind underneath |
| Mother Thrum (`mother_thrum`) | `kad-witch` | dry, careful, kind underneath |
| Stall Witch (`stall_witch`) | `kad-witch` | brisk, patient, a warm sales smile |
| Hummock (`route_worker_yeti`) | `kad-yeti-deep` | slow, rumbling, kind, a gentle giant |
| Flurry (`flurry`) | `kad-yeti-gentle` | quick, nervous, kind, soft |
| Elder Murmur (`elder_murmur`) | `kad-yeti-gentle` | whispering, very slow, very old, gentle |
| Yeti builders (`yeti_builders`) | `kad-yeti-deep` | slow, deep, gentle, a crew speaking together |
| Fish seller (`fish_seller`) | `kad-yeti-gentle` | practical, short, protective |

## Existing entries that will misfire on ElevenLabs

I ran your 34 existing accent and direction entries through the real `elevenTags` function for Eleven v3. Most are fine. These come out wrong, because the code appends the word "accent" to anything in the `accent` field and does not length-check it (a direction is capped at 80 characters, an accent is not):

| Speaker | Now renders as | Suggested |
|---|---|---|
| Pip | `[pubescent, voice cracking, some deep \ some higher pitched words, but confident accent]` (and a stray backslash) | accent: empty. direction: `voice cracking, some words deep and some high, but confident` |
| Yeti herder | `[raspy, low, slow and patient accent]` | accent: empty. direction: `raspy, low, slow and patient` |
| Pellam | `[nervous, fast talker accent]` | accent: empty. direction: `nervous, fast talker` |
| Orin Vale | `[studious, british accent. very curious accent]` | accent: `British`. direction: `studious, very curious` |
| Hessa Wren | `[childish pronunciations, has a obvious lisp accent]` | accent: empty. direction: `bright, high-pitched, straining to talk, childish pronunciation, a lisp` |
| Wisp | `[american child accent]` | accent: empty. direction: `small, high pitched, stuttering` |
| Burdock | `[So heavy Scottish that you can barely understand accent]` | accent: `Heavy Scottish` |
| Madame Fenn (merchant entry) | `[Cruella DeVille accent]` | accent: `Transatlantic`. direction: `grand, theatrical, dramatic` |
| Sergeant Holloway | `[autistic, speaks slightly fast and hard stop at sentences]` | A tag is read as a delivery instruction, and a diagnosis is not one. Describe the delivery: `flat, precise, slightly fast, hard stops at the end of sentences` |

Their Gemini behaviour is unaffected: Gemini is told these in a sentence, where the mix-up reads fine. The fix is only to split each into the right field.

## Doing it on the cast page

1. `npm run voice:bakeoff -- --serve`, open `/cast/profile`, switch to **ElevenLabs**, paste the key.
2. Open the **anchor** named in an entry. In the voice picker choose **Design a new voice for …**.
3. Replace the prefilled description with the prompt. Leave the sample text. **Hear 3 candidates**, pick one, and **name it exactly as headed** (`kad-yeti-deep`). Saving puts it on your account and gives it to the anchor, unapproved.
4. For everyone else on that voice, open their profile, search the picker for `kad-yeti`, and pick it. Paste their tag into **your direction**.
5. Listen to one line each. **Accept and next** when it is right.

Cost: Voice Design bills the sample text once however many candidates come back. At the repo's estimate of $0.10 per thousand characters, all 44 designs come to **well under $5** (the design rate is not in `pricing.json`, so treat that as an estimate). The real limit is slots: plans cap custom voices, and if I remember the tiers right Creator is about 30 and Pro about 160, so **check yours**. The narrator plus phases A and B is exactly 30.

### Try this first

Before designing phase B, spend ten minutes finding out how far tags alone go. Design only `kad-yeti-deep` and `kad-yeti-gentle`, then render a line each for Hummock, Flurry, Elder Murmur and the yeti builders with their tags from the table. If four yetis in one scene already sound like four people, you can skip most of phase B's second voices and keep one per species, which halves the work. If they blur, the second voices are worth it. Do the same for the six bigfoot in `gemfall-05b`, your hardest case.

## Things this does not solve, and things I noticed

- **The one-voice-per-chapter rule fights species voices.** The sheet refuses two speakers on one voice in a chapter, and **Use this voice for the other N of their people** skips anyone who would break it ([voice-cast.md](./voice-cast.md#profiles-one-at-a-time-castprofile) reports it voicing only 4 of 14 yetis). With shared species voices the red clash warnings will fire for many of the phase B voices. In ElevenLabs mode the check should compare voice *and* tag, not voice alone. I have not changed it.
- **`voice:generate` now renders with ElevenLabs** (changed 2026-11-05; see [voice-cast.md](./voice-cast.md#elevenlabs-mode)). Whoever has no ElevenLabs voice yet is read by the device voice, so designing the narrator first matters. Whole-game cost on Eleven v4 is estimated at about $113 (v4 Turbo about $57), against about $30 on Gemini 3.8: render one campaign at a time under the $75 cap.
- **Two people are on the sheet twice with different approved voices.** Madame Coralie Fenn (`coralie_fenn`, `exchange_merchant`) and Captain Voss (`voss`, `captain`). Tally and Mother Thrum are also doubled, but each pair already shares a voice. This plan puts each person on one voice either way.
- **Accents.** [voice-cast.md](./voice-cast.md#accents-and-where-their-people-live) says only regional accents of English are offered, never another language's English, because that drifts into caricature. Several current entries are of that second kind (Strong German, Jamaican, Italian New York, Transylvanian, Slavic American, Heavy Creole). Your call; I am flagging it because it cuts against that rule.
- **Art mismatch:** Tamsin Three-Cards is a kitsune in the notes and the art brief, but her `tamsin_river_keeper` figure is a griffin.
- **Gender-open voices** (`any`) are for creatures whose sheet gender is unknown: sprites, wisps, boggarts, young griffins and the Seal-Keeper. Audition a woman's and a man's candidate.
