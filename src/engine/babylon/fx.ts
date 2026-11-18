import {
  Color3, Color4, DynamicTexture, Mesh as BMesh, MeshBuilder, ParticleSystem, Ray, Scene, StandardMaterial, Texture, Vector3,
  type AbstractMesh,
} from "@babylonjs/core";

const cache = new Map<string, StandardMaterial>();
function glowMat(scene: Scene, hex: string): StandardMaterial {
  let m = cache.get(hex);
  if (!m) {
    m = new StandardMaterial("fx" + hex, scene);
    m.emissiveColor = Color3.FromHexString(hex);
    m.diffuseColor = Color3.Black();
    m.disableLighting = true;
    cache.set(hex, m);
  }
  return m;
}

/** Expanding, fading sphere: used for bullet impacts and explosions. */
export function burst(scene: Scene, at: Vector3, hex: string, size = 0.25, seconds = 0.15): void {
  const s = MeshBuilder.CreateSphere("fx", { diameter: 1, segments: 6 }, scene);
  s.isPickable = false;
  s.position.copyFrom(at);
  s.material = glowMat(scene, hex).clone("fxc");
  s.scaling.setAll(size);
  const mat = s.material as StandardMaterial;
  let t = 0;
  const obs = scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    const k = t / seconds;
    s.scaling.setAll(size * (1 + k * 2));
    mat.alpha = Math.max(0, 1 - k);
    if (k >= 1) {
      scene.onBeforeRenderObservable.remove(obs);
      mat.dispose();
      s.dispose();
    }
  });
}

export { glowMat };

// ───────────────────────── modern shot feedback ─────────────────────────

function canvasTex(scene: Scene, name: string, size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): DynamicTexture {
  const t = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const c = t.getContext() as unknown as CanvasRenderingContext2D;
  c.clearRect(0, 0, size, size);
  draw(c, size);
  t.hasAlpha = true;
  t.update(true);
  return t;
}

/** Soft round particle sprite. */
function softDot(scene: Scene): DynamicTexture {
  return canvasTex(scene, "fx-dot", 64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.7)"); g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  });
}

/** Muzzle-flash star sprite. */
export function flashTexture(scene: Scene): DynamicTexture {
  return canvasTex(scene, "fx-flash", 128, (c, s) => {
    const cx = s / 2;
    const g = c.createRadialGradient(cx, cx, 0, cx, cx, cx);
    g.addColorStop(0, "rgba(255,255,235,1)"); g.addColorStop(0.18, "rgba(255,220,140,0.95)");
    g.addColorStop(0.45, "rgba(255,150,40,0.45)"); g.addColorStop(1, "rgba(255,90,0,0)");
    c.fillStyle = g;
    c.beginPath();
    const spikes = 7;
    for (let i = 0; i <= spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? cx * (0.8 + Math.random() * 0.2) : cx * 0.28;
      c.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
    }
    c.closePath(); c.fill();
    c.fillStyle = g; c.beginPath(); c.arc(cx, cx, cx * 0.42, 0, Math.PI * 2); c.fill();
  });
}

interface Burst { pos: Vector3; normal: Vector3; left: number; speed: number; spread: number }

/** One ParticleSystem that can emit many bursts per frame at different spots (start position/direction from a queue). */
class BurstParticles {
  readonly ps: ParticleSystem;
  private queue: Burst[] = [];

  constructor(scene: Scene, name: string, capacity: number, tex: Texture, setup: (ps: ParticleSystem) => void) {
    const ps = new ParticleSystem(name, capacity, scene);
    ps.particleTexture = tex;
    ps.emitter = Vector3.Zero();
    ps.emitRate = 0;
    ps.manualEmitCount = 0;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.startPositionFunction = (_wm, pos) => {
      const b = this.queue[0];
      if (!b) return;
      pos.copyFrom(b.pos);
    };
    ps.startDirectionFunction = (_wm, dir) => {
      const b = this.queue[0];
      if (!b) { dir.set(0, 1, 0); return; }
      const r = () => (Math.random() - 0.5) * 2 * b.spread;
      dir.copyFromFloats(b.normal.x + r(), b.normal.y + r() + 0.25, b.normal.z + r()).normalize().scaleInPlace(b.speed * (0.5 + Math.random()));
      if (--b.left <= 0) this.queue.shift();
    };
    setup(ps);
    ps.start();
    this.ps = ps;
  }

  emit(pos: Vector3, normal: Vector3, count: number, speed: number, spread = 0.6): void {
    if (this.queue.length > 40) return; // cap pending bursts
    this.queue.push({ pos: pos.clone(), normal: normal.clone(), left: count, speed, spread });
    this.ps.manualEmitCount = (this.ps.manualEmitCount > 0 ? this.ps.manualEmitCount : 0) + count;
  }
}

interface Shell { mesh: BMesh; vel: Vector3; spin: Vector3; life: number; bounced: boolean }
interface Fade { mesh: BMesh; life: number; max: number }

/** Shared per-scene feedback effects: impacts, decals, shells, tracers, smoke. All pooled and capped. */
export class Fx {
  static readonly MAX_DECALS = 60;
  static readonly MAX_SPLATS = 24;
  static readonly MAX_SHELLS = 30;
  static readonly MAX_TRACERS = 12;
  private static byScene = new WeakMap<Scene, Fx>();
  static for(scene: Scene): Fx {
    let f = Fx.byScene.get(scene);
    if (!f) { f = new Fx(scene); Fx.byScene.set(scene, f); }
    return f;
  }

  readonly sparks: BurstParticles;
  readonly dust: BurstParticles;
  readonly ichor: BurstParticles;
  readonly smoke: BurstParticles;
  private scene: Scene;
  private holes: BMesh[] = []; private holeI = 0;
  private splats: BMesh[] = []; private splatI = 0;
  private shells: Shell[] = []; private shellI = 0;
  private tracers: Fade[] = []; private tracerI = 0;

  private constructor(scene: Scene) {
    this.scene = scene;
    const dot = softDot(scene);
    this.sparks = new BurstParticles(scene, "fx-sparks", 400, dot, (ps) => {
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.color1 = new Color4(1, 0.85, 0.45, 1); ps.color2 = new Color4(1, 0.55, 0.15, 1); ps.colorDead = new Color4(0.6, 0.1, 0, 0);
      ps.minSize = 0.02; ps.maxSize = 0.05; ps.minLifeTime = 0.12; ps.maxLifeTime = 0.35;
      ps.gravity = new Vector3(0, -14, 0); ps.minEmitPower = 1; ps.maxEmitPower = 1;
    });
    this.dust = new BurstParticles(scene, "fx-dust", 300, dot, (ps) => {
      ps.color1 = new Color4(0.62, 0.56, 0.5, 0.55); ps.color2 = new Color4(0.45, 0.4, 0.36, 0.45); ps.colorDead = new Color4(0.4, 0.38, 0.35, 0);
      ps.minSize = 0.08; ps.maxSize = 0.22; ps.minLifeTime = 0.35; ps.maxLifeTime = 0.8;
      ps.minScaleX = 1; ps.gravity = new Vector3(0, -1.2, 0); ps.minEmitPower = 1; ps.maxEmitPower = 1;
      ps.addSizeGradient(0, 0.6); ps.addSizeGradient(1, 1.8);
    });
    this.ichor = new BurstParticles(scene, "fx-ichor", 400, dot, (ps) => {
      ps.color1 = new Color4(0.35, 1, 0.3, 1); ps.color2 = new Color4(0.6, 0.15, 0.85, 1); ps.colorDead = new Color4(0.1, 0.3, 0.05, 0);
      ps.minSize = 0.04; ps.maxSize = 0.11; ps.minLifeTime = 0.25; ps.maxLifeTime = 0.6;
      ps.gravity = new Vector3(0, -12, 0); ps.minEmitPower = 1; ps.maxEmitPower = 1;
    });
    this.smoke = new BurstParticles(scene, "fx-smoke", 200, dot, (ps) => {
      // Faint, dark and short-lived: it sits right in front of the camera, and pale smoke here fogged the whole view
      ps.color1 = new Color4(0.4, 0.38, 0.36, 0.07); ps.color2 = new Color4(0.32, 0.3, 0.29, 0.05); ps.colorDead = new Color4(0.3, 0.3, 0.3, 0);
      ps.minSize = 0.05; ps.maxSize = 0.09; ps.minLifeTime = 0.2; ps.maxLifeTime = 0.4;
      ps.gravity = new Vector3(0, 0.8, 0); ps.minEmitPower = 1; ps.maxEmitPower = 1;
      ps.addSizeGradient(0, 0.08); ps.addSizeGradient(1, 0.28);
    });

    // Decal pools (camera-independent quads aligned to the surface normal)
    const holeTex = canvasTex(scene, "fx-hole", 64, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(8,6,6,1)"); g.addColorStop(0.28, "rgba(20,16,14,0.95)"); g.addColorStop(0.45, "rgba(60,52,46,0.6)");
      g.addColorStop(0.7, "rgba(40,34,30,0.25)"); g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.fillRect(0, 0, s, s);
    });
    const holeMat = new StandardMaterial("fx-holeMat", scene);
    holeMat.diffuseTexture = holeTex; holeMat.useAlphaFromDiffuseTexture = true; holeMat.specularColor = Color3.Black();
    holeMat.zOffset = -2; holeMat.backFaceCulling = false;
    const splatTex = canvasTex(scene, "fx-splat", 64, (c, s) => {
      for (let i = 0; i < 14; i++) {
        const r = s * (0.08 + Math.random() * 0.18), a = Math.random() * Math.PI * 2, d = Math.random() * s * 0.3;
        const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d;
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(90,255,80,0.95)"); g.addColorStop(1, "rgba(40,120,30,0)");
        c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      }
    });
    const splatMat = new StandardMaterial("fx-splatMat", scene);
    splatMat.diffuseTexture = splatTex; splatMat.useAlphaFromDiffuseTexture = true; splatMat.emissiveColor = new Color3(0.15, 0.45, 0.1);
    splatMat.specularColor = Color3.Black(); splatMat.zOffset = -2; splatMat.backFaceCulling = false;
    for (let i = 0; i < Fx.MAX_DECALS; i++) this.holes.push(this.quad("fx-hole", 0.11, holeMat));
    for (let i = 0; i < Fx.MAX_SPLATS; i++) this.splats.push(this.quad("fx-splat", 0.5, splatMat));

    // Shell casings
    const brass = new StandardMaterial("fx-brass", scene);
    brass.diffuseColor = Color3.FromHexString("#c9a24a"); brass.specularColor = new Color3(0.9, 0.8, 0.5); brass.specularPower = 64;
    const red = new StandardMaterial("fx-shotshell", scene);
    red.diffuseColor = Color3.FromHexString("#9e2a20"); red.specularColor = new Color3(0.3, 0.3, 0.3);
    for (let i = 0; i < Fx.MAX_SHELLS; i++) {
      const m = MeshBuilder.CreateCylinder("fx-shell", { diameter: 1, height: 1, tessellation: 6 }, scene);
      m.isPickable = false; m.setEnabled(false); m.material = brass;
      this.shells.push({ mesh: m, vel: Vector3.Zero(), spin: Vector3.Zero(), life: 0, bounced: false });
    }
    (this as unknown as { brass: StandardMaterial; red: StandardMaterial }).brass = brass;
    (this as unknown as { brass: StandardMaterial; red: StandardMaterial }).red = red;

    // Tracers
    const tracerMat = new StandardMaterial("fx-tracer", scene);
    tracerMat.emissiveColor = new Color3(1, 0.8, 0.45); tracerMat.disableLighting = true; tracerMat.alpha = 0.7;
    for (let i = 0; i < Fx.MAX_TRACERS; i++) {
      const m = MeshBuilder.CreateBox("fx-tracer", { width: 0.012, height: 0.012, depth: 1 }, scene);
      m.isPickable = false; m.setEnabled(false); m.material = tracerMat;
      this.tracers.push({ mesh: m, life: 0, max: 0.05 });
    }

    scene.onBeforeRenderObservable.add(() => this.tick(Math.min(scene.getEngine().getDeltaTime() / 1000, 0.05)));
  }

  private quad(name: string, size: number, mat: StandardMaterial): BMesh {
    const m = MeshBuilder.CreatePlane(name, { size }, this.scene);
    m.isPickable = false; m.setEnabled(false); m.material = mat;
    return m;
  }

  private placeDecal(m: BMesh, point: Vector3, normal: Vector3, scale: number): void {
    m.setEnabled(true);
    m.position.copyFrom(point).addInPlace(normal.scale(0.012));
    m.lookAt(point.add(normal));
    m.rotate(Vector3.Forward(), Math.random() * Math.PI * 2);
    m.scaling.setAll(scale);
  }

  /** Bullet impact by surface: "world" = sparks + dust + hole decal; "flesh" = alien ichor + splat; "energy" = sparks only. */
  impact(point: Vector3, normal: Vector3 | null, kind: "world" | "flesh" | "energy", decalOn?: AbstractMesh): void {
    const n = normal && normal.lengthSquared() > 0 ? normal : new Vector3(0, 1, 0);
    if (kind === "flesh") {
      this.ichor.emit(point, n, 12, 3.2, 0.9);
      // splat on the ground under the monster
      const down = this.scene.pickWithRay(new Ray(point, new Vector3(0, -1, 0), 4),
        (m) => (m.metadata as { world?: boolean } | null)?.world === true && m.isEnabled());
      if (down?.hit && down.pickedPoint && Math.random() < 0.6) {
        const s = this.splats[this.splatI++ % Fx.MAX_SPLATS];
        this.placeDecal(s, down.pickedPoint, new Vector3(0, 1, 0), 0.6 + Math.random() * 0.8);
      }
      return;
    }
    this.sparks.emit(point, n, kind === "energy" ? 10 : 7, 5.5, 0.7);
    if (kind === "world") {
      this.dust.emit(point, n, 4, 1.0, 0.5);
      if (decalOn) {
        const h = this.holes[this.holeI++ % Fx.MAX_DECALS];
        this.placeDecal(h, point, n, 0.8 + Math.random() * 0.5);
      }
    }
  }

  muzzleSmoke(at: Vector3, dir: Vector3, heavy: boolean): void {
    // Start well ahead of the muzzle so the puff never fills the screen
    this.smoke.emit(at.add(dir.scale(0.7)), dir, heavy ? 3 : 1, heavy ? 1.0 : 0.5, 0.35);
  }

  /** Eject a casing from `at` with initial velocity `vel` (world space). */
  shell(at: Vector3, vel: Vector3, shotgun: boolean): void {
    const s = this.shells[this.shellI++ % Fx.MAX_SHELLS];
    const mats = this as unknown as { brass: StandardMaterial; red: StandardMaterial };
    s.mesh.material = shotgun ? mats.red : mats.brass;
    s.mesh.scaling.set(shotgun ? 0.022 : 0.011, shotgun ? 0.06 : 0.032, shotgun ? 0.022 : 0.011);
    s.mesh.position.copyFrom(at);
    s.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    s.mesh.visibility = 1;
    s.mesh.setEnabled(true);
    s.vel.copyFrom(vel);
    s.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    s.life = 0;
    s.bounced = false;
  }

  tracer(from: Vector3, to: Vector3): void {
    const len = Vector3.Distance(from, to);
    if (len < 1.5) return;
    const t = this.tracers[this.tracerI++ % Fx.MAX_TRACERS];
    t.mesh.setEnabled(true);
    t.mesh.position.copyFrom(from.add(to).scale(0.5));
    t.mesh.scaling.set(1, 1, len);
    t.mesh.lookAt(to);
    t.life = 0;
    t.max = 0.045;
  }

  /** Live counts (for tests). */
  stats(): { decals: number; splats: number; shells: number; tracers: number } {
    const on = (a: { isEnabled(): boolean }[]) => a.filter((m) => m.isEnabled()).length;
    return { decals: on(this.holes), splats: on(this.splats), shells: on(this.shells.map((s) => s.mesh)), tracers: on(this.tracers.map((t) => t.mesh)) };
  }

  private tick(dt: number): void {
    for (const s of this.shells) {
      if (!s.mesh.isEnabled()) continue;
      s.life += dt;
      s.vel.y -= 9.8 * dt;
      s.mesh.position.addInPlace(s.vel.scale(dt));
      s.mesh.rotation.addInPlace(s.spin.scale(dt));
      if (s.mesh.position.y < 0.02 && s.vel.y < 0) {
        s.mesh.position.y = 0.02;
        if (!s.bounced) { s.vel.y = -s.vel.y * 0.35; s.vel.x *= 0.4; s.vel.z *= 0.4; s.spin.scaleInPlace(0.4); s.bounced = true; }
        else { s.vel.setAll(0); s.spin.setAll(0); }
      }
      if (s.life > 1.6) s.mesh.visibility = Math.max(0, 1 - (s.life - 1.6) / 0.5);
      if (s.life > 2.1) s.mesh.setEnabled(false);
    }
    for (const t of this.tracers) {
      if (!t.mesh.isEnabled()) continue;
      t.life += dt;
      if (t.life > t.max) t.mesh.setEnabled(false);
    }
  }
}
