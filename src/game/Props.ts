import { LoadAssetContainerAsync, MeshBuilder, type AbstractMesh, type AssetContainer, type Mesh, type Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { markWorld } from "./types";
import "@babylonjs/loaders/glTF";

/**
 * Loads .glb models from /public/models once and places copies in the level.
 * Models are VISUAL ONLY: collisions and line of sight use the invisible gray-box colliders in Level.ts.
 * They stay pickable, so bullets spark on them.
 */
const cache = new Map<string, Promise<AssetContainer>>();

function load(scene: Scene, file: string): Promise<AssetContainer> {
  let p = cache.get(file);
  if (!p) {
    p = LoadAssetContainerAsync(`${import.meta.env.BASE_URL}models/${file}`, scene);
    cache.set(file, p);
  }
  return p;
}

export interface Placed {
  root: TransformNode;
  meshes: AbstractMesh[];
}

/**
 * Place a copy of `file` at `pos`, rotated by `yaw` radians about Y.
 * `only` keeps just one top-level node of a kit file (e.g. "Lamp_Post" from street_props.glb) and moves it to the origin.
 */
export async function place(scene: Scene, file: string, pos: Vector3, yaw = 0, only?: string): Promise<Placed> {
  const c = await load(scene, file);
  const inst = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
  const holder = new TransformNode(`${only ?? file}-holder`, scene);
  holder.position.copyFrom(pos);
  holder.rotation.y = yaw;
  for (const r of inst.rootNodes) {
    r.parent = holder;
    if (only) {
      for (const child of r.getChildren()) {
        if (child.name === only) (child as TransformNode).position.setAll(0);
        else child.dispose();
      }
    }
  }
  const meshes = holder.getChildMeshes(false);
  for (const m of meshes) {
    m.checkCollisions = false;
    m.isPickable = true;
    // Many exported models come in as ALPHABLEND even though they're opaque, which breaks depth sorting and shadows
    // (the entrance auto looked smeared and dark). Use alpha-test instead: still keeps leaf/cut-out transparency.
    const pm = m.material as { transparencyMode?: number | null; alpha?: number; alphaCutOff?: number } | null;
    if (pm && pm.transparencyMode === 2 && (pm.alpha ?? 1) >= 0.99) { pm.transparencyMode = 1; pm.alphaCutOff = 0.4; }
    const mat = m.material as { maxSimultaneousLights?: number } | null;
    if (mat && "maxSimultaneousLights" in mat) mat.maxSimultaneousLights = 8;
  }
  return { root: holder, meshes };
}

/**
 * Give a placed model a solid, invisible collision box fitted to its shape (in the holder's own rotated space,
 * so it follows the prop's yaw). Players and enemies collide with it and it blocks line of sight; bullets still
 * spark on the visible model. `shrink` trims the box slightly so you can get close without snagging.
 */
export function makeSolid(p: Placed, shrink = 0.92): Mesh | null {
  p.root.computeWorldMatrix(true);
  const inv = p.root.getWorldMatrix().clone().invert();
  const mn = new Vector3(Infinity, Infinity, Infinity), mx = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of p.meshes) {
    m.computeWorldMatrix(true);
    for (const c of m.getBoundingInfo().boundingBox.vectorsWorld) {
      const l = Vector3.TransformCoordinates(c, inv);
      mn.minimizeInPlace(l); mx.maximizeInPlace(l);
    }
  }
  if (!isFinite(mn.x)) return null;
  const size = mx.subtract(mn);
  const box = MeshBuilder.CreateBox("prop-solid", { width: size.x * shrink, height: size.y, depth: size.z * shrink }, p.root.getScene());
  box.parent = p.root;
  box.position.copyFrom(mn.add(mx).scale(0.5));
  box.isVisible = false;
  box.isPickable = false; // bullets hit the visible model instead
  box.checkCollisions = true;
  markWorld(box); // blocks line of sight
  return box;
}

/**
 * Close gaps narrower than the player between a solid prop and a wall: such pockets let the player wedge in and get
 * stuck (e.g. a lamp post 0.6 m from a wall). Adds an invisible filler collider spanning the gap. Run once after all
 * props are placed.
 */
export function fillCollisionPockets(scene: Scene, playerDiameter = 0.8, margin = 0.15): number {
  const solids: { mn: Vector3; mx: Vector3 }[] = [];
  const walls: { mn: Vector3; mx: Vector3 }[] = [];
  for (const m of scene.meshes) {
    if (!m.checkCollisions || !m.isEnabled() || m.isDisposed()) continue;
    m.computeWorldMatrix(true);
    const b = m.getBoundingInfo().boundingBox;
    const mn = b.minimumWorld.clone(), mx = b.maximumWorld.clone();
    if (mx.y - mn.y < 0.3) continue; // floors
    if (m.name === "prop-solid") solids.push({ mn, mx });
    else if (m.metadata?.world) walls.push({ mn, mx });
  }
  const gapMax = playerDiameter + margin;
  let added = 0;
  const filler = (x0: number, x1: number, z0: number, z1: number, h: number) => {
    const box = MeshBuilder.CreateBox("pocket-filler", { width: x1 - x0, height: h, depth: z1 - z0 }, scene);
    box.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    box.isVisible = false; box.isPickable = false; box.checkCollisions = true;
    markWorld(box); // so the physics depenetration safety net also pushes bodies out of fillers
    added++;
  };
  for (const s of solids) {
    const h = Math.min(2.2, s.mx.y);
    for (const w of walls) {
      const overlapZ = Math.min(s.mx.z, w.mx.z) - Math.max(s.mn.z, w.mn.z);
      const overlapX = Math.min(s.mx.x, w.mx.x) - Math.max(s.mn.x, w.mn.x);
      if (overlapZ > 0) {
        // Extend 0.3 m past the prop (within the wall) so rotated prop corners can't leave a notch to catch on
        const z0 = Math.max(s.mn.z - 0.3, w.mn.z), z1 = Math.min(s.mx.z + 0.3, w.mx.z);
        const gapR = w.mn.x - s.mx.x, gapL = s.mn.x - w.mx.x;
        if (gapR > 0.001 && gapR < gapMax) filler(s.mx.x, w.mn.x, z0, z1, h);
        if (gapL > 0.001 && gapL < gapMax) filler(w.mx.x, s.mn.x, z0, z1, h);
      }
      if (overlapX > 0) {
        const x0 = Math.max(s.mn.x - 0.3, w.mn.x), x1 = Math.min(s.mx.x + 0.3, w.mx.x);
        const gapF = w.mn.z - s.mx.z, gapB = s.mn.z - w.mx.z;
        if (gapF > 0.001 && gapF < gapMax) filler(x0, x1, s.mx.z, w.mn.z, h);
        if (gapB > 0.001 && gapB < gapMax) filler(x0, x1, w.mx.z, s.mn.z, h);
      }
    }
  }
  return added;
}
