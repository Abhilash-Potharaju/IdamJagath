/**
 * Engine-neutral LEVEL data (data/level/*.json): typed + validated on load. Pure TypeScript, no engine imports,
 * so a port can reuse this file (or mirror it in C#/GDScript/C++).
 * Conventions: metres; +Y up; +Z north; yaw = radians about +Y (0 faces +Z); positions [x, y, z];
 * boxes are min/max corners; ground rectangles are { min:[x,z], max:[x,z] }.
 */
import level1Json from "../../data/level/level1.json";

export type V3 = [number, number, number];
export type V2 = [number, number];
export interface Rect { min: V2; max: V2 }

export type BlockData =
  | { name: string; shape: "box"; min: V3; max: V3; color: string; id?: string; tags?: string[] }
  | { name: string; shape: "slab"; min: V3; max: V3; color: string; id?: string; tags?: string[] }
  | { name: string; shape: "ground"; center: V3; size: V2; color: string; id?: string; tags?: string[] }
  | { name: string; shape: "cylinder"; center: V3; diameter: number; height: number; segments: number; color: string; id?: string; tags?: string[] };

export interface ColliderData { name: string; min: V3; max: V3 }
export interface EffectData { type: "burningCar" | "smoulder"; pos: V3 }

export interface PropData {
  /** Model path relative to the models folder (e.g. "props/autorickshaw.glb"). */
  model: string;
  /** Keep only this top-level node of a kit file. */
  node?: string;
  pos: V3;
  yaw: number;
  roll?: number;
  /** "fitted" = invisible box collider fitted to the model (fit = shrink factor, default 0.92). */
  solid?: "fitted";
  fit?: number;
  /** Explicit invisible box colliders (added to the level's world list). */
  colliders?: ColliderData[];
  /** Block ids (or "#tag") whose gray-box stand-ins are hidden (kept as colliders) once this model is placed. */
  hides?: string[];
  /** Only place in this look: "beauty" (default look) or "classic" (?classic). Omitted = always. */
  mode?: "beauty" | "classic";
  /** Named material treatment applied by the engine layer ("charminar", "burnt"). */
  material?: string;
  /** Alternate model selected by a URL flag (comparisons). */
  altModel?: { flag: string; model: string };
  effects?: EffectData[];
  id?: string;
  tags?: string[];
}

export interface FacadeRunData { axis: "x" | "z"; wall: number; from: number; to: number; height: 9 | 11 | 14; yaw: number; inset: number }
export interface QuadData { pos: V3; yaw: number; size: V2 }
export interface WallDecalData { pos: V3; yaw: number; size: number; spin: number }
export interface GroundDecalData { pos: V3; yaw: number; size: number }
export interface PuddleData { pos: V3; yaw: number; size: V2 }
export interface SurfaceRule { match: string; material?: string; tint?: string; roughness?: number; tile: number; cycle?: { material: string; tint?: string }[] }

export interface LevelData {
  id: string;
  name: string;
  anchors: {
    playerSpawn: V3; extraction: Rect; plazaEntryZ: number; cageTrigger: Rect;
    pylons: V3[]; healthPacks: V3[]; secretPickup: V3; climbEntry?: V3;
  };
  blocks: BlockData[];
  beautySurfaces: { environment: { hdri: string; intensity: number }; rules: SurfaceRule[] };
  facadeRuns: FacadeRunData[];
  props: PropData[];
  lights: { lamps: V2[]; fires: V3[] };
  skylineSmoke: V2[];
  banners: QuadData[];
  billboards: QuadData[];
  wallDecals: WallDecalData[];
  scorchDecals: GroundDecalData[];
  puddles: PuddleData[];
}

// ───────────────────────── validation ─────────────────────────
function fail(path: string, msg: string): never { throw new Error(`[level data] ${path}: ${msg}`); }
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function vec(v: unknown, n: 2 | 3, path: string): void {
  if (!Array.isArray(v) || v.length !== n || !v.every(isNum)) fail(path, `expected [${n} numbers], got ${JSON.stringify(v)}`);
}
function num(v: unknown, path: string): void { if (!isNum(v)) fail(path, `expected a number, got ${JSON.stringify(v)}`); }
function str(v: unknown, path: string): void { if (typeof v !== "string" || !v) fail(path, `expected a string`); }
function arr(v: unknown, path: string): unknown[] { if (!Array.isArray(v)) fail(path, "expected an array"); return v; }

export function validateLevel(raw: unknown): LevelData {
  const d = raw as LevelData;
  if (!d || typeof d !== "object") fail("level", "not an object");
  str(d.id, "id");
  const a = d.anchors;
  vec(a.playerSpawn, 3, "anchors.playerSpawn");
  for (const k of ["extraction", "cageTrigger"] as const) { vec(a[k].min, 2, `anchors.${k}.min`); vec(a[k].max, 2, `anchors.${k}.max`); }
  num(a.plazaEntryZ, "anchors.plazaEntryZ");
  arr(a.pylons, "anchors.pylons").forEach((p, i) => vec(p, 3, `anchors.pylons[${i}]`));
  arr(a.healthPacks, "anchors.healthPacks").forEach((p, i) => vec(p, 3, `anchors.healthPacks[${i}]`));
  vec(a.secretPickup, 3, "anchors.secretPickup");

  const ids = new Set<string>(), tags = new Set<string>();
  arr(d.blocks, "blocks").forEach((b0, i) => {
    const b = b0 as BlockData, p = `blocks[${i}]`;
    str(b.name, `${p}.name`); str(b.color, `${p}.color`);
    if (b.shape === "box" || b.shape === "slab") { vec(b.min, 3, `${p}.min`); vec(b.max, 3, `${p}.max`); }
    else if (b.shape === "ground") { vec(b.center, 3, `${p}.center`); vec(b.size, 2, `${p}.size`); }
    else if (b.shape === "cylinder") { vec(b.center, 3, `${p}.center`); num(b.diameter, `${p}.diameter`); num(b.height, `${p}.height`); }
    else fail(p, `unknown shape ${(b as { shape: string }).shape}`);
    if (b.id) { if (ids.has(b.id)) fail(p, `duplicate id ${b.id}`); ids.add(b.id); }
    for (const t of b.tags ?? []) tags.add(t);
  });
  arr(d.props, "props").forEach((p0, i) => {
    const p = p0 as PropData, path = `props[${i}]`;
    str(p.model, `${path}.model`); vec(p.pos, 3, `${path}.pos`); num(p.yaw, `${path}.yaw`);
    if (p.solid !== undefined && p.solid !== "fitted") fail(`${path}.solid`, `must be "fitted"`);
    if (p.mode !== undefined && p.mode !== "beauty" && p.mode !== "classic") fail(`${path}.mode`, "beauty|classic");
    for (const h of p.hides ?? []) {
      if (h.startsWith("#") ? !tags.has(h.slice(1)) : !ids.has(h)) fail(`${path}.hides`, `no block ${h}`);
    }
    for (const c of p.colliders ?? []) { vec(c.min, 3, `${path}.colliders.min`); vec(c.max, 3, `${path}.colliders.max`); }
    for (const e of p.effects ?? []) vec(e.pos, 3, `${path}.effects.pos`);
  });
  arr(d.facadeRuns, "facadeRuns").forEach((f0, i) => {
    const f = f0 as FacadeRunData;
    if (![9, 11, 14].includes(f.height)) fail(`facadeRuns[${i}].height`, "9|11|14");
    if (f.axis !== "x" && f.axis !== "z") fail(`facadeRuns[${i}].axis`, "x|z");
  });
  arr(d.lights.lamps, "lights.lamps").forEach((p, i) => vec(p, 2, `lights.lamps[${i}]`));
  arr(d.lights.fires, "lights.fires").forEach((p, i) => vec(p, 3, `lights.fires[${i}]`));
  arr(d.skylineSmoke, "skylineSmoke").forEach((p, i) => vec(p, 2, `skylineSmoke[${i}]`));
  for (const k of ["banners", "billboards"] as const) arr(d[k], k).forEach((q, i) => { vec((q as QuadData).pos, 3, `${k}[${i}].pos`); vec((q as QuadData).size, 2, `${k}[${i}].size`); });
  arr(d.wallDecals, "wallDecals").forEach((q, i) => vec((q as WallDecalData).pos, 3, `wallDecals[${i}].pos`));
  arr(d.scorchDecals, "scorchDecals").forEach((q, i) => vec((q as GroundDecalData).pos, 3, `scorchDecals[${i}].pos`));
  arr(d.puddles, "puddles").forEach((q, i) => { vec((q as PuddleData).pos, 3, `puddles[${i}].pos`); vec((q as PuddleData).size, 2, `puddles[${i}].size`); });
  return d;
}

export const LEVEL1: LevelData = validateLevel(level1Json);

// ───────────────────────── level shell geometry (GLB) ─────────────────────────
// The gray-box shell is also a portable asset: tools/blender/build_level.py turns `blocks` into a Blender scene and
// public/models/level/level1.glb. This reader is engine-neutral (fetch + DataView): it returns raw arrays that any
// engine adapter can turn into meshes. glTF coordinates in that file are game coordinates (see docs/LEVEL_PIPELINE.md).

export interface BlockGeometry {
  blockIndex: number;
  name: string;
  /** Node translation = block centre (no rotation/scale on level nodes). */
  translation: V3;
  positions: Float32Array; normals: Float32Array; uv0?: Float32Array; uv1?: Float32Array;
  /** Triangle indices in glTF (counter-clockwise, right-handed) order. */
  indices: Uint32Array;
}
export interface LevelGeometry { sourceHash: string; blocks: Map<number, BlockGeometry>; colliders: Map<number, BlockGeometry> }

const mmRound = (v: number) => Math.floor(v * 1000 + 0.5);
/** Hash of block geometry fields; must match block_hash() in tools/blender/build_level.py. */
export function levelGeometryHash(d: LevelData): string {
  const parts = d.blocks.map((b) => {
    const r = b as unknown as Record<string, unknown>;
    const nums: number[] = [];
    for (const k of ["min", "max", "center", "size"]) if (Array.isArray(r[k])) nums.push(...(r[k] as number[]).map(mmRound));
    for (const k of ["diameter", "height", "segments"]) if (typeof r[k] === "number") nums.push(mmRound(r[k] as number));
    return `${b.name}|${b.shape}|${nums.join(",")}`;
  });
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(parts.join(";"))) { h ^= byte; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

interface GltfJson {
  scenes?: { extras?: { source_hash?: string } }[];
  nodes: { name?: string; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; children?: number[]; extras?: Record<string, unknown> }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
}

/** Fetch and parse a level-shell GLB. Returns null on any problem (callers fall back to building from JSON). */
export async function loadLevelGeometry(url: string): Promise<LevelGeometry | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
    const jsonLen = dv.getUint32(12, true);
    const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))) as GltfJson;
    const binStart = 20 + jsonLen + 8;
    const SIZES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    const read = (ai: number): Float32Array | Uint32Array => {
      const a = gltf.accessors[ai], bv = gltf.bufferViews[a.bufferView];
      const n = a.count * SIZES[a.type], off = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
      if (bv.byteStride && bv.byteStride !== SIZES[a.type] * 4) throw new Error("interleaved buffers not supported");
      if (a.componentType === 5126) return new Float32Array(buf.slice(off, off + n * 4));
      if (a.componentType === 5125) return new Uint32Array(buf.slice(off, off + n * 4));
      if (a.componentType === 5123) return Uint32Array.from(new Uint16Array(buf.slice(off, off + n * 2)));
      if (a.componentType === 5121) return Uint32Array.from(new Uint8Array(buf.slice(off, off + n)));
      throw new Error(`unsupported componentType ${a.componentType}`);
    };
    const out: LevelGeometry = { sourceHash: gltf.scenes?.[0]?.extras?.source_hash ?? "", blocks: new Map(), colliders: new Map() };
    for (const node of gltf.nodes) {
      if (node.mesh === undefined) continue;
      if (node.rotation || node.scale || node.matrix || node.children) throw new Error(`level node ${node.name} has a non-translation transform`);
      const ex = node.extras ?? {};
      const collider = typeof ex.collider_for === "number";
      const idx = (collider ? ex.collider_for : ex.block_index) as number | undefined;
      if (typeof idx !== "number") continue;
      const prims = gltf.meshes[node.mesh].primitives;
      if (prims.length !== 1 || prims[0].indices === undefined) throw new Error(`level mesh ${node.name}: expected one indexed primitive`);
      const at = prims[0].attributes;
      const g: BlockGeometry = {
        blockIndex: idx, name: (ex.block_name as string) ?? node.name ?? "",
        translation: (node.translation ?? [0, 0, 0]) as V3,
        positions: read(at.POSITION) as Float32Array, normals: read(at.NORMAL) as Float32Array,
        uv0: at.TEXCOORD_0 !== undefined ? (read(at.TEXCOORD_0) as Float32Array) : undefined,
        uv1: at.TEXCOORD_1 !== undefined ? (read(at.TEXCOORD_1) as Float32Array) : undefined,
        indices: Uint32Array.from(read(prims[0].indices)),
      };
      (collider ? out.colliders : out.blocks).set(idx, g);
    }
    return out;
  } catch (e) {
    console.warn("[level] could not read level shell GLB; building blocks from JSON instead", e);
    return null;
  }
}
