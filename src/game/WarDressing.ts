import {
  Color3, Color4, DynamicTexture, type Mesh, MeshBuilder, PBRMaterial, ParticleSystem, PointLight, StandardMaterial,
  VertexBuffer, Vector3, type Scene,
} from "@babylonjs/core";
import type { Level } from "./Level";
import { makeSolid, place } from "./Props";

/**
 * Key-art war dressing (art/concepts/keyart/charminar-occupied-chatgpt.png): burnt-out cars (two smouldering),
 * rubble, red alien propaganda banners + glowing billboard screens on the surrounding buildings (never on the
 * Charminar, a religious site), bullet-pock / scorch decals, and wet puddles. Wrecks and rubble are Sketchfab CC BY
 * (credited in src/credits.ts), optimized by tools/blender/optimize_props.py. Decorative quads use an `fx` prefix
 * so they don't cast shadows.
 */

const RED = "#b3121b";

function canvasTex(scene: Scene, name: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, alpha = false): DynamicTexture {
  const t = new DynamicTexture(name, { width: w, height: h }, scene, true);
  const c = t.getContext() as unknown as CanvasRenderingContext2D;
  c.clearRect(0, 0, w, h);
  draw(c);
  t.hasAlpha = alpha;
  t.update(true);
  return t;
}

/** Original alien emblem: elongated head, big dark almond eyes. Drawn centred at (cx, cy) with height h. */
function drawEmblem(c: CanvasRenderingContext2D, cx: number, cy: number, h: number, face = "#f4efe6", eye = "#120607"): void {
  const w = h * 0.62;
  c.save();
  c.translate(cx, cy);
  c.fillStyle = face;
  c.beginPath();
  c.moveTo(0, -h / 2);
  c.bezierCurveTo(w * 0.62, -h / 2, w * 0.62, h * 0.05, w * 0.18, h * 0.38);
  c.quadraticCurveTo(0, h / 2, -w * 0.18, h * 0.38);
  c.bezierCurveTo(-w * 0.62, h * 0.05, -w * 0.62, -h / 2, 0, -h / 2);
  c.fill();
  c.fillStyle = eye;
  for (const sx of [-1, 1]) {
    c.save();
    c.translate(sx * w * 0.2, h * 0.02);
    c.rotate(sx * 0.55);
    c.beginPath();
    c.ellipse(0, 0, w * 0.2, h * 0.085, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.fillRect(-w * 0.07, h * 0.27, w * 0.14, h * 0.012); // thin mouth slit
  c.restore();
}

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
  const jobs: Promise<unknown>[] = [];
  const S = (file: string, x: number, z: number, yaw: number) =>
    place(scene, `props/${file}.glb`, new Vector3(x, 0, z), yaw).then((p) => { makeSolid(p, 0.9); return p; });

  // ── 1) Burnt-out cars (plaza edges, clear of paths, spawn points, pylons and the cage door) ──
  jobs.push(S("car_burned_pair", -12.6, 99.5, 1.2).then(() => smoulder(scene, new Vector3(-12.6, 0.9, 99.5))));
  jobs.push(S("car_crashed", 21, 63.6, -0.3).then(() => smoulder(scene, new Vector3(21, 0.8, 63.6))));
  jobs.push(S("car_sedan_abandoned", 8.5, 108, 1.4));
  jobs.push(S("car_crashed", -19.5, 76, 0.1));

  // ── 2) Rubble and broken masonry at building bases ──
  jobs.push(S("concrete_chunks", -24.2, 96, 0.5));
  jobs.push(S("concrete_chunks", 24.2, 70.5, 2.3));
  jobs.push(S("concrete_chunks", 13, 110.3, 0.2));
  jobs.push(S("concrete_chunks", 6.5, 62.6, 0.6)); // (thin "concrete_debris" slabs read as floating sheets; removed)
  jobs.push(S("concrete_chunks", -23.5, 104.5, 1.9));
  jobs.push(S("concrete_chunks", -3.2, 50.4, 1.57));
  jobs.push(S("concrete_chunks", 19.5, 99.5, 0.4));

  // ── 3) Alien propaganda banners (rooflines of plaza buildings + two in the lane) and billboard screens ──
  banners(scene);
  billboards(scene);

  // ── 4) Bullet-pock / scorch decals on walls and ground ──
  wallDecals(scene);

  // ── 5) Puddles ──
  puddles(scene);

  void level;
  await Promise.allSettled(jobs);
}

/** A small orange glow + rising smoke at a smouldering wreck. */
function smoulder(scene: Scene, at: Vector3): void {
  const light = new PointLight("smoulder", at.add(new Vector3(0, 0.4, 0)), scene);
  light.diffuse = Color3.FromHexString("#ff6a1f");
  light.range = 7;
  let t = Math.random() * 10;
  scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    light.intensity = 0.9 + Math.sin(t * 11) * 0.15 + Math.sin(t * 5.3) * 0.15;
  });
  const dot = canvasTex(scene, "fx-smokeDot", 64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  }, true);
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

function banners(scene: Scene): void {
  const tex = canvasTex(scene, "fx-bannerTex", 256, 704, (c) => {
    c.fillStyle = RED; c.fillRect(0, 0, 256, 704);
    c.fillStyle = "#7d0a10"; c.fillRect(0, 0, 256, 26); c.fillRect(0, 678, 256, 26); c.fillRect(0, 0, 14, 704); c.fillRect(242, 0, 14, 704);
    c.strokeStyle = "#f4efe6"; c.lineWidth = 4; c.strokeRect(28, 44, 200, 616);
    drawEmblem(c, 128, 250, 250);
    drawGlyphs(c, 44, 470, 170, 26, "#f4efe6", 7);
    drawGlyphs(c, 44, 520, 170, 26, "#f4efe6", 19);
    c.fillStyle = "#f4efe6";
    for (let i = 0; i < 6; i++) c.fillRect(56 + i * 26, 600, 14, 40 + (i % 3) * 8); // ragged hem stripes
  });
  const mat = new StandardMaterial("fx-bannerMat", scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(0.32, 0.3, 0.3); // reads at night, like the lit banners in the key art
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  mat.backFaceCulling = false;
  mat.maxSimultaneousLights = 8;

  // [x, centreY, z, yaw (facing), width, height] — plaza rooflines (walls at z=60/112, x=±26) and two in the lane
  const spots: [number, number, number, number, number, number][] = [
    [-14, 7.4, 111.0, Math.PI, 2.5, 7], [0, 7.4, 111.0, Math.PI, 2.5, 7], [14, 7.4, 111.0, Math.PI, 2.5, 7],
    [-25.0, 7.4, 101, Math.PI / 2, 2.5, 7], [25.0, 7.4, 70, -Math.PI / 2, 2.5, 7],
    [-15, 7.4, 61.0, 0, 2.5, 7], [15, 7.4, 61.0, 0, 2.5, 7],
    [-3.15, 6.2, 34.5, Math.PI / 2, 1.6, 4.6], [3.15, 6.8, 23.5, -Math.PI / 2, 1.6, 4.6],
  ];
  const cloths: { mesh: Mesh; base: Float32Array; phase: number; h: number }[] = [];
  for (const [x, y, z, yaw, w, h] of spots) {
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

function billboards(scene: Scene): void {
  // [x, y, z, yaw, w, h]: on top of the plaza arcades and high on the tall lane building, facing the player routes
  const spots: [number, number, number, number, number, number][] = [
    [-23.9, 9.6, 75, Math.PI / 2, 6, 3.4], [23.9, 9.6, 89, -Math.PI / 2, 6, 3.4], [3.0, 12.6, 50, -Math.PI / 2, 4.2, 2.4],
  ];
  const frameMat = new StandardMaterial("fx-screenFrame", scene);
  frameMat.diffuseColor = Color3.FromHexString("#1a1418");
  frameMat.specularColor = new Color3(0.2, 0.2, 0.2);
  const screens: { tex: DynamicTexture; mat: StandardMaterial; seed: number }[] = [];
  spots.forEach(([x, y, z, yaw, w, h], i) => {
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
      c.fillStyle = "#3a0204"; c.fillRect(0, 0, 512, 290);
      const g = c.createRadialGradient(150, 145, 10, 150, 145, 190);
      g.addColorStop(0, "#d01218"); g.addColorStop(1, "#3a0204");
      c.fillStyle = g; c.fillRect(0, 0, 512, 290);
      drawEmblem(c, 150, 145, 200, "#f2d8d8", "#220203");
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

function wallDecals(scene: Scene): void {
  const pock = canvasTex(scene, "fx-pockTex", 256, 256, (c) => {
    // scorch cloud
    const g = c.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, "rgba(10,8,6,0.75)"); g.addColorStop(0.55, "rgba(20,16,12,0.45)"); g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
    // bullet pocks
    let r = 42;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 26; i++) {
      const x = 40 + rnd() * 176, y = 40 + rnd() * 176, s = 3 + rnd() * 6;
      c.fillStyle = "rgba(5,4,3,0.95)"; c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill();
      c.fillStyle = "rgba(120,110,95,0.5)"; c.beginPath(); c.arc(x + s * 0.4, y - s * 0.4, s * 1.6, 0, Math.PI * 2); c.fill();
    }
  }, true);
  const mat = new StandardMaterial("fx-pockMat", scene);
  mat.diffuseTexture = pock; mat.useAlphaFromDiffuseTexture = true;
  mat.specularColor = Color3.Black(); mat.zOffset = -2; mat.backFaceCulling = false;
  // [x, y, z, yaw (normal direction), size]: arcade fronts (x=±22), plaza-w/e walls, lane building ends, ground scorch
  const walls: [number, number, number, number, number][] = [
    [-21.96, 2.4, 70, Math.PI / 2, 3.2], [-21.96, 4.6, 79, Math.PI / 2, 2.6], [21.96, 2.2, 84, -Math.PI / 2, 3], [21.96, 4.8, 94, -Math.PI / 2, 2.4],
    [-25.96, 3.5, 63, Math.PI / 2, 2.6], [21.96, 3.0, 88.5, -Math.PI / 2, 3.2], [-14, 3.2, 26.04, 0, 3], [-10, 2.4, 31.96, Math.PI, 2.6],
  ];
  for (const [x, y, z, yaw, s] of walls) {
    const p = MeshBuilder.CreatePlane("fx-pock", { size: s }, scene);
    p.rotation.y = yaw + Math.PI;
    p.position.set(x, y, z);
    p.rotation.z = Math.random() * Math.PI;
    p.material = mat; p.isPickable = false;
  }
  for (const [x, z, s] of [[-12.6, 99.5, 5.5], [21, 63.6, 5], [-9, 63.5, 5], [-19.5, 76, 4.2]] as [number, number, number][]) {
    const g = MeshBuilder.CreateGround("fx-scorch", { width: s, height: s }, scene);
    g.position.set(x, 0.018, z); g.rotation.y = Math.random() * Math.PI;
    g.material = mat; g.isPickable = false;
  }
}

function puddles(scene: Scene): void {
  const tex = canvasTex(scene, "fx-puddleTex", 256, 256, (c) => {
    // irregular blob: overlapping soft circles
    let r = 7;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 9; i++) {
      const x = 70 + rnd() * 116, y = 70 + rnd() * 116, rad = 40 + rnd() * 50;
      const g = c.createRadialGradient(x, y, rad * 0.4, x, y, rad);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill();
    }
  }, true);
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
  const spots: [number, number, number][] = [
    [1.2, 8, 2.2], [-1.5, 27, 1.8], [0.8, 46, 2.4], [-0.6, 55, 1.6],
    [-3, 66, 3.2], [9, 70, 2.6], [-15, 82, 3], [14, 84, 2.4], [-6, 97, 2.2], [11, 96, 3.4], [-19, 108, 2.6], [2, 72, 1.8], [18, 106, 2.2],
  ];
  for (const [x, z, s] of spots) {
    const p = MeshBuilder.CreateGround("fx-puddle", { width: s * 1.4, height: s }, scene);
    p.position.set(x, 0.02, z);
    p.rotation.y = Math.random() * Math.PI;
    p.material = mat;
    p.isPickable = false;
  }
}
