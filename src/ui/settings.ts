/**
 * Player settings: persisted in localStorage (every access wrapped, so defaults work when storage is blocked),
 * observable, and overridable by URL params for testing (?bob, ?quality, ?nofps). Plain TS, no engine imports.
 */
export type QualityPreset = "low" | "medium" | "high" | "ultra";

export interface Settings {
  /** Mouse-look multiplier (1 = default). */
  sensitivity: number;
  invertY: boolean;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Extra look multiplier while zoomed (right mouse). */
  zoomSensitivity: number;
  /** Head-bob / weapon-bob amount 0..1 (accessibility). */
  bob: number;
  master: number;
  sfx: number;
  /** Ambience / music bus. */
  music: number;
  quality: QualityPreset;
  showFps: boolean;
  showHints: boolean;
}

/** The core's base FOV (data/gameplay/player.json fov = 1.25 rad ≈ 71.6°). The FOV setting scales relative to it. */
export const BASE_FOV_DEG = 1.25 * (180 / Math.PI);

export const DEFAULTS: Settings = {
  sensitivity: 1, invertY: false, fov: Math.round(BASE_FOV_DEG), zoomSensitivity: 1, bob: 1,
  master: 1, sfx: 1, music: 1, quality: "high", showFps: true, showHints: true,
};

const KEY = "idam-jagath.settings.v1";
const QUALITIES: QualityPreset[] = ["low", "medium", "high", "ultra"];

function clamp(v: unknown, lo: number, hi: number, d: number): number {
  const n = typeof v === "number" && isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, n));
}

/** Validate anything (stored JSON, partial updates) into a complete Settings object. */
function sanitize(raw: Partial<Settings> | null | undefined): Settings {
  const r = raw ?? {};
  return {
    sensitivity: clamp(r.sensitivity, 0.2, 3, DEFAULTS.sensitivity),
    invertY: typeof r.invertY === "boolean" ? r.invertY : DEFAULTS.invertY,
    fov: clamp(r.fov, 55, 100, DEFAULTS.fov),
    zoomSensitivity: clamp(r.zoomSensitivity, 0.3, 2, DEFAULTS.zoomSensitivity),
    bob: clamp(r.bob, 0, 1, DEFAULTS.bob),
    master: clamp(r.master, 0, 1, DEFAULTS.master),
    sfx: clamp(r.sfx, 0, 1, DEFAULTS.sfx),
    music: clamp(r.music, 0, 1, DEFAULTS.music),
    quality: QUALITIES.includes(r.quality as QualityPreset) ? (r.quality as QualityPreset) : DEFAULTS.quality,
    showFps: typeof r.showFps === "boolean" ? r.showFps : DEFAULTS.showFps,
    showHints: typeof r.showHints === "boolean" ? r.showHints : DEFAULTS.showHints,
  };
}

function readStored(): Partial<Settings> | null {
  try {
    const s = window.localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as Partial<Settings>) : null;
  } catch {
    return null; // private mode / blocked storage: defaults
  }
}

function writeStored(s: Settings): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked: keep in memory */ }
}

let current = sanitize(readStored());
const listeners = new Set<(s: Settings) => void>();

/** Current settings (stored values; URL overrides are applied by `effective()`). */
export function getSettings(): Settings {
  return { ...current };
}

/** Settings with URL test overrides applied (?bob=0..1, ?quality=…, ?nofps). */
export function effective(): Settings {
  const s = getSettings();
  const p = new URLSearchParams(location.search);
  if (p.has("bob")) s.bob = clamp(Number(p.get("bob")), 0, 1, s.bob);
  const q = p.get("quality");
  if (q && QUALITIES.includes(q as QualityPreset)) s.quality = q as QualityPreset;
  if (p.has("nofps")) s.showFps = false;
  return s;
}

/** Merge, validate, persist and notify. Returns the new settings. */
export function updateSettings(patch: Partial<Settings>): Settings {
  current = sanitize({ ...current, ...patch });
  writeStored(current);
  const eff = effective();
  for (const l of listeners) l(eff);
  return getSettings();
}

export function resetSettings(): Settings {
  return updateSettings({ ...DEFAULTS });
}

/** Subscribe to changes (receives effective settings). Returns an unsubscribe function. */
export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
