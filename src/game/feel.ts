import type { Vector3 } from "@babylonjs/core";

/**
 * Tiny event bus + shared state for "game feel" systems, so Player, Weapon, HUD, Audio and enemies can react to
 * each other without wiring through Game.ts.
 */
export interface FeelEvents {
  hurt: { amount: number; from?: Vector3; playerPos: Vector3; yaw: number };
  footstep: { sprint: boolean };
  land: { strength: number };
  heartbeat: Record<string, never>;
  enemyHurt: { at: Vector3 };
  enemyKilled: { at: Vector3 };
  shot: { heavy: boolean };
}

type Handler<K extends keyof FeelEvents> = (e: FeelEvents[K]) => void;
const handlers = new Map<keyof FeelEvents, ((e: unknown) => void)[]>();

export const Feel = {
  on<K extends keyof FeelEvents>(k: K, h: Handler<K>): void {
    const list = handlers.get(k) ?? [];
    list.push(h as (e: unknown) => void);
    handlers.set(k, list);
  },
  emit<K extends keyof FeelEvents>(k: K, e: FeelEvents[K]): void {
    for (const h of handlers.get(k) ?? []) h(e);
  },
};

/** Trauma-based camera shake: add trauma (0..1); the offset is trauma² × noise, decaying over time. */
export const Shake = {
  trauma: 0,
  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  },
};

/** Feel settings (?bob=0..1 scales head-bob; default 1). */
const q = new URLSearchParams(location.search);
export const FeelSettings = {
  bob: Math.max(0, Math.min(1, Number(q.get("bob") ?? "1") || (q.get("bob") === "0" ? 0 : 1))),
};
