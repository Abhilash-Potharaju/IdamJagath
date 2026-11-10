import {
  BoundingBox, Color3, Color4, DefaultRenderingPipeline, DirectionalLight, DynamicTexture, Effect, HemisphericLight,
  ImageProcessingConfiguration, Mesh, MeshBuilder, ParticleSystem, PointLight, Scene, ShaderMaterial, StandardMaterial,
  Texture, Vector3, VertexBuffer, type Camera,
} from "@babylonjs/core";
import { place } from "./Props";
import { addFleet, redMothership } from "./Fleet";

/**
 * Mood for Level 1, matched to the key art (art/concepts/keyart/charminar-occupied-chatgpt.png):
 * "Hyderabad old city under alien occupation": a dark stormy overcast sky lit blood-red from below by the alien
 * fleet, warm fire glow against cold grey, crimson alien light. Owns: sky, fog, base lights, post-processing,
 * particles, and surface textures.
 */

/** Fog colour = the sky's horizon colour, so distant geometry melts into the sky (dark grey, red-tinted). */
export const FOG_COLOR = new Color3(0.16, 0.085, 0.08);
export const HEMI_COLOR = Color3.FromHexString("#8e8a98");
/** Direction of the mothership as seen from the plaza: the red glow in the clouds is strongest around it. */
const SHIP_DIR = new Vector3(-150, 215, 290).normalize();
// Framed above the Charminar, right of centre, when looking up the bazaar lane from the start
const MOON_DIR = new Vector3(0.16, 0.5, 0.85).normalize();

// ───────────────────────── sky shader ─────────────────────────
Effect.ShadersStore["ijSkyVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
  gl_Position.z = gl_Position.w * 0.99999; // always at the far plane
}`;

Effect.ShadersStore["ijSkyFragmentShader"] = `
precision highp float;
varying vec3 vDir;
uniform float time;
uniform float flash;
uniform vec3 moonDir;
uniform vec3 shipDir;
uniform vec3 fogColor;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // Base: charcoal storm sky, a little lighter grey in the middle band, dark red-brown at the horizon
  vec3 zenith = vec3(0.035, 0.035, 0.045);
  vec3 mid = vec3(0.10, 0.095, 0.105);
  vec3 lowRed = vec3(0.32, 0.07, 0.05);
  vec3 col = fogColor;
  if (h > 0.0) {
    col = mix(fogColor, lowRed, smoothstep(0.0, 0.06, h));
    col = mix(col, mid, smoothstep(0.05, 0.28, h));
    col = mix(col, zenith, smoothstep(0.3, 0.95, h));
  }
  // Red glow around the mothership and low along the horizon (fires + alien beams lighting the clouds)
  float ship = max(dot(d, shipDir), 0.0);
  float shipGlow = pow(ship, 6.0) * 0.9 + pow(ship, 40.0) * 0.6;
  float horizon = smoothstep(0.35, 0.0, h) * step(0.0, h);

  if (h > 0.0) {
    // Two layers of heavy, slowly rolling clouds (fbm), projected onto a dome
    vec2 uv = d.xz / (h + 0.12);
    float c1 = fbm(vec3(uv * 0.55 + vec2(time * 0.006, time * 0.002), time * 0.004));
    float c2 = fbm(vec3(uv * 1.35 - vec2(time * 0.011, -time * 0.004), time * 0.007 + 3.0));
    float dens = smoothstep(0.32, 0.72, c1 * 0.65 + c2 * 0.45);
    // Cloud bodies: dark grey; undersides lit red/orange near the horizon and near the ship
    float under = clamp(horizon * 1.2 + shipGlow, 0.0, 1.0);
    vec3 cloudBody = mix(vec3(0.07, 0.068, 0.075), vec3(0.16, 0.15, 0.16), c2);
    vec3 cloudLit = mix(vec3(0.55, 0.12, 0.06), vec3(0.85, 0.32, 0.10), c1);
    vec3 cloudCol = mix(cloudBody, cloudLit, under * (0.35 + 0.65 * (1.0 - dens)));
    // Darker cores, brighter edges (fake volumetric shading)
    cloudCol *= 0.75 + 0.5 * smoothstep(0.75, 0.3, dens);
    col = mix(col, cloudCol, clamp(dens * 1.1, 0.0, 0.97) * smoothstep(0.0, 0.05, h));
    // Faint moon glow through the clouds (no hard disc)
    float md = max(dot(d, moonDir), 0.0);
    col += vec3(0.55, 0.58, 0.62) * (pow(md, 60.0) * 0.18 + pow(md, 500.0) * 0.35) * (1.0 - dens * 0.7);
    // Lightning: brightens the cloud layer, strongest inside the clouds
    col += vec3(0.75, 0.78, 0.95) * flash * (0.25 + dens * 0.9) * smoothstep(0.0, 0.2, h);
  }
  col += vec3(0.42, 0.06, 0.03) * shipGlow * 0.55;
  col += vec3(0.30, 0.07, 0.03) * horizon * 0.35;
  gl_FragColor = vec4(col, 1.0);
}`;

// ───────────────────────── procedural textures ─────────────────────────
function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

function makeTex(scene: Scene, name: string, size: number, draw: (c: Ctx, s: number, r: () => number) => void, seed = 7): DynamicTexture {
  const t = new DynamicTexture(name, { width: size, height: size }, scene, true, Texture.NEAREST_NEAREST_MIPLINEAR);
  const c = t.getContext() as unknown as Ctx;
  draw(c, size, rng(seed));
  t.update(true);
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
}

/** Near-white plaster with speckle, damp blotches and grime streaks (tinted by the material colour). */
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

/** 4 bays × 4 floors of old-city facade (one tile = 16 m × 14 m): windows, shutters, cornices, balconies. */
function facade(c: Ctx, s: number, r: () => number, lit: boolean): void {
  if (!lit) plaster(c, s, r);
  else { c.fillStyle = "#000"; c.fillRect(0, 0, s, s); }
  const bay = s / 4, floor = s / 4;
  const shutterCols = ["#3d6b5a", "#5a4a8a", "#7a4a2a", "#2f5f7f", "#8a3a3a"];
  for (let fy = 0; fy < 4; fy++) {
    if (!lit) {
      c.fillStyle = "rgba(90,80,72,0.55)"; // cornice at each floor line
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
          c.fillStyle = "rgba(0,0,0,0.5)"; // window bars
          c.fillRect(x + w / 2 - 1, y, 2, h);
        } else if (roll < 0.40) {
          c.fillStyle = "#2c4c9c"; // a TV's blue glow
          c.fillRect(x + 3, y + 3, w - 6, h - 6);
        } else if (roll < 0.42) {
          c.fillStyle = "#7a2cb8"; // alien light inside
          c.fillRect(x + 3, y + 3, w - 6, h - 6);
        }
        continue;
      }
      c.fillStyle = "#efe7d6"; c.fillRect(x - 4, y - 4, w + 8, h + 8); // frame
      c.fillStyle = "#17151c"; c.fillRect(x, y, w, h); // glass
      // arched top
      c.beginPath(); c.fillStyle = "#17151c"; c.ellipse(x + w / 2, y, w / 2, w * 0.35, 0, Math.PI, 0); c.fill();
      if (roll > 0.45) { // wooden shutters, open or closed
        c.fillStyle = shutterCols[Math.floor(r() * shutterCols.length)];
        if (r() < 0.5) c.fillRect(x, y, w, h);
        else { c.fillRect(x - w * 0.48, y, w * 0.45, h); c.fillRect(x + w * 1.03, y, w * 0.45, h); }
        c.fillStyle = "rgba(0,0,0,0.25)";
        for (let k = 0; k < h; k += 6) c.fillRect(x - w * 0.48, y + k, w * 1.96, 1);
      }
      if (r() < 0.4) { // small balcony
        c.fillStyle = "#6f655c"; c.fillRect(x - 10, y + h + 2, w + 20, 7);
        c.fillStyle = "#2a2420"; for (let k = 0; k <= w + 20; k += 6) c.fillRect(x - 10 + k, y + h - 14, 2, 16);
      }
    }
  }
}

function ashlar(c: Ctx, s: number, r: () => number): void { // sandstone blocks
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
  for (let i = 0; i < 9; i++) { // cracks
    c.beginPath();
    let x = r() * s, y = r() * s;
    c.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; c.lineTo(x, y); }
    c.lineWidth = 1 + r();
    c.stroke();
  }
  for (let i = 0; i < 12; i++) { // oil stains / puddles
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

/**
 * Re-map a block's UVs by world-space box projection, so one texture tile covers `tileU` × `tileV` metres
 * on every face, upright on walls, and patterns continue across neighbouring blocks.
 * (Level blocks are unrotated, so local position + mesh position = world position.)
 */
export function tileUVs(mesh: Mesh, tileU: number, tileV: number): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!pos || !nrm) return;
  const o = mesh.position;
  const uvs = new Array<number>((pos.length / 3) * 2);
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3] + o.x, y = pos[i * 3 + 1] + o.y, z = pos[i * 3 + 2] + o.z;
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    let u: number, v: number;
    if (Math.abs(ny) > 0.5) { u = x; v = z; } // floors / roofs
    else if (Math.abs(nx) > Math.abs(nz)) { u = nx > 0 ? -z : z; v = y; } // walls facing ±X
    else { u = nz > 0 ? x : -x; v = y; } // walls facing ±Z
    uvs[i * 2] = u / tileU;
    uvs[i * 2 + 1] = v / tileV;
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs);
}

const PASTELS = ["#5fa8a0", "#c8963e", "#c9928a", "#e3dccb", "#7fa7c9", "#9cc7a4", "#e0c873", "#c97f9a"];

function pastelFor(name: string): string {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return PASTELS[Math.abs(h) % PASTELS.length];
}

/** Materials for the level's blocks, chosen from the block's name. */
export class Surfaces {
  private scene: Scene;
  private tex = new Map<string, DynamicTexture>();
  private mats = new Map<string, StandardMaterial>();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  private t(kind: string): DynamicTexture {
    let t = this.tex.get(kind);
    if (!t) {
      const s = this.scene;
      switch (kind) {
        case "facade": t = makeTex(s, "facade", 512, (c, n, r) => facade(c, n, r, false), 11); break;
        case "facadeLit": t = makeTex(s, "facadeLit", 512, (c, n, r) => facade(c, n, r, true), 11); break;
        case "ashlar": t = makeTex(s, "ashlar", 256, ashlar, 3); break;
        case "cobbles": t = makeTex(s, "cobbles", 256, cobbles, 5); break;
        case "asphalt": t = makeTex(s, "asphalt", 256, asphalt, 9); break;
        case "planks": t = makeTex(s, "planks", 128, planks, 13); break;
        case "cracked": t = makeTex(s, "cracked", 256, cracked, 17); break;
        default: t = makeTex(s, "plaster", 256, (c, n, r) => plaster(c, n, r), 21);
      }
      this.tex.set(kind, t);
    }
    return t;
  }

  private material(key: string, color: string, tex: string, opts: { lit?: boolean; emissive?: string } = {}): StandardMaterial {
    let m = this.mats.get(key);
    if (!m) {
      m = new StandardMaterial(key, this.scene);
      m.diffuseColor = Color3.FromHexString(color);
      m.diffuseTexture = this.t(tex);
      m.specularColor = new Color3(0.04, 0.04, 0.04);
      m.maxSimultaneousLights = 8;
      if (opts.lit) {
        m.emissiveTexture = this.t("facadeLit");
        m.emissiveColor = Color3.Black();
        // Otherwise StandardMaterial multiplies emissive by the (dark-glass) diffuse texture and the windows never glow
        m.useEmissiveAsIllumination = true;
      }
      if (opts.emissive) m.emissiveColor = Color3.FromHexString(opts.emissive);
      this.mats.set(key, m);
    }
    return m;
  }

  /** Pick the look for a level block by its name, and tile its UVs to real-world size. */
  apply(mesh: Mesh, fallbackColor: string): void {
    const n = mesh.name;
    const isBuilding = /^(L\d|R\d|arcade-|plaza-)/.test(n);
    if (n === "ground") {
      mesh.material = this.material("ground", "#8a7464", "asphalt"); tileUVs(mesh, 6, 6);
    } else if (n === "street" || n === "alley") {
      mesh.material = this.material("cobbles", "#a08a76", "cobbles"); tileUVs(mesh, 3, 3);
    } else if (isBuilding) {
      const col = n === "plaza-sw" || n === "plaza-se" ? "#b8875a" : pastelFor(n);
      mesh.material = this.material("bld" + col, col, "facade", { lit: true }); tileUVs(mesh, 16, 14);
    } else if (/^(yard-|court-[nsw]|secret-back|secret-roof)/.test(n)) {
      mesh.material = this.material("sandstone", "#b48a60", "ashlar"); tileUVs(mesh, 4, 3);
    } else if (/^(cover|court-crate|stall|cart)/.test(n)) {
      mesh.material = this.material("crate", "#a5774a", "planks"); tileUVs(mesh, 1.3, 1.3);
    } else if (n === "secret-wall") {
      // Same paint as the neighbouring building, but visibly cracked: a fair clue for the secret
      const col = pastelFor("R1");
      mesh.material = this.material("crack" + col, col, "cracked"); tileUVs(mesh, 6, 4);
    } else if (n === "cage-door") {
      mesh.material = this.material("cagedoor", "#4a1010", "plaster", { emissive: "#c41818" });
    } else if (n.startsWith("cage")) {
      mesh.material = this.material("iron", "#3c3a40", "plaster", { emissive: "#120a1a" });
    } else {
      mesh.material = this.material("misc" + fallbackColor, fallbackColor, "plaster"); tileUVs(mesh, 4, 4);
    }
  }
}

// ───────────────────────── environment ─────────────────────────
export class Environment {
  readonly scene: Scene;
  readonly hemi: HemisphericLight;
  readonly moon: DirectionalLight;
  private sky: Mesh;
  private skyMat: ShaderMaterial;
  private time = 0;
  private particleTex: DynamicTexture;

  constructor(scene: Scene) {
    this.scene = scene;
    scene.clearColor = new Color4(FOG_COLOR.r, FOG_COLOR.g, FOG_COLOR.b, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0125;
    scene.fogColor = FOG_COLOR;
    scene.ambientColor = new Color3(0.28, 0.22, 0.28);

    // Cool sky light from above, warm bounce from the ground
    this.hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), scene);
    this.hemi.intensity = 0.7;
    this.hemi.diffuse = HEMI_COLOR.clone();
    this.hemi.groundColor = Color3.FromHexString("#7a3022"); // red/orange bounce from fires and alien light
    this.hemi.specular = Color3.Black();
    // Moonlight comes from the moon's direction in the sky
    this.moon = new DirectionalLight("moon", MOON_DIR.scale(-1), scene);
    this.moon.intensity = 0.42; // diffuse moonlight through the overcast
    this.moon.diffuse = Color3.FromHexString("#a8b2c8");
    this.moon.specular = Color3.FromHexString("#303848");

    this.skyMat = new ShaderMaterial("sky", scene, { vertex: "ijSky", fragment: "ijSky" }, {
      attributes: ["position"], uniforms: ["worldViewProjection", "time", "flash", "moonDir", "shipDir", "fogColor"],
    });
    this.skyMat.backFaceCulling = false;
    this.skyMat.disableDepthWrite = true;
    this.skyMat.setVector3("moonDir", MOON_DIR);
    this.skyMat.setVector3("shipDir", SHIP_DIR);
    this.skyMat.setFloat("flash", 0);
    this.skyMat.setColor3("fogColor", FOG_COLOR);
    this.sky = MeshBuilder.CreateSphere("sky", { diameter: 800, segments: 24 }, scene);
    this.sky.material = this.skyMat;
    this.sky.infiniteDistance = true;
    this.sky.isPickable = false;
    this.sky.applyFog = false;

    this.particleTex = makeTex(scene, "particle", 64, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.6)"); g.addColorStop(1, "rgba(255,255,255,0)");
      c.clearRect(0, 0, s, s); c.fillStyle = g; c.fillRect(0, 0, s, s);
    });
    this.particleTex.hasAlpha = true;

    // Lightning: a double flicker every 8–20 s brightens the clouds and briefly lifts the sky light
    let nextFlash = 6 + Math.random() * 8, flashT = -1;
    const hemiBase = this.hemi.intensity;
    scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      this.time += dt;
      this.skyMat.setFloat("time", this.time);
      let f = 0;
      if (flashT >= 0) {
        flashT += dt;
        f = Math.max(0, 1 - flashT / 0.09) + (flashT > 0.16 ? Math.max(0, 0.7 - (flashT - 0.16) / 0.12) : 0);
        if (flashT > 0.45) flashT = -1;
      } else if (this.time > nextFlash) {
        flashT = 0;
        nextFlash = this.time + 8 + Math.random() * 12;
      }
      this.skyMat.setFloat("flash", f);
      this.hemi.intensity = hemiBase + f * 0.9;
    });
  }

  /** Tone mapping, colour grading, a light bloom, vignette, a hint of chromatic aberration. */
  setupPost(camera: Camera): DefaultRenderingPipeline {
    const p = new DefaultRenderingPipeline("post", true, this.scene, [camera]);
    p.fxaaEnabled = false; // keep the crisp pixel look
    p.imageProcessingEnabled = true;
    const ip = p.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.18;
    ip.contrast = 1.32;
    ip.colorCurvesEnabled = true;
    if (ip.colorCurves) {
      // Key-art grade: cool grey-blue shadows, red/orange highlights, slightly muted midtones
      const cc = ip.colorCurves;
      cc.globalSaturation = 6;
      cc.shadowsHue = 215; cc.shadowsDensity = 22; cc.shadowsSaturation = 18; cc.shadowsExposure = -12;
      cc.midtonesHue = 220; cc.midtonesDensity = 6; cc.midtonesSaturation = -8;
      cc.highlightsHue = 14; cc.highlightsDensity = 34; cc.highlightsSaturation = 45;
    }
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 2.2;
    ip.vignetteColor = new Color4(0.06, 0.0, 0.0, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    p.bloomEnabled = true;
    p.bloomThreshold = 0.88;
    p.bloomWeight = 0.3;
    p.bloomKernel = 24;
    p.bloomScale = 0.25;
    // Film grain is left off: Babylon's grain pass cost ~90% of the frame rate in testing.
    p.grainEnabled = false;
    p.chromaticAberrationEnabled = true;
    p.chromaticAberration.aberrationAmount = 6;
    p.chromaticAberration.radialIntensity = 0.8;
    return p;
  }

  /** Warm sodium lamps on the lane's lamp posts (lamp heads overhang the lane by ~1 m). */
  addLamps(spots: [number, number][]): void {
    for (const [x, z] of spots) {
      const l = new PointLight("lamp", new Vector3(x < 0 ? x + 1 : x - 1, 4.8, z), this.scene);
      l.diffuse = Color3.FromHexString("#ffad55");
      l.specular = Color3.FromHexString("#553311");
      l.intensity = 1.25;
      l.range = 11;
    }
  }

  /** A burning wreck: flickering firelight, flames, smoke, embers. */
  addFire(at: Vector3): void {
    const s = this.scene;
    const light = new PointLight("fire", at.add(new Vector3(0, 2.9, 0)), s); // above the roof: lights the street, not just the wreck
    light.diffuse = Color3.FromHexString("#ff7a2a");
    light.range = 12;
    s.onBeforeRenderObservable.add(() => {
      light.intensity = 1.6 + Math.sin(this.time * 17) * 0.25 + Math.sin(this.time * 7.3) * 0.25 + Math.random() * 0.2;
    });

    const flames = this.ps("flames", 90, at.add(new Vector3(0, 0.9, 0)), new Vector3(-0.35, 0, -0.45), new Vector3(0.35, 0.3, 0.45)); // cabin only, so the body shows
    flames.color1 = new Color4(1, 0.75, 0.25, 1); flames.color2 = new Color4(1, 0.35, 0.05, 1); flames.colorDead = new Color4(0.3, 0.05, 0, 0);
    flames.minSize = 0.18; flames.maxSize = 0.45; flames.minLifeTime = 0.3; flames.maxLifeTime = 0.7;
    flames.emitRate = 70; flames.blendMode = ParticleSystem.BLENDMODE_ADD;
    // Realistic tongues: grow, then taper; white-yellow core -> orange -> deep red -> gone
    flames.addSizeGradient(0, 0.5); flames.addSizeGradient(0.35, 1.1); flames.addSizeGradient(1, 0.15);
    flames.addColorGradient(0, new Color4(0.9, 0.6, 0.25, 0.55)); flames.addColorGradient(0.3, new Color4(0.85, 0.35, 0.06, 0.5));
    flames.addColorGradient(0.7, new Color4(0.6, 0.12, 0.02, 0.35)); flames.addColorGradient(1, new Color4(0.2, 0.03, 0, 0));
    flames.minAngularSpeed = -1.5; flames.maxAngularSpeed = 1.5;
    // Hot low core inside the cabin
    const core = this.ps("fire-core", 60, at.add(new Vector3(0, 0.5, 0)), new Vector3(-0.35, 0, -0.5), new Vector3(0.35, 0.15, 0.5));
    core.minSize = 0.15; core.maxSize = 0.3; core.minLifeTime = 0.15; core.maxLifeTime = 0.3; core.emitRate = 30;
    core.blendMode = ParticleSystem.BLENDMODE_ADD;
    core.addColorGradient(0, new Color4(0.95, 0.75, 0.4, 0.5)); core.addColorGradient(1, new Color4(0.9, 0.35, 0.05, 0));
    core.direction1 = new Vector3(-0.1, 1, -0.1); core.direction2 = new Vector3(0.1, 1.6, 0.1);
    core.minEmitPower = 0.4; core.maxEmitPower = 0.8;
    flames.direction1 = new Vector3(-0.2, 2, -0.2); flames.direction2 = new Vector3(0.2, 3, 0.2);
    flames.minEmitPower = 0.6; flames.maxEmitPower = 1.2;

    const smoke = this.ps("smoke", 50, at.add(new Vector3(0, 1.4, 0)), new Vector3(-0.4, 0, -0.4), new Vector3(0.4, 0.2, 0.4));
    smoke.color1 = new Color4(0.18, 0.14, 0.16, 0.5); smoke.color2 = new Color4(0.1, 0.08, 0.1, 0.4); smoke.colorDead = new Color4(0.05, 0.04, 0.06, 0);
    smoke.minSize = 0.9; smoke.maxSize = 1.8; smoke.minLifeTime = 4; smoke.maxLifeTime = 7;
    smoke.emitRate = 16; smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    smoke.addSizeGradient(0, 0.6); smoke.addSizeGradient(1, 3.2); // billows outward as it rises
    smoke.addColorGradient(0, new Color4(0.12, 0.08, 0.07, 0.65)); smoke.addColorGradient(0.5, new Color4(0.1, 0.09, 0.1, 0.4));
    smoke.addColorGradient(1, new Color4(0.08, 0.08, 0.09, 0));
    smoke.direction1 = new Vector3(-0.3, 1, -0.1); smoke.direction2 = new Vector3(0.5, 1.6, 0.3);
    smoke.minEmitPower = 0.5; smoke.maxEmitPower = 0.9;
    smoke.minAngularSpeed = -0.4; smoke.maxAngularSpeed = 0.4;

    const embers = this.ps("embers", 60, at.add(new Vector3(0, 0.8, 0)), new Vector3(-0.8, 0, -0.8), new Vector3(0.8, 0.5, 0.8));
    embers.color1 = new Color4(1, 0.7, 0.2, 1); embers.color2 = new Color4(1, 0.45, 0.1, 1); embers.colorDead = new Color4(1, 0.2, 0, 0);
    embers.minSize = 0.05; embers.maxSize = 0.12; embers.minLifeTime = 2; embers.maxLifeTime = 4;
    embers.emitRate = 14; embers.blendMode = ParticleSystem.BLENDMODE_ADD;
    embers.direction1 = new Vector3(-0.6, 1.5, -0.6); embers.direction2 = new Vector3(0.8, 2.5, 0.6);
    embers.minEmitPower = 0.7; embers.maxEmitPower = 1.4;
    embers.gravity = new Vector3(0.3, 0.2, 0);
  }

  /** Ambient particles: violet alien spores over the plaza, dust motes in the bazaar lane. */
  addAmbientParticles(): void {
    const spores = this.ps("spores", 160, Vector3.Zero(), new Vector3(-25, 0.5, 60), new Vector3(25, 16, 112));
    spores.color1 = new Color4(1, 0.25, 0.08, 1); spores.color2 = new Color4(0.55, 0.5, 0.48, 0.6); spores.colorDead = new Color4(0.3, 0.05, 0.02, 0); // embers + ash
    spores.minSize = 0.08; spores.maxSize = 0.22; spores.minLifeTime = 6; spores.maxLifeTime = 11;
    spores.emitRate = 16; spores.blendMode = ParticleSystem.BLENDMODE_ADD;
    spores.direction1 = new Vector3(-0.3, 0.05, -0.3); spores.direction2 = new Vector3(0.3, 0.35, 0.3);
    spores.minEmitPower = 0.2; spores.maxEmitPower = 0.5;
    spores.preWarmCycles = 120; spores.preWarmStepOffset = 5;

    const dust = this.ps("dust", 110, Vector3.Zero(), new Vector3(-4, 0.3, -12), new Vector3(4, 6, 60));
    dust.color1 = new Color4(1, 0.85, 0.65, 0.45); dust.color2 = new Color4(0.8, 0.75, 1, 0.3); dust.colorDead = new Color4(1, 0.9, 0.8, 0);
    dust.minSize = 0.04; dust.maxSize = 0.09; dust.minLifeTime = 5; dust.maxLifeTime = 9;
    dust.emitRate = 12; dust.blendMode = ParticleSystem.BLENDMODE_ADD;
    dust.direction1 = new Vector3(-0.15, -0.05, -0.15); dust.direction2 = new Vector3(0.2, 0.1, 0.2);
    dust.minEmitPower = 0.1; dust.maxEmitPower = 0.25;
    dust.preWarmCycles = 100; dust.preWarmStepOffset = 5;
  }

  /**
   * The alien mothership hanging over the city to the north, if the Blender model exists.
   * Huge (~260 m), unfogged so it reads against the sky, and slowly drifting. Missing file = skipped.
   */
  async addMothership(): Promise<void> {
    let m: Awaited<ReturnType<typeof place>>;
    try {
      m = await place(this.scene, "mothership.glb", new Vector3(-150, 215, 290));
    } catch {
      return;
    }
    const { min, max } = m.root.getHierarchyBoundingVectors(true);
    const size = Math.max(max.x - min.x, max.z - min.z, 1);
    m.root.scaling.setAll(260 / size);
    for (const mesh of m.meshes) { mesh.applyFog = false; mesh.isPickable = false; mesh.name = "fx-" + mesh.name; }
    const base = m.root.position.clone();
    redMothership(this.scene, m.root, base.y); // key art: blood-red lights + a huge red beam
    this.scene.onBeforeRenderObservable.add(() => {
      m.root.position.x = base.x + Math.sin(this.time * 0.02) * 25;
      m.root.position.y = base.y + Math.sin(this.time * 0.13) * 2;
      m.root.rotation.y = this.time * 0.004;
    });
  }

  /** Key-art sky dressing: the saucer fleet with red tractor beams, plus smoke columns rising off the skyline. */
  async addFleet(): Promise<void> {
    this.addSkylineSmoke();
    this.redAlienMaterials();
    await addFleet(this.scene);
  }

  /** Alien glow materials baked into models (pylon crystals, crashed pod, old vines) were violet: make them blood red. */
  private redAlienMaterials(): void {
    const RED_GLOW = /^(PylonCore|PodGlow|AlienGlow)$/;
    const recolor = (m: { name: string }) => {
      if (!RED_GLOW.test(m.name)) return;
      const pm = m as unknown as { emissiveColor?: Color3 };
      if (pm.emissiveColor) pm.emissiveColor = new Color3(1.0, 0.1, 0.06);
    };
    for (const m of this.scene.materials) recolor(m);
    // glTF materials get their emissive set right after creation, so recolor on the next tick
    this.scene.onNewMaterialAddedObservable.add((m) => setTimeout(() => recolor(m), 0));
  }

  /** 6 tall dark smoke plumes behind the buildings, lit orange at their base by unseen fires. */
  private addSkylineSmoke(): void {
    const spots: [number, number][] = [[-38, 18], [36, 30], [-42, 96], [44, 84], [12, 138], [-20, -34]];
    for (const [x, z] of spots) {
      const smoke = new ParticleSystem("fx-plume", 70, this.scene);
      smoke.particleTexture = this.particleTex;
      smoke.emitter = new Vector3(x, 9, z);
      smoke.createCylinderEmitter(2.2, 0.5, 0, 0);
      smoke.color1 = new Color4(0.09, 0.08, 0.08, 0.75); smoke.color2 = new Color4(0.16, 0.14, 0.14, 0.6);
      smoke.colorDead = new Color4(0.12, 0.11, 0.11, 0);
      smoke.addColorGradient(0, new Color4(0.9, 0.35, 0.1, 0.65)); // fire-lit base
      smoke.addColorGradient(0.12, new Color4(0.2, 0.12, 0.1, 0.7));
      smoke.addColorGradient(1, new Color4(0.1, 0.09, 0.09, 0));
      smoke.minSize = 4; smoke.maxSize = 7; smoke.addSizeGradient(0, 0.6); smoke.addSizeGradient(1, 3.2);
      smoke.minLifeTime = 9; smoke.maxLifeTime = 14; smoke.emitRate = 6;
      smoke.direction1 = new Vector3(-0.3, 1, -0.2); smoke.direction2 = new Vector3(0.5, 1.4, 0.3);
      smoke.minEmitPower = 2.2; smoke.maxEmitPower = 3.4; smoke.gravity = new Vector3(0.35, 0.25, 0.1); // drift with the wind
      smoke.minAngularSpeed = -0.2; smoke.maxAngularSpeed = 0.2;
      smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      smoke.preWarmCycles = 140; smoke.preWarmStepOffset = 8;
      smoke.start();
      // Orange glow of the fire behind the roofline
      const glow = new ParticleSystem("fx-fireglow", 12, this.scene);
      glow.particleTexture = this.particleTex;
      glow.emitter = new Vector3(x, 8, z);
      glow.createSphereEmitter(1.5);
      glow.color1 = new Color4(1, 0.45, 0.1, 0.55); glow.color2 = new Color4(1, 0.25, 0.05, 0.45); glow.colorDead = new Color4(1, 0.2, 0, 0);
      glow.minSize = 6; glow.maxSize = 10; glow.minLifeTime = 0.6; glow.maxLifeTime = 1.2; glow.emitRate = 9;
      glow.minEmitPower = 0; glow.maxEmitPower = 0.3; glow.blendMode = ParticleSystem.BLENDMODE_ADD;
      glow.start();
    }
  }

  private ps(name: string, capacity: number, emitter: Vector3, min: Vector3, max: Vector3): ParticleSystem {
    const p = new ParticleSystem(name, capacity, this.scene);
    p.particleTexture = this.particleTex;
    p.emitter = emitter;
    p.createBoxEmitter(new Vector3(0, 1, 0), new Vector3(0, 1, 0), min, max);
    p.start();
    return p;
  }

  /**
   * Babylon gives every mesh the first N lights regardless of distance, so far-away point lights waste
   * slots and can push out the ones that matter. Restrict each local light to the meshes within its range.
   * Call again after models load. Leaves the muzzle flash global.
   */
  restrictPointLights(): void {
    for (const l of this.scene.lights) {
      if (!(l instanceof PointLight) || l.name === "muzzle") continue;
      const pos = l.getAbsolutePosition();
      const r = l.range;
      l.includedOnlyMeshes = this.scene.meshes.filter((m) => {
        if (m === this.sky) return false;
        const bb = m.getBoundingInfo().boundingBox;
        return BoundingBox.IntersectsSphere(bb.minimumWorld, bb.maximumWorld, pos, r);
      });
    }
  }
}
