/**
 * Engine-neutral gameplay data (data/gameplay/*.json): typed + validated on load.
 * Pure TypeScript, no engine imports, so a port can reuse this file as-is (or mirror it in C#/GDScript/C++).
 * Units: metres, seconds, m/s, radians; +Y up; positions on the ground are [x, z].
 */

// ───────────────────────── types ─────────────────────────

export interface WeaponData {
  id: string;
  name: string;
  mag: number;
  fireInterval: number;
  reloadTime: number;
  damage: number;
  pellets: number;
  spread: number;
  range: number;
  kick: number;
  kickBack: number;
  kickClimb: number;
  flashColor: string;
  sound: string;
  model?: string;
  modelCredit?: string;
  /** First-person arms posed on this gun (tools/blender/build_fp_arms.py), placed in the gun model's frame. */
  arms?: string;
  muzzle: number;
  proceduralMesh: string;
}
export interface WeaponsFile { weapons: WeaponData[] }

export interface PlayerData {
  maxHealth: number;
  /** Landing damage: none below minSpeed (m/s impact), then perSpeed HP per extra m/s. Optional (defaults in code). */
  fallDamage?: { minSpeed: number; perSpeed: number };
  overchargeCap: number;
  collisionHalfExtents: [number, number, number];
  gravity: number;
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  slideBoost: number;
  slideTime: number;
  jumpSpeed: number;
  eyeHeight: number;
  crouchEyeDrop: number;
  mouseSensitivity: number;
  fov: number;
  sprintFovBonus: number;
  zoomFov: number;
  zoomSpeed: number;
  accelGround: number;
  decelGround: number;
  accelAir: number;
}

export interface MonsterModelData {
  file: string;
  length: number;
  axis: "x" | "y" | "z";
  yaw: number;
  anim: string;
  animSpeedRef: number;
  keep?: string[];
  keepInPlace?: string[];
  clips?: Partial<Record<"idle" | "walk" | "run" | "attack" | "hit" | "stun" | "death", string>>;
  eyes?: string[];
  eyeColor?: string;
}

interface EnemyBase { hp: number; halfHeight: number; radius: number; sightRange: number }
interface Hit { damage: number; knockback: number }

export interface CrawlerData extends EnemyBase {
  chaseSpeed: number; zigzagWeight: number; zigzagRate: number;
  bite: Hit & { range: number; cooldown: number };
  lunge: Hit & {
    minRange: number; maxRange: number; initialCooldown: number; cooldown: number;
    windup: number; duration: number; speed: number; hitRange: number; recover: number;
  };
  weakSpots: { eye: number };
  model: MonsterModelData;
}

export interface SpitterData extends EnemyBase {
  moveSpeed: number; minRange: number; maxRange: number; strafeWeight: number;
  fire: { initialCooldown: number; cooldown: number; windup: number };
  glob: { speed: number; damage: number; lifetime: number; hitRadiusEye: number; hitRadiusBody: number };
  weakSpots: { sac: number };
  model: MonsterModelData;
}

export interface WardenData extends EnemyBase {
  dropHeight: number; dropSpeed: number;
  land: Hit & { radius: number };
  stalkSpeed: number; turnRate: number;
  contact: { range: number; damagePerSecond: number; knockback: number };
  charge: Hit & {
    initialCooldown: number; minRange: number; maxRange: number; windup: number; duration: number; speed: number;
    hitRange: number; wallStopFraction: number; recover: number; cooldownAfterRecover: number; cooldownAfterStun: number;
  };
  stun: { duration: number; damageMultiplier: number };
  /** Anti-stalemate: blocked this long (s) without reaching the player, back off to `distance` (max `maxTime` s). */
  unstick: { after: number; distance: number; maxTime: number; chargeCooldown: number };
  model: MonsterModelData;
}

export interface EnemiesFile { crawler: CrawlerData; spitter: SpitterData; warden: WardenData }

export type EnemyType = "crawler" | "spitter" | "warden";
export interface Spawn {
  type: EnemyType; at: [number, number];
  /** floor height (m) for elevated spawns, e.g. the Charminar roof */ y?: number;
  /** hold this spot until the player is on the same floor (roof guards around the pylon) */ guard?: boolean;
}

export interface MissionData {
  id: string;
  pylon: { hp: number };
  secretWall: { hp: number; message: string };
  pickups: {
    health: { amount: number; radius: number; message: string };
    secret: { amount: number; cap: number; message: string };
  };
  initialSpawns: Spawn[];
  ambush: { message: string; alarmSeconds: number; wakeEnemiesNorthOfZ: number; spawns: Spawn[] };
  escapeWave: { message: string; spawns: Spawn[] };
  messages: { pylonDestroyed: string; allPylonsDown: string };
  objectives: { pylons: string; cage: string; escape: string };
}

// ───────────────────────── validation ─────────────────────────

/** Minimal shape spec: "number" | "string" | "number3" | "xz" | nested object spec | [itemSpec] for arrays. */
type Spec = "number" | "string" | "number3" | "xz" | "optString" | "optStringArray" | "optStringRecord" | { [k: string]: Spec } | [Spec];

function check(value: unknown, spec: Spec, path: string): void {
  const fail = (want: string) => { throw new Error(`[gameplay data] ${path}: expected ${want}, got ${JSON.stringify(value)}`); };
  if (spec === "number") { if (typeof value !== "number" || !Number.isFinite(value)) fail("a number"); return; }
  if (spec === "string") { if (typeof value !== "string") fail("a string"); return; }
  if (spec === "optString") { if (value !== undefined && typeof value !== "string") fail("a string or nothing"); return; }
  if (spec === "optStringArray") {
    if (value !== undefined && !(Array.isArray(value) && value.every((v) => typeof v === "string"))) fail("a string array or nothing");
    return;
  }
  if (spec === "optStringRecord") {
    if (value !== undefined && !(typeof value === "object" && value !== null && !Array.isArray(value)
      && Object.values(value).every((v) => typeof v === "string"))) fail("an object of strings or nothing");
    return;
  }
  if (spec === "number3" || spec === "xz") {
    const n = spec === "number3" ? 3 : 2;
    if (!Array.isArray(value) || value.length !== n || !value.every((v) => typeof v === "number")) fail(`[${n} numbers]`);
    return;
  }
  if (Array.isArray(spec)) {
    if (!Array.isArray(value)) fail("an array");
    (value as unknown[]).forEach((v, i) => check(v, spec[0], `${path}[${i}]`));
    return;
  }
  if (typeof value !== "object" || value === null) fail("an object");
  for (const [k, s] of Object.entries(spec)) check((value as Record<string, unknown>)[k], s, `${path}.${k}`);
}

const N = "number" as const, S = "string" as const;
const hit = { damage: N, knockback: N };
const model: Spec = {
  file: S, length: N, axis: S, yaw: N, anim: S, animSpeedRef: N, keep: "optStringArray", keepInPlace: "optStringArray",
  clips: "optStringRecord", eyes: "optStringArray", eyeColor: "optString",
};
const base = { hp: N, halfHeight: N, radius: N, sightRange: N };
const spawn: Spec = { type: S, at: "xz" };

const SPECS = {
  weapons: { weapons: [{
    id: S, name: S, mag: N, fireInterval: N, reloadTime: N, damage: N, pellets: N, spread: N, range: N,
    kick: N, kickBack: N, kickClimb: N, flashColor: S, sound: S, model: "optString", arms: "optString", muzzle: N, proceduralMesh: S,
  }] } as Spec,
  player: {
    maxHealth: N, overchargeCap: N, collisionHalfExtents: "number3", gravity: N, walkSpeed: N, sprintSpeed: N,
    crouchSpeed: N, slideBoost: N, slideTime: N, jumpSpeed: N, eyeHeight: N, crouchEyeDrop: N, mouseSensitivity: N,
    fov: N, sprintFovBonus: N, zoomFov: N, zoomSpeed: N, accelGround: N, decelGround: N, accelAir: N,
  } as Spec,
  enemies: {
    crawler: {
      ...base, chaseSpeed: N, zigzagWeight: N, zigzagRate: N,
      bite: { ...hit, range: N, cooldown: N },
      lunge: { ...hit, minRange: N, maxRange: N, initialCooldown: N, cooldown: N, windup: N, duration: N, speed: N, hitRange: N, recover: N },
      weakSpots: { eye: N }, model,
    },
    spitter: {
      ...base, moveSpeed: N, minRange: N, maxRange: N, strafeWeight: N,
      fire: { initialCooldown: N, cooldown: N, windup: N },
      glob: { speed: N, damage: N, lifetime: N, hitRadiusEye: N, hitRadiusBody: N },
      weakSpots: { sac: N }, model,
    },
    warden: {
      ...base, dropHeight: N, dropSpeed: N, land: { ...hit, radius: N }, stalkSpeed: N, turnRate: N,
      contact: { range: N, damagePerSecond: N, knockback: N },
      charge: {
        ...hit, initialCooldown: N, minRange: N, maxRange: N, windup: N, duration: N, speed: N, hitRange: N,
        wallStopFraction: N, recover: N, cooldownAfterRecover: N, cooldownAfterStun: N,
      },
      stun: { duration: N, damageMultiplier: N },
      unstick: { after: N, distance: N, maxTime: N, chargeCooldown: N }, model,
    },
  } as Spec,
  mission: {
    id: S, pylon: { hp: N }, secretWall: { hp: N, message: S },
    pickups: { health: { amount: N, radius: N, message: S }, secret: { amount: N, cap: N, message: S } },
    initialSpawns: [spawn],
    ambush: { message: S, alarmSeconds: N, wakeEnemiesNorthOfZ: N, spawns: [spawn] },
    escapeWave: { message: S, spawns: [spawn] },
    messages: { pylonDestroyed: S, allPylonsDown: S },
    objectives: { pylons: S, cage: S, escape: S },
  } as Spec,
};

const ENEMY_TYPES: EnemyType[] = ["crawler", "spitter", "warden"];

export function validateWeapons(d: unknown): WeaponsFile { check(d, SPECS.weapons, "weapons.json"); return d as WeaponsFile; }
export function validatePlayer(d: unknown): PlayerData { check(d, SPECS.player, "player.json"); return d as PlayerData; }
export function validateEnemies(d: unknown): EnemiesFile {
  check(d, SPECS.enemies, "enemies.json");
  const e = d as EnemiesFile;
  for (const t of ENEMY_TYPES) {
    if (e[t] && "model" in e[t] && !["x", "y", "z"].includes((e[t] as CrawlerData).model.axis)) {
      throw new Error(`[gameplay data] enemies.json.${t}.model.axis: expected "x", "y" or "z"`);
    }
  }
  return e;
}
export function validateMission(d: unknown): MissionData {
  check(d, SPECS.mission, "mission.json");
  const m = d as MissionData;
  for (const [where, list] of [["initialSpawns", m.initialSpawns], ["ambush.spawns", m.ambush.spawns], ["escapeWave.spawns", m.escapeWave.spawns]] as const) {
    list.forEach((s, i) => {
      if (!ENEMY_TYPES.includes(s.type)) throw new Error(`[gameplay data] mission.json.${where}[${i}].type: unknown enemy "${s.type}"`);
    });
  }
  return m;
}

/** Fill "{key}" placeholders in a data string. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
