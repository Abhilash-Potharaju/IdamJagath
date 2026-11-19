import { Vec3 } from "./math";
import type { NavObstacle } from "./ports";

/**
 * Ground-floor navigation grid for monsters (the Warden is too big to bumble through the lanes by steering alone).
 *
 * Built from the physics adapter's solid obstacles at walking height (boxes, possibly rotated): cells they overlap
 * are blocked, then a distance transform gives every cell its clearance (metres to the nearest obstacle). A body of
 * radius r may use cells with clearance >= r. Paths are 8-connected A* over those cells, smoothed by string pulling.
 * Pure data and maths: deterministic, no engine types.
 */
export class NavGrid {
  static readonly CELL = 0.5;
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly h: number;
  /** Clearance per cell in metres (0 = blocked). */
  readonly clear: Float32Array;

  private constructor(x0: number, z0: number, w: number, h: number, clear: Float32Array) {
    this.x0 = x0; this.z0 = z0; this.w = w; this.h = h; this.clear = clear;
  }

  /** Rasterize obstacles into a grid covering them (the level's outer walls bound the playable area). */
  static build(obstacles: NavObstacle[]): NavGrid {
    const C = NavGrid.CELL;
    let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
    const aabb = obstacles.map((o) => {
      const c = Math.abs(Math.cos(o.yaw)), s = Math.abs(Math.sin(o.yaw));
      const ex = o.hx * c + o.hz * s, ez = o.hx * s + o.hz * c;
      mnx = Math.min(mnx, o.cx - ex); mxx = Math.max(mxx, o.cx + ex); mnz = Math.min(mnz, o.cz - ez); mxz = Math.max(mxz, o.cz + ez);
      return { ex, ez };
    });
    if (!obstacles.length) { mnx = -10; mxx = 10; mnz = -10; mxz = 10; }
    const PAD = 4; // open margin around the obstacles (beyond the grid counts as open ground)
    const x0 = Math.floor(mnx) - PAD, z0 = Math.floor(mnz) - PAD;
    const w = Math.ceil((mxx + PAD - x0) / C), h = Math.ceil((mxz + PAD - z0) / C);
    const blocked = new Uint8Array(w * h);
    const half = C / 2;
    obstacles.forEach((o, k) => {
      const { ex, ez } = aabb[k];
      const i0 = Math.max(0, Math.floor((o.cx - ex - x0) / C)), i1 = Math.min(w - 1, Math.floor((o.cx + ex - x0) / C));
      const j0 = Math.max(0, Math.floor((o.cz - ez - z0) / C)), j1 = Math.min(h - 1, Math.floor((o.cz + ez - z0) / C));
      const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
      // thin walls are grown until they're at least a cell thick, so they always block a row of cell centres
      const gx = Math.max(0.02, half - o.hx), gz = Math.max(0.02, half - o.hz);
      for (let j = j0 - 1; j <= j1 + 1; j++) {
        for (let i = i0 - 1; i <= i1 + 1; i++) {
          if (i < 0 || j < 0 || i >= w || j >= h) continue;
          const dx = x0 + (i + 0.5) * C - o.cx, dz = z0 + (j + 0.5) * C - o.cz;
          const lx = dx * c - dz * s, lz = dx * s + dz * c;
          if (Math.abs(lx) <= o.hx + gx && Math.abs(lz) <= o.hz + gz) blocked[j * w + i] = 1;
        }
      }
    });
    // Chamfer distance transform (1, √2) from blocked cells, in cells
    const INF = 1e9, D = new Float32Array(w * h);
    for (let n = 0; n < w * h; n++) D[n] = blocked[n] ? 0 : INF;
    const R2 = Math.SQRT2;
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? INF : D[j * w + i]);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const n = j * w + i;
      if (!D[n]) continue;
      D[n] = Math.min(D[n], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + R2, at(i + 1, j - 1) + R2);
    }
    for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
      const n = j * w + i;
      if (!D[n]) continue;
      D[n] = Math.min(D[n], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + R2, at(i - 1, j + 1) + R2);
    }
    const clear = new Float32Array(w * h);
    for (let n = 0; n < w * h; n++) clear[n] = D[n] ? Math.max(0, Math.min(D[n] * C - half, 1e6)) : 0;
    return new NavGrid(x0, z0, w, h, clear);
  }

  private cellOf(x: number, z: number): [number, number] {
    return [Math.floor((x - this.x0) / NavGrid.CELL), Math.floor((z - this.z0) / NavGrid.CELL)];
  }

  private centre(n: number): Vec3 {
    const i = n % this.w, j = (n - i) / this.w;
    return new Vec3(this.x0 + (i + 0.5) * NavGrid.CELL, 0, this.z0 + (j + 0.5) * NavGrid.CELL);
  }

  /** Clearance (m) at a point; unlimited outside the grid (open ground). */
  clearanceAt(x: number, z: number): number {
    const [i, j] = this.cellOf(x, z);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? 1e6 : this.clear[j * this.w + i];
  }

  /** True when a body of radius r can walk straight from a to b (every cell along the segment has room). */
  lineClear(ax: number, az: number, bx: number, bz: number, r: number): boolean {
    const len = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(len / (NavGrid.CELL * 0.5)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      if (this.clearanceAt(ax + (bx - ax) * t, az + (bz - az) * t) < r) return false;
    }
    return true;
  }

  /**
   * Waypoints (excluding the start) from `from` toward `to` for a body of radius r. If `to` isn't reachable (a
   * doorway too narrow, upstairs), the path ends at the reachable cell nearest to it. Null when `from` is boxed in.
   */
  findPath(from: Vec3, to: Vec3, r: number, maxExpand = 40000): Vec3[] | null {
    const { w, h, clear } = this;
    let [si, sj] = this.cellOf(from.x, from.z);
    si = Math.min(w - 1, Math.max(0, si)); sj = Math.min(h - 1, Math.max(0, sj));
    let start = sj * w + si;
    if (clear[start] < r) {
      // pressed against something: start from the roomiest neighbour within 1.5 m
      let best = -1, bc = 0;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
        const i = si + di, j = sj + dj;
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        const c = clear[j * w + i];
        if (c >= r && (best < 0 || di * di + dj * dj < bc)) { best = j * w + i; bc = di * di + dj * dj; }
      }
      if (best < 0) return null;
      start = best;
    }
    const [gi, gj] = this.cellOf(to.x, to.z);
    const C = NavGrid.CELL;
    const hcost = (n: number) => { const i = n % w, j = (n - i) / w; const dx = Math.abs(i - gi), dz = Math.abs(j - gj); return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * C; };
    const g = new Float32Array(w * h).fill(Infinity), came = new Int32Array(w * h).fill(-1), closed = new Uint8Array(w * h);
    const heap = new MinHeap();
    g[start] = 0; heap.push(start, hcost(start));
    let bestNode = start, bestH = hcost(start), expanded = 0;
    while (heap.size && expanded < maxExpand) {
      const n = heap.pop();
      if (closed[n]) continue;
      closed[n] = 1; expanded++;
      const hn = hcost(n);
      if (hn < bestH) { bestH = hn; bestNode = n; }
      if (hn === 0) break;
      const i = n % w, j = (n - i) / w;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const m = nj * w + ni;
        if (closed[m] || clear[m] < r) continue;
        if (di && dj && (clear[j * w + ni] < r || clear[nj * w + i] < r)) continue; // no corner cutting
        const ng = g[n] + (di && dj ? Math.SQRT2 : 1) * C;
        if (ng < g[m]) { g[m] = ng; came[m] = n; heap.push(m, ng + hcost(m)); }
      }
    }
    const cells: number[] = [];
    for (let n = bestNode; n !== -1; n = came[n]) cells.push(n);
    cells.reverse();
    // String pulling: keep only the waypoints needed to stay on walkable cells
    const pts = cells.map((n) => this.centre(n));
    if (pts.length && bestH === 0) pts[pts.length - 1] = new Vec3(to.x, 0, to.z);
    const out: Vec3[] = [];
    let anchor = new Vec3(from.x, 0, from.z), k = 0;
    while (k < pts.length) {
      let far = k;
      for (let m = pts.length - 1; m > k; m--) if (this.lineClear(anchor.x, anchor.z, pts[m].x, pts[m].z, r)) { far = m; break; }
      out.push(pts[far]);
      anchor = pts[far];
      k = far + 1;
    }
    return out;
  }
}

/** Binary min-heap of (node, priority). */
class MinHeap {
  private n: number[] = [];
  private p: number[] = [];
  get size(): number { return this.n.length; }
  push(node: number, pri: number): void {
    const n = this.n, p = this.p;
    let i = n.length;
    n.push(node); p.push(pri);
    while (i > 0) {
      const q = (i - 1) >> 1;
      if (p[q] <= pri) break;
      n[i] = n[q]; p[i] = p[q]; i = q;
    }
    n[i] = node; p[i] = pri;
  }
  pop(): number {
    const n = this.n, p = this.p, top = n[0];
    const ln = n.pop()!, lp = p.pop()!;
    if (n.length) {
      let i = 0;
      for (;;) {
        const a = 2 * i + 1, b = a + 1;
        let m = i, mp = lp;
        if (a < n.length && p[a] < mp) { m = a; mp = p[a]; }
        if (b < n.length && p[b] < mp) { m = b; mp = p[b]; }
        if (m === i) break;
        n[i] = n[m]; p[i] = p[m]; i = m;
      }
      n[i] = ln; p[i] = lp;
    }
    return top;
  }
}
