// Phone aiming help. Two modes (switch on the pause menu, saved per device):
//   auto   - Rook aims at and shoots the best zombie in sight on its own; dragging on the
//            right half of the screen takes over aim manually while your thumb is down.
//   assist - twin-stick aiming, firing starts the moment the right thumb touches down,
//            and shots snap onto the zombie closest to where you point.

import { TILE, AIM_KEY } from '../config.js';

const Wrap = (a) => Phaser.Math.Angle.Wrap(a);
const ASSIST_CONE = 0.55; // radians either side of where you point (~30 degrees)

export function aimMode() {
  try { return localStorage.getItem(AIM_KEY) === 'assist' ? 'assist' : 'auto'; } catch { return 'auto'; }
}

export function setAimMode(m) {
  try { localStorage.setItem(AIM_KEY, m); } catch { /* private mode: just this session */ }
}

// Is there a clear line from (x0,y0) to (x1,y1)? Walks the line through the wall grid.
// The tiles at both ends are ignored: a crowd can shove Rook (or a zombie) partly into a wall.
export function lineOfSight(solid, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 8);
  const cell = (x, y) => [Math.floor(x / TILE), Math.floor(y / TILE)];
  const [ac, ar] = cell(x0, y0), [bc, br] = cell(x1, y1);
  for (let i = 1; i < n; i++) {
    const [c, r] = cell(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
    if ((c === ac && r === ar) || (c === bc && r === br)) continue;
    if (solid[r]?.[c]) return false;
  }
  return true;
}

function candidates(game, range) {
  const p = game.player;
  const out = [];
  for (const z of game.zombies.getChildren()) {
    if (!z.alive || !z.body || z.alpha < 0.5) continue;
    const dx = z.cx - p.cx, dy = z.cy - p.cy;
    const reach = range + (z.isBoss ? z.body.halfWidth : 8);
    const dist = Math.hypot(dx, dy);
    if (dist > reach) continue;
    out.push({ z, dist, ang: Math.atan2(dy, dx) });
  }
  return out;
}

// A riot shield facing Rook would just eat the bullets.
const shieldUp = (z, angFromPlayer) => z.shield && z.shieldHp > 0 && Math.abs(Wrap(angFromPlayer + Math.PI - z.facing)) < 1.15;

// Auto mode: nearest zombie in sight, sticking with the current one so aim doesn't flicker.
export function autoTarget(game, range, current) {
  const p = game.player;
  let best = null, bestScore = Infinity;
  for (const c of candidates(game, range)) {
    let score = c.dist;
    if (shieldUp(c.z, c.ang)) score += 160;
    if (c.z === current) score -= 40;
    if (score >= bestScore) continue;
    if (!lineOfSight(game.solid, p.cx, p.cy, c.z.cx, c.z.cy)) continue;
    best = c; bestScore = score;
  }
  return best;
}

// Assist mode: zombie closest to the direction you're pointing, within a cone.
export function assistTarget(game, range, dir) {
  const p = game.player;
  let best = null, bestScore = Infinity;
  for (const c of candidates(game, range)) {
    const off = Math.abs(Wrap(c.ang - dir));
    if (off > ASSIST_CONE) continue;
    const score = off * 300 + c.dist * 0.3;
    if (score >= bestScore) continue;
    if (!lineOfSight(game.solid, p.cx, p.cy, c.z.cx, c.z.cy)) continue;
    best = c; bestScore = score;
  }
  return best;
}
