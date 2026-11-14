// Floor 10 boss. Pattern:
//   chase -> (far) wind-up + charge across the room; hitting a wall/pillar stuns him (takes 1.5x damage)
//         -> (close) ground slam with a telegraphed circle
// Calls in shamblers at 66% and 33% health.

import { BOSSES } from '../data/enemies.js';
import { hasArt, locomote, playFor } from './anim.js';

const SLAM_R = 120;

export class Doorman extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, hpScale = 1) {
    super(scene, x, y, 'doorman');
    scene.add.existing(this);
    const d = BOSSES.doorman;
    this.isBoss = true;
    this.kind = 'doorman';
    this.artKey = 'doorman';
    this.real = hasArt(scene, 'doorman');
    this.bossName = d.name;
    this.maxHp = Math.round(d.hp * hpScale);
    this.hp = this.maxHp;
    this.speed = d.speed;
    this.dmg = d.dmg;
    this.alive = true;
    this.lastHit = 0;
    this.state = 'intro';
    this.stateUntil = scene.time.now + 1600;
    this.nextAttack = 0;
    this.chargeDir = { x: 0, y: 1 };
    this.summoned = { 66: false, 33: false };
    this.tele = scene.add.graphics().setDepth(3);
    this.bobT = 0;
    this.spawnUntil = 0;
  }

  initBody() {
    this.body.setCircle(20, 12, 34); // feet circle near bottom of 64x64 sprite
    this.body.pushable = false;
    this.setDepth(this.y);
  }

  get cx() { return this.body.center.x; }
  get cy() { return this.body.center.y; }

  canBite() { return this.alive && this.state !== 'intro'; }

  contactDamage() { return this.state === 'charge' ? 30 : this.dmg; }

  set(state, ms) {
    this.state = state;
    this.stateUntil = this.scene.time.now + ms;
    if (!this.real) return;
    const t = this.scene.time.now;
    if (state === 'windup') { this.anims.stop(); this.setTexture('doorman', 12); this.animLock = t + ms; }
    else if (state === 'charge') playFor(this, 'doorman_attack', ms, t, { loop: true });
    else if (state === 'stunned') playFor(this, 'doorman_hurt', ms, t);
    else if (state === 'slamWind') playFor(this, 'doorman_slam_play', ms + 150, t);
  }

  updateAI(time, dt, game) {
    if (!this.alive) return;
    this.setDepth(this.y);
    this.tele.clear();
    const p = game.player;
    const dx = p.cx - this.cx, dy = p.cy - this.cy;
    const dist = Math.hypot(dx, dy) || 1;

    switch (this.state) {
      case 'intro':
        this.body.setVelocity(0, 0);
        locomote(this, 0, 0, time);
        if (time > this.stateUntil) { this.state = 'chase'; this.nextAttack = time + 1200; }
        break;

      case 'chase': {
        const flow = dist > 60 ? game.flow.dirFrom(this.cx, this.cy) : null;
        const vx = flow ? flow.x : dx / dist, vy = flow ? flow.y : dy / dist;
        this.body.setVelocity(vx * this.speed, vy * this.speed);
        if (this.real) locomote(this, vx, vy, time, 0.1);
        else {
          if (Math.abs(vx) > 0.15) this.setFlipX(vx < 0);
          this.bobT += dt * 0.008;
          this.setScale(1, 1 + Math.abs(Math.sin(this.bobT)) * 0.04);
        }
        if (time > this.nextAttack) {
          this.body.setVelocity(0, 0);
          if (dist < SLAM_R + 10) this.set('slamWind', 850);
          else { this.chargeDir = { x: dx / dist, y: dy / dist }; this.set('windup', 800); }
        }
        break;
      }

      case 'windup': {
        this.body.setVelocity(0, 0);
        const left = this.stateUntil - time;
        if (left > 350) this.chargeDir = { x: dx / dist, y: dy / dist }; // tracks you, then locks
        this.setFlipX(this.chargeDir.x < 0);
        this.x += Math.sin(time / 20) * 0.8; // shake
        const a = 0.25 + 0.35 * Math.abs(Math.sin(time / 70));
        this.tele.lineStyle(14, 0xff5f56, a);
        this.tele.lineBetween(this.cx, this.cy, this.cx + this.chargeDir.x * 700, this.cy + this.chargeDir.y * 700);
        if (time > this.stateUntil) { this.set('charge', 1100); this.hitWallOnce = false; }
        break;
      }

      case 'charge': {
        const s = BOSSES.doorman.chargeSpeed;
        this.body.setVelocity(this.chargeDir.x * s, this.chargeDir.y * s);
        const b = this.body.blocked;
        if (time > this.stateUntil - 1000 && (b.left || b.right || b.up || b.down)) {
          this.body.setVelocity(0, 0);
          game.cameras.main.shake(250, 0.012);
          game.burst(this.cx, this.cy, 0xbbbbbb, 18);
          game.toast('DAZED! HIT HIM NOW', '#ffe066');
          this.set('stunned', 1500);
        } else if (time > this.stateUntil) {
          this.state = 'chase';
          this.nextAttack = time + 1500;
        }
        break;
      }

      case 'stunned':
        this.body.setVelocity(0, 0);
        this.tele.fillStyle(0xffe066, 0.9);
        for (let i = 0; i < 3; i++) {
          const ang = time / 200 + (i * Math.PI * 2) / 3;
          this.tele.fillRect(this.x + Math.cos(ang) * 18 - 2, this.y - 36 + Math.sin(ang) * 5 - 2, 5, 5);
        }
        this.tele.setDepth(this.depth + 1);
        if (time > this.stateUntil) { this.state = 'chase'; this.nextAttack = time + 1000; }
        break;

      case 'slamWind': {
        this.body.setVelocity(0, 0);
        const t = 1 - (this.stateUntil - time) / 850;
        this.tele.fillStyle(0xff5f56, 0.12 + 0.18 * t);
        this.tele.fillCircle(this.cx, this.cy, SLAM_R);
        this.tele.lineStyle(2, 0xff5f56, 0.8);
        this.tele.strokeCircle(this.cx, this.cy, SLAM_R * t);
        this.setScale(1 + 0.08 * t, 1 - 0.08 * t);
        if (time > this.stateUntil) {
          this.setScale(1, 1);
          game.cameras.main.shake(300, 0.015);
          game.ring(this.cx, this.cy, SLAM_R);
          if (dist < SLAM_R) {
            game.damagePlayer(25);
            p.knock((dx / dist) * 420, (dy / dist) * 420, 220);
          }
          this.state = 'chase';
          this.nextAttack = time + 1700;
        }
        break;
      }
    }
  }

  hurt(dmg, _kx, _ky, game) {
    if (!this.alive) return;
    if (this.state === 'stunned') dmg *= 1.5;
    this.hp -= dmg;
    this.setTintFill(this.state === 'stunned' ? 0xffe066 : 0xffffff);
    this.scene.time.delayedCall(60, () => this.active && this.clearTint());
    for (const pct of [66, 33]) {
      if (!this.summoned[pct] && this.hp < this.maxHp * (pct / 100)) {
        this.summoned[pct] = true;
        game.toast('"DOORS ARE OPEN!"', '#ff8a2a');
        game.summon(4);
      }
    }
    if (this.hp <= 0) {
      this.alive = false;
      this.tele.destroy();
      game.onEnemyKilled(this);
    }
  }
}

export const BOSS_CLASSES = { doorman: Doorman };
