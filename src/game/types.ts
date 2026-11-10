import type { AbstractMesh, Vector3 } from "@babylonjs/core";

/** Anything the player's gun can hurt (enemies, pylons, the secret wall). */
export interface Damageable {
  takeDamage(amount: number, point: Vector3): void;
}

export function setDamageable(mesh: AbstractMesh, target: Damageable): void {
  mesh.metadata = { ...(mesh.metadata ?? {}), damageable: target };
}

export function getDamageable(mesh: AbstractMesh): Damageable | undefined {
  return mesh.metadata?.damageable;
}

/** Static level geometry: blocks bullets and line of sight. */
export function markWorld(mesh: AbstractMesh): void {
  mesh.metadata = { ...(mesh.metadata ?? {}), world: true };
}

export function isWorld(mesh: AbstractMesh): boolean {
  return mesh.metadata?.world === true;
}
