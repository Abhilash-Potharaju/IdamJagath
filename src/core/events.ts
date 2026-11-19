import type { Vec3 } from "./math";
import type { EnemyType } from "../data/schemas";

/**
 * Typed event bus. The core emits; presentation (sound, particles, HUD, camera feel) subscribes.
 * Handlers run synchronously inside the simulation step, in subscription order.
 */
export type Phase = "pylons" | "cage" | "escape" | "won" | "dead";
export type ImpactKind = "world" | "flesh" | "energy";

/**
 * How an enemy was hit (presentation only: hit reactions, death momentum). `dir` = unit direction the damage travelled
 * (null when unknown, e.g. scripted damage), `weapon` = arsenal slot that fired (-1 = not a player weapon),
 * `weak` = the hit landed on a weak spot (part multiplier > 1).
 */
export interface HitInfo { dir: Vec3 | null; weapon: number; weak: boolean }

export interface GameEvents {
  sound: { name: string; at?: Vec3 };
  message: { text: string; seconds: number };
  hint: { id: string; text: string };
  objective: { text: string };
  phase: { phase: Phase };
  missionEnd: { result: "won" | "dead"; title: string; body: string };

  // player
  hurt: { amount: number; from?: Vec3; playerPos: Vec3; yaw: number };
  damageFlash: Record<string, never>;
  footstep: { sprint: boolean };
  land: { strength: number };
  pickup: { index: number; kind: "health" | "secret" };

  // weapons
  shot: { weapon: number; heavy: boolean };
  tracer: { to: Vec3 };
  impact: { point: Vec3; normal: Vec3; kind: ImpactKind; surface?: unknown };
  shotResult: { hit: boolean; killed: boolean; flesh: boolean };
  reloadStart: { weapon: number };
  switchStart: { to: number };

  // enemies
  enemySpawned: { id: number; type: EnemyType; body: number };
  enemyHurt: { id: number; at: Vec3 } & HitInfo;
  /** `at` = the enemy's centre; `hit` = where the killing blow landed. */
  enemyKilled: { id: number; type: EnemyType; at: Vec3; hit: Vec3 } & HitInfo;
  shieldHit: { id: number; at: Vec3 };
  shield: { id: number; up: boolean };
  wardenLanded: { id: number; at: Vec3 };
  wardenStunned: { id: number; at: Vec3 };
  globSpawned: { id: number; pos: Vec3 };
  globEnded: { id: number; pos: Vec3; hitPlayer: boolean };

  // mission objects
  pylonHit: { index: number; at: Vec3 };
  pylonDestroyed: { index: number; at: Vec3 };
  secretWallHit: { at: Vec3 };
  secretWallBroken: Record<string, never>;
  ambush: { alarmSeconds: number };
  cageOpened: { at: Vec3 };
  captivesFreed: Record<string, never>;
}

type Handler<K extends keyof GameEvents> = (e: GameEvents[K]) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Handler<keyof GameEvents>[]>();

  on<K extends keyof GameEvents>(k: K, h: Handler<K>): () => void {
    const list = this.handlers.get(k) ?? [];
    list.push(h as unknown as Handler<keyof GameEvents>);
    this.handlers.set(k, list);
    return () => {
      const l = this.handlers.get(k);
      if (l) l.splice(l.indexOf(h as unknown as Handler<keyof GameEvents>), 1);
    };
  }

  emit<K extends keyof GameEvents>(k: K, e: GameEvents[K]): void {
    const list = this.handlers.get(k);
    if (!list) return;
    for (const h of list.slice()) (h as unknown as Handler<K>)(e);
  }
}
