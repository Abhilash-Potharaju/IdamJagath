// Renders every in-house synthesized sound (src/game/Audio.ts recipes) to public/audio/ as AAC (.m4a, via macOS
// afconvert) or WAV, and writes public/audio/manifest.json. Requires the dev server: npm run dev
//   node tools/dev/export_audio.mjs [http://localhost:5173]
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const base = process.argv[2] || "http://localhost:5173";
const OUT = resolve("public/audio");
mkdirSync(OUT, { recursive: true });
const prof = mkdtempSync(join(tmpdir(), "ij-audio-"));
const port = 9420 + Math.floor(Math.random() * 9);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", `--remote-debugging-port=${port}`,
   `--user-data-dir=${prof}`, "--window-size=320,180", `${base}/tools/dev/audio_export.html`], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find((t) => t.type === "page")) break; } catch {} await wait(200); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const ev = (expression) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
for (let i = 0; i < 80; i++) { const r = await ev("!!window.__ready"); if (r.result?.result?.value) break; await wait(250); }
// Retry a few times in case the page reloads
let r;
for (let attempt = 0; attempt < 4; attempt++) {
  r = await ev("(async()=>{for(let i=0;i<240&&!window.__ready;i++)await new Promise(r=>setTimeout(r,250));return window.__renderAudio();})()");
  if (r.result?.result?.value) break;
  console.error("retrying:", (r.result?.exceptionDetails?.exception?.description || JSON.stringify(r)).slice(0, 200));
  await wait(2000);
}
if (!r.result?.result) { console.error("unexpected response:", JSON.stringify(r).slice(0, 400)); process.exit(1); }
const items = r.result.result.value;
const useAac = existsSync("/usr/bin/afconvert");
const manifest = { $doc: "In-house generated sound effects (rendered from the synth recipes in src/game/Audio.ts by tools/dev/export_audio.mjs). License: project-owned.", sounds: [], ambience: undefined };
let total = 0;
for (const it of items) {
  const wav = join(OUT, `${it.name}.wav`);
  writeFileSync(wav, Buffer.from(it.wav, "base64"));
  let file = `${it.name}.wav`;
  if (useAac) {
    const m4a = join(OUT, `${it.name}.m4a`);
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", it.name === "ambience" ? "96000" : "128000", wav, m4a]);
    rmSync(wav);
    file = `${it.name}.m4a`;
  }
  total += statSync(join(OUT, file)).size;
  const rec = { name: it.name, file, duration: it.duration, source: "generated in-house" };
  if (it.name === "ambience") manifest.ambience = rec; else manifest.sounds.push(rec);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`exported ${items.length} files (${useAac ? "AAC .m4a" : "WAV"}), ${(total / 1024).toFixed(0)} KB total`);
ws.close(); cleanup(); process.exit(0);
