import { Vector3, type AbstractMesh } from "@babylonjs/core";
import { Vec3 } from "../../core/math";
import type { HitTarget } from "../../core/ports";

/** Core Vec3 → Babylon Vector3. */
export const toV3 = (v: { x: number; y: number; z: number }): Vector3 => new Vector3(v.x, v.y, v.z);
/** Babylon Vector3 → core Vec3. */
export const fromV3 = (v: { x: number; y: number; z: number }): Vec3 => new Vec3(v.x, v.y, v.z);

/** Applies weapon damage to a target in the core (GameWorld.damageTarget). */
export type DamageFn = (target: HitTarget, amount: number, point: Vec3) => void;

/**
 * Tag a mesh as something shots can hit: `metadata.target` is read by BabylonPhysics.raycast, and the legacy
 * `metadata.damageable` stays for dev tools / scripted tests (`takeDamage(amount, point)` with the part multiplier).
 */
export function setTarget(mesh: AbstractMesh, target: HitTarget, damage: DamageFn): void {
  mesh.metadata = {
    ...(mesh.metadata ?? {}),
    target,
    damageable: { takeDamage: (a: number, p: { x: number; y: number; z: number }) => damage(target, a * target.mul, fromV3(p)) },
  };
}
