// Dev test driver: opens the game in headless Chrome, evaluates JS steps, prints results.
//   OUT=<dir> node tools/dev/cdp.mjs "<url>" "<js>" "WAIT:ms" "SHOT:name" ...
// SHOT saves <OUT>/<name>.png (delete after use). The temporary Chrome profile is always removed on exit.
import { spawn } from "node:child_process"; import { writeFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const [,, url, ...steps] = process.argv; const OUT = process.env.OUT || tmpdir(); mkdirSync(OUT, { recursive: true });
const W = process.env.W || "800", H = process.env.H || "450"; const port = 9390 + Math.floor(Math.random() * 9);
const prof = mkdtempSync(join(tmpdir(), "ij-prof-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, url], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup); process.on("SIGTERM", () => process.exit(1)); process.on("SIGALRM", () => process.exit(1));
const wait = (ms) => new Promise((r) => setTimeout(r, ms)); let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find((t) => t.type === "page")) break; } catch {} await wait(200); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "EXC: " + (r.result.exceptionDetails.exception?.description || "").slice(0, 400) : r.result?.result?.value; };
for (let i = 0; i < 80; i++) { if (await ev("!!window.__game")) break; await wait(250); }
for (const s of steps) {
  if (s.startsWith("SHOT:")) { await wait(300); const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, s.slice(5) + ".png"), Buffer.from(r.result.data, "base64")); console.log("saved", s.slice(5)); continue; }
  if (s.startsWith("WAIT:")) { await wait(+s.slice(5)); continue; }
  console.log(JSON.stringify(await ev(s)));
}
ws.close(); cleanup(); process.exit(0);
