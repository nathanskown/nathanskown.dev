// Rook, the player. Holds weapon slots, health, and visual state.

import { derived, hasPerk } from '../state/run.js';
import { weaponStats } from '../data/weapons.js';
import { hasArt, locomote, holdFacing } from './anim.js';

export const DASH_MS = 150;
const DASH_SPEED = 540;

export class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, run) {
    super(scene, x, y, 'rook');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setCircle(8, 8, 14); // feet: center at (16, 22) of the 32x32 sprite
    this.body.setCollideWorldBounds(true);
    this.body.setMass(2);

    this.artKey = 'rook';
    this.real = hasArt(scene, 'rook');
    this.run = run;
    this.stats = derived(run);
    this.hp = Math.min(run.hp, this.stats.maxHp);
    this.slots = run.weapons.map((w) => (w ? this.makeSlot(w) : null));
    this.slotIdx = this.slots[run.activeSlot] ? run.activeSlot : 0;
    this.aim = -Math.PI / 2;
    this.lastMelee = -99999;
    this.invulnUntil = 0;
    this.knockUntil = 0;
    this.rootUntil = 0;
    this.dashUntil = 0;
    this.dashDir = { x: 0, y: 0 };
    this.speedMul = 1; // flooded floors
    this.lastStandUsed = false; // Marcus, once per floor
    this.bobT = 0;
    this.dead = false;

    this.gun = scene.add.image(x, y, `gun_${this.cur().id}`).setOrigin(0.25, 0.55);
    this.fitGun();
  }

  makeSlot(w) {
    const st = weaponStats(w.id, w.lvl, this.stats);
    return { id: w.id, lvl: w.lvl, st, ammo: st.mag, reloadEnd: 0, lastShot: -99999 };
  }

  cur() { return this.slots[this.slotIdx]; }

  get cx() { return this.body.center.x; }
  get cy() { return this.body.center.y; }

  swap() {
    const other = 1 - this.slotIdx;
    if (!this.slots[other]) return false;
    this.slotIdx = other;
    this.gun.setTexture(`gun_${this.cur().id}`);
    this.fitGun();
    return true;
  }

  // Code-drawn guns are 32 px wide and shrink next to real character art; drawn gun art (24 px) shows 1:1.
  fitGun() {
    this.gun.setScale(this.real && this.gun.width >= 32 ? 0.75 : 1);
  }

  selectSlot(i) {
    if (i !== this.slotIdx && this.slots[i]) this.swap();
  }

  startReload(time) {
    const s = this.cur();
    if (s.reloadEnd > time || s.ammo >= s.st.mag) return;
    s.reloadEnd = time + s.st.reloadMs;
  }

  isReloading(time) { return this.cur().reloadEnd > time; }

  tickReloads(time) {
    for (const s of this.slots) {
      if (s && s.reloadEnd && time >= s.reloadEnd) { s.ammo = s.st.mag; s.reloadEnd = 0; }
    }
  }

  // Shove-dash: a short burst of speed with no damage taken. Also breaks the Warden's shackles.
  dash(ang, time) {
    this.dashDir = { x: Math.cos(ang), y: Math.sin(ang) };
    this.dashUntil = time + DASH_MS;
    this.invulnUntil = Math.max(this.invulnUntil, time + DASH_MS + 40);
    this.knockUntil = 0;
    if (this.rootUntil > time) { this.rootUntil = 0; this.clearTint(); }
  }

  isDashing(time) { return time < this.dashUntil; }

  move(vx, vy, time, dt) {
    if (time < this.dashUntil) { this.body.setVelocity(this.dashDir.x * DASH_SPEED, this.dashDir.y * DASH_SPEED); return; }
    if (time < this.knockUntil) return;
    if (time < this.rootUntil) { this.body.setVelocity(0, 0); this.bobT = 0; return; }
    const len = Math.hypot(vx, vy);
    if (len > 1) { vx /= len; vy /= len; }
    const spd = this.stats.speed * this.speedMul;
    this.body.setVelocity(vx * spd, vy * spd);
    if (len > 0.1) this.bobT += dt * 0.018;
    else this.bobT = 0;
  }

  // Shackled in place (the Warden).
  root(ms) {
    this.rootUntil = this.scene.time.now + ms;
    this.setTint(0x9aa0a8);
    this.scene.time.delayedCall(ms, () => this.active && this.clearTint());
  }

  knock(kx, ky, ms = 180) {
    this.body.setVelocity(kx, ky);
    this.knockUntil = this.scene.time.now + ms;
  }

  updateVisual(time) {
    const facingLeft = Math.cos(this.aim) < 0;
    if (this.real) {
      // body faces where you aim; legs animate while moving
      const ax = Math.cos(this.aim), ay = Math.sin(this.aim);
      const moving = this.body.velocity.length() > 20 && time > this.rootUntil;
      if (moving) locomote(this, ax, ay, time, 0);
      else holdFacing(this, ax, ay);
    } else {
      this.setFlipX(facingLeft);
      this.setScale(1, 1 + Math.abs(Math.sin(this.bobT)) * 0.06);
    }
    this.setDepth(this.y);
    this.gun.setPosition(this.cx + (facingLeft ? -3 : 3), this.cy - 4);
    this.gun.setRotation(this.aim);
    this.gun.setFlipY(facingLeft);
    this.gun.setDepth(Math.sin(this.aim) < -0.3 ? this.depth - 1 : this.depth + 1);
    // blink while invulnerable (not during a dash: that reads as a hit)
    const blink = time < this.invulnUntil && time > this.dashUntil + 90 && Math.floor(time / 60) % 2 === 0;
    this.setAlpha(blink ? 0.4 : 1);
    this.gun.setAlpha(this.alpha);
  }

  heal(n) {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  // Returns 'dead', 'revived', or the damage taken.
  // quiet = damage over time (toxic): no invulnerability window.
  hurt(dmg, time, quiet = false) {
    if (this.dead || time < this.invulnUntil) return 0;
    const taken = Math.max(1, Math.round(dmg * (1 - this.stats.reduction)));
    this.hp -= taken;
    if (!quiet) this.invulnUntil = time + 400;
    this.setTint(quiet ? 0x3dffc5 : 0xff5f56);
    this.scene.time.delayedCall(120, () => this.active && this.clearTint());
    if (this.hp <= 0) {
      if (hasPerk(this.run, 'secondwind') && !this.run.secondWindUsed) {
        this.run.secondWindUsed = true;
        this.hp = Math.round(this.stats.maxHp * 0.5);
        this.invulnUntil = time + 2000;
        return 'revived';
      }
      if ((this.run.crew || []).includes('marcus') && !this.lastStandUsed) {
        this.lastStandUsed = true;
        this.hp = 1;
        this.invulnUntil = time + 1500;
        return 'laststand';
      }
      this.hp = 0;
      this.dead = true;
      return 'dead';
    }
    return taken;
  }

  // Copy state back into the run when leaving a floor.
  writeBack() {
    this.run.hp = Math.max(1, Math.round(this.hp));
    this.run.weapons = this.slots.map((s) => (s ? { id: s.id, lvl: s.lvl } : null));
    this.run.activeSlot = this.slotIdx;
  }
}
