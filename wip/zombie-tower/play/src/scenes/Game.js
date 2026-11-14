// One floor of the tower: build the map, spawn waves, fight, unlock the stairs.

import { TILE, COLS, ROWS, W, H, TEAL, TEAL_HEX, txt } from '../config.js';
import { FLOORS, floorPlan, zoneOf, TOP_FLOOR, twistFor, TWISTS } from '../data/floors.js';
import { ENEMIES, ZONE_NEW, ZONE_MINIONS, pickEnemy } from '../data/enemies.js';
import { Player, DASH_MS } from '../game/Player.js';
import { MAX_LVL, WEAPONS } from '../data/weapons.js';
import { BURN, CRYO, BOOM, PIERCE, RICOCHET, RICOCHET_DMG, CHAIN } from '../data/mods.js';
import { crewOnFloor, HOLD_MS, CONTACT_DRAIN } from '../data/crew.js';
import { setting, buzz } from '../state/settings.js';
import { recordFloor, recordWin } from '../state/meta.js';
import { canvasTexture } from '../art/pixel.js';
import { Zombie } from '../game/Zombie.js';
import { BOSS_CLASSES } from '../game/Bosses.js';
import { FlowField } from '../game/FlowField.js';
import { Hud } from '../game/Hud.js';
import { TouchControls } from '../game/Touch.js';
import { aimMode, autoTarget, assistTarget } from '../game/aim.js';
import { decorate } from '../game/decorate.js';
import { clearCheckpoint, MAX_MERCY, MERCY_STEP, normalizeRun, isElevator, ELEVATOR_EFFECTIVE, derived } from '../state/run.js';

const SOLID = new Set(['#', 'p', 'c', 'd', 'o']);

export class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.run = normalizeRun(data.run);
    this.floorN = this.run.floor;
    this.def = FLOORS[this.floorN];
    this.elevator = isElevator(this.run);
    if (this.elevator) {
      // difficulty follows the stop number; the zombies come from the real floor's zone
      this.plan = floorPlan(ELEVATOR_EFFECTIVE[this.run.step]);
      this.plan.pick = () => pickEnemy(this.floorN);
      this.plan.minions = ZONE_MINIONS[zoneOf(this.floorN).id];
    } else this.plan = floorPlan(this.floorN);
    if (this.run.nightShift) { // after beating the tower: tougher everything, no retry bonus
      this.plan.hpScale *= 1.45;
      this.plan.dmgScale *= 1.35;
      this.plan.maxAlive += 3;
    }
    const mercy = this.elevator || this.run.nightShift ? 0 : Math.min(MAX_MERCY, this.run.mercy || 0);
    this.mercyHp = 1 - MERCY_STEP * mercy; // retry bonus
    this.isBossFloor = !!this.def.boss;
    this.isFinalFloor = this.elevator ? this.run.step === this.run.route.length - 1 : this.floorN >= TOP_FLOOR;
    this.twist = twistFor(this.floorN, this.run);
    this.zSpeedMul = 1;
    this.survivor = null;
    this.eliteSpawned = false;
    this.eliteAt = 0;
    this.dark = null;
    this.lockEnd = 0;
    this.lockdownOver = false; // the scene object is reused between floors: reset everything
    this.over = false;
    this.leaving = false;
    this.cleared = false;
    this.bossDead = false;
    this.boss = null;
    this.aliveCount = 0;
    this.lastInput = 'mouse';
    this.target = null;
    this.lullSince = 0;
    this.prevRight = false;
    this.wheelSwap = false;
    this.clouds = [];
    this.nextToxic = 0;
  }

  create() {
    this.cameras.main.fadeIn(300, 0, 0, 0);
    this.buildMap();

    this.splats = this.add.graphics().setDepth(1);
    this.zombies = this.physics.add.group();
    this.bullets = this.physics.add.group();
    this.shots = this.physics.add.group();
    this.medkits = this.physics.add.group();
    this.crates = this.physics.add.group();
    const cam = this.cameras.main, shake = cam.shake.bind(cam);
    cam.shake = (...a) => (setting('shake') ? shake(...a) : cam); // pause-menu toggle

    this.player = new Player(this, this.startPos.x, this.startPos.y, this.run);
    this.flow = new FlowField(this.solid, COLS, ROWS);
    this.flow.update(this.player.cx, this.player.cy);

    // collisions
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.zombies, this.walls);
    this.physics.add.collider(this.zombies, this.zombies);
    this.physics.add.collider(this.player, this.zombies, (_p, z) => this.onBite(z));
    this.physics.add.collider(this.bullets, this.walls, (b) => this.bulletHitWall(b));
    this.physics.add.overlap(this.bullets, this.zombies, (b, z) => this.onBulletHit(b, z));
    this.physics.add.collider(this.shots, this.walls, (s) => this.shotHitWall(s));
    this.physics.add.overlap(this.player, this.shots, (_p, s) => this.onShotHit(s));
    this.physics.add.overlap(this.player, this.medkits, (_p, m) => this.pickMedkit(m));
    this.physics.add.overlap(this.player, this.crates, (_p, c) => this.pickCrate(c));
    this.physics.add.overlap(this.player, this.stairsZone, () => {
      if (this.cleared && !this.leaving && !this.over) this.leaveFloor();
    });

    // effects
    const fx = (tint) => this.add.particles(0, 0, 'px', {
      speed: { min: 40, max: 170 }, lifespan: { min: 220, max: 520 },
      scale: { start: 1.1, end: 0 }, tint, emitting: false,
    }).setDepth(900);
    this.emitters = {
      goo: fx([TEAL, 0x7fa37a, 0x5c7d5a]),
      spark: fx([0xffe066, 0xffb84d]),
      dust: fx([0xbbbbbb, 0x888888]),
      fire: fx([0xff8a2a, 0xffe066, 0xff5f56]),
      ice: fx([0x9fe8ff, 0xffffff]),
    };
    this.numPool = [];
    this.bolts = this.add.graphics().setDepth(946);
    this.add.image(W / 2, H / 2, 'vignette').setDepth(950);

    // UI + input
    this.hud = new Hud(this, this.player, this.run, this.def);
    this.hud.pauseBtn.on('pointerdown', () => this.pauseGame());
    this.touch = new TouchControls(this);
    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,R,Q,E,SPACE,ESC,ONE,TWO');
    // remember touch vs mouse across floors, so phone auto-aim works from the first frame
    this.lastInput = this.registry.get('lastInput') || 'mouse';
    if (this.lastInput === 'touch') this.touch.enable();
    const setInput = (p) => { this.lastInput = p.wasTouch ? 'touch' : 'mouse'; this.registry.set('lastInput', this.lastInput); };
    this.input.on('pointermove', setInput);
    this.input.on('pointerdown', setInput);
    this.reticle = this.add.graphics().setDepth(947);
    this.input.on('wheel', () => { this.wheelSwap = true; });
    this.events.on('resume', () => this.input.keyboard.resetKeys());
    this.events.once('shutdown', () => this.touch.destroy());

    // waves
    this.queue = [];
    const total = this.twist === 'elite' ? Math.round(this.plan.total * 0.75) : this.plan.total;
    for (let i = 0; i < total; i++) this.queue.push(this.isBossFloor ? this.plan.minions[0] : this.plan.pick());
    this.spawnStart = this.time.now + 1500;
    this.nextSpawn = this.spawnStart;
    if (this.twist) this.setupTwist();
    this.setupSurvivor();
    recordFloor(this.run);

    // intro banners
    const zone = zoneOf(this.floorN);
    if (this.twist) {
      const tw = TWISTS[this.twist];
      this.hud.banner(tw.name, tw.sub);
    } else if (this.elevator) {
      this.hud.banner(`STOP ${this.run.step + 1} OF ${this.run.route.length}`, `${this.def.name.toUpperCase()} · FLOOR ${this.floorN}`);
    } else if (this.floorN === zone.from && this.floorN > 1) {
      this.hud.banner(`ZONE ${zone.id}`, `${zone.name.toUpperCase()} · FLOOR ${this.floorN}`);
      const fresh = ZONE_NEW[zone.id];
      if (fresh) this.time.delayedCall(2300, () => this.toast(`NEW: ${fresh.map((k) => ENEMIES[k].name.toUpperCase()).join(', ')}`, '#ffb84d'));
    } else {
      this.hud.banner(`FLOOR ${this.floorN}`, this.def.name.toUpperCase());
    }
    if (this.isBossFloor) this.spawnBoss();
    if (this.floorN % 10 === 6 && !this.elevator) this.time.delayedCall(1800, () => this.toast('CHECKPOINT', '#4ade80'));
  }

  // ------------------------------------------------------------------ map
  buildMap() {
    const theme = this.def.theme;
    const map = this.def.map;
    this.solid = map.map((row) => [...row].map((ch) => SOLID.has(ch)));
    this.hazard = new Set();
    this.walls = this.physics.add.staticGroup();
    this.spawns = [];
    const center = (c, r) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });
    const hash = (c, r) => (((c * 73856093) ^ (r * 19349663) ^ (this.floorN * 83492791)) >>> 0) % 100;
    const usedCar = new Set();
    const cars = [];
    let carColor = 0;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = map[r][c];
        const { x, y } = center(c, r);
        const h = hash(c, r);
        let floorKey = `floor_${theme}`;
        if (ch === 'S') floorKey = `spawn_${theme}`;
        else if (ch === 'h') { floorKey = `hazard_${theme}`; this.hazard.add(`${c},${r}`); }
        else if (h >= 80) floorKey = `floor_${theme}_${h < 90 ? 1 : h < 98 ? 2 : 3}`;
        if (ch !== '#') this.add.image(x, y, floorKey).setDepth(0);

        if (SOLID.has(ch)) this.walls.create(x, y, 'blank32').setVisible(false);

        if (ch === '#') {
          const below = map[r + 1]?.[c];
          let key = `wall_${theme}`;
          if (below && below !== '#') {
            key = `wallface_${theme}`;
            if (r === 0 && h % 10 < 3) key += `_${1 + (h % 4)}`;
          }
          this.add.image(x, y, key).setDepth(2);
        } else if (ch === 'p') this.add.image(x, y, `pillar_${theme}`).setDepth(y + 14);
        else if (ch === 'd') this.add.image(x, y, `desk_${theme}`).setDepth(y + 14);
        else if (ch === 'o') this.add.image(x, y, `pod_${theme}`).setDepth(y + 14);
        else if (ch === 'S') this.spawns.push({ x, y });
        else if (ch === 'P') this.startPos = { x, y };
        else if (ch === 'B') this.bossPos = { x, y };
        else if (ch === 'E') {
          this.stairs = this.add.image(x, y, 'stairs_locked').setDepth(1);
          this.stairsZone = this.physics.add.staticImage(x, y, 'blank32').setVisible(false);
          this.stairsZone.body.setSize(20, 20);
        } else if (ch === 'c' && !usedCar.has(`${c},${r}`)) {
          usedCar.add(`${c},${r}`);
          const col = carColor++ % 3;
          if (map[r][c + 1] === 'c' && !usedCar.has(`${c + 1},${r}`)) {
            usedCar.add(`${c + 1},${r}`);
            this.add.image(x + TILE / 2, y, `car_h_${col}`).setDepth(y + 14);
            cars.push({ x: x + TILE / 2, y, horiz: true });
          } else if (map[r + 1]?.[c] === 'c') {
            usedCar.add(`${c},${r + 1}`);
            this.add.image(x, y + TILE / 2, `car_v_${col}`).setDepth(y + TILE + 14);
            cars.push({ x, y: y + TILE / 2, horiz: false });
          } else {
            this.add.image(x, y, `desk_${theme}`).setDepth(y + 14);
          }
        }
      }
    }
    decorate(this, map, theme, this.floorN, cars);
  }

  // --------------------------------------------------------------- spawning
  spawnZombie(type, forceAnywhere = false) {
    const p = this.player;
    let pts = this.spawns.filter((s) => Math.hypot(s.x - p.cx, s.y - p.cy) > 170);
    if (!pts.length || forceAnywhere) pts = this.spawns;
    const s = pts[Math.floor(Math.random() * pts.length)];
    this.emitters.dust.explode(6, s.x, s.y + 8);
    return this.spawnAt(type, s.x + (Math.random() * 10 - 5), s.y + (Math.random() * 10 - 5));
  }

  spawnAt(type, x, y) {
    const z = new Zombie(this, x, y, type, this.plan.hpScale * this.mercyHp, this.plan.dmgScale);
    this.zombies.add(z);
    z.initBody();
    this.aliveCount++;
    return z;
  }

  spawnBoss() {
    const Cls = BOSS_CLASSES[this.def.boss];
    const b = new Cls(this, this.bossPos.x, this.bossPos.y, 1);
    // retry bonus / Night Shift / Elevator Run (one try, so its boss is a bit lighter)
    const bossMul = this.mercyHp * (this.run.nightShift ? 1.45 : 1) * (this.elevator ? 0.75 : 1);
    if (bossMul !== 1) { b.maxHp = Math.round(b.maxHp * bossMul); b.hp = b.maxHp; }
    this.zombies.add(b);
    b.initBody();
    this.boss = b;
    this.aliveCount++;
    this.time.delayedCall(1700, () => this.toast(`BOSS: ${b.bossName}`, '#ff8a2a'));
  }

  // Boss calls in extra zombies right now.
  summon(n, types = this.plan.minions) {
    for (let i = 0; i < n; i++) this.spawnZombie(types[i % types.length], true);
  }

  // ----------------------------------------------------------------- update
  update(time, delta) {
    if (this.over) return;
    const p = this.player;
    const k = this.keys;
    const t = this.touch;
    p.tickReloads(time);

    // move
    let mx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    let my = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    if (t.movePtr !== null) { mx = t.move.x; my = t.move.y; }
    if (this.leaving) { mx = 0; my = 0; }
    p.move(mx, my, time, delta);

    // aim + shoot
    const mouse = this.input.mousePointer;
    let fire;
    if (this.lastInput === 'touch') fire = this.touchAim(mx, my);
    else {
      this.target = null;
      if (this.lastInput === 'mouse') p.aim = Math.atan2(mouse.worldY - p.cy, mouse.worldX - p.cx);
      else if (mx || my) p.aim = Math.atan2(my, mx);
      fire = mouse.leftButtonDown();
    }
    this.drawReticle(time);
    if (fire && !this.leaving) this.tryFire(time);

    // reload / swap / melee / pause
    const JD = Phaser.Input.Keyboard.JustDown;
    if (JD(k.R) | t.take('reload')) p.startReload(time);
    if (JD(k.Q) | t.take('swap') | this.wheelSwap) { if (p.swap()) this.hud.refreshLoadout(); }
    this.wheelSwap = false;
    if (JD(k.ONE)) { p.selectSlot(0); this.hud.refreshLoadout(); }
    if (JD(k.TWO)) { p.selectSlot(1); this.hud.refreshLoadout(); }
    const right = this.lastInput === 'mouse' && mouse.rightButtonDown();
    if ((JD(k.SPACE) | JD(k.E) | t.take('melee')) || (right && !this.prevRight)) this.melee(time);
    this.prevRight = right;
    if (JD(k.ESC)) { this.pauseGame(); return; }

    p.updateVisual(time);
    this.flow.update(p.cx, p.cy);
    for (const z of this.zombies.getChildren().slice()) { z.updateAI(time, delta, this); this.keepInside(z, time); }

    for (const b of this.bullets.getChildren().slice()) {
      if (time > b.dieAt) { if (b.blast) this.explode(b.x, b.y, b.blast, b.dmg); b.destroy(); }
    }
    for (const s of this.shots.getChildren().slice()) {
      if (time > s.dieAt) s.destroy();
      else if (s.spin) s.rotation += delta * 0.015;
    }
    for (const m of this.medkits.getChildren().slice()) {
      const left = m.expireAt - time;
      if (left <= 0) m.destroy();
      else if (left < 3000) m.setAlpha(Math.floor(time / 120) % 2 ? 0.3 : 1);
    }
    this.updateToxic(time);
    this.updateBurns(time);
    if (this.twist) this.updateTwist(time);
    if (this.survivor) this.updateSurvivor(time, delta);

    // spawner
    if (time > this.nextSpawn && this.queue.length && this.aliveCount - (this.boss?.alive ? 1 : 0) < this.plan.maxAlive) {
      this.spawnZombie(this.queue.pop());
      this.nextSpawn = time + this.plan.spawnMs * (0.6 + Math.random() * 0.8);
    }

    // floor clear?
    if (!this.cleared && time > this.spawnStart && this.queue.length === 0 && this.aliveCount <= 0 &&
        (!this.isBossFloor || this.bossDead) && (this.twist !== 'elite' || this.eliteSpawned)) {
      this.unlockStairs();
    }

    let remaining = this.queue.length + Math.max(0, this.aliveCount);
    if (this.twist === 'lockdown' && !this.cleared) remaining = `SURVIVE ${Math.max(0, Math.ceil((this.lockEnd - time) / 1000))}s`;
    this.hud.update(time, remaining, this.boss);
    t.draw();
  }

  // ----------------------------------------------------------------- toxic
  updateToxic(time) {
    const p = this.player;
    this.clouds = this.clouds.filter((c) => {
      if (time > c.until) return false;
      if (time > this.nextToxic && Math.hypot(p.cx - c.x, p.cy - c.y) < c.r) this.toxicTick(time, c.dmg);
      return true;
    });
    if (this.hazard.size && time > this.nextToxic) {
      const key = `${Math.floor(p.cx / TILE)},${Math.floor(p.cy / TILE)}`;
      if (this.hazard.has(key)) this.toxicTick(time, 4 * this.plan.dmgScale);
    }
  }

  toxicTick(time, dmg) {
    this.nextToxic = time + 500;
    this.damagePlayer(dmg * this.player.stats.toxicMul, true);
    this.emitters.goo.explode(3, this.player.cx, this.player.cy + 6);
  }

  toxicCloud(x, y, r, ms, scale = 1) {
    const img = this.add.image(x, y, 'cloud').setDepth(943).setScale(0.3).setAlpha(0.85);
    this.tweens.add({ targets: img, scale: (r * 2) / img.width, duration: 300, ease: 'Back.Out' });
    this.tweens.add({ targets: img, angle: 40, duration: ms });
    this.tweens.add({ targets: img, alpha: 0, delay: ms - 500, duration: 500, onComplete: () => img.destroy() });
    this.clouds.push({ x, y, r, until: this.time.now + ms, dmg: 4.5 * scale });
  }

  // ----------------------------------------------------------------- combat
  // Knockback, blasts or crowd shoves can squeeze a zombie into or past a wall, where nothing can
  // reach it and the floor never clears. If one sits inside a wall for a moment, put it on the
  // nearest open tile.
  keepInside(z, time) {
    if (!z.alive || !z.body) return;
    const c = Math.floor(z.cx / TILE), r = Math.floor(z.cy / TILE);
    const open = r >= 0 && r < ROWS && c >= 0 && c < COLS && !this.solid[r][c];
    if (open) { z.stuckSince = 0; return; }
    if (!z.stuckSince) { z.stuckSince = time; return; }
    if (time - z.stuckSince < 300) return;
    const sc = Phaser.Math.Clamp(c, 0, COLS - 1), sr = Phaser.Math.Clamp(r, 0, ROWS - 1);
    const seen = new Set([`${sc},${sr}`]), q = [[sc, sr]];
    while (q.length) {
      const [qc, qr] = q.shift();
      if (!this.solid[qr][qc]) {
        const dx = qc * TILE + TILE / 2 - z.cx, dy = qr * TILE + TILE / 2 - z.cy;
        z.body.reset(z.x + dx, z.y + dy);
        z.stuckSince = 0;
        return;
      }
      for (const [ac, ar] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = qc + ac, nr = qr + ar, k = `${nc},${nr}`;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || seen.has(k)) continue;
        seen.add(k); q.push([nc, nr]);
      }
    }
  }

  // Phone aiming (see game/aim.js). Returns whether to fire this frame.
  touchAim(mx, my) {
    const p = this.player, t = this.touch;
    const range = this.twist === 'blackout' ? Math.min(210, p.cur().st.range) : p.cur().st.range;
    const thumb = t.aimPtr !== null;
    const pointed = thumb && t.aim.mag > 0.2 ? Math.atan2(t.aim.y, t.aim.x) : null;
    if (aimMode() === 'auto') {
      if (thumb) { // manual override while the right thumb is down
        this.target = null;
        if (pointed !== null) p.aim = pointed;
        return true;
      }
      const c = autoTarget(this, range, this.target);
      this.target = c?.z || null;
      if (c) { p.aim = c.ang; this.lullSince = 0; }
      else {
        if (mx || my) p.aim = Math.atan2(my, mx);
        // nothing in sight for a moment: top up a half-empty magazine
        const now = this.time.now, s = p.cur();
        if (!this.lullSince) this.lullSince = now;
        else if (now - this.lullSince > 600 && s.ammo < s.st.mag * 0.5) p.startReload(now);
      }
      return !!c;
    }
    // assist
    if (pointed !== null) p.aim = pointed;
    else if (!thumb && (mx || my)) p.aim = Math.atan2(my, mx);
    const c = thumb ? assistTarget(this, range, p.aim) : null;
    this.target = c?.z || null;
    if (c) p.aim = c.ang;
    return thumb;
  }

  // Phone players: when this gun is empty or reloading, switch to the other one if it's loaded.
  // The empty gun keeps reloading in the background.
  autoSwap(time) {
    const p = this.player, other = p.slots[1 - p.slotIdx];
    if (!other || other.ammo <= 0 || other.reloadEnd > time) return;
    if (p.swap()) this.hud.refreshLoadout();
  }

  // Small corner brackets around whatever aim help has locked onto.
  drawReticle(time) {
    const g = this.reticle;
    g.clear();
    const z = this.target;
    if (!z || !z.alive || !z.body) { this.target = null; return; }
    const r = Math.max(12, z.body.halfWidth + 6) + Math.sin(time / 120) * 1.5;
    const L = 5;
    g.lineStyle(2, TEAL, 0.9);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = z.cx + sx * r, y = z.cy + sy * r;
      g.lineBetween(x, y, x - sx * L, y);
      g.lineBetween(x, y, x, y - sy * L);
    }
  }

  tryFire(time) {
    const p = this.player;
    const s = p.cur();
    const touch = this.lastInput === 'touch';
    if (p.isReloading(time)) { if (touch) this.autoSwap(time); return; }
    if (time - s.lastShot < s.st.fireMs) return;
    if (s.ammo <= 0) { p.startReload(time); if (touch) this.autoSwap(time); return; }
    s.lastShot = time;
    const rounds = s.st.burst || 1;
    this.fireRound(s);
    for (let i = 1; i < rounds; i++) {
      this.time.delayedCall(i * 70, () => {
        if (!this.over && !this.leaving && s.ammo > 0 && p.cur() === s && !p.isReloading(this.time.now)) this.fireRound(s);
      });
    }
  }

  fireRound(s) {
    const p = this.player;
    const time = this.time.now;
    s.ammo--;
    const mods = p.stats.mods;
    const lastRound = s.ammo === 0 && mods.boom;
    const mx = p.gun.x + Math.cos(p.aim) * 18;
    const my = p.gun.y + Math.sin(p.aim) * 18;
    for (let i = 0; i < s.st.pellets; i++) {
      const ang = p.aim + (Math.random() * 2 - 1) * s.st.spread;
      const b = this.bullets.create(mx, my, s.st.proj || 'bullet');
      b.setRotation(ang).setDepth(945);
      b.body.setSize(6, 6);
      b.body.setVelocity(Math.cos(ang) * s.st.speed, Math.sin(ang) * s.st.speed);
      const crit = Math.random() < p.stats.crit;
      b.dmg = s.st.dmg * (crit ? 2 : 1);
      if (crit) b.setTint(0xff66ff);
      b.crit = crit;
      b.pierceLeft = s.st.pierce + PIERCE[mods.pierce || 0];
      if (mods.pierce === 2) b.dmg *= 1.15;
      b.hit = new Set();
      b.knock = s.st.knock;
      b.blast = s.st.blast || 0;
      b.speed = s.st.speed;
      b.bounces = s.st.flame ? 0 : RICOCHET[mods.ricochet || 0];
      b.chainOdds = mods.chain ? 0.4 / s.st.pellets : 0; // ~40% of shots arc, however many pellets
      if (lastRound && i === 0) { // Last Round Boom
        b.blast = Math.max(b.blast, 64);
        b.dmg *= BOOM[mods.boom];
        b.setTint(0xff5f56).setScale(1.6);
      }
      const life = (s.st.range / s.st.speed) * 1000 * (0.9 + Math.random() * 0.2);
      b.dieAt = time + life;
      if (s.st.flame) {
        b.setScale(0.6).setAngle(Math.random() * 360);
        this.tweens.add({ targets: b, scale: 1.6, alpha: 0.2, duration: life });
      }
    }
    if (!s.st.flame) {
      const flash = this.add.image(mx, my, 'flash').setDepth(946).setRotation(p.aim);
      this.time.delayedCall(45, () => flash.destroy());
    }
    if (s.st.pellets > 1 || s.st.shake) this.cameras.main.shake(60, 0.003);
    if (s.ammo <= 0) p.startReload(time);
  }

  bulletHitWall(b) {
    if (b.bounces > 0 && !b.blast && this.ricochet(b)) return;
    if (b.blast) this.explode(b.x, b.y, b.blast, b.dmg);
    else this.emitters.spark.explode(3, b.x, b.y);
    b.destroy();
  }

  onBulletHit(b, z) {
    if (!b.active || !z.alive || b.hit.has(z)) return;
    if (b.blast) { this.explode(b.x, b.y, b.blast, b.dmg); b.destroy(); return; }
    if (z.blocks?.(b)) {
      this.emitters.spark.explode(5, b.x, b.y);
      z.shieldHit(b.dmg, this);
      b.destroy();
      return;
    }
    b.hit.add(z);
    const kx = Math.cos(b.rotation) * b.knock, ky = Math.sin(b.rotation) * b.knock;
    this.emitters.goo.explode(4, b.x, b.y);
    z.hurt(b.dmg, kx, ky, this);
    this.hitNum(z, b.dmg, b.crit);
    this.applyHitMods(z, b.dmg, b);
    if (b.pierceLeft > 0) b.pierceLeft--;
    else b.destroy();
  }

  // Area damage from launcher / plasma rounds. Never hurts the player.
  explode(x, y, r, dmg) {
    this.emitters.fire.explode(18, x, y);
    this.emitters.dust.explode(8, x, y);
    this.ring(x, y, r, 0xff8a2a);
    this.cameras.main.shake(90, 0.006);
    for (const z of this.zombies.getChildren().slice()) {
      if (!z.alive) continue;
      const dx = z.cx - x, dy = z.cy - y, d = Math.hypot(dx, dy) || 1;
      if (d > r + (z.isBoss ? 26 : 8)) continue;
      const hit = dmg * (d < r * 0.5 ? 1 : 0.6);
      z.hurt(hit, (dx / d) * 220, (dy / d) * 220, this);
      this.hitNum(z, hit, false);
    }
  }

  // Shove-dash (the old melee button): dash a short way where you're moving (or aiming), then
  // shove everything around you away. Shoved zombies are dazed: they can't move, bite or dodge.
  // A shove breaks a riot shield outright, and Executives stay dazed longer.
  melee(time) {
    const p = this.player;
    if (time - p.lastMelee < p.stats.meleeCd || this.leaving) return;
    p.lastMelee = time;
    const v = p.body.velocity;
    const ang = v.length() > 30 ? Math.atan2(v.y, v.x) : p.aim;
    p.dash(ang, time);
    buzz(12);
    this.emitters.dust.explode(8, p.cx, p.cy + 8);
    this.time.delayedCall(DASH_MS, () => this.shoveBurst());
  }

  shoveBurst() {
    if (this.over) return;
    const p = this.player;
    const reach = 66;
    this.ring(p.cx, p.cy, reach, 0xffffff);
    this.cameras.main.shake(70, 0.004);
    for (const z of this.zombies.getChildren().slice()) {
      if (!z.alive) continue;
      const dx = z.cx - p.cx, dy = z.cy - p.cy;
      const d = Math.hypot(dx, dy) || 1;
      const rad = z.isBoss ? z.width * 0.4 : 0;
      if (d > reach + rad) continue;
      this.emitters.dust.explode(6, z.cx, z.cy);
      if (z.shield && z.shieldHp > 0) z.shieldHit(1e9, this); // shields can't take a shove
      const dmg = p.stats.meleeDmg * this.meleeScale();
      z.hurt(dmg, (dx / d) * 300, (dy / d) * 300, this);
      this.hitNum(z, dmg, false);
      if (z.alive && !z.isBoss) z.stagger(z.kind === 'executive' ? 1500 : 500);
    }
  }

  // Melee keeps up a bit as the tower gets tougher.
  meleeScale() { return 1 + (this.plan.hpScale - 1) * 0.5; }

  onBite(z) {
    const time = this.time.now;
    if (this.over || !z.canBite(time) || time - z.lastHit < 700) return;
    z.lastHit = time;
    const dmg = z.isBoss ? z.contactDamage() : z.dmg;
    z.attackAnim?.(time);
    if (z.isBoss && (z.state === 'charge' || z.contactKnock)) {
      const dx = this.player.cx - z.cx, dy = this.player.cy - z.cy, d = Math.hypot(dx, dy) || 1;
      this.player.knock((dx / d) * 450, (dy / d) * 450, 220);
    }
    this.damagePlayer(dmg);
  }

  damagePlayer(dmg, quiet = false) {
    const r = this.player.hurt(dmg, this.time.now, quiet);
    if (r === 'dead') this.onPlayerDeath();
    else if (r === 'revived') { this.toast('SECOND WIND!', '#ffe066'); this.cameras.main.flash(300, 255, 230, 100); }
    else if (r === 'laststand') { this.toast('MARCUS PULLS YOU UP!', '#ffc27f'); this.cameras.main.flash(300, 255, 194, 127); buzz(80); }
    else if (r > 0 && !quiet) { this.cameras.main.shake(90, 0.005); buzz(25); }
  }

  // ------------------------------------------------------- enemy projectiles
  enemyShot(x, y, ang, o) {
    const s = this.shots.create(x, y, o.key || 'goo');
    s.setDepth(944).setRotation(ang);
    if (this.anims.exists(`${o.key}_play`)) s.play(`${o.key}_play`);
    const r = 4;
    s.body.setCircle(r, s.width / 2 - r, s.height / 2 - r);
    s.body.setVelocity(Math.cos(ang) * o.speed, Math.sin(ang) * o.speed);
    s.dmg = o.dmg;
    s.toxic = !!o.toxic;
    s.root = o.root || 0;
    s.spin = !!o.spin;
    s.dieAt = this.time.now + (o.life || 3500);
    return s;
  }

  shotHitWall(s) {
    (s.toxic ? this.emitters.goo : this.emitters.dust).explode(5, s.x, s.y);
    s.destroy();
  }

  onShotHit(s) {
    if (!s.active || this.over) return;
    const p = this.player;
    this.damagePlayer(s.toxic ? s.dmg * p.stats.toxicMul : s.dmg);
    if (s.root) { p.root(s.root); this.toast('PINNED!', '#ff8a2a'); }
    (s.toxic ? this.emitters.goo : this.emitters.spark).explode(6, s.x, s.y);
    s.destroy();
  }

  onEnemyKilled(z) {
    this.aliveCount--;
    this.run.kills++;
    const p = this.player;
    if (z.elite) this.eliteDown(z);
    if (!z.isBoss && !this.lockdownOver) this.tickMeter();
    if (p.stats.leech) p.heal(p.stats.leech);
    const big = z.isBoss;
    this.emitters.goo.explode(big ? 40 : 14, z.cx, z.cy);
    this.splats.fillStyle(0x2a4a34, 0.55);
    for (let i = 0; i < (big ? 9 : 4); i++) {
      this.splats.fillCircle(z.cx + (Math.random() * 2 - 1) * (big ? 30 : 10), z.cy + (Math.random() * 2 - 1) * 8, 2 + Math.random() * (big ? 8 : 5));
    }
    z.body.enable = false;
    if (z.real && this.anims.exists(`${z.artKey}_death`)) {
      z.animLock = Infinity;
      z.setAngle(0).setScale(1).clearTint();
      z.play(`${z.artKey}_death`);
      this.tweens.add({ targets: z, alpha: 0, delay: big ? 1600 : 650, duration: 400, onComplete: () => z.destroy() });
    } else {
      this.tweens.add({ targets: z, alpha: 0, scaleX: 1.3, scaleY: 0.25, y: z.y + 8, duration: 280, onComplete: () => z.destroy() });
    }

    if (z.isBoss) {
      this.bossDead = true;
      this.queue = [];
      this.cameras.main.shake(400, 0.02);
      this.cameras.main.flash(250, 61, 255, 197);
      buzz([40, 30, 80]);
      for (const o of this.zombies.getChildren().slice()) if (o !== z && o.alive) o.hurt(1e9, 0, 0, this);
      for (const s of this.shots.getChildren().slice()) s.destroy();
      this.clouds = [];
      if (this.isFinalFloor) this.victory();
      else this.dropMedkit(z.cx, z.cy, true);
    } else if (Math.random() < 0.03 * (p.stats.scavenger ? 2 : 1)) {
      this.dropMedkit(z.cx, z.cy);
    }
  }

  dropMedkit(x, y, big = false, heal = 0, ms = 0) {
    const m = this.medkits.create(x, y, 'medkit').setDepth(5);
    m.heal = Math.round((heal || (big ? 40 : 15)) * this.player.stats.medkitMul);
    m.expireAt = this.time.now + (ms || (big ? 60000 : 12000));
    if (big) m.setScale(1.5);
  }

  pickMedkit(m) {
    if (!m.active) return;
    const p = this.player;
    if (p.hp >= p.stats.maxHp) return;
    p.heal(m.heal);
    this.toast(`+${m.heal} HP`, '#4ade80');
    buzz(15);
    m.destroy();
  }

  // ------------------------------------------------------------- weapon mods
  applyHitMods(z, dmg, b) {
    const mods = this.player.stats.mods;
    const now = this.time.now;
    if (mods.burn && z.alive) {
      // keep the stronger burn if one is already going (bosses start without these fields)
      const still = z.burnUntil > now ? z.burnDps || 0 : 0;
      z.burnDps = Math.max(still, (dmg * BURN[mods.burn]) / 2);
      z.burnUntil = now + 2000;
    }
    if (mods.cryo && z.alive && !z.isBoss) {
      z.slowUntil = now + 1000;
      z.slowMul = 1 - CRYO[mods.cryo];
      this.emitters.ice.explode(3, z.cx, z.cy);
    }
    if (mods.chain && b.chainOdds && Math.random() < b.chainOdds) this.chainFrom(z, dmg * CHAIN, mods.chain);
  }

  // Chain Shock: arc to the nearest other zombies.
  chainFrom(z, dmg, n) {
    const near = this.zombies.getChildren()
      .filter((o) => o !== z && o.alive && o.body && Math.hypot(o.cx - z.cx, o.cy - z.cy) < 120)
      .sort((a, c) => Math.hypot(a.cx - z.cx, a.cy - z.cy) - Math.hypot(c.cx - z.cx, c.cy - z.cy))
      .slice(0, n);
    if (!near.length) return;
    const g = this.add.graphics().setDepth(946);
    g.lineStyle(2, 0x66d9ff, 1);
    let from = { x: z.cx, y: z.cy };
    for (const o of near) {
      // jagged bolt
      g.beginPath(); g.moveTo(from.x, from.y);
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        g.lineTo(from.x + (o.cx - from.x) * t + (Math.random() * 10 - 5), from.y + (o.cy - from.y) * t + (Math.random() * 10 - 5));
      }
      g.lineTo(o.cx, o.cy); g.strokePath();
      o.hurt(dmg, 0, 0, this);
      this.hitNum(o, dmg, false);
      from = { x: o.cx, y: o.cy };
    }
    this.tweens.add({ targets: g, alpha: 0, duration: 140, onComplete: () => g.destroy() });
  }

  // Incendiary: burning zombies take damage every quarter second.
  updateBurns(time) {
    for (const z of this.zombies.getChildren()) {
      if (!z.alive || !(z.burnUntil > time) || time < (z.nextBurn || 0) || !(z.burnDps > 0)) continue;
      z.nextBurn = time + 250;
      this.emitters.fire.explode(2, z.cx, z.cy - 4);
      z.hurt(z.burnDps / 4, 0, 0, this);
    }
  }

  // Ricochet: bounce toward the nearest zombie in sight, or straight back if none.
  ricochet(b) {
    b.bounces--;
    b.dmg *= RICOCHET_DMG[this.player.stats.mods.ricochet || 1];
    const range = 320;
    let best = null, bd = Infinity;
    for (const z of this.zombies.getChildren()) {
      if (!z.alive || !z.body || b.hit.has(z)) continue;
      const d = Math.hypot(z.cx - b.x, z.cy - b.y);
      if (d < bd && d < range) { best = z; bd = d; }
    }
    const ang = best ? Math.atan2(best.cy - b.y, best.cx - b.x) : b.rotation + Math.PI;
    b.body.setVelocity(Math.cos(ang) * b.speed, Math.sin(ang) * b.speed);
    b.setRotation(ang);
    b.dieAt = this.time.now + (range / b.speed) * 1000;
    this.emitters.spark.explode(3, b.x, b.y);
    return true;
  }

  // ------------------------------------------------------------ medkit meter
  // Every N kills, a medkit lands near you.
  tickMeter() {
    const p = this.player;
    this.run.meter = (this.run.meter || 0) + 1;
    if (this.run.meter < p.stats.meterNeed) return;
    this.run.meter = 0;
    const spot = this.openTileNear(p.cx, p.cy, 60, 150);
    if (!spot) return;
    this.dropMedkit(spot.x, spot.y, false, Math.round(p.stats.maxHp * 0.15), 20000);
    this.ring(spot.x, spot.y, 26, 0x4ade80);
    this.toast('MEDKIT DROPPED!', '#4ade80');
  }

  // A random open floor tile between minD and maxD from (x, y).
  openTileNear(x, y, minD, maxD) {
    const spots = [];
    for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
      if (this.solid[r][c] || this.hazard.has(`${c},${r}`)) continue;
      const cx = c * TILE + TILE / 2, cy = r * TILE + TILE / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d >= minD && d <= maxD) spots.push({ x: cx, y: cy });
    }
    return spots.length ? spots[Math.floor(Math.random() * spots.length)] : null;
  }

  // ----------------------------------------------------------------- twists
  setupTwist() {
    const t = this.twist;
    if (t === 'blackout') {
      canvasTexture(this, 'light', 300, 300, (ctx) => {
        const g = ctx.createRadialGradient(150, 150, 20, 150, 150, 150);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 300, 300);
      });
      canvasTexture(this, 'light_s', 120, 120, (ctx) => {
        const g = ctx.createRadialGradient(60, 60, 6, 60, 60, 60);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 120, 120);
      });
      this.dark = this.add.renderTexture(0, 0, W, H).setOrigin(0).setDepth(948);
    } else if (t === 'lockdown') {
      this.lockEnd = this.spawnStart + 45000;
      this.plan = { ...this.plan, spawnMs: this.plan.spawnMs * 0.85 };
    } else if (t === 'elite') {
      this.eliteAt = this.spawnStart + 7000;
    } else if (t === 'flooded') {
      this.zSpeedMul = 0.75;
      this.player.speedMul = 0.8;
      this.add.rectangle(W / 2, H / 2, W, H, 0x2a6fbf, 0.22).setDepth(1.5);
      for (let i = 0; i < 14; i++) { // ripples
        const e = this.add.ellipse(Math.random() * W, Math.random() * H, 30, 10).setStrokeStyle(1, 0xbfe3ff, 0.5).setDepth(1.6);
        this.tweens.add({ targets: e, scale: 2.2, alpha: 0, duration: 1600 + Math.random() * 900, repeat: -1, delay: Math.random() * 1500 });
      }
    }
  }

  updateTwist(time) {
    const t = this.twist;
    const p = this.player;
    if (t === 'blackout') {
      const d = this.dark;
      d.clear();
      d.fill(0x05040a, 0.94);
      d.erase('light', p.cx - 150 + Math.cos(p.aim) * 45, p.cy - 150 + Math.sin(p.aim) * 45);
      if (this.cleared) d.erase('light_s', this.stairs.x - 60, this.stairs.y - 60);
      for (const m of this.medkits.getChildren()) d.erase('light_s', m.x - 60, m.y - 60);
    } else if (t === 'lockdown' && !this.cleared) {
      if (this.queue.length < 4) for (let i = 0; i < 6; i++) this.queue.push(this.plan.pick());
      if (time > this.lockEnd) {
        this.lockdownOver = true;
        this.queue = [];
        for (const z of this.zombies.getChildren().slice()) if (z.alive) z.hurt(1e9, 0, 0, this);
        this.toast('LOCKDOWN LIFTED', TEAL_HEX);
        this.unlockStairs();
      }
    } else if (t === 'elite' && !this.eliteSpawned && time > this.spawnStart && (time > this.eliteAt || this.queue.length === 0)) {
      this.spawnElite();
    }
  }

  spawnElite() {
    this.eliteSpawned = true;
    let type;
    do { type = this.plan.pick(); } while (type === 'blob' || type === 'spitter');
    const z = this.spawnZombie(type, true);
    z.elite = true;
    z.maxHp = z.hp = Math.round(z.maxHp * 8);
    z.dmg = Math.round(z.dmg * 1.5);
    z.speed *= 0.9;
    z.baseScale = 1.5;
    z.setScale(1.5).setTint(0xffc94a);
    if (z.shield) z.shieldHp *= 3;
    this.time.delayedCall(400, () => this.toast(`ELITE ${ENEMIES[type].name.toUpperCase()}!`, '#ffc94a'));
  }

  eliteDown(z) {
    buzz(50);
    const c = this.crates.create(z.cx, z.cy, 'crate').setDepth(6);
    this.tweens.add({ targets: c, y: c.y - 4, yoyo: true, repeat: -1, duration: 400 });
    this.toast('UPGRADE CRATE!', '#ffc94a');
  }

  // Elite's crate: +1 level on your current gun (or the other one), else a big heal.
  pickCrate(c) {
    if (!c.active) return;
    c.destroy();
    const p = this.player;
    const order = [p.slotIdx, 1 - p.slotIdx];
    for (const i of order) {
      const s = p.slots[i];
      if (!s || s.lvl >= MAX_LVL) continue;
      const ns = p.makeSlot({ id: s.id, lvl: s.lvl + 1 });
      ns.ammo = ns.st.mag;
      p.slots[i] = ns;
      this.hud.refreshLoadout();
      this.toast(`${WEAPONS[s.id].short} UPGRADED TO L${s.lvl + 1}!`, '#ffc94a');
      buzz(40);
      return;
    }
    p.heal(p.stats.maxHp * 0.5);
    this.toast('GUNS MAXED: +50% HP', '#4ade80');
  }

  // --------------------------------------------------------------- survivor
  setupSurvivor() {
    if (this.elevator || this.isBossFloor) return;
    const who = crewOnFloor(this.floorN);
    if (!who || this.run.crew.includes(who.id)) return;
    // an open tile far from you and the zombie spawns
    const spots = [];
    for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
      if (this.solid[r][c] || this.hazard.has(`${c},${r}`)) continue;
      const x = c * TILE + TILE / 2, y = r * TILE + TILE / 2;
      if (Math.hypot(x - this.startPos.x, y - this.startPos.y) < 260) continue;
      if (this.spawns.some((sp) => Math.hypot(sp.x - x, sp.y - y) < 96)) continue;
      if (Math.hypot(x - this.stairs.x, y - this.stairs.y) < 64) continue;
      spots.push({ x, y });
    }
    if (!spots.length) return;
    const at = spots[Math.floor(Math.random() * spots.length)];
    const img = this.add.sprite(at.x, at.y, 'rook').setTint(0xffc27f).setDepth(at.y);
    const help = txt(this, at.x, at.y - 30, 'HELP!', 8, '#ffc27f', { ox: 0.5, stroke: '#000', strokeThickness: 3 }).setDepth(940);
    this.tweens.add({ targets: help, y: at.y - 34, yoyo: true, repeat: -1, duration: 350 });
    const bar = this.add.graphics().setDepth(940);
    this.survivor = { who, img, help, bar, x: at.x, y: at.y, hold: 100 };
    this.time.delayedCall(2600, () => this.toast(`${who.name.toUpperCase()} NEEDS HELP! REACH THEM`, '#ffc27f'));
  }

  updateSurvivor(time, delta) {
    const s = this.survivor, p = this.player;
    if (time < this.spawnStart) return;
    s.hold -= (100 / HOLD_MS) * delta; // they can only hold out so long
    for (const z of this.zombies.getChildren()) {
      if (z.alive && !z.isBoss && z.body && Math.hypot(z.cx - s.x, z.cy - s.y) < 22) s.hold -= (CONTACT_DRAIN * delta) / 1000;
    }
    s.bar.clear();
    s.bar.fillStyle(0x000000, 0.8).fillRect(s.x - 15, s.y - 22, 30, 5);
    s.bar.fillStyle(s.hold > 35 ? 0xffc27f : 0xff5f56, 1).fillRect(s.x - 14, s.y - 21, 28 * Math.max(0, s.hold) / 100, 3);
    if (Math.hypot(p.cx - s.x, p.cy - s.y) < 28) return this.endSurvivor(true);
    if (s.hold <= 0) this.endSurvivor(false);
  }

  endSurvivor(saved) {
    const s = this.survivor;
    this.survivor = null;
    s.bar.destroy(); s.help.destroy();
    if (saved) {
      this.run.crew.push(s.who.id);
      this.player.stats = derived(this.run); // crew passives start now
      this.player.slots.forEach((sl) => { if (sl) { const a = sl.ammo; Object.assign(sl, this.player.makeSlot(sl)); sl.ammo = Math.min(a, sl.st.mag); } });
      this.toast(`${s.who.name.toUpperCase()} JOINS YOUR CREW!`, '#ffc27f');
      this.time.delayedCall(1300, () => this.toast(s.who.perk.toUpperCase(), '#ffe066'));
      this.ring(s.x, s.y, 30, 0xffc27f);
      buzz(40);
      this.tweens.add({ targets: s.img, alpha: 0, y: s.y - 20, duration: 500, onComplete: () => s.img.destroy() });
    } else {
      this.toast(`${s.who.name.toUpperCase()} DIDN'T MAKE IT`, '#ff5f56');
      s.img.setTint(0xff5f56);
      this.tweens.add({ targets: s.img, alpha: 0, angle: 90, duration: 700, onComplete: () => s.img.destroy() });
    }
  }

  // ------------------------------------------------------------ hit numbers
  // Damage numbers pop off zombies. Hits within a moment add up, so shotguns show one number.
  hitNum(z, dmg, crit) {
    if (!setting('numbers') || !z.body) return;
    z._numAcc = (z._numAcc || 0) + dmg;
    z._numCrit = z._numCrit || crit;
    if (z._numTimer) return;
    z._numTimer = true;
    const x = z.cx, y = z.cy - 14;
    this.time.delayedCall(60, () => {
      const total = Math.round(z._numAcc), c = z._numCrit;
      z._numAcc = 0; z._numCrit = false; z._numTimer = false;
      if (total < 1) return;
      let t = this.numPool.find((n) => !n.visible);
      if (!t) {
        if (this.numPool.length < 40) { t = txt(this, 0, 0, '', 10, '#ffffff', { ox: 0.5, oy: 0.5, stroke: '#000', strokeThickness: 3 }).setDepth(960); this.numPool.push(t); }
        else t = this.numPool.shift(), this.numPool.push(t);
      }
      this.tweens.killTweensOf(t);
      t.setText(String(total)).setPosition(x + (Math.random() * 10 - 5), y).setVisible(true).setAlpha(1)
        .setFontSize(c ? 14 : total >= 100 ? 12 : 10).setColor(c ? '#ff66ff' : total >= 100 ? '#ffe066' : '#ffffff').setScale(1.4);
      this.tweens.add({ targets: t, scale: 1, duration: 90 });
      this.tweens.add({ targets: t, y: y - 20, alpha: 0, delay: 200, duration: 380, onComplete: () => t.setVisible(false) });
    });
  }

  // ------------------------------------------------------------- effects api
  burst(x, y, color, n) {
    const e = color === 0xbbbbbb ? this.emitters.dust : color === 0xffe066 ? this.emitters.spark : this.emitters.goo;
    e.explode(n, x, y);
  }

  ring(x, y, r, color = 0xff5f56) {
    const c = this.add.circle(x, y, r).setStrokeStyle(4, color).setDepth(870).setScale(0.1);
    this.tweens.add({ targets: c, scale: 1, alpha: 0, duration: 320, onComplete: () => c.destroy() });
  }

  slash(x, y, ang, r) {
    const g = this.add.graphics().setDepth(870);
    g.lineStyle(8, 0xff5f56, 0.9);
    g.beginPath();
    g.arc(x, y, r - 20, ang - 0.65, ang + 0.65);
    g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
  }

  toast(msg, color) { this.hud.toast(msg, color); }

  // ------------------------------------------------------------ floor flow
  unlockStairs() {
    this.cleared = true;
    if (this.isFinalFloor) return;
    this.stairs.setTexture('stairs_open');
    this.tweens.add({ targets: this.stairs, scale: 1.15, yoyo: true, repeat: -1, duration: 450 });
    this.toast(this.isBossFloor ? 'BOSS DOWN! TAKE THE STAIRS' : 'FLOOR CLEAR! TAKE THE STAIRS', TEAL_HEX);
  }

  victory() {
    this.leaving = true;
    if (this.elevator) this.hud.banner('RUN COMPLETE', 'THE ELEVATOR REACHES THE TOP');
    else this.hud.banner('TOWER CONQUERED', 'THE FOUNDER HAS FALLEN');
    recordWin(this.run);
    this.time.delayedCall(3000, () => {
      this.player.writeBack();
      if (!this.elevator) clearCheckpoint();
      this.cameras.main.fadeOut(800, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('End', { mode: 'victory', run: this.run }));
    });
  }

  leaveFloor() {
    this.leaving = true;
    this.player.body.setVelocity(0, 0);
    this.player.writeBack();
    this.cameras.main.fadeOut(450, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('Draft', { run: this.run, kind: this.isBossFloor && !this.elevator ? 'perk' : 'gear' });
    });
  }

  onPlayerDeath() {
    this.over = true;
    buzz([60, 40, 140]);
    this.physics.pause();
    const p = this.player;
    p.gun.setVisible(false);
    if (p.real) { p.setScale(1).play('rook_death'); } else {
      p.setTint(0xff5f56);
      this.tweens.add({ targets: p, angle: 90, duration: 400 });
    }
    const t = txt(this, W / 2, H / 2, 'YOU DIED', 28, '#ff5f56', { ox: 0.5, oy: 0.5, stroke: '#000', strokeThickness: 6 }).setDepth(2000).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 400 });
    this.time.delayedCall(1500, () => {
      this.cameras.main.fadeOut(500, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('End', { mode: 'dead', run: this.run }));
    });
  }

  pauseGame() {
    if (this.over || this.leaving) return;
    this.scene.launch('Pause');
    this.scene.pause();
  }
}
