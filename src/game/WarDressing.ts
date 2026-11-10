import {
  Color3, Color4, DynamicTexture, type Mesh, MeshBuilder, PBRMaterial, ParticleSystem, PointLight, StandardMaterial,
  Texture, VertexBuffer, Vector3, type Scene,
} from "@babylonjs/core";
import type { Level } from "./Level";
import type { GroundDecalData, PuddleData, QuadData, WallDecalData } from "../data/level";

/**
 * Key-art war dressing (art/concepts/keyart/charminar-occupied-chatgpt.png). Positions come from the level data;
 * textures are pre-rendered PNGs (tools/textures/generators.ts). Burnt-out cars + rubble are level-data props;
 * this file adds red alien propaganda banners + glowing billboard screens on the surrounding buildings (never on the
 * Charminar, a religious site), bullet-pock / scorch decals, and wet puddles. Wrecks and rubble are Sketchfab CC BY
 * (credited in src/credits.ts), optimized by tools/blender/optimize_props.py. Decorative quads use an `fx` prefix
 * so they don't cast shadows.
 */

const BASE = import.meta.env.BASE_URL;
const gen = (file: string, scene: Scene, alpha = false): Texture => {
  const t = new Texture(`${BASE}textures/generated/${file}`, scene);
  t.hasAlpha = alpha;
  return t;
};

/** A row of made-up alien glyphs. */
function drawGlyphs(c: CanvasRenderingContext2D, x0: number, y: number, width: number, size: number, color: string, seed: number): void {
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  c.strokeStyle = color;
  c.lineWidth = Math.max(2, size * 0.12);
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

export async function dressWarDamage(scene: Scene, level: Level): Promise<void> {
  // (Wrecks and rubble are placed from the level data by Level.decorate(); smouldering is a prop "effect".)
  const d = level.data;
  banners(scene, d.banners);
  billboards(scene, d.billboards);
  wallDecals(scene, d.wallDecals, d.scorchDecals);
  puddles(scene, d.puddles);
}

/** A small orange glow + rising smoke at a smouldering wreck. */
export function smoulder(scene: Scene, at: Vector3): void {
  const light = new PointLight("smoulder", at.add(new Vector3(0, 0.4, 0)), scene);
  light.diffuse = Color3.FromHexString("#ff6a1f");
  light.range = 7;
  let t = Math.random() * 10;
  scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    light.intensity = 0.9 + Math.sin(t * 11) * 0.15 + Math.sin(t * 5.3) * 0.15;
  });
  const dot = gen("particle_smoke.png", scene, true);
  const smoke = new ParticleSystem("fx-wreckSmoke", 60, scene);
  smoke.particleTexture = dot;
  smoke.emitter = at.clone();
  smoke.minEmitBox = new Vector3(-0.8, 0, -0.8); smoke.maxEmitBox = new Vector3(0.8, 0.3, 0.8);
  smoke.color1 = new Color4(0.22, 0.2, 0.2, 0.5); smoke.color2 = new Color4(0.12, 0.11, 0.11, 0.4); smoke.colorDead = new Color4(0.1, 0.1, 0.1, 0);
  smoke.minSize = 0.8; smoke.maxSize = 1.8; smoke.minLifeTime = 3; smoke.maxLifeTime = 5.5;
  smoke.emitRate = 10; smoke.gravity = new Vector3(0.25, 0.9, 0);
  smoke.direction1 = new Vector3(-0.2, 1, -0.2); smoke.direction2 = new Vector3(0.2, 1.4, 0.2);
  smoke.minEmitPower = 0.3; smoke.maxEmitPower = 0.7;
  smoke.addSizeGradient(0, 0.6); smoke.addSizeGradient(1, 2.6);
  smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  smoke.start();
  // a few embers for the glowing core
  const embers = new ParticleSystem("fx-wreckEmbers", 30, scene);
  embers.particleTexture = dot; embers.emitter = at.clone();
  embers.minEmitBox = new Vector3(-0.6, 0, -0.6); embers.maxEmitBox = new Vector3(0.6, 0.2, 0.6);
  embers.color1 = new Color4(1, 0.6, 0.2, 1); embers.color2 = new Color4(1, 0.35, 0.05, 1); embers.colorDead = new Color4(0.5, 0.1, 0, 0);
  embers.minSize = 0.04; embers.maxSize = 0.09; embers.minLifeTime = 0.8; embers.maxLifeTime = 1.6;
  embers.emitRate = 12; embers.gravity = new Vector3(0, 1.2, 0); embers.blendMode = ParticleSystem.BLENDMODE_ADD;
  embers.start();
}

function banners(scene: Scene, spots: QuadData[]): void {
  const tex = gen("alien_banner.png", scene);
  const mat = new StandardMaterial("fx-bannerMat", scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(0.32, 0.3, 0.3); // reads at night, like the lit banners in the key art
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  mat.backFaceCulling = false;
  mat.maxSimultaneousLights = 8;

  const cloths: { mesh: Mesh; base: Float32Array; phase: number; h: number }[] = [];
  for (const { pos: [x, y, z], yaw, size: [w, h] } of spots) {
    const m = MeshBuilder.CreateGround("fx-banner", { width: w, height: h, subdivisionsX: 4, subdivisionsY: 12, updatable: true }, scene);
    m.rotation.set(-Math.PI / 2, yaw, 0); // stand the cloth up; its face points along `yaw`
    m.position.set(x, y, z);
    m.material = mat;
    m.isPickable = false;
    const rod = MeshBuilder.CreateCylinder("fx-bannerRod", { diameter: 0.08, height: w + 0.3, tessellation: 6 }, scene);
    rod.rotation.set(0, yaw, Math.PI / 2);
    rod.position.set(x, y + h / 2 + 0.05, z);
    rod.material = mat; rod.isPickable = false;
    cloths.push({ mesh: m, base: Float32Array.from(m.getVerticesData(VertexBuffer.PositionKind)!), phase: Math.random() * 6, h });
  }
  // Gentle cloth sway: ripple along the banner's normal, growing toward the free bottom edge
  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    for (const c of cloths) {
      const pos = c.base.slice();
      for (let i = 0; i < pos.length; i += 3) {
        const lz = pos[i + 2]; // ground z = banner height axis (top at +h/2 after the stand-up rotation)
        const k = (c.h / 2 - lz) / c.h; // 0 at the top rod, 1 at the hem
        pos[i + 1] = Math.sin(t * 1.7 + c.phase + lz * 0.8 + pos[i] * 0.9) * 0.18 * k;
      }
      c.mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
    }
  });
}

function billboards(scene: Scene, spots: QuadData[]): void {
  // Static frame (gradient + emblem) is pre-rendered; glyph rows, scanlines and the border animate on top at runtime
  const base = new Image();
  base.src = `${BASE}textures/generated/alien_billboard_base.png`;
  const frameMat = new StandardMaterial("fx-screenFrame", scene);
  frameMat.diffuseColor = Color3.FromHexString("#1a1418");
  frameMat.specularColor = new Color3(0.2, 0.2, 0.2);
  const screens: { tex: DynamicTexture; mat: StandardMaterial; seed: number }[] = [];
  spots.forEach(({ pos: [x, y, z], yaw, size: [w, h] }, i) => {
    const tex = new DynamicTexture(`fx-screenTex${i}`, { width: 512, height: 290 }, scene, true);
    const mat = new StandardMaterial(`fx-screenMat${i}`, scene);
    mat.diffuseColor = Color3.Black();
    mat.emissiveTexture = tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    const scr = MeshBuilder.CreatePlane("fx-screen", { width: w, height: h }, scene);
    scr.rotation.y = yaw + Math.PI; // plane faces -Z by default; turn it to face the street
    scr.position.set(x, y, z);
    scr.material = mat; scr.isPickable = false;
    const frame = MeshBuilder.CreateBox("billboard-frame", { width: w + 0.35, height: h + 0.35, depth: 0.3 }, scene);
    frame.rotation.y = yaw;
    const back = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).scale(-0.17);
    frame.position.set(x + back.x, y, z + back.z);
    frame.material = frameMat;
    const glow = new PointLight("screenGlow", new Vector3(x - back.x * 8, y - 1, z - back.z * 8), scene);
    glow.diffuse = Color3.FromHexString("#ff2a2a"); glow.intensity = 0.9; glow.range = 10;
    screens.push({ tex, mat, seed: i * 31 + 5 });
  });
  // Animated content: emblem + glyph rows + scanlines, redrawn ~12x/second, with flicker
  let t = 0, acc = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    t += dt; acc += dt;
    for (const s of screens) {
      const f = 0.62 + Math.sin(t * 37 + s.seed) * 0.04 + (Math.random() < 0.02 ? -0.3 : 0);
      s.mat.emissiveColor.set(f, f * 0.55, f * 0.55);
    }
    if (acc < 1 / 12) return;
    acc = 0;
    for (const s of screens) {
      const c = s.tex.getContext() as unknown as CanvasRenderingContext2D;
      if (base.complete && base.naturalWidth) c.drawImage(base, 0, 0, 512, 290);
      else { c.fillStyle = "#3a0204"; c.fillRect(0, 0, 512, 290); }
      const scroll = Math.floor(t * 30) % 60;
      drawGlyphs(c, 290, 70, 200, 24, "#ffd6d6", s.seed + Math.floor(t * 2));
      drawGlyphs(c, 290, 120, 200, 24, "#ffb3b3", s.seed + 3);
      drawGlyphs(c, 290, 170, 200, 24, "#ffd6d6", s.seed + 11 + Math.floor(t));
      drawGlyphs(c, 290, 220, 200, 24, "#ff9a9a", s.seed + 17);
      c.fillStyle = "rgba(0,0,0,0.28)";
      for (let y = -60 + scroll; y < 290; y += 6) c.fillRect(0, y, 512, 2); // scanlines
      c.strokeStyle = "#ff6a6a"; c.lineWidth = 6; c.strokeRect(8, 8, 496, 274);
      s.tex.update(true);
    }
  });
}

function wallDecals(scene: Scene, walls: WallDecalData[], scorch: GroundDecalData[]): void {
  const pock = gen("decal_pock_scorch.png", scene, true);
  const mat = new StandardMaterial("fx-pockMat", scene);
  mat.diffuseTexture = pock; mat.useAlphaFromDiffuseTexture = true;
  mat.specularColor = Color3.Black(); mat.zOffset = -2; mat.backFaceCulling = false;
  for (const { pos: [x, y, z], yaw, size: s, spin } of walls) {
    const p = MeshBuilder.CreatePlane("fx-pock", { size: s }, scene);
    p.rotation.y = yaw + Math.PI;
    p.position.set(x, y, z);
    p.rotation.z = spin;
    p.material = mat; p.isPickable = false;
  }
  for (const { pos: [x, y, z], size: s, yaw } of scorch) {
    const g = MeshBuilder.CreateGround("fx-scorch", { width: s, height: s }, scene);
    g.position.set(x, y, z); g.rotation.y = yaw;
    g.material = mat; g.isPickable = false;
  }
}

function puddles(scene: Scene, spots: PuddleData[]): void {
  const tex = gen("decal_puddle_mask.png", scene, true);
  const mat = new PBRMaterial("fx-puddleMat", scene);
  mat.albedoColor = Color3.FromHexString("#1c1c24");
  mat.opacityTexture = tex;
  mat.metallic = 0.35;
  mat.roughness = 0.04; // mirror-like: picks up the env map + specular streaks from lamps, fires and screens
  mat.usePhysicalLightFalloff = false;
  mat.zOffset = -1;
  mat.maxSimultaneousLights = 8;
  mat.alpha = 0.7;
  mat.environmentIntensity = 1.6; // stronger reflection of the night sky / city glow
  for (const { pos: [x, y, z], size: [w, d], yaw } of spots) {
    const p = MeshBuilder.CreateGround("fx-puddle", { width: w, height: d }, scene);
    p.position.set(x, y, z);
    p.rotation.y = yaw;
    p.material = mat;
    p.isPickable = false;
  }
}
