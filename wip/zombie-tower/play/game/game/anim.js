// Animation helpers for the real character art (see src/art/sheets.js).
// Character sheets: row 0 idle, 1 walk down, 2 walk up, 3 walk right (mirrored for left),
// 4 attack, 5 hurt (1 frame) + death. One-row sheets (effects, projectiles) get a single `<key>_play`.
// Everything here quietly does nothing when a key is still a code-drawn placeholder.

import { SHEETS } from '../art/sheets.js';

const LOOPING_FX = new Set(['goo', 'orb', 'shackle', 'blob']);

export function defineAnims(scene) {
  const A = scene.anims;
  for (const [key, s] of Object.entries(SHEETS)) {
    if (!scene.textures.exists(key) || scene.textures.get(key).frameTotal <= 2) continue;
    const fr = (row, from, to) => A.generateFrameNumbers(key, { start: row * s.cols + from, end: row * s.cols + to });
    const add = (name, frames, frameRate, repeat) => {
      if (frames.length && !A.exists(`${key}_${name}`)) A.create({ key: `${key}_${name}`, frames, frameRate, repeat });
    };
    if (s.rows.length >= 6) {
      add('idle', fr(0, 0, s.rows[0] - 1), 3, -1);
      add('down', fr(1, 0, s.rows[1] - 1), 7, -1);
      add('up', fr(2, 0, s.rows[2] - 1), 7, -1);
      add('side', fr(3, 0, s.rows[3] - 1), 7, -1);
      add('attack', fr(4, 0, s.rows[4] - 1), 9, 0);
      add('hurt', fr(5, 0, 0), 1, 0);
      add('death', fr(5, 1, s.rows[5] - 1), 7, 0);
    } else {
      add('play', fr(0, 0, s.rows[0] - 1), 8, LOOPING_FX.has(key) ? -1 : 0);
    }
  }
}

export function hasArt(scene, key) {
  return scene.anims.exists(`${key}_down`);
}

// Walk / idle in the direction of (vx, vy). Skipped while a one-off animation is playing.
export function locomote(sprite, vx, vy, time, still = 6) {
  const key = sprite.artKey;
  if (!sprite.real || time < (sprite.animLock || 0)) return;
  let a;
  if (Math.hypot(vx, vy) < still) {
    a = `${key}_idle`;
  } else if (Math.abs(vy) > Math.abs(vx) * 1.15) {
    a = vy < 0 ? `${key}_up` : `${key}_down`;
    sprite.setFlipX(false);
  } else {
    a = `${key}_side`;
    sprite.setFlipX(vx < 0);
  }
  if (sprite.anims.currentAnim?.key !== a || !sprite.anims.isPlaying) sprite.play(a);
}

// Hold the first frame of a direction (used when the player stands still but aims somewhere).
export function holdFacing(sprite, ax, ay) {
  const key = sprite.artKey;
  const s = SHEETS[key];
  if (ay > Math.abs(ax) * 0.6) { // aiming down: real idle animation
    if (sprite.anims.currentAnim?.key !== `${key}_idle` || !sprite.anims.isPlaying) sprite.play(`${key}_idle`);
    sprite.setFlipX(false);
    return;
  }
  sprite.anims.stop();
  const row = ay < -Math.abs(ax) * 0.6 ? 2 : 3;
  sprite.setFrame(row * s.cols);
  sprite.setFlipX(row === 3 && ax < 0);
}

// Play a one-off animation stretched to last `ms` (or its natural length), locking out walk anims.
export function playFor(sprite, animKey, ms, time, opts = {}) {
  const A = sprite.scene.anims;
  if (!A.exists(animKey)) return false;
  const anim = A.get(animKey);
  const cfg = { key: animKey, repeat: opts.loop ? -1 : 0 };
  if (ms && !opts.loop) cfg.frameRate = Math.max(1, anim.frames.length / (ms / 1000));
  sprite.play(cfg);
  sprite.animLock = time + (ms || (anim.frames.length / anim.frameRate) * 1000);
  return true;
}

// A one-shot effect sprite (bloater burst etc.) that removes itself when done.
export function effect(scene, sheetKey, x, y, depth = 900, scale = 1) {
  const key = `${sheetKey}_play`;
  if (!scene.anims.exists(key)) return null;
  const s = scene.add.sprite(x, y, sheetKey).setDepth(depth).setScale(scale);
  s.play(key);
  s.once('animationcomplete', () => s.destroy());
  return s;
}
