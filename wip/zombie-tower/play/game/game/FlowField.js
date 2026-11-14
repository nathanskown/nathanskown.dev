// Breadth-first "distance to player" map over the tile grid, so zombies can
// path around cars, desks and walls instead of getting stuck on them.

import { TILE } from '../config.js';

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export class FlowField {
  constructor(solid, cols, rows) {
    this.solid = solid; // solid[r][c] = true for blocked tiles
    this.cols = cols;
    this.rows = rows;
    this.dist = new Int32Array(cols * rows).fill(-1);
    this.pc = -1;
    this.pr = -1;
  }

  open(c, r) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && !this.solid[r][c];
  }

  // Recompute only when the player moves to a new tile.
  update(px, py) {
    const c = Math.floor(px / TILE), r = Math.floor(py / TILE);
    if (c === this.pc && r === this.pr) return;
    if (!this.open(c, r)) return;
    this.pc = c; this.pr = r;
    const { cols, dist } = this;
    dist.fill(-1);
    const q = [c + r * cols];
    dist[q[0]] = 0;
    for (let i = 0; i < q.length; i++) {
      const cur = q[i];
      const cc = cur % cols, cr = (cur - cc) / cols;
      for (const [dx, dy] of DIRS) {
        const nc = cc + dx, nr = cr + dy;
        if (!this.open(nc, nr)) continue;
        if (dx && dy && (!this.open(cc + dx, cr) || !this.open(cc, cr + dy))) continue; // no corner cutting
        const ni = nc + nr * cols;
        if (dist[ni] !== -1) continue;
        dist[ni] = dist[cur] + 1;
        q.push(ni);
      }
    }
  }

  // Unit vector pointing toward the next tile on the shortest path, or null.
  dirFrom(x, y) {
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
    if (!this.open(c, r)) return null;
    const here = this.dist[c + r * this.cols];
    if (here <= 0) return null;
    let best = null, bestD = here;
    for (const [dx, dy] of DIRS) {
      const nc = c + dx, nr = r + dy;
      if (!this.open(nc, nr)) continue;
      if (dx && dy && (!this.open(c + dx, r) || !this.open(c, r + dy))) continue;
      const d = this.dist[nc + nr * this.cols];
      if (d >= 0 && d < bestD) { bestD = d; best = [nc, nr]; }
    }
    if (!best) return null;
    const tx = (best[0] + 0.5) * TILE - x, ty = (best[1] + 0.5) * TILE - y;
    const len = Math.hypot(tx, ty) || 1;
    return { x: tx / len, y: ty / len };
  }
}
