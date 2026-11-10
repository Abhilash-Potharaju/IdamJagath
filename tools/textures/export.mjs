// Renders tools/textures/generators.ts in headless Chrome and writes PNGs to public/textures/generated/.
// Needs the dev server: `npm run dev`, then `node tools/textures/export.mjs`.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL = process.env.URL || "http://localhost:5173/tools/textures/export.html";
const OUT = join(process.cwd(), "public/textures/generated");
const port = 9380 + Math.floor(Math.random() * 9);
const prof = mkdtempSync(join(tmpdir(), "ij-tex-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, URL], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find((t) => t.type === "page")) break; } catch {} await wait(200); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const ev = (expression) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } })); });
let list;
for (let i = 0; i < 80; i++) { const r = await ev("window.__textures || null"); list = r.result?.result?.value; if (list) break; await wait(250); }
if (!list) { console.error("generator page did not render"); process.exit(1); }
mkdirSync(OUT, { recursive: true });
for (const t of list) {
  const buf = Buffer.from(t.data.split(",")[1], "base64");
  writeFileSync(join(OUT, t.file), buf);
  console.log(`${t.file}  ${(buf.length / 1024).toFixed(1)} KB`);
}
ws.close(); process.exit(0);
