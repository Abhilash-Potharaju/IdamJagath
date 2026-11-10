import {
  Color3, Constants, DynamicTexture, Mesh, MeshBuilder, type Scene, StandardMaterial, TransformNode, Vector3,
} from "@babylonjs/core";
import { place } from "./Props";

/**
 * The alien fleet from the key art: mid-size saucers (tools/blender/saucer.py) circling over the old city, each
 * shining a pulsing blood-red tractor beam down to a glowing spot on the ground. Decor only: not pickable, no
 * collisions, unfogged (they read against the storm sky), and named "fx-*" so they don't cast shadows.
 */
const RED = new Color3(1.0, 0.07, 0.04);

/** Vertical fade for beams (bright at the emitter, fading toward the ground) as an opacity texture. */
function beamTexture(scene: Scene): DynamicTexture {
  const t = new DynamicTexture("fx-beamTex", { width: 8, height: 128 }, scene, false);
  const c = t.getContext() as unknown as CanvasRenderingContext2D;
  const g = c.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "rgba(255,255,255,0.8)");
  g.addColorStop(0.35, "rgba(255,255,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0.04)");
  c.fillStyle = g; c.fillRect(0, 0, 8, 128);
  t.update(false);
  t.hasAlpha = true;
  return t;
}

/** Soft round glow for the beam's ground spot. */
function spotTexture(scene: Scene): DynamicTexture {
  const t = new DynamicTexture("fx-spotTex", { width: 128, height: 128 }, scene, false);
  const c = t.getContext() as unknown as CanvasRenderingContext2D;
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.9)"); g.addColorStop(0.4, "rgba(255,255,255,0.35)"); g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  t.update(false);
  t.hasAlpha = true;
  return t;
}

function additive(scene: Scene, name: string, opacity: DynamicTexture, strength: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveColor = RED.scale(strength);
  m.diffuseColor = Color3.Black();
  m.opacityTexture = opacity;
  m.alphaMode = Constants.ALPHA_ADD;
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  m.fogEnabled = false;
  return m;
}

/** A tractor beam cone hanging under `parent` (top at the parent), `height` metres long. */
export function makeBeam(scene: Scene, name: string, parent: TransformNode, height: number, topD: number, bottomD: number, mat: StandardMaterial): Mesh {
  const beam = MeshBuilder.CreateCylinder(name, { height, diameterTop: topD, diameterBottom: bottomD, tessellation: 20, cap: Mesh.NO_CAP }, scene);
  beam.material = mat;
  beam.parent = parent;
  beam.position.y = -height / 2;
  beam.isPickable = false;
  beam.applyFog = false;
  return beam;
}

interface Ship { node: TransformNode; spot: Mesh | null; cx: number; cz: number; r: number; alt: number; speed: number; phase: number }

export async function addFleet(scene: Scene): Promise<void> {
  const beamTex = beamTexture(scene);
  const spotTex = spotTexture(scene);
  const beamMat = additive(scene, "fx-beamMat", beamTex, 0.32);
  const spotMat = additive(scene, "fx-spotMat", spotTex, 0.9);

  // centre x/z of the orbit, orbit radius, altitude, angular speed (rad/s): near ones over the map, far ones on the horizon
  const orbits: [number, number, number, number, number][] = [
    [0, 82, 34, 52, 0.05], [-38, 36, 24, 66, -0.04], [42, 108, 28, 62, 0.035], [62, -24, 40, 84, 0.03], [-75, 155, 48, 92, -0.025],
  ];
  const ships: Ship[] = [];
  for (let i = 0; i < orbits.length; i++) {
    const [cx, cz, r, alt, speed] = orbits[i];
    let m: Awaited<ReturnType<typeof place>>;
    try {
      m = await place(scene, "saucer.glb", new Vector3(cx, alt, cz));
    } catch {
      return; // model missing: no fleet
    }
    for (const mesh of m.meshes) {
      mesh.name = `fx-saucer-${i}`;
      mesh.isPickable = false;
      mesh.applyFog = false;
    }
    const s = 0.9 + (i % 3) * 0.2; // vary sizes a little (~14–20 m)
    m.root.scaling.setAll(s);
    const beam = makeBeam(scene, `fx-beam-${i}`, m.root, alt / s, 2.4, 7 + i, beamMat);
    beam.position.y -= 1.4; // start just under the emitter
    // Ground spot only for ships that pass over the playable area
    let spot: Mesh | null = null;
    if (Math.hypot(cx, cz - 50) < 80) {
      spot = MeshBuilder.CreateGround(`fx-spot-${i}`, { width: 14, height: 14 }, scene);
      spot.material = spotMat;
      spot.isPickable = false;
      spot.position.y = 0.06;
    }
    ships.push({ node: m.root, spot, cx, cz, r, alt, speed, phase: i * 1.7 });
  }

  // Fly the orbits, bob gently, pulse the beams (no per-frame allocations)
  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    for (const sh of ships) {
      const a = sh.phase + t * sh.speed;
      const x = sh.cx + Math.cos(a) * sh.r, z = sh.cz + Math.sin(a) * sh.r;
      sh.node.position.set(x, sh.alt + Math.sin(t * 0.6 + sh.phase) * 1.2, z);
      sh.node.rotation.y = t * 0.25 + sh.phase;
      if (sh.spot) sh.spot.position.set(x, 0.06, z);
    }
    const pulse = 0.3 + Math.sin(t * 2.3) * 0.08 + Math.sin(t * 5.1) * 0.03;
    beamMat.emissiveColor.set(RED.r * pulse, RED.g * pulse, RED.b * pulse);
    spotMat.emissiveColor.set(RED.r * pulse * 1.6, RED.g * pulse * 1.6, RED.b * pulse * 1.6);
  });
}

/** Recolour the mothership's lights to blood red and hang a huge red beam under it. */
export function redMothership(scene: Scene, root: TransformNode, worldHeight: number): void {
  for (const m of scene.materials) {
    if (m.name === "ShipGlow") {
      const pm = m as unknown as { emissiveColor?: Color3; emissiveIntensity?: number };
      if (pm.emissiveColor) pm.emissiveColor = new Color3(1.0, 0.08, 0.05);
    }
  }
  const mat = additive(scene, "fx-shipBeamMat", beamTexture(scene), 0.22);
  const s = root.scaling.y || 1;
  const beam = makeBeam(scene, "fx-shipBeam", root, worldHeight / s, 18 / s, 45 / s, mat);
  beam.position.y -= 14 / s;
}
