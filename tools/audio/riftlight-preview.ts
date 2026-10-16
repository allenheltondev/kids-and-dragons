/** Audit the composed bank and make a listening review from the shipped files. */
import fs from "node:fs";
import path from "node:path";
import { proceduralSounds, renderProcedural } from "../../packages/client/src/audio/procedural";

const destination = path.resolve(process.argv[2] ?? "art/review/riftlight-music");
const only = process.argv.slice(3);
fs.mkdirSync(destination, { recursive: true });
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const sounds = proceduralSounds().filter((sound) => only.length ? only.includes(sound.id) : sound.id.startsWith("riftlight-"));
if (!sounds.length) throw new Error("No matching Riftlight scores");
const cards: string[] = [];
const inventory = [];
for (const sound of sounds) {
  const pcm = renderProcedural(sound, 24000);
  let peak = 0, energy = 0;
  for (const channel of pcm) for (const value of channel) { peak = Math.max(peak, Math.abs(value)); energy += value * value; }
  const rms = Math.sqrt(energy / (pcm[0].length * 2));
  const seam = Math.max(...pcm.map((channel) => Math.abs(channel[0]! - channel.at(-1)!)));
  if (peak > 0.601 || rms < 0.001 || (sound.loop && seam > 0.025)) throw new Error(`${sound.id}: unsafe level or loop seam`);
  const file = `assets/audio/${sound.loop ? "music" : "cues"}/${sound.id}.webm`;
  const bytes = fs.statSync(file).size;
  const waveform = Array.from({ length: 480 }, (_, x) => {
    const start = Math.floor(x * pcm[0].length / 480), end = Math.floor((x + 1) * pcm[0].length / 480);
    let sum = 0;
    for (let i = start; i < end; i++) sum += pcm[0][i]! ** 2;
    const height = Math.min(38, Math.sqrt(sum / (end - start)) * 350);
    return `<path d="M${x * 2} ${45 - height}V${45 + height}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 90"><rect width="960" height="90" fill="#242724"/><g stroke="#e4adba" stroke-width="1.5">${waveform}</g></svg>`;
  fs.writeFileSync(path.join(destination, `${sound.id}.svg`), svg);
  inventory.push({ id: sound.id, seconds: sound.seconds, sampleRate: 24000, loop: sound.loop, bytes, peak, rms, seam, voices: sound.voices.length });
  cards.push(`<article><h2>${escape(sound.label)}</h2><p>${escape(sound.brief)}</p><img src="${sound.id}.svg" alt="RMS envelope across the whole track"><audio controls preload="none" ${sound.loop ? "loop" : ""} src="../../../${file}"></audio><p>${sound.seconds}s · ${(bytes / 1024).toFixed(0)} KiB · RMS ${rms.toFixed(3)} · seam ${seam.toFixed(5)}</p></article>`);
}
fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify({ motif: "D–F–A–G–E", source: "Deterministic procedural scores; no provider or recorded samples", sounds: inventory }, null, 2)+"\n");
fs.writeFileSync(path.join(destination, "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Riftlight music review</title><style>body{margin:0;background:#242724;color:#eee6d7;font:17px/1.5 system-ui}main{max-width:960px;margin:auto;padding:28px}h1{font:38px Georgia}article{border-top:1px solid #74766d;padding:20px 0}p{color:#d8d2c5}img,audio{width:100%}img{height:90px}audio{height:44px}</style><main><h1>Riftlight · listening review</h1><p>One five-note thread: D–F–A–G–E. Listen quietly, then compare the regional voices. Music repeats; playing one pauses the others.</p>${cards.join("")}</main><script>for(const player of document.querySelectorAll('audio'))player.addEventListener('play',()=>{for(const other of document.querySelectorAll('audio'))if(other!==player)other.pause()});</script></html>`);
console.log(JSON.stringify(inventory, null, 2));
