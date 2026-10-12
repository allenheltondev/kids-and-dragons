# Home, creation and lobby audio

The app shell owns one audio engine across home, creation and play. Music starts after a pointer or keyboard gesture; the existing persisted mute control remains available. Party controllers disable their engine after joining, leaving the shared display as the room speaker. Travel mode keeps its engine across both panes.

`entry-home` is a 36-second acoustic arrangement in a lilting six-beat rhythm, with soft plucks, hand percussion and sparse flute phrases. All five local creation steps share this track without restarting it. `entry-lobby` is a quieter 40-second fireside bed with slow strings, reed answers and outdoor air folded into the loop. Waiting and ready scenes share it. Both tracks crossfade into quest music.

Raw character-selection buttons use the approved tiny tap effect; regular buttons already play it. Typing stays silent. Successful character submission plays the approved choice confirmation. `party-ready` plays a short wooden-string and hand drum response only when a nonempty party transitions to everyone ready, never on initial attachment to an already-ready room.

Source arrangements and levels live in `packages/client/src/audio/procedural.ts`; briefs and paths live in `paths.ts`. Export only these assets with `npm run audio:install -- --only=entry-home,entry-lobby,party-ready`. Assets are stereo Opus/WebM. Existing approved quest assets are preserved.
