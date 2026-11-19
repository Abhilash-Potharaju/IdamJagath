#!/usr/bin/env node
/**
 * Builds the Freesound-sourced sounds (tools/audio/recipes.mjs) into public/audio/fs/*.m4a and merges them into
 * public/audio/manifest.json (variants → `files`), plus provenance into data/assets.json (audio entries).
 *   node tools/audio/build.mjs [name …]        (default: all)
 * Sources are HQ previews cached in tools/audio/.cache/ (git-ignored; fetched on demand with freesound.mjs).
 * Run AFTER tools/dev/export_audio.mjs if you re-export the synth sounds (that tool rewrites the manifest).
 * Needs ffmpeg (decode + AAC encode).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { SOUNDS, CC_BY } from "./recipes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const CACHE = join(HERE, ".cache");
const OUT_DIR = join(ROOT, "public/audio/fs");
const MANIFEST = join(ROOT, "public/audio/manifest.json");
const ASSETS = join(ROOT, "data/assets.json");
const SR = 44100;
mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const only = process.argv.slice(2);
const names = only.length ? only : Object.keys(SOUNDS);

// ── sources ──
const meta = new Map();
function source(id) {
  const ogg = join(CACHE, `${id}.ogg`), js = join(CACHE, `${id}.json`);
  if (!existsSync(ogg) || !existsSync(js)) execFileSync("node", [join(HERE, "freesound.mjs"), "fetch", String(id), CACHE], { stdio: "inherit" });
  const m = JSON.parse(readFileSync(js, "utf8"));
  if (m.license !== "CC0" && !(m.license === "CC BY" && CC_BY.includes(id))) throw new Error(`${id}: licence ${m.license} not allowed`);
  meta.set(id, m);
  return ogg;
}
const pcm = new Map();
function decode(id) {
  if (!pcm.has(id)) {
    const raw = execFileSync("ffmpeg", ["-v", "error", "-i", source(id), "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
    pcm.set(id, new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  }
  return pcm.get(id);
}

// ── DSP ──
function biquad(x, type, f) {
  const w = 2 * Math.PI * f / SR, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2);
  const [b0, b1, b2] = type === "lp" ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function resample(x, rate) {
  if (rate === 1) return x;
  const n = Math.floor(x.length / rate), y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * rate, k = Math.floor(p), f = p - k; y[i] = (x[k] ?? 0) * (1 - f) + (x[k + 1] ?? 0) * f; }
  return y;
}
/** First sample (from start) whose 2 ms window reaches peak − 24 dB, minus 1 ms. */
function onsetIndex(x) {
  let pk = 0;
  for (const v of x) pk = Math.max(pk, Math.abs(v));
  const thr = pk * 0.063, w = Math.round(SR * 0.002);
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= thr) return Math.max(0, i - Math.round(SR * 0.001) - w);
  return 0;
}

function renderPart(p) {
  const src = decode(p.id);
  let x = src.slice(Math.round(p.t0 * SR), Math.min(src.length, Math.round(p.t1 * SR)));
  if (p.onset) x = x.slice(onsetIndex(x));
  if (p.hp) { x = biquad(x, "hp", p.hp); if (p.hp2) x = biquad(x, "hp", p.hp); }
  if (p.lp) { x = biquad(x, "lp", p.lp); if (p.lp2) x = biquad(x, "lp", p.lp); }
  x = resample(x, p.rate ?? 1);
  const g = Math.pow(10, (p.gain ?? 0) / 20);
  const fi = Math.round((p.fi ?? 0.002) * SR), fo = Math.round((p.fo ?? 0.03) * SR);
  for (let i = 0; i < x.length; i++) {
    let e = g;
    if (i < fi) e *= i / fi;
    if (i > x.length - fo) e *= Math.max(0, (x.length - i) / fo);
    if (p.decay) e *= Math.pow(10, -3 * (i / SR) / p.decay);
    x[i] *= e;
  }
  return x;
}

function renderVariant(v, rmsTarget) {
  const parts = v.parts.map((p) => ({ x: renderPart(p), at: Math.round((p.at ?? 0) * SR) }));
  const len = Math.max(...parts.map((p) => p.at + p.x.length));
  const y = new Float32Array(len);
  for (const p of parts) for (let i = 0; i < p.x.length; i++) y[p.at + i] += p.x[i];
  // Loudness: RMS over 10 ms frames within 30 dB of the loudest frame → target; then peak-limit to −1 dBFS
  const fr = Math.round(SR * 0.01), rms = [];
  for (let i = 0; i + fr <= len; i += fr) { let s = 0; for (let j = i; j < i + fr; j++) s += y[j] * y[j]; rms.push(s / fr); }
  const top = Math.max(...rms), act = rms.filter((r) => r > top * 1e-3);
  const cur = Math.sqrt(act.reduce((a, b) => a + b, 0) / act.length);
  let gain = Math.pow(10, rmsTarget / 20) / cur;
  let pk = 0;
  for (const s of y) pk = Math.max(pk, Math.abs(s));
  gain = Math.min(gain, 0.89 / pk);
  // Trim trailing near-silence (−60 dB below peak)
  let end = len;
  while (end > 1 && Math.abs(y[end - 1]) * gain < 0.001 * 0.89) end--;
  const out = y.subarray(0, Math.min(len, end + Math.round(SR * 0.01)));
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

function wav16(x) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  return b;
}

const hasAacAt = execFileSync("ffmpeg", ["-hide_banner", "-encoders"]).toString().includes("aac_at");
function encode(x, file, kbps) {
  const tmp = join(tmpdir(), `ij-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);
  writeFileSync(tmp, wav16(x));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-c:a", hasAacAt ? "aac_at" : "aac", "-b:a", `${kbps}k`, "-movflags", "+faststart", file]);
  rmSync(tmp);
}

// ── build ──
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const used = new Map(); // freesound id → sound names
for (const name of names) {
  const s = SOUNDS[name];
  if (!s) throw new Error(`unknown sound ${name}`);
  const files = [];
  let dur = 0;
  s.variants.forEach((v, i) => {
    const x = renderVariant(v, s.rms ?? -16);
    const rel = `fs/${name}_${i + 1}.m4a`;
    encode(x, join(ROOT, "public/audio", rel), x.length / SR > 1.2 ? 80 : 96);
    files.push(rel);
    dur = Math.max(dur, x.length / SR);
    for (const p of v.parts) { if (!used.has(p.id)) used.set(p.id, new Set()); used.get(p.id).add(name); }
  });
  // drop stale variant files of this sound
  for (const f of readdirSync(OUT_DIR)) {
    const m = f.match(/^(.*)_(\d+)\.m4a$/);
    if (m && m[1] === name && Number(m[2]) > s.variants.length) rmSync(join(OUT_DIR, f));
  }
  const srcs = [...new Set(s.variants.flatMap((v) => v.parts.map((p) => p.id)))].map((id) => {
    const m = meta.get(id);
    return { id, author: m.author, license: m.license, url: m.url };
  });
  const entry = { name, file: files[0], files, duration: +dur.toFixed(3), source: "freesound (tools/audio/recipes.mjs)", sources: srcs };
  const k = manifest.sounds.findIndex((e) => e.name === name);
  if (k >= 0) manifest.sounds[k] = entry; else manifest.sounds.push(entry);
  console.log(`${name.padEnd(16)} ${files.length} variant(s), ≤${dur.toFixed(2)} s`);
}
// The core's "reload" cue is now rendered as per-weapon phases (WeaponView); keep no file for it.
manifest.sounds = manifest.sounds.filter((e) => e.name !== "reload");
manifest.$doc = "Sound files the game loads (Audio.ts). 'generated in-house' = rendered from the synth recipes by tools/dev/export_audio.mjs " +
  "(project-owned). 'freesound' = built by tools/audio/build.mjs from CC0 / CC BY Freesound sources (listed per sound; CC BY ones are credited " +
  "via data/assets.json). 'files' are random variants.";
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + "\n");

// Provenance → data/assets.json (one entry per Freesound source; CC BY ones get credits)
if (!only.length) {
  const assets = JSON.parse(readFileSync(ASSETS, "utf8"));
  for (const k of Object.keys(assets.assets)) if (k.startsWith("audio/freesound/")) delete assets.assets[k];
  let order = Math.max(...Object.values(assets.assets).map((a) => a.credit_order ?? -1));
  for (const [id, set] of [...used.entries()].sort((a, b) => a[0] - b[0])) {
    const m = meta.get(id);
    const by = m.license === "CC BY";
    assets.assets[`audio/freesound/${id}`] = {
      type: "audio", source: m.url, author: m.author, license: by ? "CC BY 4.0" : "CC0",
      ...(by ? { license_url: m.license_url } : {}),
      credit_required: by, ...(by ? { credit_title: m.name.replace(/\.(wav|mp3|ogg|aiff?)$/i, ""), credit_order: ++order } : {}),
      in_game: true, notes: `modified (trimmed, filtered, mixed, normalised) into: ${[...set].join(", ")} (public/audio/fs/)`,
    };
  }
  writeFileSync(ASSETS, JSON.stringify(assets, null, 1) + "\n");
}

let total = 0;
for (const f of readdirSync(OUT_DIR)) total += statSync(join(OUT_DIR, f)).size;
console.log(`public/audio/fs: ${(total / 1024).toFixed(0)} KB`);
