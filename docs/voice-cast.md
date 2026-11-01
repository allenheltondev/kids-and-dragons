# Cast voice sheet

Every character in the game, the voice they speak with, and their own lines to hear it on. This
is the production cast the [voice narration plan](./voice-narration-plan.md) (§2) calls for. Its
voices are Gemini's, the provider the game is leaning toward, and a page can also be switched to
**ElevenLabs** to pick and audition voices from an account there (see
[ElevenLabs mode](#elevenlabs-mode)). Everyone starts with an American accent,
because the game is for American children, but nobody has to keep it: each character can have their own, and the
profile page suggests some (see [Accents](#accents-and-where-their-people-live)).

```
npm run voice:cast                  # build or refresh content/voice/cast.json from the content
npm run voice:bakeoff -- --serve    # then open http://127.0.0.1:5199/cast/profile
```

Two pages show the sheet:

- **`/cast/profile`:** one character at a time, to review the cast start to finish.
- **`/cast`:** every card at once, to search and filter.

## The sheet: `content/voice/cast.json`

One entry per speaker, keyed by id:

| Field | What it holds |
|---|---|
| `name`, `aliases` | what the content calls them ("Madame Coralie Fenn", also "Madame Fenn") |
| `kind` | `narrator`, `party`, `character`, `group` (a flock, a crew) or `creature` |
| `who` | how they sound, from the chapter's `voiceGuide.npcVoices` and canon's `speech_register` |
| `pronouns` | canon's, or the ones the narration's own speech tags use for them ("…," she says) |
| `gender`, `genderFrom` | `female`, `male`, `nonbinary` or `unknown`, and where that came from: `canon`, `narration` (the speech tags), `notes` (words like "grandmother"), `person` (set on the profile page) or `none`. Nonbinary and unknown can take either a woman's or a man's voice |
| `figure` | the figure the scenes draw them with (`cast/coralie_fenn`, or `entities/faun` for someone drawn as any faun) |
| `canon` | their canon individual (`individual.pib`), when canon has them |
| `voiceNotes` | which chapters' `voiceGuide.npcVoices` describe them, and under which key |
| `chapters` | every chapter they appear in, so one person keeps one voice across the game |
| `gemini.voice` | one of Gemini's 30 prebuilt voices |
| `elevenlabs` | the voice they have on ElevenLabs, picked by ear on the cast pages: `voiceId`, its `name`, and `approved` once a person approved it. Absent until picked. Kept on every rebuild |
| `accent` | set only to override the sheet-wide `accent` (General American) |
| `direction` | a person's direction for the voice model, told after who they are ("a touch quicker than usual") |
| `lines` | up to three real quotes of theirs from the narration, each with its address: the lines to audition a voice on, never a count |
| `lineCount` | how many lines the game gives them to speak: every quote the narration's speech tags give them, in every chapter, counted once per place it is said, plus the guesses below. The narrator's is every narration line, and the party's the "you say" lines. Refreshed on every rebuild. The pages sort by it |
| `guessedLines` | how many of `lineCount` are a guess: a quote nobody is tagged for, in a scene where this is the only character who could be speaking. Absent when none. Never used to audition on |
| `speaks` | false for those who only bleat or sigh |
| `status` | `provisional` (assigned by the builder) or `approved` (chosen by a person) |
| `history` | every approval and rejection, oldest first: the voice, the listener's notes, the model it was heard on, and when |

## How it's built

`npm run voice:cast` (`tools/voice/cast/build.ts`, logic in `sheet.ts`) reads:

- every chapter's `voiceGuide.npcVoices`, keyed by id in most chapters and by display name in
  Riftlight's;
- every scene's `cast`;
- `canon/individuals.yaml`.

It merges the same person across chapters:

- a cast name joins the chapter's voice note it names ("Professor Tidewell" joins `tidewell`);
- titles are dropped ("Master Orin Vale" is "Orin Vale");
- a shorter proper name joins a fuller one within a campaign ("Madame Fenn" joins Coralie Fenn).
  A generic name ("Wisp") is never merged that way, so Riftlight's Seren Wisp stays her own
  person.

**Lines** are quotes a speech tag gives to someone:

- a name in the tag ("…," says Pib);
- a pronoun tag, after the character was named ("…," he croaks);
- a quote that follows on from one of theirs.

"You say" is the party's. A role word ("the captain") counts only in a chapter where it picks
out one speaker. A quote split by a mid-sentence tag is joined back into one line.

**Voices** are assigned by score:

- the character's likely gender, from pronouns and words in the notes;
- what the notes ask for: young or small, old, big, soft, bright.

Each voice is matched against Google's word for it (`sheet.ts` → `GEMINI_VOICE_TRAITS`; the
genders there are as best known, so check them by ear). Recurring characters are placed first.

**Rules:**

- Two speakers never share a voice in any chapter.
- Nobody else gets the narrator's voice (Sulafat), since the narrator is in every chapter.
- A rebuild never moves a voice. A person's decisions (status, voice, a gender they set, accent,
  direction, notes, history) carry over, and everything the content says is refreshed for
  everyone. Run it again after writing a chapter, and only the new people are placed.

`npm run voice:cast -- --check` reports without writing, and exits 1 if any chapter has two
speakers on one voice.

The first build: 207 speakers, 127 with lines from the game, no voice clashes.

## Profiles, one at a time: `/cast/profile`

It opens on the first character still waiting, in the order the sheet is best reviewed in: the
narrator, the party, then whoever has the most lines to speak (`lineCount`), then the most
chapters, so the characters that matter most are reviewed first. The header keeps count:
**37 left** of 207, with a progress bar.

Each profile has:

- **The player, under their picture,** which stays on screen while the panels beside it scroll,
  so you can edit a field, press Play and watch their face without scrolling back up. On a short
  screen the picture shrinks first, and the panel scrolls inside itself if it still doesn't fit:
  - their voice;
  - the line it's on, with **‹ ›** to change lines;
  - one big **Play** button (**Render and play** the first time a line is heard in this voice);
  - a progress bar;
  - **Play all**, to hear every line in turn;
  - **New take**, to render the same words again. Gemini has no seed, so each take reads a little
    differently. It's one more call, up to five takes, and **back to take N** returns to an
    earlier one.

  **When anything changes what is sent** (the voice, accent, direction, or the narrator's
  description), the button turns back into **Render and play**, with a note that this line hasn't
  been heard in these words yet. One click renders the new version and plays it. The old clips
  stay cached, so changing back is free.

  The lines further down share the same player.
- **Their picture:** the figure the scenes draw them with, from `assets/`. The empty margin is
  trimmed, so a teapot-sized sprite fills the frame. Someone drawn as any faun or centaur says so,
  and someone with no painting gets their initial.
- **About them:**
  - their **gender**, with where it came from;
  - pronouns, their people, height, home and role (from canon and the art manifest);
  - **where their people live**, numbered, with the realm's map beside it and each place marked
    on it (see [Accents](#accents-and-where-their-people-live));
  - how they look (the art brief, `docs/briefs/story-cast-art.md`);
  - other names, whether they speak, and their chapters.

  Changing the gender saves it as yours. If the current voice no longer fits (a man's voice for
  someone now marked female), they move to the best voice that does, unless the voice was
  approved. **use the content's** hands the gender back to the content.
- **Voice notes in canon:** every chapter's voice note for them, and for canon individuals the
  fields of `canon/individuals.yaml` (who they are, how they look, how they talk, pronouns).
  **Edit** any of them and **Save to canon**:
  - the edit is written to that file, changing that one value and nothing else in it;
  - the sheet is rebuilt, so the voice model hears the new words, and every decision is kept;
  - a Gemfall chapter is marked pinned. `gemfall-compat.test.ts` hashes Gemfall's files, so a
    commit with an edit there must re-take those hashes and say why (its header says how).
- **Voice and model:**
  - the voice, with a warning if it doesn't match their gender, and any clash in a chapter;
  - their **accent**, with ideas to try;
  - **your direction for the model**, in plain words ("a touch quicker than usual", "brighter,
    with a smile in it"). It goes after who they are, in `direction` on the sheet, and is kept on
    every rebuild. Leave it empty to remove it;
  - for the narrator and the party, **how they sound**. Their description lives on the sheet
    rather than in any chapter, so it is edited here. Everyone else's comes from their voice notes
    in canon, edited above.

  Accent, direction and how they sound are plain fields, saved as you leave them, with no Edit
  button and no second step. (The voice notes in canon above stay two-step on purpose: they
  write to a canon file.) The line you were on is marked as not yet heard in the new words, ready
  for one click;
  - **Use this voice for the other N of their people** (the others who are one of the same kind, a yeti or a
    griffin, from canon or the kind they are drawn as). It asks first, naming who would get the voice and who
    would be left and why, and only then does it. It keeps to the sheet's rule: nobody is put on a voice
    they would share a chapter with someone on, or on the narrator's, and nobody with a voice you approved is
    moved, nor anyone with an ElevenLabs voice you picked, approved or not (only Gemini's builder-assigned
    voices may be replaced). Everyone it gives the voice to is still unapproved, so each is yours to hear. On the real cast it
    gives a voice to a third or so of a people (4 of 14 yetis, 9 of 15 griffins), because members of a people
    so often share chapters;
  - **what the model is told** besides the words: the exact Gemini 3.8 style, or the Gemini 3.1
    prompt, for the model picked in the header.
- **Hear them:** every audition line in full, each with its own **Play**, and where it comes
  from. **Say it** has them say anything you type (up to 400
  characters, Cmd/Ctrl+Enter). Everything is cached like any other line, so it costs once.
- **The decision bar**, always on screen:
  - **Accept and next** approves the voice (with the note, if any) and moves straight on to the
    next character still waiting.
  - **Reject, try another voice** needs a note, as on the cards page, and stays on the character
    with their new voice.
  - **Skip** moves on without deciding.

Keys, when you're not typing: **A** accept and next, **J** or **→** skip, **K** or **←** back,
**P** or **space** play or stop the line, **[** and **]** change lines. **Jump to…** finds anyone by name. **only those still
waiting** makes Prev and Skip pass over approved characters. **play the first line on arrival**
plays each character as they open. Each line is rendered once, at a fraction of a cent.

## Every card: `/cast`

Served by the bake-off server, so it uses the same Gemini key (pasted once on any of the pages), the
same clip cache and the same session spending cap.

- **One card per speaker:** who they are, their chapters, their voice (with Google's word for it
  and whether it reads as a woman's or a man's), how many others share it, and a link to their
  profile.
- **Auditions:** **Render** and **Play** each audition line. A speaker with no line in the game
  yet gets a stand-in line, marked as such. Someone who doesn't speak gets none.
- **Clash warnings:** a red line names anyone who shares this voice in a chapter.
- **Voice picker:** saves to the sheet straight away, and the auditions need rendering again in
  the new voice. Switching back is free, because the old clips stay cached.
- **Approve and Reject:** see the next section.
- **Accent override** saves to the sheet too.
- **Lines to speak:** each card says how many lines the game gives them (`lineCount`), and the
  page sorts by it, **Most spoken lines first** by default, with the narrator and the party always
  at the top. That is the order to give voices attention in: the first few dozen characters carry
  most of the speech.
- **Filters:** search, campaign, still provisional, approved, rejected and waiting to be heard
  again, not reviewed yet, sharing a voice, no line yet, and doesn't speak.
- **Gemini | ElevenLabs:** the switch in the header, see the next section.
- **Render all shown** renders every audition the filters show, three at a time. Rendering the
  whole cast on Gemini 3.8 Flash is about $0.42.

Gemini's style for each line is the character's name and notes, then
`Accent: General American, …`, then the line's delivery if it has one
([voice-bakeoff.md](./voice-bakeoff.md#expression-delivery-and-beats)).

## Accents and where their people live

The sheet's accent is General American, and a character's own **accent** replaces it in what
Gemini is told. The accent box suggests as you type (it is a list of regional accents of English:
American regions, British and Irish, Canadian, Australian and New Zealand), and the same list is on
the cards page.

On a profile, **Their people live** lists the places canon gives their people and marks each on the
realm's map. It comes from canon:

- a people's own homeland (`relationships.primary_locations` in `canon/npcs.yaml`), plus any
  biome that names them under `inhabitants` in `canon/biomes.yaml`, which is also how the six
  playable species are placed;
- for someone with no people on the map, the place canon says is their home, shown as **Lives**;
- nothing for someone with neither (the narrator, the party, anyone canon doesn't place).

A place is shown by its canon name, with the map's own label when it differs ("The Sallow
Wastelands", which the map calls "The Bone Yard"). A homeland is where a people is most often found,
not a border, as canon itself says.

Under the accent box, **Ideas from where their people live** are a few accents that might suit those
places, each with its reason on hover ("Sunward Fields: farms, orchards and village cooperatives").
One click tries it, and a click on the one in use puts the sheet's own accent back. They are guesses
to hear and judge, kept in `tools/voice/cast/accents.ts` (`REGION_IDEAS`), where you can change
them; a test checks that every place named there is a real biome in canon. Only regional accents of
English are offered, never another language's English, which too easily becomes a caricature.
Gemini is told the accent in words. ElevenLabs has no style prompt, so only v3 and later get it, as a tag in front of each line (see [ElevenLabs mode](#elevenlabs-mode)).

## ElevenLabs mode

Both pages have a **Gemini | ElevenLabs** switch in the header, with that provider's own model list
and a key box (one key for each, pasted once, shared with the bake-off page). The mode is
remembered in the browser. In ElevenLabs mode everything on the page is about the ElevenLabs
voice, and nothing there touches the Gemini one:

- **Voices** come from the account, listed with the key (the picker says so if there is no key or
  no voices). An account can have hundreds, so the picker has a **search** box that narrows the
  list as you type: every word must appear in a voice's name or what ElevenLabs says about it
  (premade or cloned, accent, gender, age, what it is for), so `american female narration` finds
  those voices, and "30 of 120" says how many are left. The voice a character already has always
  stays in the list. **Preview** plays the highlighted voice's own sample, which is free, so you
  can sift by ear before paying for an audition on the character's real lines. (Each card's list
  is only built when you reach for it: a page of 200 cards would otherwise carry 25,000 options.)
  A **gender filter** (any, women, men) beside the search uses ElevenLabs' own gender label; a
  voice with none shows only under "any". The list is the account's own voices, which for a new account is a couple of
  dozen (the premade ones). **Find more voices in the ElevenLabs library** in the header searches the public Voice Library
  (thousands of voices; searching changes nothing, and each has a free sample). **Add to my account** puts one on your
  account after a confirmation, since that changes the account and may use one of your plan's voice slots; it then
  appears in every picker. A character's choice is saved as `elevenlabs` on the sheet, and **No voice yet** takes
  it back. A voice that has left the account is still listed, marked, so the picker never hides
  what is saved.
- **Designing a voice** is an option on every character's voice picker, for when nothing in the account or the library
  fits: **Design a new voice for Pib** opens a description and a sample text, prefilled from the sheet. The description
  is who they are (their notes, with their name taken out: a name the model might take for a real person is a way to
  get a voice that sounds like one), a man's or a woman's voice, the direction you gave, their accent, and a line asking
  for an adult storyteller's voice that is warm, clear and never scary. The sample text is their own lines from the game
  (topped up with the stand-in line when they have under 100 characters of them). Edit either, then **Hear 3 candidates**:
  ElevenLabs makes three voices from the description and each says the text. That step spends: it is priced and held
  to the session's cap like an audition (the cost is shown first, and a design that fails is not charged). **Use this
  voice** names it, asks, and saves it to the ElevenLabs account (it may use one of the plan's voice slots) and gives
  it to the character, unapproved. Nothing changes the account until that click. Design runs on ElevenLabs' own design model (`eleven_ttv_v3`), not a speech model, and bills the sample text once however many candidates come back. `pricing.json` has no design rate, so the cap's price is an estimate: the text priced once as `eleven_v3` speech (itself an unconfirmed rate there). It is asked for again whenever the text is edited, shown beside the button, and sent with the request: if the words changed, the server answers with the new price instead of spending on the old one. Editing either box also takes the candidates away, so a voice is only ever saved under the description it was made from. Check what a design really costs on your account. ElevenLabs takes a description of 20 to 1,000
  characters and a sample text of 100 to 1,000.
- **Nothing is chosen for you.** Gemini's voices come with traits that a builder can match to a
  character; an account's don't, so nobody has an ElevenLabs voice until you pick one. Until then
  they have nothing to render or approve, and their buttons say so.
- **Auditions** render with the mode's model (`eleven_v4` to start) in the voice you picked, and
  count against the same session cap. ElevenLabs has no style prompt, so it is not told who they are
  or how they talk. It gets the voice and the words, with tags in front on v3 and later: their own accent (the sheet's
  default is the voice's own, so it is not a tag) as `[Scottish Highland accent]`, and a direction of 80 characters or
  fewer as `[the direction]`, then the line's delivery tag. A longer direction is left out rather than risk it being
  read aloud, and older models (v2 and before) take neither: pick a voice that already sounds right. The description
  steers only Gemini.
- **Coverage** is in the cards page's header line: "30% of 1,430 lines covered" is the share of the game's spoken lines (not the narrator's or the party's) that belong to a character approved in the mode you are in.
- **Approve** pins that voice on its own (`elevenlabs.approved`), and Gemini's approval is
  unchanged. **Reject** records the voice and your note and takes the choice back, so you can pick
  another; a voice you rejected for a character is left out of their picker.
- **History and clash warnings** are per mode: a decision with no `provider` is a Gemini one, and
  two characters on one ElevenLabs voice in a chapter are warned about only in ElevenLabs mode.
  The review export still lists Gemini's decisions.

**What this doesn't do yet:** `voice:generate`, `voice:status` and `voice:verify` still render
and key every clip with Gemini's voice. The sheet now holds both, so switching production to
ElevenLabs is a change to what the generator reads, not to the sheet.

## Approving and rejecting

Each card has a notes box and two buttons.

- **Approve** pins the voice, so no rebuild ever moves it. The note (why it works) is optional.
- **Reject, try another voice** needs a note saying what's wrong. It records the voice and the
  note in the character's `history` and moves them straight to the next best voice, so you can
  render and listen again at once.

  The note steers that pick. Plain words are read:

  | The note says | The next voice |
  |---|---|
  | "younger", "too old" | younger, smaller |
  | "older", "too young" | older, mature |
  | "deeper", "too thin" | bigger, more gravelly |
  | "lighter", "too deep" | smaller, brighter |
  | "softer", "too harsh" | soft, gentle |
  | "brighter", "too flat" | brighter, upbeat |
  | "calmer", "too excited" | even, easy-going |
  | "warmer", "too cold" | warm, friendly |
  | "firmer", "too timid" | firm |
  | "a woman's voice", "a man's voice" | that gender |

  A voice a character was rejected in is never offered to them again, and voices still never
  clash within a chapter. That can mean the closest fit is taken: rejecting a voice as "should be
  more gravelly" gets the most gravelly voice free in that character's chapters.
- **Approved: reopen** takes an approval back, so the voice can be changed.

Rebuilds keep every decision. An approved entry is untouched, and a provisional one keeps its
history, so a rejected voice stays rejected.

## The review: something to take away

**Download review (Markdown)** and **(JSON)** in the page header, or from the command line:

```
npm run voice:cast -- --review                      # Markdown to the terminal
npm run voice:cast -- --review --out review.md
npm run voice:cast -- --review --out review.json
```

- **The Markdown** is for people:
  - counts of approved, rejected and waiting, not reviewed, and voice clashes;
  - a table of approved voices with their notes and what was turned down first;
  - each rejection with its voice, note, model and date;
  - **voices rejected most**: one turned down for several characters may be the wrong fit for
    this game, not just for them;
  - who hasn't been heard yet.
- **The JSON** has the same summary plus every speaker's status, voice and full decision
  history, for a script or an agent to act on.

Both are reports of the sheet. `content/voice/cast.json`, committed with its history, stays the
source of truth.

## One person, two names

A person the scenes call "Elder Sefa" and the chapter's voice notes call "Sefa Tallgrass" is one entry, with the other name as an alias and the figure kept. A title (Elder, Old, Captain, Lady…) is not part of who someone is when the cast name is matched to a voice note, so it needs no rename in the content. Two people who share a title ("Captain Voss", "Captain Thimble") stay two: only the part of the name after a leading title has to match, only a title at the front comes off ("Sefa Mother" is not "Sefa"), and it must fit exactly one voice note (two notes for different Sefas leave "Elder Sefa" her own entry rather than guessing). If two entries on the sheet are one person and a title does not explain it, the fix is in `collectCharacters` (tools/voice/cast/sheet.ts), not by hand in the sheet, which a rebuild rewrites.

## Tagging lines

`npm run voice:untagged` lists the quotes nobody is tagged for (only the ones that read as something said), by
chapter, so a writer can add the tag in the chapter: `-- --chapter gemfall-06` for one chapter with the scene's cast
and the words either side, `-- --who skupper_cousin` for the scenes a character is in, `-- --silent` for scenes with a
speaker who has no counted lines yet, `-- --missing` for the quotes counted for nobody at all (the rest are counted as guesses for the one speaker in their scene). It reports and never edits. Tag a quote by name or by the role the scene
gives them (`says the oldest archivist`), not with "he" or "she" after a sentence that names two people: a pronoun
goes to whoever was named last. Adding a tag changes the words, so do it before a chapter is recorded. The same attributor cuts the script sidecars (`npm run voice:script`, [voice-narration-plan.md §3](./voice-narration-plan.md#drafting-scripts)): a quote nobody is tagged for stays with the narrator there and is listed as needing a person, so a tag added here is also a quote voiced in its speaker's voice. After a quote that ends its sentence, "Tansy says a real fight works like tag" is reported speech, what Tansy says next, and not a tag for the quote before it; "Tansy says." and an action beat ("Tansy offers a huge price") still are.

## What's still rough

- **Lines are counted from speech tags, plus a guess.** A quote is given to whoever it is tagged for ("…," says
  Pib), by name or by what they are in that scene ("says a cousin", "the keeper asks": the last word of their name, where
  nobody else in the scene shares it), and a named character the campaign knows is tagged in a chapter they are not cast in ("asks Voss" in a chapter that only casts the Skywardens), but only by their name as written: "Wisp", never the noun in "a wisp line", and never a name the chapter also uses as a plain word. A group ("Gullet's Cousins") is not given a he or she from the narration, and a trait the narration once gave someone is kept when a rebuild moves a quote to somebody else. A "she says" or "he says" with nobody named is the one she (or he) in the scene, when the sheet knows exactly one, and a quote that says who is speaking ("I'm Orin Vale") names its own speaker. A title that begins a name counts in its scene ("the elder" for the Elder Unicorn), and a tree is the kind it is ("the beech"), but the first word of a name is never "the", a description ("Small", "Red"), a thing ("Door Archivist" is not "the door") or any word the prose also writes in lower case at least twice ("a soup line" is not the Soup Woman; "Soup Woman" and her alias still are). A given name like Tobble or Pellam never appears in lower case, so it still works alone. A hyphen is a space in a name ("Seal-Keeper"). Of about 2,600 quoted passages, about 1,400 are tagged. So where a scene has
  only one character who could be speaking, the quotes nobody is tagged for are counted for them as a **guess**,
  shown apart ("52 lines, 4 guessed"). A guess skips what is not a sentence someone said (a fragment, a sign,
  something sold, the party's own "you say") and any quote with someone else named beside it. On the real cast
  that is about 117 lines, and on a read of 26 of them (before the last guard was added) about
  four in five were right. A crowded scene's untagged quotes are still counted for nobody, so someone who talks a lot among
  others is counted low, and 36 characters who speak still have none. They audition on the stand-in until
  a chapter gives them words. Treat the order as a good guide to who speaks most, not an exact tally.
- **The voice genders and traits** are from Google's one-word descriptions and best knowledge,
  not a listening pass. The page is the listening pass.
- **ElevenLabs is on the sheet but not in production** (see above). The bake-off's own cast
  (`tools/voice/bakeoff/cast.json`) keeps its own ElevenLabs voices for comparison, separate from
  the ones picked on the cast pages.
