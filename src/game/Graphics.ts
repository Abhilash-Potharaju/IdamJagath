import { effective, updateSettings } from "../ui/settings";
import {
  type AbstractMesh, CascadedShadowGenerator, type Camera, Constants, type DefaultRenderingPipeline, type DirectionalLight,
  type Engine, SSAO2RenderingPipeline, SSRRenderingPipeline, type Scene, ShadowGenerator,
  StandardMaterial,
} from "@babylonjs/core";

/**
 * Modern rendering setup: full-resolution (DPR-aware) output with adaptive resolution, anti-aliasing, cascaded
 * moon shadows, SSAO contact shadows, screen-space reflections on the wet street, and quality presets.
 * `?retro` restores the old half-resolution pixel look. `?quality=low|medium|high` picks a preset (default high).
 */
export type Quality = "low" | "medium" | "high" | "ultra";

export interface GraphicsSettings {
  retro: boolean;
  quality: Quality;
  /** Device-pixel-ratio cap (1 = CSS pixels, 2 = retina). */
  maxDpr: number;
  shadows: boolean;
  shadowMapSize: number;
  ssao: boolean;
  ssr: boolean;
  msaa: number;
  fxaa: boolean;
  /** Lower the resolution automatically when FPS stays low. */
  adaptive: boolean;
}

const params = new URLSearchParams(location.search);
const q = params.get("quality");
// URL ?quality wins (testing); otherwise the saved Settings preset (applied on reload)
const quality: Quality = q === "low" || q === "medium" || q === "high" || q === "ultra" ? q : effective().quality;
const retro = params.has("retro");
const flag = (name: string, dflt: boolean): boolean => (params.has(name) ? params.get(name) !== "0" : dflt);

/** Current settings; a settings menu can change these and call `applyResolution` / reload. */
export const graphicsSettings: GraphicsSettings = {
  retro,
  quality,
  maxDpr: quality === "low" ? 1 : quality === "ultra" ? 2 : 1.5,
  shadows: !retro,
  shadowMapSize: quality === "low" ? 1024 : 2048,
  // ?ssao=0|1 and ?ssr=0|1 override the preset (handy for A/B checks)
  // SSAO is opt-in: combined with SSR (shared pre-pass) it produced a grey maze-like noise on the ground
  ssao: flag("ssao", !retro && quality === "ultra" && params.get("ssr") === "0"),
  ssr: flag("ssr", !retro && (quality === "high" || quality === "ultra")),
  // MSAA x4 on top of a high-DPR canvas was costly; FXAA handles edges, MSAA kept for ultra/medium
  msaa: retro ? 1 : quality === "ultra" || quality === "medium" ? 4 : 2,
  fxaa: !retro,
  adaptive: !retro,
};

/** Base hardware scaling for the settings (1/DPR at full quality; 2 for retro; 1.25 on low). */
function baseScaling(s: GraphicsSettings): number {
  if (s.retro) return 2;
  if (s.quality === "low") return 1.25;
  const dpr = Math.min(window.devicePixelRatio || 1, s.maxDpr);
  return 1 / dpr;
}

export function applyResolution(engine: Engine, s: GraphicsSettings = graphicsSettings): void {
  engine.setHardwareScalingLevel(baseScaling(s));
  document.body.classList.toggle("retro", s.retro);
}

/**
 * Lower the internal resolution a notch when FPS stays under ~45 for a few seconds (and raise it back when there's
 * headroom). Never goes coarser than CSS pixels (scaling 1.0) unless FPS is really bad (< 24), then up to 1.5.
 */
function adaptiveResolution(engine: Engine, scene: Scene, s: GraphicsSettings): void {
  if (!s.adaptive) return;
  const base = baseScaling(s);
  let level = base, acc = 0, n = 0, timer = 0;
  scene.onAfterRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    if (!isFinite(dt) || dt <= 0) return;
    acc += engine.getFps(); n++; timer += dt;
    if (timer < 3) return;
    const fps = acc / n; acc = 0; n = 0; timer = 0;
    let next = level;
    if (fps < 24) next = Math.min(1.5, level + 0.25);
    else if (fps < 45) next = Math.min(1, level + 0.25);
    else if (fps > 58) next = Math.max(base, level - 0.25);
    if (next !== level) { level = next; engine.setHardwareScalingLevel(level); }
  });
}

/** Meshes that should never cast shadows (sky, glowing beams, fx, HUD-like, huge far objects, invisible colliders). */
function castsShadow(m: AbstractMesh): boolean {
  if (!m.isVisible || !m.isEnabled() || m.renderingGroupId !== 0) return false; // gun is rendering group 1
  const n = m.name;
  if (n === "sky" || n === "ground" || n === "street" || n === "alley" || n === "pad" || n === "glob" || n.startsWith("fx")) return false;
  if (/^(beam|beacon|cage-door|health|secret$)/.test(n)) return false;
  // the mothership (and anything parented under it) is far away in the sky
  let p = m.parent;
  while (p) { if (p.name.startsWith("mothership")) return false; p = p.parent; }
  // tiny details (railings, bolts, small clutter) cost a lot of shadow draw calls for little visual gain
  if (m.getBoundingInfo().boundingSphere.radiusWorld < 0.3) return false;
  const mat = m.material as (StandardMaterial & { alpha: number }) | null;
  if (mat && mat.alpha !== undefined && mat.alpha < 0.6) return false; // translucent (shield, glow sprites)
  return true;
}

export interface GraphicsHandles {
  shadows?: CascadedShadowGenerator | ShadowGenerator;
  ssao?: SSAO2RenderingPipeline;
  ssr?: SSRRenderingPipeline;
}

/** Set up shadows, SSAO, SSR and the AA/grade tweaks on the existing DefaultRenderingPipeline. */
export function setupGraphics(engine: Engine, scene: Scene, camera: Camera, moon: DirectionalLight,
  post: DefaultRenderingPipeline, s: GraphicsSettings = graphicsSettings): GraphicsHandles {
  const h: GraphicsHandles = {};
  applyResolution(engine, s);
  adaptiveResolution(engine, scene, s);
  if (s.retro) return h; // keep the old look exactly

  // --- Anti-aliasing + a crisper, more cinematic grade
  post.samples = engine.webGLVersion >= 2 ? s.msaa : 1;
  post.fxaaEnabled = s.fxaa;
  post.chromaticAberrationEnabled = false;
  post.sharpenEnabled = true;
  post.sharpen.edgeAmount = 0.25;
  post.sharpen.colorAmount = 1;
  post.imageProcessing.vignetteWeight = 1.4;

  // --- Contact shadows (SSAO) before the main post chain
  if (s.ssao && engine.webGLVersion >= 2) {
    try {
      const ao = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 1, blurRatio: 1 }, [camera], true);
      // Tuned by eye: small radius + bilateral blur = clean contact shading (larger radius / cheap blur went blotchy)
      ao.radius = 0.5;
      ao.totalStrength = 0.9;
      ao.base = 0.25;
      ao.samples = 24; // full-res + more samples: half-res at 16 left a visible grainy pattern
      ao.maxZ = 90;
      ao.minZAspect = 0.2;
      ao.expensiveBlur = true;
      ao.bilateralSamples = 16;
      ao.bilateralSoften = 0.5;
      ao.bilateralTolerance = 0.002;
      h.ssao = ao;
    } catch (e) { console.warn("[graphics] SSAO unavailable", e); }
  }

  // --- Screen-space reflections on the damp street (high only)
  if (s.ssr && engine.webGLVersion >= 2) {
    try {
      const ssr = new SSRRenderingPipeline("ssr", scene, [camera], false, Constants.TEXTURETYPE_UNSIGNED_BYTE);
      ssr.strength = 0.8;
      ssr.reflectionSpecularFalloffExponent = 2.5;
      ssr.maxDistance = 60;
      ssr.maxSteps = 120;
      ssr.step = 0.6;
      ssr.thickness = 0.4;
      ssr.blurDispersionStrength = 0.03;
      ssr.roughnessFactor = 0; // no per-pixel random jitter (a source of grain); blur handles softness
      ssr.selfCollisionNumSkip = 2;
      ssr.reflectivityThreshold = 0.03;
      h.ssr = ssr;
    } catch (e) { console.warn("[graphics] SSR unavailable", e); }
  }

  // --- Cascaded moon shadows
  if (s.shadows) {
    let gen: CascadedShadowGenerator | ShadowGenerator;
    try {
      const csm = new CascadedShadowGenerator(s.shadowMapSize, moon);
      csm.numCascades = s.quality === "ultra" ? 3 : 2;
      csm.shadowMaxZ = 110;
      csm.lambda = 0.82;
      csm.stabilizeCascades = true;
      csm.cascadeBlendPercentage = 0.08;
      csm.usePercentageCloserFiltering = true;
      csm.filteringQuality = s.quality === "high" ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
      csm.bias = 0.004;
      csm.normalBias = 0.02;
      csm.darkness = 0.25;
      gen = csm;
    } catch (e) {
      console.warn("[graphics] CSM unavailable, falling back to a single shadow map", e);
      const sg = new ShadowGenerator(s.shadowMapSize, moon);
      sg.usePercentageCloserFiltering = true;
      sg.bias = 0.004;
      sg.normalBias = 0.02;
      sg.darkness = 0.25;
      gen = sg;
    }
    h.shadows = gen;
    const map = gen.getShadowMap();
    const known = new Set<AbstractMesh>();
    const register = (m: AbstractMesh) => {
      if (known.has(m)) return;
      known.add(m);
      // Everything opaque in the world receives (PBR and Standard materials both support it)
      if (m.renderingGroupId === 0 && m.name !== "sky") m.receiveShadows = true;
      if (castsShadow(m)) map?.renderList?.push(m);
    };
    // Models load asynchronously and enemies spawn later: register now, on add, and re-sweep periodically
    // (visibility changes after load, e.g. gray boxes hidden behind models).
    for (const m of scene.meshes) register(m);
    scene.onNewMeshAddedObservable.add((m) => setTimeout(() => register(m), 0));
    let t = 0;
    scene.onBeforeRenderObservable.add(() => {
      t += engine.getDeltaTime();
      if (t < 1500) return;
      t = 0;
      const list = map?.renderList;
      if (!list) return;
      // drop meshes that became invisible/disposed (e.g. gray boxes hidden after models loaded, dead enemies)
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (m.isDisposed() || !castsShadow(m)) { list.splice(i, 1); known.delete(m); }
      }
      for (const m of scene.meshes) if (!known.has(m) || (!list.includes(m) && castsShadow(m))) { known.delete(m); register(m); }
    });
  }
  return h;
}

/** Small FPS counter (top-right). F toggles it (and saves the choice); Settings can toggle it too. */
let fpsEl: HTMLDivElement | null = null;

export function setFpsVisible(on: boolean): void {
  if (fpsEl) fpsEl.style.display = on ? "block" : "none";
}

export function fpsCounter(engine: Engine): void {
  const el = document.createElement("div");
  el.id = "fps";
  el.style.cssText = "position:fixed;top:10px;right:12px;z-index:50;font:600 12px/1 system-ui,sans-serif;" +
    "color:#cfe;background:rgba(0,0,0,.45);padding:4px 7px;border-radius:4px;pointer-events:none;";
  document.body.appendChild(el);
  fpsEl = el;
  setFpsVisible(effective().showFps);
  window.addEventListener("keydown", (e) => {
    if (e.code !== "KeyF" || document.activeElement instanceof HTMLInputElement) return;
    const on = el.style.display === "none";
    updateSettings({ showFps: on }); // listeners (main.ts) call setFpsVisible
    setFpsVisible(on);
  });
  setInterval(() => {
    const fps = engine.getFps();
    el.textContent = `${fps.toFixed(0)} FPS · ${graphicsSettings.quality}`;
    el.style.color = fps >= 50 ? "#9f9" : fps >= 30 ? "#fd6" : "#f77";
  }, 500);
}
