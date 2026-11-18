/**
 * Minimal engine-neutral vector maths. Left-handed, +Y up, +Z forward (matches the data files and Babylon).
 * Yaw is radians about +Y: yaw 0 faces +Z, forward(yaw) = (sin yaw, 0, cos yaw), right(yaw) = (cos yaw, 0, -sin yaw).
 */
export class Vec3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  static zero(): Vec3 { return new Vec3(0, 0, 0); }
  static from(a: { x: number; y: number; z: number }): Vec3 { return new Vec3(a.x, a.y, a.z); }
  static fromArray(a: readonly number[]): Vec3 { return new Vec3(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0); }

  set(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  copyFrom(o: { x: number; y: number; z: number }): this { this.x = o.x; this.y = o.y; this.z = o.z; return this; }
  clone(): Vec3 { return new Vec3(this.x, this.y, this.z); }
  asArray(): [number, number, number] { return [this.x, this.y, this.z]; }

  add(o: Vec3): Vec3 { return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z); }
  subtract(o: Vec3): Vec3 { return new Vec3(this.x - o.x, this.y - o.y, this.z - o.z); }
  scale(s: number): Vec3 { return new Vec3(this.x * s, this.y * s, this.z * s); }
  addInPlace(o: Vec3): this { this.x += o.x; this.y += o.y; this.z += o.z; return this; }
  subtractInPlace(o: Vec3): this { this.x -= o.x; this.y -= o.y; this.z -= o.z; return this; }
  scaleInPlace(s: number): this { this.x *= s; this.y *= s; this.z *= s; return this; }
  addInPlaceFromFloats(x: number, y: number, z: number): this { this.x += x; this.y += y; this.z += z; return this; }

  length(): number { return Math.hypot(this.x, this.y, this.z); }
  lengthSquared(): number { return this.x * this.x + this.y * this.y + this.z * this.z; }
  /** Normalises in place (a zero vector stays zero). */
  normalize(): this {
    const l = this.length();
    if (l > 0) { this.x /= l; this.y /= l; this.z /= l; }
    return this;
  }

  static distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  static distanceSquared(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
  }
  static dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
  static lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return new Vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Wrap an angle difference into [-π, π]. */
export function wrapAngle(d: number): number {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Horizontal forward unit vector for a yaw (radians about +Y). */
export const forwardOf = (yaw: number): Vec3 => new Vec3(Math.sin(yaw), 0, Math.cos(yaw));
/** Horizontal right unit vector for a yaw. */
export const rightOf = (yaw: number): Vec3 => new Vec3(Math.cos(yaw), 0, -Math.sin(yaw));

/** View direction for camera angles (pitch > 0 looks down, as in Babylon's FreeCamera). Roll doesn't change it. */
export function viewDir(pitch: number, yaw: number): Vec3 {
  return new Vec3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

/** Rotate a local offset by a yaw (same convention as a Babylon node's rotation.y). */
export function rotateY(v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return new Vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

/** Damped spring step: returns [x, v]. */
export function spring(x: number, v: number, k: number, c: number, dt: number): [number, number] {
  v += (-k * x - c * v) * dt;
  return [x + v * dt, v];
}
