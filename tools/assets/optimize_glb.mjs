// GLB optimizer (glTF-Transform): dedup, prune, weld, resample animations, WebP textures, meshopt geometry compression.
//   node tools/assets/optimize_glb.mjs [file.glb ...]    (default: every GLB under public/models except public/models/level)
// Sources: art/_public_backup/models (pristine pre-optimization copies) → writes to public/models. Re-runnable.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, weld, resample, textureCompress, reorder, quantize } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";

const SRC = "art/_public_backup/models", OUT = "public/models";
// Per-file overrides: max texture size (embedded fallback textures that the game replaces at runtime can be small)
const MAX_TEX = { "charminar_skfb.glb": 1024 };
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === "level" ? [] : walk(p)) : p.endsWith(".glb") ? [p] : []; });

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const files = process.argv.slice(2).length ? process.argv.slice(2).map((f) => join(SRC, relative(OUT, f))) : walk(SRC);
let before = 0, after = 0;
for (const src of files) {
  const rel = relative(SRC, src), out = join(OUT, rel), name = rel.split("/").pop();
  const doc = await io.read(src);
  const size = MAX_TEX[name] ?? 2048;
  await doc.transform(
    dedup(), prune(), weld(), resample(),
    // Normal maps keep more quality (lossy artefacts show as bumpy noise); colour/ORM maps compress harder
    textureCompress({ encoder: sharp, targetFormat: "webp", slots: /^normalTexture$/, quality: 92, resize: [size, size] }),
    textureCompress({ encoder: sharp, targetFormat: "webp", slots: /^(?!normalTexture$).*/, quality: 84, resize: [size, size] }),
    reorder({ encoder: MeshoptEncoder }),
    quantize(),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
  await io.write(out, doc);
  let a = statSync(src).size, b = statSync(out).size;
  if (b >= a) { copyFileSync(src, out); b = a; console.log(`  (kept original: optimized was not smaller)`); } // never grow a file
  before += a; after += b;
  console.log(`${rel.padEnd(42)} ${(a / 1e6).toFixed(2).padStart(6)} MB -> ${(b / 1e6).toFixed(2).padStart(6)} MB`);
}
console.log(`TOTAL ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
