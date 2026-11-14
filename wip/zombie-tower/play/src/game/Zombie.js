// Regular zombies. Behavior per type:
//   shambler    - slow, wobbly walk straight at you
//   valet       - quick, sprints in short bursts when close
//   crawler     - low and fast, small hitbox
//   spitter     - keeps its distance and lobs toxic goo
//   testsubject - twitchy, jerks sideways and lunges
//   hazmat      - slow tank, barely flinches; suit cracks at half health
//   guard       - riot shield blocks bullets from the front (flank it, melee it, or break the shield)
//   bloater     - bursts into a toxic cloud when it dies
//   executive   - fast, sidesteps when you aim at it
//   blob        - tiny fast thing Specimen Zero splits off

import { ENEMIES } from '../data/enemies.js';
import { hasArt, locomote, playFor, effect } from './anim.js';

const Wrap = (a) => Phaser.Math.Angle.Wrap(a);

export class Zombie extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, type, hpScale = 1, dmgScale = 1) {
    super(scene, x, y, type);
    scene.add.existing(this);
    const d = ENEMIES[type];
    this.def = d;
    this.kind = type;
    this.artKey = type;
    this.real = hasArt(scene, type);
    if (scene.anims.exists(`${type}_play`)) this.play(`${type}_play`); // blob wiggle
    this.cracked = false;
    this.isBoss = false;
    this.maxHp = Math.round(d.hp * hpScale);
    this.hp = this.maxHp;
    this.speed = d.speed * Math.min(1.5, 1 + (hpScale - 1) * 0.25);
    this.dmgScale = dmgScale;
    this.dmg = Math.round(d.dmg * dmgScale);
    this.alive = true;
    this.lastHit = 0;
    this.knockUntil = 0;
    this.bobT = Math.random() * 10;
    const now = scene.time.now;
    this.nextSprint = now + 1000 + Math.random() * 1500;
    this.sprintUntil = 0;
    this.nextShot = now + 1200 + Math.random() * 1500;
    this.windupUntil = 0;
    this.jitter = 0;
    this.nextJitter = 0;
    this.nextDodge = now + 800;
    this.dodgeUntil = 0;
    this.dodgeDir = { x: 0, y: 0 };
    this.spawnUntil = now + 550;
    this.staggerUntil = 0; // shoved: can't move, bite or dodge
    this.slowUntil = 0; // cryo rounds
    this.slowMul = 1;
    this.burnUntil = 0; // incendiary rounds
    this.burnDps = 0;
    this.nextBurn = 0;
    this.elite = false;
    this.baseScale = 1;
    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 450 });

    if (type === 'guard') {
      this.shieldHp = d.shieldHp * hpScale;
      this.facing = Math.PI / 2;
      this.shield = scene.add.image(x, y, 'riotshield').setAlpha(0);
      if (this.real) this.shield.setVisible(false); // the art already holds the shield
      else scene.tweens.add({ targets: this.shield, alpha: 1, duration: 450 });
    }
  }

  // Call after adding to a physics group (groups reset some body settings).
  initBody() {
    const [r, ox, oy] = this.width <= 16 ? [6, 2, 3] : this.def.body || [9, 7, 13];
    this.body.setCircle(r, ox, oy);
    this.body.setCollideWorldBounds(true);
    this.setDepth(this.y);
  }

  get cx() { return this.body.center.x; }
  get cy() { return this.body.center.y; }

  canBite(time) {
    return this.alive && time > this.spawnUntil && time > this.staggerUntil;
  }

  // Riot shield: does it stop this bullet?
  blocks(bullet) {
    if (!this.shield || this.shieldHp <= 0) return false;
    const from = bullet.rotation + Math.PI; // direction the bullet came from
    return Math.abs(Wrap(from - this.facing)) < 1.15;
  }

  shieldHit(dmg, game) {
    this.shieldHp -= dmg;
    this.shield.setTintFill(0xffffff);
    this.scene.time.delayedCall(50, () => this.shield?.active && this.shield.clearTint());
    if (this.shieldHp <= 0) {
      game.burst(this.shield.x, this.shield.y, 0xbbbbbb, 12);
      game.toast('SHIELD BROKEN', '#ffe066');
      this.shield.destroy();
      this.shield = null;
      if (this.real && hasArt(this.scene, 'guard_noshield')) { this.artKey = 'guard_noshield'; this.anims.stop(); }
    }
  }

  updateAI(time, dt, game) {
    if (!this.alive) return;
    this.setDepth(this.y);
    if (this.shield) this.placeShield(time, dt, game);
    if (time < this.knockUntil) return;
    if (time < this.spawnUntil) { this.body.setVelocity(0, 0); return; }
    if (time < this.staggerUntil) { // dazed: wobble in place
      this.body.setVelocity(0, 0);
      this.setAngle(Math.sin(time / 45) * 12);
      this.dazed = true;
      return;
    }
    if (this.dazed) { this.dazed = false; this.setAngle(0); this.restoreTint(); }

    const p = game.player;
    const dx = p.cx - this.cx, dy = p.cy - this.cy;
    const dist = Math.hypot(dx, dy) || 1;
    const flow = dist > 44 ? game.flow.dirFrom(this.cx, this.cy) : null;
    let vx = flow ? flow.x : dx / dist;
    let vy = flow ? flow.y : dy / dist;
    let spd = this.speed;
    const sway = (amt, rate = 320) => {
      const w = Math.sin(time / rate + this.bobT) * amt;
      const nx = vx - vy * w, ny = vy + vx * w;
      const l = Math.hypot(nx, ny) || 1;
      vx = nx / l; vy = ny / l;
    };

    switch (this.kind) {
      case 'valet':
        if (time > this.nextSprint && dist < 300) {
          this.sprintUntil = time + 550;
          this.nextSprint = time + 2000 + Math.random() * 1200;
        }
        if (time < this.sprintUntil) spd = this.def.sprint;
        break;

      case 'spitter': {
        const d = this.def;
        if (this.windupUntil) {
          spd = 0;
          if (time > this.windupUntil) {
            this.windupUntil = 0;
            this.clearTint();
            game.enemyShot(this.cx, this.cy - 6, Math.atan2(dy, dx), {
              speed: d.shotSpeed, dmg: d.shotDmg * this.dmgScale, key: 'goo', toxic: true,
            });
            this.nextShot = time + d.shotMs * (0.8 + Math.random() * 0.4);
          }
        } else if (dist < d.range && time > this.nextShot) {
          this.windupUntil = time + 450;
          this.setTint(0x3dffc5);
          playFor(this, 'spitter_attack', 450, time);
        } else if (dist < 130) {
          vx = -dx / dist; vy = -dy / dist; spd *= 0.8; // back off
        } else if (dist < d.range * 0.75) {
          vx = -dy / dist; vy = dx / dist; spd *= 0.4; // hold range, drift sideways
          if (Math.sin(this.bobT * 0.3) < 0) { vx = -vx; vy = -vy; }
        }
        break;
      }

      case 'testsubject':
        if (time > this.nextJitter) {
          this.jitter = (Math.random() * 2 - 1) * 1.3;
          this.nextJitter = time + 220 + Math.random() * 380;
          this.setAngle((Math.random() * 2 - 1) * (this.real ? 5 : 10));
          // Lunges get a short crouch-and-flash tell first so they can be dodged.
          if (dist < 200 && !this.lungeAt && Math.random() < 0.25) { this.lungeAt = time + 260; this.setTint(0xffffff); }
        }
        if (this.lungeAt && time >= this.lungeAt) {
          this.lungeAt = 0; this.clearTint();
          this.sprintUntil = time + 240;
          this.lungeDir = { x: dx / dist, y: dy / dist };
        }
        if (this.lungeAt) { spd *= 0.1; } // crouched, about to spring
        else if (time < this.sprintUntil) { spd = this.def.lunge; vx = this.lungeDir.x; vy = this.lungeDir.y; }
        else {
          const c = Math.cos(this.jitter), s = Math.sin(this.jitter);
          [vx, vy] = [vx * c - vy * s, vx * s + vy * c];
        }
        break;

      case 'executive': {
        const fired = time - (p.cur()?.lastShot ?? -1e9) < 260;
        const aimedAt = Math.abs(Wrap(p.aim - Math.atan2(-dy, -dx))) < 0.24;
        if (time > this.nextDodge && fired && aimedAt && dist < 420) {
          const side = Math.random() < 0.5 ? 1 : -1;
          this.dodgeDir = { x: (-dy / dist) * side, y: (dx / dist) * side };
          this.dodgeUntil = time + 220;
          this.nextDodge = time + this.def.dodgeCd;
          game.burst(this.cx, this.cy + 8, 0xbbbbbb, 4);
          if (playFor(this, 'executive_dodge_play', 260, time)) this.setFlipX(this.dodgeDir.x < 0);
        }
        if (time < this.dodgeUntil) { vx = this.dodgeDir.x; vy = this.dodgeDir.y; spd = this.def.dodgeSpeed; }
        break;
      }

      case 'shambler': case 'hazmat': sway(0.35); break;
      case 'bloater': sway(0.5, 260); break;
      case 'guard': sway(0.15); break;
      default: break;
    }

    if (time < this.slowUntil) spd *= this.slowMul;
    spd *= game.zSpeedMul || 1;
    this.body.setVelocity(vx * spd, vy * spd);
    if (this.real) {
      this.bobT += dt * 0.012;
      if (this.kind === 'guard' && this.shield) locomote(this, Math.cos(this.facing) * spd, Math.sin(this.facing) * spd, time);
      else locomote(this, vx * spd, vy * spd, time);
      return;
    }
    if (Math.abs(vx) > 0.15 && this.kind !== 'testsubject') this.setFlipX(vx < 0);
    else if (this.kind === 'testsubject') this.setFlipX(dx < 0);
    this.bobT += dt * 0.012 * (Math.max(spd, 30) / 60);
    const squash = this.kind === 'crawler' || this.kind === 'blob' ? 0.12 : 0.07;
    this.setScale(this.baseScale, this.baseScale * (1 + Math.abs(Math.sin(this.bobT)) * squash));
  }

  placeShield(time, dt, game) {
    const p = game.player;
    const want = Math.atan2(p.cy - this.cy, p.cx - this.cx);
    const diff = Wrap(want - this.facing);
    const step = this.def.turnRate * (dt / 1000);
    this.facing = Wrap(this.facing + Phaser.Math.Clamp(diff, -step, step));
    const fx = Math.cos(this.facing), fy = Math.sin(this.facing);
    this.shield.setPosition(this.cx + fx * 12, this.cy - 4 + fy * 10);
    this.shield.setRotation(this.facing);
    this.shield.setDepth(fy < -0.2 ? this.depth - 1 : this.depth + 1);
    this.shield.setAlpha(this.alpha);
  }

  // Back to the right tint after a hit flash.
  restoreTint() {
    if (this.windupUntil) this.setTint(0x3dffc5);
    else if (this.lungeAt) this.setTint(0xffffff);
    else if (this.scene.time.now < this.staggerUntil) this.setTint(0xffe066);
    else if (this.elite) this.setTint(0xffc94a);
    else this.clearTint();
  }

  // Shove-dash: knocked back and dazed for a moment.
  stagger(ms) {
    this.staggerUntil = this.scene.time.now + ms;
    this.lungeAt = 0; this.windupUntil = 0; // interrupts lunges and spits
    this.setTint(0xffe066);
  }

  attackAnim(time) {
    if (this.real) playFor(this, `${this.artKey}_attack`, 380, time);
  }

  hurt(dmg, kx, ky, game) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => this.active && this.restoreTint());
    if (kx || ky) {
      const k = this.def.heavy ? 0.3 : 1;
      this.body.setVelocity(kx * k, ky * k);
      this.knockUntil = this.scene.time.now + 130 * k;
    }
    if (this.kind === 'hazmat' && this.hp < this.maxHp / 2 && !this.cracked) {
      this.cracked = true;
      if (this.real && hasArt(this.scene, 'hazmat_cracked')) { this.artKey = 'hazmat_cracked'; this.anims.stop(); }
      else this.setTexture('hazmat_cracked');
    }
    if (this.hp <= 0) {
      this.alive = false;
      if (this.shield) { this.shield.destroy(); this.shield = null; }
      if (this.kind === 'bloater') {
        effect(this.scene, 'bloater_burst', this.x, this.y, this.depth + 1, 1.5);
        game.toxicCloud(this.cx, this.cy, this.def.cloudR, this.def.cloudMs, this.dmgScale);
      }
      game.onEnemyKilled(this);
    }
  }

  // No preDestroy that removes the shield: destroying a sibling while the scene's display list
  // is shutting down skips past the end of the list and crashes. die() drops the shield, and on
  // shutdown the scene destroys it like everything else.
}
