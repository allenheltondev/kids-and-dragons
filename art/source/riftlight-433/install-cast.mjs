/** Apply #433's art to #431's scene audit. Idempotent; never changes story graphs. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIR = path.join(ROOT, 'content/chapters');
const edit = (id, update) => {
  const file = path.join(DIR, `riftlight-${id}.json`);
  const chapter = JSON.parse(fs.readFileSync(file, 'utf8'));
  const before = JSON.stringify(chapter);
  update(chapter);
  for (const [id, scene] of Object.entries(chapter.scenes)) if ((scene.cast?.length ?? 0) > 3) throw new Error(`${chapter.id}/${id} exceeds cast cap`);
  if (JSON.stringify(chapter) !== before) fs.writeFileSync(file, JSON.stringify(chapter, null, 2) + '\n');
};
function swap(chapter, select, figure) {
  for (const scene of Object.values(chapter.scenes)) for (const member of scene.cast ?? []) {
    if (select(member)) { member.figure = figure; delete member.size; }
  }
}
function add(chapter, ids, figure, name, count) {
  for (const id of ids) {
    const scene = chapter.scenes[id];
    if (!scene || scene.type === 'encounter') throw new Error(`Invalid scene ${chapter.id}/${id}`);
    scene.cast ??= [];
    if (!scene.cast.some((member) => member.figure === figure && member.name === name)) scene.cast.push({ figure, ...(name ? { name } : {}), ...(count ? { count } : {}) });
  }
}
edit('stone-counters', (c) => swap(c, (m) => m.figure === 'characters/dragonling', 'cast/adult_dragonling'));
for (const id of ['whale-road', 'the-island-due-back']) edit(id, (c) => {
  swap(c, (m) => m.figure === 'cast/kitsune_temple_keeper' && m.name !== 'New keeper', 'cast/island_keeper');
  swap(c, (m) => m.name === 'New keeper', 'cast/new_island_keeper');
});
// Squall Temple explicitly introduces a different kitsune from the lookout.
// Keep her original gray-cloaked figure through both temple visits.
for (const id of ['squall-temple', 'sky-islands-arrival']) edit(id, (c) => {
  swap(c, (m) => m.name === 'Temple keeper', 'cast/kitsune_temple_keeper');
});
edit('reading-room', (c) => {
  swap(c, (m) => m.name === 'Younger keeper', 'cast/younger_keeper');
  swap(c, (m) => m.name === 'Newcomer', 'cast/newcomer_yeti');
});
edit('the-wrong-valley', (c) => swap(c, (m) => ['Route worker', 'Far worker'].includes(m.name), 'cast/route_worker_yeti'));
edit('cairnstep-pass', (c) => swap(c, (m) => m.name === 'Pass keeper', 'cast/pass_keeper'));
edit('frostfang-shore', (c) => swap(c, (m) => m.name === 'Ridge griffin', 'cast/ridge_griffin'));
edit('finale', (c) => {
  swap(c, (m) => m.name === 'Yeti watcher', 'cast/yeti_watcher');
  add(c, ['wyrm_plan'], 'cast/allied_wyrm', 'Frost wyrm');
  // Other epilogues already have three speakers. Do not silently hide a fourth.
  add(c, ['loss_epilogue'], 'cast/goat_kid');
});
edit('glacier-survival', (c) => {
  add(c, ['arrival', 'shelter', 'windbreak', 'rocks', 'mend', 'tracks', 'tell_rift', 'ask_help', 'channel', 'step', 'sledge', 'wing_line', 'song_step', 'dry_bank', 'wet_bank', 'herd', 'patient', 'sleeve', 'hum', 'drift', 'drift_probe', 'drift_detour', 'drift_slip'], 'cast/goat_kid', 'Goat kid');
  add(c, ['conservatory', 'conservatory_sing'], 'cast/frogfolk_student', 'Frogfolk student');
  add(c, ['listen', 'song_answer', 'learn_note', 'seam_response', 'seam_hum', 'seam_touch', 'seam_listen', 'changing', 'blankets'], 'cast/young_yeti_singer', 'Young yeti singer');
});
edit('wyrm-nest', (c) => add(c, ['readers', 'readers_1', 'readers_2', 'readers_check', 'readers_clear', 'readers_changed'], 'cast/memory_reader', 'Memory readers', 2));
edit('exchange-rift', (c) => {
  swap(c, (m) => m.name === 'Goat kid', 'cast/goat_kid');
  add(c, ['morning', 'gull', 'gull_help'], 'entities/quay_gull', 'Gull');
  add(c, ['clear_quay'], 'cast/dock_worker', 'Dock workers', 2);
  add(c, ['pull', 'catch', 'anchor', 'swoop', 'smash', 'brace', 'caught', 'together'], 'cast/dock_worker', 'Dock worker');
});
edit('ashspan-bridge', (c) => add(c, ['landing', 'plank', 'rope'], 'cast/boarding_traveler', 'Travelers', 2));
edit('saltrot-arrival', (c) => add(c, ['local', 'bag', 'path'], 'cast/boarding_traveler', 'Traveler'));
// Both variants place the fisher here, so a fixed cast is true for every party.
edit('stuttering-flats', (c) => add(c, ['next', 'next_1', 'next_2'], 'cast/passing_fisher', 'Passing fisher'));
