# Cast voice sheet

Every character in the game, the voice they speak with, and their own lines to hear it on. This
is the production cast the [voice narration plan](./voice-narration-plan.md) (§2) calls for. Its
voices are Gemini's, the provider the game is leaning toward. Everyone speaks with an American
accent: the game is for American children.

```
npm run voice:cast                  # build or refresh content/voice/cast.json from the content
npm run voice:bakeoff -- --serve    # then open http://127.0.0.1:5199/cast
```

## The sheet: `content/voice/cast.json`

One entry per speaker, keyed by id:

| Field | What it holds |
|---|---|
| `name`, `aliases` | what the content calls them ("Madame Coralie Fenn", also "Madame Fenn") |
| `kind` | `narrator`, `party`, `character`, `group` (a flock, a crew) or `creature` |
| `who` | how they sound, from the chapter's `voiceGuide.npcVoices` and canon's `speech_register` |
| `pronouns` | canon's, or the ones the narration's own speech tags use for them ("…," she says) |
| `chapters` | every chapter they appear in, so one person keeps one voice across the game |
| `gemini.voice` | one of Gemini's 30 prebuilt voices |
| `accent` | set only to override the sheet-wide `accent` (General American) |
| `lines` | up to three real quotes of theirs from the narration, each with its address |
| `speaks` | false for those who only bleat or sigh |
| `status` | `provisional` (assigned by the builder) or `approved` (chosen by a person) |
| `notes` | anything a listener wants to remember |

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
- A rebuild never moves a voice: an approved entry is left exactly as it was, and a provisional
  one keeps its voice while its chapters and lines are refreshed. Run it again after writing a
  chapter, and only the new people are placed.

`npm run voice:cast -- --check` reports without writing, and exits 1 if any chapter has two
speakers on one voice.

The first build: 207 speakers, 127 with lines from the game, no voice clashes.

## The cast page: `/cast`

Served by the bake-off server, so it uses the same Gemini key (pasted once on either page), the
same clip cache and the same session spending cap.

- **One card per speaker:** who they are, their chapters, their voice (with Google's word for it
  and whether it reads as a woman's or a man's), and how many others share it.
- **Auditions:** **Render** and **Play** each audition line. A speaker with no line in the game
  yet gets a stand-in line, marked as such. Someone who doesn't speak gets none.
- **Clash warnings:** a red line names anyone who shares this voice in a chapter.
- **Voice picker:** saves to the sheet straight away, and the auditions need rendering again in
  the new voice. Switching back is free, because the old clips stay cached.
- **Approve this voice:** pins it, so no rebuild will ever move it.
- **Accent override and notes** save to the sheet too.
- **Filters:** search, campaign, still provisional, approved, sharing a voice, no line yet, and
  doesn't speak.
- **Render all shown** renders every audition the filters show, three at a time. Rendering the
  whole cast on Gemini 3.8 Flash is about $0.42.

Gemini's style for each line is the character's name and notes, then
`Accent: General American, …`, then the line's delivery if it has one
([voice-bakeoff.md](./voice-bakeoff.md#expression-delivery-and-beats)).

## What's still rough

- **69 speakers have no line found** in the game. Some really have none, and some are spoken for
  in a way the attribution misses ("the clerk says"). They audition on the stand-in until a
  chapter gives them words.
- **The voice genders and traits** are from Google's one-word descriptions and best knowledge,
  not a listening pass. The page is the listening pass.
- **ElevenLabs isn't on the sheet yet.** The bake-off's own cast (`tools/voice/bakeoff/cast.json`)
  keeps ElevenLabs voices for comparison, now all American premade voices.
