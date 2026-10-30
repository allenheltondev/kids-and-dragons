# Cast voice sheet

Every character in the game, the voice they speak with, and their own lines to hear it on. This
is the production cast the [voice narration plan](./voice-narration-plan.md) (§2) calls for. Its
voices are Gemini's, the provider the game is leaning toward, and a page can also be switched to
**ElevenLabs** to pick and audition voices from an account there (see
[ElevenLabs mode](#elevenlabs-mode)). Everyone speaks with an American
accent: the game is for American children.

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
| `lineCount` | how many lines the game gives them to speak: every quote the narration's speech tags give them, in every chapter, counted once per place it is said. The narrator's is every narration line, and the party's the "you say" lines. Refreshed on every rebuild. The pages sort by it |
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

- **The player, under their picture:**
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
  - their accent;
  - **your direction for the model**, in plain words ("a touch quicker than usual", "brighter,
    with a smile in it"). It goes after who they are, in `direction` on the sheet, and is kept on
    every rebuild. Leave it empty to remove it;
  - for the narrator and the party, **how they sound**. Their description lives on the sheet
    rather than in any chapter, so it is edited here. Everyone else's comes from their voice notes
    in canon, edited above;
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

## ElevenLabs mode

Both pages have a **Gemini | ElevenLabs** switch in the header, with that provider's own model list
and a key box (one key for each, pasted once, shared with the bake-off page). The mode is
remembered in the browser. In ElevenLabs mode everything on the page is about the ElevenLabs
voice, and nothing there touches the Gemini one:

- **Voices** come from the account, listed with the key (the picker says so if there is no key or
  no voices). A character's choice is saved as `elevenlabs` on the sheet, and **No voice yet** takes
  it back. A voice that has left the account is still listed, marked, so the picker never hides
  what is saved.
- **Nothing is chosen for you.** Gemini's voices come with traits that a builder can match to a
  character; an account's don't, so nobody has an ElevenLabs voice until you pick one. Until then
  they have nothing to render or approve, and their buttons say so.
- **Auditions** render with the mode's model (`eleven_v4` to start) in the voice you picked, and
  count against the same session cap. ElevenLabs is not told who they are or how they talk: it gets
  the voice and the words (with a delivery tag in front on v3 and later), so the description,
  accent and direction steer only Gemini. The profile page shows exactly what is sent.
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

## What's still rough

- **Lines are counted from the narration's speech tags**, so a quote nobody is tagged for is
  counted for nobody. On the first count, 1,211 lines were given to someone out of about 2,600
  quoted passages, so a character who talks a lot but is rarely tagged ("the clerk says") is
  counted low: 63 characters have a count of none, 52 of whom do speak. They audition on the stand-in until a chapter gives
  them words. Treat the order as a good guide to who speaks most, not an exact tally.
- **The voice genders and traits** are from Google's one-word descriptions and best knowledge,
  not a listening pass. The page is the listening pass.
- **ElevenLabs is on the sheet but not in production** (see above). The bake-off's own cast
  (`tools/voice/bakeoff/cast.json`) keeps its own ElevenLabs voices for comparison, separate from
  the ones picked on the cast pages.
