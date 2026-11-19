#!/usr/bin/env node
/**
 * Freesound API helper (search + download HQ previews). Key: FREESOUND_API_KEY in .env.local (git-ignored).
 *   node tools/audio/freesound.mjs search "gunshot rifle" [--any] [--n 15] [--max 6]
 *        default filter: CC0 only; --any also allows CC BY (never NC / sampling+).
 *   node tools/audio/freesound.mjs info <id>
 *   node tools/audio/freesound.mjs fetch <id> <outDir>     → <outDir>/<id>.ogg + <id>.json (licence, author, url)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function key() {
  if (process.env.FREESOUND_API_KEY) return process.env.FREESOUND_API_KEY;
  const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  const m = env.match(/^FREESOUND_API_KEY\s*=\s*"?([^"\n]+)"?/m);
  if (!m) throw new Error("FREESOUND_API_KEY missing (.env.local)");
  return m[1].trim();
}
const API = "https://freesound.org/apiv2";
const FIELDS = "id,name,license,username,duration,avg_rating,num_ratings,num_downloads,tags,description,previews,url,samplerate,channels";

async function get(path, params = {}) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set("token", key());
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

const licenceName = (l) => l.includes("/zero/") ? "CC0" : l.includes("/by/") ? "CC BY" : l.includes("nc") ? "NC" : l.includes("sampling") ? "sampling+" : l;

const [cmd, ...args] = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

if (cmd === "search") {
  const any = args.includes("--any");
  const max = Number(flag("--max", 8));
  const filter = (any ? 'license:("Creative Commons 0" OR "Attribution")' : 'license:"Creative Commons 0"') + ` duration:[0 TO ${max}]`;
  const res = await get("/search/text/", { query: args[0], filter, fields: FIELDS, page_size: flag("--n", 15), sort: flag("--sort", "score") });
  for (const s of res.results) {
    console.log(`${s.id}\t${licenceName(s.license)}\t${s.duration.toFixed(2)}s\t★${(s.avg_rating ?? 0).toFixed(1)}(${s.num_ratings})\t↓${s.num_downloads}\t${s.username}\t${s.name}\t[${s.tags.slice(0, 8).join(",")}]`);
  }
  console.log(`(${res.count} total)`);
} else if (cmd === "info") {
  const s = await get(`/sounds/${args[0]}/`, { fields: FIELDS });
  console.log(JSON.stringify({ ...s, license: licenceName(s.license) + " " + s.license, previews: undefined }, null, 1));
} else if (cmd === "fetch") {
  const [id, out] = args;
  mkdirSync(out, { recursive: true });
  const s = await get(`/sounds/${id}/`, { fields: FIELDS });
  const lic = licenceName(s.license);
  if (lic !== "CC0" && lic !== "CC BY") throw new Error(`refusing licence ${s.license}`);
  const r = await fetch(s.previews["preview-hq-ogg"]);
  if (!r.ok) throw new Error(`preview ${r.status}`);
  writeFileSync(join(out, `${id}.ogg`), Buffer.from(await r.arrayBuffer()));
  writeFileSync(join(out, `${id}.json`), JSON.stringify({ id: s.id, name: s.name, author: s.username, license: lic, license_url: s.license, url: s.url, duration: s.duration, tags: s.tags }, null, 1));
  console.log(`${id}\t${lic}\t${s.username}\t${s.name}`);
} else {
  console.log("usage: search <query> [--any] [--n N] [--max sec] | info <id> | fetch <id> <outDir>");
}
