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
