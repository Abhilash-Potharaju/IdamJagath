// Re-encode standalone JPEG textures in place (same names + format, so code paths don't change) with mozjpeg.
//   node tools/assets/optimize_textures.mjs     Sources: art/_public_backup/textures → public/textures (skips lightmaps/)
import sharp from "sharp";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
const SRC = "art/_public_backup/textures", OUT = "public/textures";
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === "lightmaps" ? [] : walk(p)) : /\.jpe?g$/i.test(f) ? [p] : []; });
let a = 0, b = 0;
for (const src of walk(SRC)) {
  const rel = relative(SRC, src), out = join(OUT, rel);
  const normal = /nor_gl|normal/i.test(rel);
  // Normal maps: higher quality + 4:4:4 chroma (chroma subsampling bends normals); colour/ARM: mozjpeg q82
  const buf = await sharp(src).jpeg({ mozjpeg: true, quality: normal ? 90 : 82, chromaSubsampling: normal ? "4:4:4" : "4:2:0" }).toBuffer();
  const s0 = statSync(src).size;
  if (buf.length < s0) writeFileSync(out, buf); // never make a file bigger
  a += s0; b += Math.min(buf.length, s0);
  console.log(`${rel.padEnd(60)} ${(s0 / 1e3).toFixed(0).padStart(5)} KB -> ${(Math.min(buf.length, s0) / 1e3).toFixed(0).padStart(5)} KB`);
}
console.log(`TOTAL ${(a / 1e6).toFixed(1)} MB -> ${(b / 1e6).toFixed(1)} MB`);
