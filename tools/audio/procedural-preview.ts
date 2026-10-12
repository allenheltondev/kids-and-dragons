/** Render the review bank to WAV and build a standalone listening page. No API or encoder required. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { proceduralSounds, renderProcedural } from "../../packages/client/src/audio/procedural";

export function wav(channels: [Float32Array, Float32Array], sampleRate: number): Buffer {
  const length = channels[0].length;
  const data = Buffer.alloc(44 + length * 4);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * 4, 28);
  data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write("data", 36);
  data.writeUInt32LE(length * 4, 40);
  for (let i = 0; i < length; i++) for (let ch = 0; ch < 2; ch++) {
    const value = Math.max(-1, Math.min(1, channels[ch]![i]!));
    data.writeInt16LE(Math.round(value * (value < 0 ? 32768 : 32767)), 44 + i * 4 + ch * 2);
  }
  return data;
}

const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buildPreview(destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  const sounds = proceduralSounds();
  const sampleRate = 24000;
  const revision = Number(path.basename(destination).match(/-v(\d+)$/)?.[1] ?? 1);
  const previousLink = revision > 1 ? `<p><a href="../gemfall-audio/index.html">Compare with the first drafts</a></p>` : "";
  const inventory = sounds.map((sound) => {
    const pcm = renderProcedural(sound, sampleRate);
    let peak = 0, squares = 0;
    for (const channel of pcm) for (const value of channel) { peak = Math.max(peak, Math.abs(value)); squares += value * value; }
    const rms = Math.sqrt(squares / (pcm[0].length * 2));
    const boundaryStep = Math.max(...pcm.map((c) => Math.abs(c[0]! - c[c.length - 1]!)));
    if (!Number.isFinite(peak) || peak > 0.601 || rms < 0.001 || (sound.loop && boundaryStep > 0.025)) {
      throw new Error(`${sound.id}: invalid level or discontinuous loop: peak=${peak}, rms=${rms}, boundary=${boundaryStep}`);
    }
    const file = `${sound.id}.wav`;
    fs.writeFileSync(path.join(destination, file), wav(pcm, sampleRate));
    console.log(`${sound.id.padEnd(20)} ${sound.seconds.toFixed(2).padStart(5)}s  peak ${peak.toFixed(3)}  RMS ${rms.toFixed(3)}${sound.loop ? `  seam ${boundaryStep.toFixed(5)}` : ""}`);
    return { id: sound.id, label: sound.label, group: sound.group, brief: sound.brief, seconds: sound.seconds, loop: sound.loop, file, peak, rms, boundaryStep };
  });
  fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify({ sampleRate, channels: 2, source: "Procedural synthesis; no generated or recorded samples", sounds: inventory }, null, 2));
  const sections = ["Gemfall effects", "Game effects", "Music"].map((group) => `
    <section aria-labelledby="${group.replaceAll(" ", "-")}"><h2 id="${group.replaceAll(" ", "-")}">${group}</h2><div class="cards">${inventory.filter((s) => s.group === group).map((s) => `
      <article><div class="card-head"><h3>${escape(s.label)}</h3><span>${s.seconds}s${s.loop ? " · loops" : ""}</span></div>
      <p>${escape(s.brief)}</p><audio controls preload="none" ${s.loop ? "loop" : ""} aria-label="${escape(s.label)}" src="${s.file}"></audio>
      <a href="${s.file}" download>Download WAV</a></article>`).join("")}</div></section>`).join("");
  fs.writeFileSync(path.join(destination, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gemfall · Listening room</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#101522;color:#f4efe4;font:16px/1.55 system-ui,sans-serif}main{max-width:1160px;margin:auto;padding:48px 24px 80px}.eyebrow{color:#80d9d1;letter-spacing:.16em;text-transform:uppercase;font-size:12px;font-weight:700}h1{font-family:Georgia,serif;font-size:clamp(36px,7vw,64px);line-height:1.1;margin:14px 0}header p{max-width:650px;color:#b9c6d6}.toolbar{display:flex;align-items:center;gap:24px;flex-wrap:wrap;margin:28px 0;padding:16px 20px;border:1px solid #344254;border-radius:14px;background:#182133;position:sticky;top:8px;z-index:2}.toolbar label{display:flex;gap:12px;align-items:center}input{accent-color:#83d8ce;width:145px}button{font:inherit;border:1px solid #7fbeb9;background:#243c45;color:#f4efe4;border-radius:8px;padding:8px 18px;cursor:pointer}button:hover{background:#31515c}h2{font-family:Georgia,serif;font-size:28px;margin:38px 0 18px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}article{background:linear-gradient(145deg,#1d293c,#172130);border:1px solid #35455a;border-radius:16px;padding:22px;display:flex;flex-direction:column;gap:14px}.card-head{display:flex;justify-content:space-between;gap:12px;align-items:baseline}h3{font-size:19px;margin:0;text-transform:capitalize}.card-head span{color:#90dbd0;white-space:nowrap;font-size:13px}article p{color:#c1cddd;margin:0;flex:1}audio{width:100%;height:44px}a{color:#95dbd0;font-size:13px}footer{margin-top:40px;color:#b9c6d6;font-size:14px}*:focus-visible{outline:3px solid #ffc877;outline-offset:4px}@media(max-width:600px){main{padding:28px 16px 60px}.cards{grid-template-columns:1fr}.toolbar{gap:12px;padding:12px;position:static}article{padding:18px}.card-head{flex-wrap:wrap}}
</style></head><body><main><header><div class="eyebrow">Kids & Dragons · Audio drafts</div><h1>Gemfall listening room</h1><p>Warm bells, soft wooden beats, and quiet music for the road north. Listen to one draft at a time. Music repeats until you pause it.</p></header>
${previousLink}<div class="toolbar"><button id="stop" type="button">Stop all</button><label for="volume">Volume <input id="volume" type="range" min="0" max="1" step="0.05" value="0.6"><output for="volume" id="level">60%</output></label><span>Revision ${revision} · ${sounds.length} drafts · ${sounds.filter((s) => s.loop).length} music loops</span></div>
${sections}<footer>Drafts for listening and comparison. These have not replaced the sounds in the game.</footer></main>
<script>const players=[...document.querySelectorAll('audio')];const volume=document.getElementById('volume');for(const player of players){player.volume=Number(volume.value);player.addEventListener('play',()=>{for(const other of players)if(other!==player)other.pause();});}document.getElementById('stop').addEventListener('click',()=>{for(const player of players){player.pause();player.currentTime=0;}});volume.addEventListener('input',()=>{document.getElementById('level').value=Math.round(Number(volume.value)*100)+'%';for(const player of players)player.volume=Number(volume.value);});</script></body></html>`);
  console.log(`\nListening page: ${path.join(destination, "index.html")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPreview(path.resolve(process.argv[2] ?? "art/review/gemfall-audio"));
}
