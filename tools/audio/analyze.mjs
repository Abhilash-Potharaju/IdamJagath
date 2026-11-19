#!/usr/bin/env node
/**
 * Quick objective look at sound files (we pick sounds without ears in the loop): duration, peak, loudness,
 * events (regions above peak − 30 dB, split on ≥ 60 ms gaps) with their start/end, peak level, brightness
 * (zero-crossing rate → rough Hz) and low-end share (< 200 Hz energy fraction).
 *   node tools/audio/analyze.mjs file1.ogg [file2 …] [--db 30] [--gap 60]
 * Needs ffmpeg on PATH.
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = Number(args[i + 1]); args.splice(i, 2); return v; };
const DB = opt("--db", 30), GAP = opt("--gap", 60);
const SR = 22050, FR = Math.round(SR * 0.01);

export function decode(file, sr = SR) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(sr), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

const db = (x) => (20 * Math.log10(Math.max(1e-9, x))).toFixed(1);

for (const f of args) {
  const x = decode(f);
  let peak = 0, sum = 0;
  for (const v of x) { const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
  const frames = [];
  for (let i = 0; i + FR <= x.length; i += FR) {
    let s = 0;
    for (let j = i; j < i + FR; j++) s += x[j] * x[j];
    frames.push(Math.sqrt(s / FR));
  }
  const fpeak = Math.max(...frames);
  const thr = fpeak * Math.pow(10, -DB / 20);
  const ev = [];
  let cur = null, quiet = 0;
  frames.forEach((r, k) => {
    if (r >= thr) { if (!cur) cur = { a: k, b: k, p: 0 }; cur.b = k; cur.p = Math.max(cur.p, r); quiet = 0; }
    else if (cur && ++quiet * 10 >= GAP) { ev.push(cur); cur = null; quiet = 0; }
  });
  if (cur) ev.push(cur);
  const desc = ev.slice(0, 12).map((e) => {
    const a = e.a * FR, b = (e.b + 1) * FR;
    let zc = 0, lp = 0, lo = 0, all = 0;
    const k = 1 - Math.exp(-2 * Math.PI * 200 / SR);
    for (let i = a; i < b; i++) {
      if (i > a && (x[i] >= 0) !== (x[i - 1] >= 0)) zc++;
      lp += k * (x[i] - lp); lo += lp * lp; all += x[i] * x[i];
    }
    const hz = Math.round((zc / 2) / ((b - a) / SR));
    return `${(a / SR).toFixed(2)}-${(b / SR).toFixed(2)}s ${db(e.p)}dB ~${hz}Hz lo${Math.round(100 * lo / Math.max(all, 1e-12))}%`;
  });
  console.log(`${basename(f)}\t${(x.length / SR).toFixed(2)}s pk ${db(peak)} rms ${db(Math.sqrt(sum / x.length))} | ${ev.length} ev: ${desc.join(" | ")}`);
}
