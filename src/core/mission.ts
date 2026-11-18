import { Vec3 } from "./math";
import { fmt, type MissionData, type Spawn } from "../data/schemas";
import type { LevelAnchors, Rect } from "./ports";
import type { Phase } from "./events";
import type { CoreContext } from "./context";
import type { Player } from "./entities/player";

export interface Pylon { index: number; pos: Vec3; hp: number; alive: boolean }
export interface Pickup { index: number; kind: "health" | "secret"; pos: Vec3; taken: boolean }

/** What the mission needs from the world. */
export interface MissionHost extends CoreContext {
  readonly player: Player;
  readonly explore: boolean;
  readonly zoo: boolean;
  readonly time: number;
  readonly kills: number;
  spawn(sp: Spawn, awake: boolean): void;
  wakeEnemiesNorthOf(z: number): void;
}

const inRect = (p: Vec3, r: Rect): boolean => p.x >= r.x1 && p.x <= r.x2 && p.z >= r.z1 && p.z <= r.z2;

/**
 * Level 1 objectives, data-driven from mission.json + the level anchors:
 * destroy the pylons → the cage opens → free the captives (escape wave) → reach extraction → won. Death → dead.
 */
export class Mission {
  phase: Phase = "pylons";
  readonly pylons: Pylon[];
  readonly pickups: Pickup[];
  secretWallHp: number;
  secrets = 0;
  objectiveText = "";
  private ambushDone = false;
  private readonly host: MissionHost;
  private readonly M: MissionData;
  private readonly L: LevelAnchors;

  constructor(host: MissionHost, data: MissionData, level: LevelAnchors) {
    this.host = host;
    this.M = data;
    this.L = level;
    this.pylons = level.pylonSpots.map((p, index) => ({ index, pos: new Vec3(p.x, 3, p.z), hp: data.pylon.hp, alive: true }));
    this.pickups = [
      ...level.healthSpots.map((p, i) => ({ index: i, kind: "health" as const, pos: new Vec3(p.x, 0.8, p.z), taken: false })),
      { index: level.healthSpots.length, kind: "secret" as const, pos: new Vec3(level.secretPickup.x, 1, level.secretPickup.z), taken: false },
    ];
    this.secretWallHp = data.secretWall.hp;
  }

  get pylonsLeft(): number { return this.pylons.filter((p) => p.alive).length; }
  get isOver(): boolean { return this.phase === "won" || this.phase === "dead"; }

  start(): void {
    if (!this.host.explore) for (const sp of this.M.initialSpawns) this.host.spawn(sp, false);
    this.updateObjective();
  }

  damagePylon(index: number, amount: number, at: Vec3): void {
    const p = this.pylons[index];
    if (!p || p.hp <= 0) return;
    const h = this.host;
    p.hp -= amount;
    h.events.emit("pylonHit", { index, at: Vec3.from(at) });
    h.sound("pylon_hit", Vec3.from(at));
    if (p.hp > 0) return;
    p.alive = false;
    const base = new Vec3(p.pos.x, 2.25, p.pos.z);
    h.events.emit("pylonDestroyed", { index, at: base });
    h.sound("pylon_explode", base.clone());
    const left = this.pylonsLeft;
    if (left > 0) {
      h.message(fmt(this.M.messages.pylonDestroyed, { left }), 2);
    } else {
      this.setPhase("cage");
      h.events.emit("cageOpened", { at: this.L.cageDoor.clone() });
      h.sound("cage_open", this.L.cageDoor.clone());
      h.message(this.M.messages.allPylonsDown, 3);
    }
    this.updateObjective();
  }

  damageSecretWall(amount: number, at: Vec3): void {
    if (this.secretWallHp <= 0) return;
    this.secretWallHp -= amount;
    this.host.events.emit("secretWallHit", { at: Vec3.from(at) });
    if (this.secretWallHp <= 0) {
      this.host.events.emit("secretWallBroken", {});
      this.host.message(this.M.secretWall.message, 3);
    }
  }

  updatePickups(): void {
    const h = this.host, p = h.player.pos, PK = this.M.pickups;
    for (const k of this.pickups) {
      if (k.taken) continue;
      if (Math.hypot(p.x - k.pos.x, p.z - k.pos.z) > PK.health.radius) continue;
      if (k.kind === "health") {
        if (h.player.health >= h.player.maxHealth) continue;
        h.player.heal(PK.health.amount);
        h.sound("pickup");
        h.message(PK.health.message, 1.2);
      } else {
        this.secrets++;
        h.sound("secret");
        h.player.heal(PK.secret.amount, PK.secret.cap);
        h.message(PK.secret.message, 3.5);
      }
      k.taken = true;
      h.events.emit("pickup", { index: k.index, kind: k.kind });
    }
  }

  updateTriggers(): void {
    const h = this.host, M = this.M, p = h.player.pos;

    // Surprise encounter: the Warden drops from the Charminar when you enter the plaza
    if (!this.ambushDone && !h.explore && !h.zoo && p.z > this.L.plazaEntryZ) {
      this.ambushDone = true;
      h.events.emit("ambush", { alarmSeconds: M.ambush.alarmSeconds });
      h.sound("alarm");
      h.message(M.ambush.message, 2);
      for (const sp of M.ambush.spawns) h.spawn(sp, false);
      h.wakeEnemiesNorthOf(M.ambush.wakeEnemiesNorthOfZ);
    }

    if (this.phase === "cage" && inRect(p, this.L.cageTrigger)) {
      this.setPhase("escape");
      h.events.emit("captivesFreed", {});
      h.sound("captives_freed");
      h.message(M.escapeWave.message, 3.5);
      if (!h.explore) for (const sp of M.escapeWave.spawns) h.spawn(sp, true);
      this.updateObjective();
    }

    if (this.phase === "escape" && inRect(p, this.L.extraction)) {
      this.setPhase("won");
      h.sound("win");
      h.events.emit("missionEnd", {
        result: "won", title: "MISSION COMPLETE",
        body: `Charminar sector liberated.<br/>Time ${fmtTime(h.time)} · Kills ${h.kills} · Secrets ${this.secrets}/1 · Health ${Math.ceil(h.player.health)}`,
      });
    }
  }

  checkDeath(): void {
    const h = this.host;
    if (!h.player.alive && !this.isOver) {
      this.setPhase("dead");
      h.sound("lose");
      h.events.emit("missionEnd", {
        result: "dead", title: "YOU FELL",
        body: `The occupation holds… for now.<br/>Time ${fmtTime(h.time)} · Kills ${h.kills}`,
      });
    }
  }

  /** World position of the current objective (nearest live pylon, the cage, or extraction). */
  objectiveTarget(): Vec3 | null {
    if (this.phase === "pylons") {
      const p = this.host.player.pos;
      let best: Vec3 | null = null, bestD = Infinity;
      for (const t of this.pylons) {
        if (!t.alive) continue;
        const d = Vec3.distanceSquared(t.pos, p);
        if (d < bestD) { bestD = d; best = t.pos; }
      }
      return best;
    }
    if (this.phase === "cage") return new Vec3(0, 1.5, 103);
    if (this.phase === "escape") return new Vec3(0, 1.5, -10);
    return null;
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.host.events.emit("phase", { phase });
  }

  private updateObjective(): void {
    const h = this.host, O = this.M.objectives;
    let text: string;
    if (h.zoo) text = "▸ ZOO MODE: monsters frozen for viewing. Crawlers in the lane, Spitters at the lane end / courtyard / plaza";
    else if (h.explore) text = "▸ EXPLORE MODE: no monsters. Walk around freely (remove ?explore from the URL to play the mission)";
    else {
      const total = this.pylons.length;
      const t: Record<string, string> = {
        pylons: fmt(O.pylons, { done: total - this.pylonsLeft, total }),
        cage: O.cage,
        escape: O.escape,
      };
      text = t[this.phase] ?? "";
    }
    this.objectiveText = text;
    h.events.emit("objective", { text });
  }
}

export function fmtTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
