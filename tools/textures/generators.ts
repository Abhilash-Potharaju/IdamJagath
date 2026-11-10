/**
 * Texture GENERATORS (dev tool, not shipped). Every texture the game used to draw at runtime with a 2D canvas
 * lives here; `tools/textures/export.mjs` renders them in headless Chrome and writes PNGs to
 * public/textures/generated/, which the game loads like any other image. Edit a generator, re-run the export,
 * commit the PNGs. Pure canvas code: no engine imports.
 */
type Ctx = CanvasRenderingContext2D;

export interface Gen { file: string; w: number; h: number; draw: (c: Ctx, w: number, h: number) => void }

// ───────────────────────── shared helpers ─────────────────────────
/** Deterministic PRNG (mulberry32), same as the game used, so outputs match the old runtime textures. */
export function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────── classic surfaces (Environment.Surfaces) ─────────────────────────
function plaster(c: Ctx, s: number, r: () => number, base = 222): void {
  c.fillStyle = `rgb(${base},${base},${base})`;
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < s * s / 10; i++) {
    const v = base - 40 + r() * 55;
    c.fillStyle = `rgba(${v},${v},${v},0.35)`;
    c.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2);
  }
  for (let i = 0; i < 18; i++) {
    c.fillStyle = `rgba(70,55,50,${0.04 + r() * 0.06})`;
    c.beginPath();
    c.ellipse(r() * s, r() * s, 10 + r() * s * 0.15, 6 + r() * s * 0.1, r() * 3, 0, Math.PI * 2);
    c.fill();
  }
  for (let i = 0; i < 26; i++) {
    c.fillStyle = `rgba(55,45,40,${0.05 + r() * 0.08})`;
    c.fillRect(r() * s, r() * s * 0.6, 1 + r() * 3, 20 + r() * s * 0.4);
  }
}

function facade(c: Ctx, s: number, r: () => number, lit: boolean): void {
  if (!lit) plaster(c, s, r);
  else { c.fillStyle = "#000"; c.fillRect(0, 0, s, s); }
  const bay = s / 4, floor = s / 4;
  const shutterCols = ["#3d6b5a", "#5a4a8a", "#7a4a2a", "#2f5f7f", "#8a3a3a"];
  for (let fy = 0; fy < 4; fy++) {
    if (!lit) {
      c.fillStyle = "rgba(90,80,72,0.55)";
      c.fillRect(0, fy * floor, s, 5);
      c.fillStyle = "rgba(255,250,240,0.25)";
      c.fillRect(0, fy * floor + 5, s, 2);
    }
    for (let bx = 0; bx < 4; bx++) {
      const x = bx * bay + bay * 0.31, y = fy * floor + floor * 0.24, w = bay * 0.38, h = floor * 0.55;
      const roll = r();
      if (lit) {
        if (roll < 0.36) {
          const g = c.createLinearGradient(x, y, x, y + h);
          g.addColorStop(0, "#ffcf7a"); g.addColorStop(1, "#ff8a2a");
          c.fillStyle = g;
          c.fillRect(x + 3, y + 3, w - 6, h - 6);
          c.fillStyle = "rgba(0,0,0,0.5)";
          c.fillRect(x + w / 2 - 1, y, 2, h);
        } else if (roll < 0.40) {
          c.fillStyle = "#2c4c9c";
          c.fillRect(x + 3, y + 3, w - 6, h - 6);
        } else if (roll < 0.42) {
          c.fillStyle = "#7a2cb8";
          c.fillRect(x + 3, y + 3, w - 6, h - 6);
        }
        continue;
      }
      c.fillStyle = "#efe7d6"; c.fillRect(x - 4, y - 4, w + 8, h + 8);
      c.fillStyle = "#17151c"; c.fillRect(x, y, w, h);
      c.beginPath(); c.fillStyle = "#17151c"; c.ellipse(x + w / 2, y, w / 2, w * 0.35, 0, Math.PI, 0); c.fill();
      if (roll > 0.45) {
        c.fillStyle = shutterCols[Math.floor(r() * shutterCols.length)];
        if (r() < 0.5) c.fillRect(x, y, w, h);
        else { c.fillRect(x - w * 0.48, y, w * 0.45, h); c.fillRect(x + w * 1.03, y, w * 0.45, h); }
        c.fillStyle = "rgba(0,0,0,0.25)";
        for (let k = 0; k < h; k += 6) c.fillRect(x - w * 0.48, y + k, w * 1.96, 1);
      }
      if (r() < 0.4) {
        c.fillStyle = "#6f655c"; c.fillRect(x - 10, y + h + 2, w + 20, 7);
        c.fillStyle = "#2a2420"; for (let k = 0; k <= w + 20; k += 6) c.fillRect(x - 10 + k, y + h - 14, 2, 16);
      }
    }
  }
}

function ashlar(c: Ctx, s: number, r: () => number): void {
  plaster(c, s, r, 215);
  const rows = 8;
  const rh = s / rows;
  c.fillStyle = "rgba(70,50,35,0.45)";
  for (let y = 0; y < rows; y++) {
    c.fillRect(0, y * rh, s, 2);
    const off = (y % 2) * (s / 8);
    for (let x = -1; x < 5; x++) c.fillRect(off + x * (s / 4), y * rh, 2, rh);
    for (let x = 0; x < 4; x++) {
      c.fillStyle = `rgba(${150 + r() * 60},${110 + r() * 40},${80 + r() * 30},0.12)`;
      c.fillRect(off + x * (s / 4) + 2, y * rh + 2, s / 4 - 4, rh - 4);
      c.fillStyle = "rgba(70,50,35,0.45)";
    }
  }
}

function cobbles(c: Ctx, s: number, r: () => number): void {
  c.fillStyle = "#3a332e"; c.fillRect(0, 0, s, s);
  const n = 10, cs = s / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 150 + r() * 70;
      c.fillStyle = `rgb(${v},${v * 0.93},${v * 0.85})`;
      const ox = (y % 2) * cs / 2;
      c.fillRect(((x * cs + ox) % s) + 2, y * cs + 2, cs - 4 - r() * 3, cs - 4 - r() * 3);
    }
  }
  for (let i = 0; i < 40; i++) { c.fillStyle = "rgba(20,15,12,0.25)"; c.fillRect(r() * s, r() * s, 2 + r() * 10, 2 + r() * 10); }
}

function asphalt(c: Ctx, s: number, r: () => number): void {
  plaster(c, s, r, 200);
  c.strokeStyle = "rgba(25,20,18,0.5)";
  for (let i = 0; i < 9; i++) {
    c.beginPath();
    let x = r() * s, y = r() * s;
    c.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; c.lineTo(x, y); }
    c.lineWidth = 1 + r();
    c.stroke();
  }
  for (let i = 0; i < 12; i++) {
    c.fillStyle = `rgba(30,25,35,${0.1 + r() * 0.15})`;
    c.beginPath(); c.ellipse(r() * s, r() * s, 8 + r() * 30, 5 + r() * 18, r() * 3, 0, Math.PI * 2); c.fill();
  }
}

function planks(c: Ctx, s: number, r: () => number): void {
  plaster(c, s, r, 210);
  const n = 6, ph = s / n;
  for (let i = 0; i < n; i++) {
    c.fillStyle = `rgba(60,35,20,${0.1 + r() * 0.15})`;
    c.fillRect(0, i * ph, s, ph);
    c.fillStyle = "rgba(30,18,10,0.7)";
    c.fillRect(0, i * ph, s, 2);
  }
  c.fillStyle = "rgba(30,18,10,0.6)";
  c.fillRect(0, 0, 6, s); c.fillRect(s - 6, 0, 6, s);
}

function cracked(c: Ctx, s: number, r: () => number): void {
  plaster(c, s, r);
  c.strokeStyle = "rgba(20,15,15,0.85)";
  for (let i = 0; i < 6; i++) {
    c.beginPath();
    let x = s * 0.5 + (r() - 0.5) * s * 0.3, y = s * 0.5 + (r() - 0.5) * s * 0.3;
    c.moveTo(x, y);
    for (let k = 0; k < 10; k++) { x += (r() - 0.5) * 45; y += (r() - 0.5) * 45; c.lineTo(x, y); }
    c.lineWidth = 2 + r() * 2;
    c.stroke();
  }
  c.fillStyle = "rgba(20,15,15,0.35)";
  c.beginPath(); c.ellipse(s / 2, s / 2, s * 0.18, s * 0.14, 0.3, 0, Math.PI * 2); c.fill();
}

const sq = (file: string, size: number, seed: number, f: (c: Ctx, s: number, r: () => number) => void): Gen =>
  ({ file, w: size, h: size, draw: (c) => f(c, size, rng(seed)) });

// ───────────────────────── shop signs (Dressing) ─────────────────────────
// Generic text, no real brands. Drawn upside down because the facade sign panel's V axis is flipped.
export const SIGNS: { text: string; font: string; bg: string; fg: string }[] = [
  { text: "లాడ్ బజార్", font: "bold 64px sans-serif", bg: "#b8202a", fg: "#ffe9a8" },
  { text: "ఇరానీ చాయ్", font: "bold 64px sans-serif", bg: "#1d5e8c", fg: "#ffffff" },
  { text: "గాజుల దుకాణం", font: "bold 58px sans-serif", bg: "#7b2d8e", fg: "#ffd36b" },
  { text: "लाड बाज़ार", font: "bold 64px sans-serif", bg: "#d4851c", fg: "#2a1200" },
  { text: "पान भंडार", font: "bold 64px sans-serif", bg: "#226b3a", fg: "#fff4c2" },
  { text: "बिरयानी हाउस", font: "bold 60px sans-serif", bg: "#8c1c1c", fg: "#ffe0a0" },
  { text: "لاڈ بازار", font: "bold 64px sans-serif", bg: "#0f6b62", fg: "#ffffff" },
  { text: "ایرانی چائے", font: "bold 60px sans-serif", bg: "#5a3a1a", fg: "#ffd27a" },
  { text: "NAWAB BANGLES", font: "bold 60px sans-serif", bg: "#e8e0c8", fg: "#9a1b2e" },
  { text: "CHAI • BUN MASKA", font: "bold 52px sans-serif", bg: "#f2c12e", fg: "#3a1a00" },
];
function sign(c: Ctx, s: (typeof SIGNS)[number]): void {
  c.fillStyle = s.bg; c.fillRect(0, 0, 512, 96);
  c.strokeStyle = s.fg; c.lineWidth = 4; c.strokeRect(6, 6, 500, 84);
  c.font = s.font; c.fillStyle = s.fg; c.textAlign = "center"; c.textBaseline = "middle";
  c.save(); c.translate(0, 96); c.scale(1, -1); c.fillText(s.text, 256, 48, 480); c.restore();
}

// ───────────────────────── alien propaganda (WarDressing) ─────────────────────────
export function drawEmblem(c: Ctx, cx: number, cy: number, h: number, face = "#f4efe6", eye = "#120607"): void {
  const w = h * 0.62;
  c.save(); c.translate(cx, cy); c.fillStyle = face; c.beginPath();
  c.moveTo(0, -h / 2);
  c.bezierCurveTo(w * 0.62, -h / 2, w * 0.62, h * 0.05, w * 0.18, h * 0.38);
  c.quadraticCurveTo(0, h / 2, -w * 0.18, h * 0.38);
  c.bezierCurveTo(-w * 0.62, h * 0.05, -w * 0.62, -h / 2, 0, -h / 2);
  c.fill();
  c.fillStyle = eye;
  for (const sx of [-1, 1]) {
    c.save(); c.translate(sx * w * 0.2, h * 0.02); c.rotate(sx * 0.55);
    c.beginPath(); c.ellipse(0, 0, w * 0.2, h * 0.085, 0, 0, Math.PI * 2); c.fill(); c.restore();
  }
  c.fillRect(-w * 0.07, h * 0.27, w * 0.14, h * 0.012);
  c.restore();
}
export function drawGlyphs(c: Ctx, x0: number, y: number, width: number, size: number, color: string, seed: number): void {
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  c.strokeStyle = color; c.lineWidth = Math.max(2, size * 0.12);
  for (let x = x0; x < x0 + width - size; x += size * 1.3) {
    c.beginPath();
    const n = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const ax = x + rnd() * size, ay = y - size / 2 + rnd() * size;
      const bx = x + rnd() * size, by = y - size / 2 + rnd() * size;
      c.moveTo(ax, ay); c.lineTo(bx, by);
    }
    if (rnd() > 0.5) { c.moveTo(x + size * 0.85, y - size / 2); c.arc(x + size / 2, y - size / 2, size * 0.35, 0, Math.PI); }
    c.stroke();
  }
}
const RED = "#b3121b";
function banner(c: Ctx): void {
  c.fillStyle = RED; c.fillRect(0, 0, 256, 704);
  c.fillStyle = "#7d0a10"; c.fillRect(0, 0, 256, 26); c.fillRect(0, 678, 256, 26); c.fillRect(0, 0, 14, 704); c.fillRect(242, 0, 14, 704);
  c.strokeStyle = "#f4efe6"; c.lineWidth = 4; c.strokeRect(28, 44, 200, 616);
  drawEmblem(c, 128, 250, 250);
  drawGlyphs(c, 44, 470, 170, 26, "#f4efe6", 7);
  drawGlyphs(c, 44, 520, 170, 26, "#f4efe6", 19);
  c.fillStyle = "#f4efe6";
  for (let i = 0; i < 6; i++) c.fillRect(56 + i * 26, 600, 14, 40 + (i % 3) * 8);
}
/** Static part of the alien billboard screen; glyph rows, scanlines and the border animate at runtime on top. */
function billboardBase(c: Ctx): void {
  c.fillStyle = "#3a0204"; c.fillRect(0, 0, 512, 290);
  const g = c.createRadialGradient(150, 145, 10, 150, 145, 190);
  g.addColorStop(0, "#d01218"); g.addColorStop(1, "#3a0204");
  c.fillStyle = g; c.fillRect(0, 0, 512, 290);
  drawEmblem(c, 150, 145, 200, "#f2d8d8", "#220203");
}
function pock(c: Ctx): void {
  const g = c.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, "rgba(10,8,6,0.75)"); g.addColorStop(0.55, "rgba(20,16,12,0.45)"); g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g; c.fillRect(0, 0, 256, 256);
  let r = 42;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 26; i++) {
    const x = 40 + rnd() * 176, y = 40 + rnd() * 176, s = 3 + rnd() * 6;
    c.fillStyle = "rgba(5,4,3,0.95)"; c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(120,110,95,0.5)"; c.beginPath(); c.arc(x + s * 0.4, y - s * 0.4, s * 1.6, 0, Math.PI * 2); c.fill();
  }
}
function puddle(c: Ctx): void {
  let r = 7;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 9; i++) {
    const x = 70 + rnd() * 116, y = 70 + rnd() * 116, rad = 40 + rnd() * 50;
    const g = c.createRadialGradient(x, y, rad * 0.4, x, y, rad);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill();
  }
}
function radial(stops: [number, string][]) {
  return (c: Ctx, w: number) => {
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    for (const [o, col] of stops) g.addColorStop(o, col);
    c.fillStyle = g; c.fillRect(0, 0, w, w);
  };
}

// ───────────────────────── fx sprites (fx.ts / Fleet.ts; exported, see notes in the report) ─────────────────────────
function flash(c: Ctx, s: number): void {
  const cx = s / 2, r = rng(3);
  const g = c.createRadialGradient(cx, cx, 0, cx, cx, cx);
  g.addColorStop(0, "rgba(255,255,235,1)"); g.addColorStop(0.18, "rgba(255,220,140,0.95)");
  g.addColorStop(0.45, "rgba(255,150,40,0.45)"); g.addColorStop(1, "rgba(255,90,0,0)");
  c.fillStyle = g; c.beginPath();
  const spikes = 7;
  for (let i = 0; i <= spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? cx * (0.8 + r() * 0.2) : cx * 0.28;
    c.lineTo(cx + Math.cos(a) * rad, cx + Math.sin(a) * rad);
  }
  c.closePath(); c.fill();
  c.fillStyle = g; c.beginPath(); c.arc(cx, cx, cx * 0.42, 0, Math.PI * 2); c.fill();
}
function splat(c: Ctx, s: number): void {
  const r = rng(5);
  for (let i = 0; i < 14; i++) {
    const rad = s * (0.08 + r() * 0.18), a = r() * Math.PI * 2, d = r() * s * 0.3;
    const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d;
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, "rgba(90,255,80,0.95)"); g.addColorStop(1, "rgba(40,120,30,0)");
    c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill();
  }
}

export const GENERATORS: Gen[] = [
  // classic surfaces
  sq("surface_facade.png", 512, 11, (c, s, r) => facade(c, s, r, false)),
  sq("surface_facade_lit.png", 512, 11, (c, s, r) => facade(c, s, r, true)),
  sq("surface_ashlar.png", 256, 3, ashlar),
  sq("surface_cobbles.png", 256, 5, cobbles),
  sq("surface_asphalt.png", 256, 9, asphalt),
  sq("surface_planks.png", 128, 13, planks),
  sq("surface_cracked.png", 256, 17, cracked),
  sq("surface_plaster.png", 256, 21, (c, s, r) => plaster(c, s, r)),
  // shop signs
  ...SIGNS.map((s, i): Gen => ({ file: `sign_${String(i).padStart(2, "0")}.png`, w: 512, h: 96, draw: (c) => sign(c, s) })),
  // alien propaganda + war decals
  { file: "alien_banner.png", w: 256, h: 704, draw: banner },
  { file: "alien_emblem.png", w: 512, h: 512, draw: (c) => drawEmblem(c, 256, 256, 480) },
  { file: "alien_billboard_base.png", w: 512, h: 290, draw: billboardBase },
  { file: "decal_pock_scorch.png", w: 256, h: 256, draw: pock },
  { file: "decal_puddle_mask.png", w: 256, h: 256, draw: puddle },
  // particle / fx sprites
  { file: "particle_soft.png", w: 64, h: 64, draw: radial([[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,0.6)"], [1, "rgba(255,255,255,0)"]]) },
  { file: "particle_smoke.png", w: 64, h: 64, draw: radial([[0, "rgba(255,255,255,1)"], [1, "rgba(255,255,255,0)"]]) },
  { file: "fx_dot.png", w: 64, h: 64, draw: radial([[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,0.7)"], [1, "rgba(255,255,255,0)"]]) },
  { file: "fx_muzzle_flash.png", w: 128, h: 128, draw: (c, w) => flash(c, w) },
  { file: "fx_bullet_hole.png", w: 64, h: 64, draw: radial([[0, "rgba(8,6,6,1)"], [0.28, "rgba(20,16,14,0.95)"], [0.45, "rgba(60,52,46,0.6)"], [0.7, "rgba(40,34,30,0.25)"], [1, "rgba(0,0,0,0)"]]) },
  { file: "fx_ichor_splat.png", w: 64, h: 64, draw: (c, w) => splat(c, w) },
  { file: "fx_beam_gradient.png", w: 8, h: 128, draw: (c) => { const g = c.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, "rgba(255,255,255,0.8)"); g.addColorStop(0.35, "rgba(255,255,255,0.3)"); g.addColorStop(1, "rgba(255,255,255,0.04)"); c.fillStyle = g; c.fillRect(0, 0, 8, 128); } },
  { file: "fx_beam_spot.png", w: 128, h: 128, draw: radial([[0, "rgba(255,255,255,0.9)"], [0.4, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]]) },
];
