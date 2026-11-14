// Bosses for floors 20, 30, 40 and 50 (the Doorman on floor 10 lives in Doorman.js).
// Every attack is telegraphed in red first so it can be dodged.
//
//   THE MANAGER (20)    cord-whip cone up close, paperwork volleys from range, spinning chair rush.
//                       "Calls a meeting" (summons) at 75/50/25%.
//   SPECIMEN ZERO (30)  lunges in a straight line, then is exposed (core takes 2x damage).
//                       Sprays rings of goo, splits off blobs. Faster below 50%.
//   THE WARDEN (40)     chain swing hits a ring around him (stand right next to him, or far away).
//                       Throws a shackle that pins you in place. Calls guards at 66/33%.
//   THE FOUNDER (50)    phase 1: keeps his distance and throws serum syringes, calls Executives.
//                       phase 2 (below ~55%): transforms, energy novas, stomps, more Executives.

import { BOSSES } from '../data/enemies.js';
import { Doorman } from './Doorman.js';
import { hasArt, locomote, playFor } from './anim.js';
import { SHEETS } from '../art/sheets.js';

const Wrap = (a) => Phaser.Math.Angle.Wrap(a);
const RED = 0xff5f56;

class Boss extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, key, id) {
    super(scene, x, y, key);
    scene.add.existing(this);
    const d = BOSSES[id];
    this.d = d;
    this.isBoss = true;
    this.kind = id;
    this.artKey = key;
    this.real = hasArt(scene, key);
    this.bossName = d.name;
    this.maxHp = d.hp;
    this.hp = d.hp;
    this.speed = d.speed;
    this.dmg = d.dmg;
    this.alive = true;
    this.lastHit = 0;
    this.state = 'intro';
    this.stateUntil = scene.time.now + 1600;
    this.nextAttack = 0;
    this.thresholds = [];
    this.done = new Set();
    this.contactKnock = false;
    this.invulnerable = false;
    this.tele = scene.add.graphics().setDepth(3);
    this.bobT = 0;
    this.spawnUntil = 0;
    this.attackN = 0;
    this.aimAng = 0;
  }

  initBody() {
    const r = Math.round(this.width * 0.31);
    this.body.setCircle(r, this.width / 2 - r, Math.round(this.height * 0.53));
    this.body.pushable = false;
    this.setDepth(this.y);
  }

  get cx() { return this.body.center.x; }
  get cy() { return this.body.center.y; }

  canBite() { return this.alive && this.state !== 'intro' && this.state !== 'transform'; }
  contactDamage() { return Math.round(this.dmg * (this.contactKnock ? 1.3 : 1)); }
  damageMul() { return 1; }

  set(state, ms) {
    this.state = state;
    this.stateUntil = this.scene.time.now + ms;
    this.enter(state, ms);
  }

  // Animation for each attack state, from the subclass's ANIM table:
  //   'attack' / 'hurt'  -> that row of the boss's own sheet, stretched to the state's length
  //   'fx:<sheet>'       -> a separate one-row sheet (slam, throw, cast...)
  //   'loop:<row>'       -> loop a walk row (e.g. charging sideways)
  //   'hold:<row>'       -> freeze on the first frame of a row
  enter(state, ms) {
    const spec = this.real && this.ANIM?.[state];
    if (!spec) return;
    const t = this.scene.time.now;
    const [what, extra] = spec.split(':');
    if (what === 'fx') playFor(this, `${extra}_play`, ms, t);
    else if (what === 'loop') playFor(this, `${this.artKey}_${extra}`, ms, t, { loop: true });
    else if (what === 'hold') {
      this.anims.stop();
      this.setTexture(this.artKey, SHEETS[this.artKey].cols * { idle: 0, down: 1, up: 2, side: 3 }[extra]);
      this.animLock = t + ms;
    } else playFor(this, `${this.artKey}_${what}`, ms, t);
  }

  fx(sheet, ms) { if (this.real) playFor(this, `${sheet}_play`, ms, this.scene.time.now); }

  progress(time, total) { return Phaser.Math.Clamp(1 - (this.stateUntil - time) / total, 0, 1); }

  chaseStep(time, dt, game, mul = 1) {
    const p = game.player;
    const dx = p.cx - this.cx, dy = p.cy - this.cy, dist = Math.hypot(dx, dy) || 1;
    const flow = dist > 60 ? game.flow.dirFrom(this.cx, this.cy) : null;
    const vx = flow ? flow.x : dx / dist, vy = flow ? flow.y : dy / dist;
    this.body.setVelocity(vx * this.speed * mul, vy * this.speed * mul);
    if (this.real) { locomote(this, vx, vy, time, 0.1); return; }
    if (Math.abs(vx) > 0.15) this.setFlipX(vx < 0);
    this.bobT += dt * 0.008;
    this.setScale(1, 1 + Math.abs(Math.sin(this.bobT)) * 0.04);
  }

  stop() { this.body.setVelocity(0, 0); }
  idle(time) { locomote(this, 0, 0, time); }

  // ---- telegraphs
  cone(ang, spread, r, a) {
    this.tele.fillStyle(RED, a);
    this.tele.slice(this.cx, this.cy, r, ang - spread, ang + spread, false);
    this.tele.fillPath();
  }

  line(ang, len, a, width = 14) {
    this.tele.lineStyle(width, RED, a);
    this.tele.lineBetween(this.cx, this.cy, this.cx + Math.cos(ang) * len, this.cy + Math.sin(ang) * len);
  }

  circle(r, t) {
    this.tele.fillStyle(RED, 0.12 + 0.18 * t);
    this.tele.fillCircle(this.cx, this.cy, r);
    this.tele.lineStyle(2, RED, 0.8);
    this.tele.strokeCircle(this.cx, this.cy, r * t);
  }

  donut(r1, r2, t) {
    this.tele.lineStyle(r2 - r1, RED, 0.12 + 0.2 * t);
    this.tele.strokeCircle(this.cx, this.cy, (r1 + r2) / 2);
    this.tele.lineStyle(2, RED, 0.8);
    this.tele.strokeCircle(this.cx, this.cy, r1);
    this.tele.strokeCircle(this.cx, this.cy, r1 + (r2 - r1) * t);
  }

  shake(time) { this.x += Math.sin(time / 20) * 0.8; }

  hurt(dmg, _kx, _ky, game) {
    if (!this.alive || this.invulnerable) return;
    dmg *= this.damageMul();
    this.hp -= dmg;
    this.setTintFill(this.damageMul() > 1 ? 0xffe066 : 0xffffff);
    this.scene.time.delayedCall(60, () => this.active && this.clearTint());
    for (const t of this.thresholds) {
      if (!this.done.has(t) && this.hp > 0 && this.hp < this.maxHp * t) {
        this.done.add(t);
        this.onThreshold(t, game);
      }
    }
    if (this.hp <= 0) {
      this.alive = false;
      this.tele.destroy();
      game.onEnemyKilled(this);
    }
  }

  onThreshold() {}

  // Fire a fan of shots at an angle.
  fan(game, ang, n, step, opts) {
    for (let i = 0; i < n; i++) game.enemyShot(this.cx, this.cy - 8, ang + (i - (n - 1) / 2) * step, opts);
  }

  ringShots(game, n, offset, opts) {
    for (let i = 0; i < n; i++) game.enemyShot(this.cx, this.cy - 8, offset + (i / n) * Math.PI * 2, opts);
  }
}

// ======================================================================= MANAGER
class Manager extends Boss {
  constructor(scene, x, y) {
    super(scene, x, y, 'manager', 'manager');
    this.thresholds = [0.75, 0.5, 0.25];
    this.ANIM = { whipWind: 'attack', paperWind: 'hold:down', spinWind: 'hold:down', spin: 'loop:side' };
  }

  onThreshold(_t, game) {
    this.fx('manager_summon', 700);
    game.toast('"LET\'S CALL A MEETING!"', '#ff8a2a');
    game.summon(4);
  }

  updateAI(time, dt, game) {
    if (!this.alive) return;
    this.setDepth(this.y);
    this.tele.clear();
    const p = game.player;
    const dx = p.cx - this.cx, dy = p.cy - this.cy, dist = Math.hypot(dx, dy) || 1;
    const toP = Math.atan2(dy, dx);

    switch (this.state) {
      case 'intro':
        this.stop();
        this.idle(time);
        if (time > this.stateUntil) { this.state = 'chase'; this.nextAttack = time + 1200; }
        break;

      case 'chase':
        this.chaseStep(time, dt, game);
        if (time > this.nextAttack) {
          this.stop();
          this.attackN++;
          this.aimAng = toP;
          if (dist < 175) this.set('whipWind', 750);
          else if (this.attackN % 3 === 0) this.set('spinWind', 650);
          else this.set('paperWind', 550);
        }
        break;

      case 'whipWind': {
        this.stop();
        const t = this.progress(time, 750);
        if (this.stateUntil - time > 450) this.aimAng = toP; // locks with 0.45s left to dodge
        this.cone(this.aimAng, 0.65, 185, 0.15 + 0.3 * t);
        this.setFlipX(Math.cos(this.aimAng) < 0);
        if (time > this.stateUntil) {
          game.cameras.main.shake(150, 0.008);
          game.slash(this.cx, this.cy, this.aimAng, 185);
          if (dist < 190 && Math.abs(Wrap(toP - this.aimAng)) < 0.7) {
            game.damagePlayer(26);
            p.knock((dx / dist) * 380, (dy / dist) * 380, 200);
          }
          this.state = 'chase';
          this.nextAttack = time + 1300;
        }
        break;
      }

      case 'paperWind':
        this.stop();
        this.shake(time);
        this.line(toP, 120, 0.2 + 0.3 * this.progress(time, 550), 6);
        if (time > this.stateUntil) {
          this.fan(game, toP, 5, 0.2, { speed: 240, dmg: 12, key: 'paper', spin: true });
          this.state = 'chase';
          this.nextAttack = time + 1500;
        }
        break;

      case 'spinWind':
        this.stop();
        this.circle(70, this.progress(time, 650));
        this.setAngle(Math.sin(time / 40) * 12);
        if (time > this.stateUntil) { this.set('spin', 1700); this.contactKnock = true; }
        break;

      case 'spin': {
        this.setAngle(this.angle + dt * 1.1);
        this.body.setVelocity((dx / dist) * 205, (dy / dist) * 205);
        if (time % 120 < 20) game.burst(this.cx, this.cy, 0xbbbbbb, 2);
        if (time > this.stateUntil) {
          this.setAngle(0);
          this.contactKnock = false;
          this.state = 'chase';
          this.nextAttack = time + 1400;
        }
        break;
      }
      default: break;
    }
  }
}

// =================================================================== SPECIMEN ZERO
class SpecimenZero extends Boss {
  constructor(scene, x, y) {
    super(scene, x, y, 'specimen', 'specimen');
    this.thresholds = [0.66, 0.5, 0.33];
    this.nextBlobs = scene.time.now + 9000;
    this.ANIM = { lungeWind: 'attack', lunge: 'loop:side', recover: 'hurt', sprayWind: 'attack' };
  }

  get enraged() { return this.hp < this.maxHp * 0.5; }
  damageMul() { return this.state === 'recover' ? 2 : 1; }

  onThreshold(t, game) {
    if (t === 0.5) { game.toast('IT\'S GETTING ANGRY', '#ff8a2a'); return; }
    game.toast('IT SPLITS APART!', '#3dffc5');
    this.fx('specimen_spawn', 500);
    for (let i = 0; i < 5; i++) game.spawnAt('blob', this.cx + (Math.random() - 0.5) * 50, this.cy + (Math.random() - 0.5) * 30);
  }

  updateAI(time, dt, game) {
    if (!this.alive) return;
    this.setDepth(this.y);
    this.tele.clear();
    const p = game.player;
    const dx = p.cx - this.cx, dy = p.cy - this.cy, dist = Math.hypot(dx, dy) || 1;
    const toP = Math.atan2(dy, dx);
    const cd = this.enraged ? 0.7 : 1;

    if (this.state !== 'intro' && time > this.nextBlobs) {
      this.nextBlobs = time + 9000 * cd;
      if (this.state === 'chase') this.fx('specimen_spawn', 500);
      for (let i = 0; i < 3; i++) game.spawnAt('blob', this.cx + (Math.random() - 0.5) * 40, this.cy + (Math.random() - 0.5) * 30);
    }

    switch (this.state) {
      case 'intro':
        this.stop();
        this.idle(time);
        if (time > this.stateUntil) { this.state = 'chase'; this.nextAttack = time + 1000; }
        break;

      case 'chase':
        this.chaseStep(time, dt, game, this.enraged ? 1.3 : 1);
        if (time > this.nextAttack) {
          this.stop();
          this.aimAng = toP;
          if (dist < 340 && Math.random() < 0.65) this.set('lungeWind', 650);
          else this.set('sprayWind', 650);
        }
        break;

      case 'lungeWind': {
        this.stop();
        if (this.stateUntil - time > 420) this.aimAng = toP; // locks with 0.42s left to dodge
        this.shake(time);
        this.setFlipX(Math.cos(this.aimAng) < 0);
        this.line(this.aimAng, 320, 0.25 + 0.35 * Math.abs(Math.sin(time / 70)), 30);
        if (time > this.stateUntil) { this.set('lunge', 430); this.contactKnock = true; }
        break;
      }

      case 'lunge': {
        this.body.setVelocity(Math.cos(this.aimAng) * 580, Math.sin(this.aimAng) * 580);
        const b = this.body.blocked;
        if (time > this.stateUntil || (time > this.stateUntil - 330 && (b.left || b.right || b.up || b.down))) {
          this.stop();
          this.contactKnock = false;
          game.cameras.main.shake(180, 0.01);
          game.burst(this.cx, this.cy, 0x3dffc5, 14);
          this.set('recover', 1300);
          game.toast('CORE EXPOSED!', '#ffe066');
        }
        break;
      }

      case 'recover':
        this.stop();
        this.tele.fillStyle(0x3dffc5, 0.35 + 0.3 * Math.abs(Math.sin(time / 90)));
        this.tele.fillCircle(this.x, this.y + 2, 12);
        this.tele.setDepth(this.depth + 1);
        if (time > this.stateUntil) { this.tele.setDepth(3); this.state = 'chase'; this.nextAttack = time + 1100 * cd; }
        break;

      case 'sprayWind':
        this.stop();
        this.circle(60, this.progress(time, 650));
        this.setScale(1 + 0.08 * this.progress(time, 650), 1 - 0.06 * this.progress(time, 650));
        if (time > this.stateUntil) {
          this.setScale(1, 1);
          const off = Math.random() * Math.PI;
          const opts = { speed: 165, dmg: 13, key: 'goo', toxic: true };
          this.ringShots(game, 12, off, opts);
          if (this.enraged) this.scene.time.delayedCall(280, () => this.alive && this.ringShots(game, 12, off + Math.PI / 12, opts));
          this.state = 'chase';
          this.nextAttack = time + 1500 * cd;
        }
        break;
      default: break;
    }
  }
}

// ======================================================================== WARDEN
class Warden extends Boss {
  constructor(scene, x, y) {
    super(scene, x, y, 'warden', 'warden');
    this.thresholds = [0.66, 0.33];
    this.ANIM = { chainWind: 'attack', shackleWind: 'fx:warden_throw' };
  }

  get enraged() { return this.hp < this.maxHp * 0.33; }

  onThreshold(_t, game) {
    game.toast('"LOCKDOWN! ALL GUARDS!"', '#ff8a2a');
    game.summon(4, ['guard', 'guard', 'shambler', 'shambler']);
  }

  updateAI(time, dt, game) {
    if (!this.alive) return;
    this.setDepth(this.y);
    this.tele.clear();
    const p = game.player;
    const dx = p.cx - this.cx, dy = p.cy - this.cy, dist = Math.hypot(dx, dy) || 1;
    const toP = Math.atan2(dy, dx);
    const cd = this.enraged ? 0.7 : 1;

    switch (this.state) {
      case 'intro':
        this.stop();
        this.idle(time);
        if (time > this.stateUntil) { this.state = 'chase'; this.nextAttack = time + 1200; }
        break;

      case 'chase':
        this.chaseStep(time, dt, game, this.enraged ? 1.25 : 1);
        if (time > this.nextAttack) {
          this.stop();
          this.attackN++;
          this.aimAng = toP;
          if (dist < 200) this.set('chainWind', 950 * (this.enraged ? 0.85 : 1));
          else this.set('shackleWind', 600);
        }
        break;

      case 'chainWind': {
        this.stop();
        const total = 950 * (this.enraged ? 0.85 : 1);
        const t = this.progress(time, total);
        this.donut(48, 165, t);
        this.setAngle(Math.sin(time / 50) * 6);
        if (time > this.stateUntil) {
          this.setAngle(0);
          game.cameras.main.shake(260, 0.014);
          game.ring(this.cx, this.cy, 165);
          if (dist > 44 && dist < 170) {
            game.damagePlayer(30);
            p.knock((dx / dist) * 420, (dy / dist) * 420, 220);
          }
          this.state = 'chase';
          this.nextAttack = time + 1500 * cd;
        }
        break;
      }

      case 'shackleWind':
        this.stop();
        if (this.stateUntil - time > 400) this.aimAng = toP; // locks with 0.4s left to dodge
        this.setFlipX(Math.cos(this.aimAng) < 0);
        this.line(this.aimAng, 600, 0.15 + 0.25 * this.progress(time, 600), 8);
        if (time > this.stateUntil) {
          game.enemyShot(this.cx, this.cy - 10, this.aimAng, { speed: 420, dmg: 14, key: 'shackle', root: 1100, spin: true });
          if (this.enraged) {
            this.fan(game, this.aimAng, 2, 0.5, { speed: 380, dmg: 14, key: 'shackle', root: 900, spin: true });
          }
          this.state = 'chase';
          this.nextAttack = time + 1300 * cd;
        }
        break;
      default: break;
    }
  }
}

// ======================================================================= FOUNDER
class Founder extends Boss {
  constructor(scene, x, y) {
    super(scene, x, y, 'founder', 'founder');
    this.phase = 1;
    this.thresholds = [0.55, 0.35, 0.15];
    this.nextCall = scene.time.now + 12000;
  }

  get ANIM() {
    return this.phase === 1 || this.state === 'transform'
      ? { syringeWind: 'fx:founder_cast', transform: 'hurt' }
      : { syringeWind: 'attack', novaWind: 'fx:founder2_wave', stompWind: 'attack' };
  }

  onThreshold(t, game) {
    if (t === 0.55) {
      this.phase = 2;
      this.invulnerable = true;
      this.contactKnock = false;
      this.set('transform', 2400);
      game.toast('THE FOUNDER INJECTS THE SERUM...', '#3dffc5');
      return;
    }
    game.toast('"THE BOARD WILL SEE YOU NOW."', '#ff8a2a');
    game.summon(3, ['executive']);
  }

  updateAI(time, dt, game) {
    if (!this.alive) return;
    this.setDepth(this.y);
    this.tele.clear();
    const p = game.player;
    const dx = p.cx - this.cx, dy = p.cy - this.cy, dist = Math.hypot(dx, dy) || 1;
    const toP = Math.atan2(dy, dx);

    if (this.phase === 1 && this.state !== 'intro' && time > this.nextCall) {
      this.nextCall = time + 12000;
      game.toast('"SECURITY!"', '#ff8a2a');
      game.summon(2, ['executive']);
    }

    switch (this.state) {
      case 'intro':
        this.stop();
        this.idle(time);
        if (time > this.stateUntil) { this.state = 'move'; this.nextAttack = time + 1200; }
        break;

      case 'move':
        if (this.phase === 1) {
          // keep his distance: back off if close, close in if far, otherwise circle
          let vx, vy;
          if (dist < 190) { vx = -dx / dist; vy = -dy / dist; }
          else if (dist > 300) { const f = game.flow.dirFrom(this.cx, this.cy) || { x: dx / dist, y: dy / dist }; vx = f.x; vy = f.y; }
          else { vx = -dy / dist; vy = dx / dist; }
          this.body.setVelocity(vx * this.speed, vy * this.speed);
          if (this.real) locomote(this, vx, vy, time, 0.1);
          else this.setFlipX(dx < 0);
          if (time > this.nextAttack) { this.stop(); this.set('syringeWind', 500); }
        } else {
          this.chaseStep(time, dt, game, 1.5);
          if (time > this.nextAttack) {
            this.stop();
            this.attackN++;
            if (dist < 160) this.set('stompWind', 800);
            else if (this.attackN % 2) this.set('novaWind', 750);
            else this.set('syringeWind', 450);
          }
        }
        break;

      case 'syringeWind':
        this.stop();
        this.shake(time);
        this.line(toP, 140, 0.2 + 0.3 * this.progress(time, 500), 6);
        if (time > this.stateUntil) {
          const n = this.phase === 1 ? 3 : 5;
          const opts = { speed: 340, dmg: 13, key: 'syringe' };
          for (let v = 0; v < 3; v++) {
            this.scene.time.delayedCall(v * 170, () => {
              if (!this.alive) return;
              const a = Math.atan2(game.player.cy - this.cy, game.player.cx - this.cx);
              this.fan(game, a, n, 0.16, opts);
            });
          }
          this.state = 'move';
          this.nextAttack = time + (this.phase === 1 ? 1700 : 1300);
        }
        break;

      case 'novaWind': {
        this.stop();
        const t = this.progress(time, 750);
        this.circle(80, t);
        this.setScale(1 + 0.06 * t);
        if (time > this.stateUntil) {
          this.setScale(1);
          const off = Math.random() * Math.PI;
          const opts = { speed: 175, dmg: 14, key: 'orb' };
          this.ringShots(game, 18, off, opts);
          this.scene.time.delayedCall(320, () => this.alive && this.ringShots(game, 18, off + Math.PI / 18, opts));
          game.cameras.main.flash(120, 61, 255, 197);
          this.state = 'move';
          this.nextAttack = time + 1500;
        }
        break;
      }

      case 'stompWind': {
        this.stop();
        const t = this.progress(time, 800);
        this.circle(150, t);
        this.setScale(1 + 0.06 * t, 1 - 0.06 * t);
        if (time > this.stateUntil) {
          this.setScale(1, 1);
          game.cameras.main.shake(320, 0.018);
          game.ring(this.cx, this.cy, 150);
          if (dist < 150) { game.damagePlayer(32); p.knock((dx / dist) * 460, (dy / dist) * 460, 240); }
          this.state = 'move';
          this.nextAttack = time + 1300;
        }
        break;
      }

      case 'transform': {
        this.stop();
        const t = this.progress(time, 2400);
        this.setTint(Math.floor(time / 90) % 2 ? 0x3dffc5 : 0xffffff);
        this.shake(time);
        game.cameras.main.shake(50, 0.004 + t * 0.01);
        if (time > this.stateUntil) {
          this.clearTint();
          if (this.real && hasArt(this.scene, 'founder2')) { this.artKey = 'founder2'; this.animLock = 0; this.play('founder2_idle'); }
          else this.setTexture('founder2');
          this.invulnerable = false;
          this.speed = this.d.speed;
          game.cameras.main.flash(400, 61, 255, 197);
          game.ring(this.cx, this.cy, 200);
          game.toast('PHASE 2', '#3dffc5');
          this.state = 'move';
          this.nextAttack = time + 1000;
        }
        break;
      }
      default: break;
    }
  }
}

export const BOSS_CLASSES = { doorman: Doorman, manager: Manager, specimen: SpecimenZero, warden: Warden, founder: Founder };
