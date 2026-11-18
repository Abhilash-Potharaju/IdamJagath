import { Vec3 } from "./math";
import { Rng } from "./rng";
import { EventBus } from "./events";
import { Mission } from "./mission";
import { Player } from "./entities/player";
import { Arsenal, type DamageResult } from "./entities/weapons";
import { Crawler, Enemy, Spitter, Warden, type EnemyContext } from "./entities/enemies";
import type { HitTarget, InputSnapshot, IPhysics, LevelAnchors } from "./ports";
import type { EnemiesFile, MissionData, PlayerData, Spawn, WeaponData } from "../data/schemas";

export interface GameplayData {
  weapons: WeaponData[];
  player: PlayerData;
  enemies: EnemiesFile;
  mission: MissionData;
}

export interface WorldOptions {
  data: GameplayData;
  level: LevelAnchors;
  physics: IPhysics;
  /** RNG seed: same seed + same inputs ⇒ same game. */
  seed?: number;
  /** Sightseeing: no monsters, no ambush. */
  explore?: boolean;
  /** Monsters spawn but stay frozen; player can't be hurt. */
  zoo?: boolean;
  /** Head-bob amount 0..1 (accessibility). */
  bobScale?: number;
}

export interface Glob { id: number; pos: Vec3; vel: Vec3; life: number }

/** Camera-shake trauma carried by some sounds (scaled by distance to the player for positioned sounds). */
const SOUND_SHAKE: Record<string, number> = {
  trishul_fire: 0.2, vajra_fire: 0.025, pylon_explode: 0.55, warden_land: 0.65, warden_impact: 0.45, warden_charge: 0.12,
  cage_open: 0.15, warden_death: 0.4,
};

/**
 * The whole simulation for one mission. Advance it with `step(SIM_DT, input)` at a fixed rate; read its state to
 * render; subscribe to `events` for presentation. Deterministic: no wall clock, no Math.random, no engine types.
 */
export class GameWorld implements EnemyContext {
  readonly events = new EventBus();
  readonly rng: Rng;
  readonly physics: IPhysics;
  readonly player: Player;
  readonly arsenal: Arsenal;
  readonly mission: Mission;
  readonly explore: boolean;
  readonly zoo: boolean;
  enemies: Enemy[] = [];
  globs: Glob[] = [];
  time = 0;
  kills = 0;
  /** Number of simulation steps run. */
  frame = 0;

  private readonly data: GameplayData;
  private hints = new Set<string>();
  private idSeq = 0;
  private globSeq = 0;
  private lastHealth: number;
  private hurtCd = 0;

  constructor(o: WorldOptions) {
    this.data = o.data;
    this.physics = o.physics;
    this.rng = new Rng(o.seed ?? 1);
    this.explore = !!o.explore;
    this.zoo = !!o.zoo;
    this.player = new Player(this, o.data.player, o.level.playerSpawn, o.bobScale ?? 1);
    this.arsenal = new Arsenal(this, this.player, o.data.weapons);
    this.mission = new Mission(this, o.data.mission, o.level);
    this.lastHealth = this.player.health;
  }

  /** Spawn the initial enemies and publish the first objective (call after presentation has subscribed). */
  start(): void {
    this.mission.start();
  }

  get phase() { return this.mission.phase; }
  get isOver(): boolean { return this.mission.isOver; }

  // ───────────────────────── CoreContext ─────────────────────────

  sound(name: string, at?: Vec3): void {
    const shake = SOUND_SHAKE[name];
    if (shake) {
      const k = at ? Math.max(0, 1 - Vec3.distance(at, this.player.eye) / 40) : 1;
      if (k > 0) this.player.addTrauma(shake * k);
    }
    this.events.emit("sound", { name, at });
  }

  hint(id: string, text: string): void {
    if (this.hints.has(id)) return;
    this.hints.add(id);
    this.events.emit("hint", { id, text });
  }

  message(text: string, seconds: number): void {
    this.events.emit("message", { text, seconds });
  }

  nextId(): number { return ++this.idSeq; }

  spawnGlob(from: Vec3, dir: Vec3): void {
    const G = this.data.enemies.spitter.glob;
    const g: Glob = { id: ++this.globSeq, pos: from.clone(), vel: dir.scale(G.speed), life: G.lifetime };
    this.globs.push(g);
    this.events.emit("globSpawned", { id: g.id, pos: g.pos.clone() });
  }

  onEnemyKilled(e: Enemy): void {
    this.kills++;
    this.enemies = this.enemies.filter((x) => x !== e);
  }

  spawn(sp: Spawn, awake: boolean): Enemy {
    const at = new Vec3(sp.at[0], sp.y ?? 0, sp.at[1]);
    const E = this.data.enemies;
    const e = sp.type === "crawler" ? new Crawler(this, at, E.crawler)
      : sp.type === "spitter" ? new Spitter(this, at, E.spitter) : new Warden(this, at, E.warden);
    if (awake) e.awake = true;
    this.enemies.push(e);
    this.events.emit("enemySpawned", { id: e.id, type: e.type, body: e.body });
    return e;
  }

  wakeEnemiesNorthOf(z: number): void {
    for (const e of this.enemies) if (e.pos.z > z) e.awake = true;
  }

  /** Apply weapon damage to whatever a ray hit. */
  damageTarget(target: HitTarget, amount: number, point: Vec3): DamageResult {
    switch (target.kind) {
      case "enemy": {
        const e = this.enemies.find((x) => x.id === target.id);
        if (!e || !e.alive) return { enemy: false, killed: false };
        e.takeDamage(amount, point);
        return { enemy: true, killed: !e.alive };
      }
      case "shield": {
        const w = this.enemies.find((x) => x.id === target.id);
        if (w instanceof Warden) w.shieldHit(point);
        return { enemy: false, killed: false };
      }
      case "pylon":
        this.mission.damagePylon(target.id, amount, point);
        return { enemy: false, killed: false };
      case "secretWall":
        this.mission.damageSecretWall(amount, point);
        return { enemy: false, killed: false };
    }
  }

  // ───────────────────────── simulation ─────────────────────────

  /** Advance one fixed step. */
  step(dt: number, input: InputSnapshot): void {
    if (this.isOver) return;
    this.frame++;
    this.time += dt;
    this.player.update(dt, input);
    this.arsenal.update(dt, input);
    if (this.zoo) this.player.health = this.player.maxHealth; // invulnerable while viewing
    else for (const e of [...this.enemies]) e.update(dt);
    this.separate();
    this.updateGlobs(dt);
    this.mission.updatePickups();
    this.mission.updateTriggers();

    // Hurt sound whenever health drops (throttled)
    this.hurtCd -= dt;
    if (this.player.health < this.lastHealth - 0.5 && this.hurtCd <= 0 && this.player.alive) {
      this.sound("player_hurt");
      this.hurtCd = 0.25;
    }
    this.lastHealth = this.player.health;
    this.mission.checkDeath();
  }

  /** Keep enemies from stacking and from walking through the player. */
  private separate(): void {
    const pp = this.player.pos;
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d > 0.001 && d < min) {
          const push = new Vec3(dx / d, 0, dz / d).scale((min - d) / 2);
          b.push(push);
          a.push(push.scale(-1));
        }
      }
      const dx = pp.x - a.pos.x, dz = pp.z - a.pos.z;
      const d = Math.hypot(dx, dz), min = a.radius + 0.4;
      if (d > 0.001 && d < min && Math.abs(pp.y - a.pos.y) < 2.5) {
        pp.copyFrom(this.physics.move(this.player.body, pp, new Vec3(dx / d, 0, dz / d).scale(min - d)));
      }
    }
  }

  private updateGlobs(dt: number): void {
    const G = this.data.enemies.spitter.glob;
    const eye = this.player.eye;
    this.globs = this.globs.filter((g) => {
      g.life -= dt;
      const step = g.vel.scale(dt);
      const blocked = !this.physics.lineOfSight(g.pos, g.pos.add(step));
      g.pos.addInPlace(step);
      if (Vec3.distance(g.pos, eye) < G.hitRadiusEye || Vec3.distance(g.pos, this.player.pos) < G.hitRadiusBody) {
        this.player.hurt(G.damage);
        this.events.emit("damageFlash", {});
        this.events.emit("globEnded", { id: g.id, pos: g.pos.clone(), hitPlayer: true });
        return false;
      }
      if (blocked || g.life <= 0 || g.pos.y < 0.05) {
        if (g.life > 0) this.sound("glob_splash", g.pos.clone());
        this.events.emit("globEnded", { id: g.id, pos: g.pos.clone(), hitPlayer: false });
        return false;
      }
      return true;
    });
  }

  /** Compact fingerprint of the simulation state (determinism tests, replay verification). */
  stateHash(): string {
    const f = (n: number) => (Math.round(n * 1e5) / 1e5).toString();
    const p = this.player;
    const parts = [
      this.frame, this.rng.state, this.phase, this.kills, this.mission.secrets,
      f(p.pos.x), f(p.pos.y), f(p.pos.z), f(p.yaw), f(p.pitch), f(p.health), f(p.view.pitch), f(p.view.yaw),
      this.arsenal.current, ...this.arsenal.guns.map((g) => g.ammo),
      ...this.enemies.map((e) => `${e.id}:${e.type}:${f(e.pos.x)},${f(e.pos.y)},${f(e.pos.z)}:${f(e.yaw)}:${f(e.hp)}:${e.awake ? 1 : 0}`),
      ...this.globs.map((g) => `g${g.id}:${f(g.pos.x)},${f(g.pos.y)},${f(g.pos.z)}`),
      ...this.mission.pylons.map((y) => f(y.hp)),
    ];
    let h = 2166136261;
    const s = parts.join("|");
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16) + ":" + s.length;
  }
}
