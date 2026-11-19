// Death screen and end-of-slice screen.

import { W, H, TEAL_HEX, MAX_BUILT_FLOOR, WIN_KEY, TOUCH, HINT, txt, button, menuKeys } from '../config.js';
import { bumpMercy, newRun, saveCheckpoint, clearResume, MERCY_STEP, newElevatorRun } from '../state/run.js';
import { fadeIn, fadeOut } from '../game/motion.js';
import { CREW } from '../data/crew.js';

export class EndScene extends Phaser.Scene {
  constructor() { super('End'); }

  init(data) {
    this.mode = data.mode; // 'dead' | 'victory'
    this.run = data.run;
  }

  create() {
    fadeIn(this, 300);
    this.add.rectangle(W / 2, H / 2, W, H, 0x0d0b12, 1);
    this.add.image(W / 2, H / 2, 'vignette');

    const elev = this.run.mode === 'elevator';
    const b1 = TOUCH ? 290 : 262, b2 = TOUCH ? 358 : 316; // two buttons, further apart on phones
    const wrap = W - 40;
    const keys = (...b) => menuKeys(this, b);
    if (this.mode === 'dead' && elev) {
      txt(this, W / 2, 110, 'RUN OVER', 32, '#ff5f56', { ox: 0.5, stroke: '#000', strokeThickness: 6 });
      txt(this, W / 2, 170, `STOP ${this.run.step + 1} OF ${this.run.route.length}  ·  ${this.run.kills} KILLS`, 10, '#e8e2d4', { ox: 0.5 });
      keys(button(this, W / 2, b1, 'NEW ELEVATOR RUN', () => this.go('Game', { run: newElevatorRun() }), { w: 320, color: 0xe8a020 }),
        button(this, W / 2, b2, 'MAIN MENU', () => this.go('Menu'), { w: 320, color: 0x6b6580 }));
    } else if (this.mode === 'victory' && elev) {
      txt(this, W / 2, 90, 'ELEVATOR RUN COMPLETE', 22, TEAL_HEX, { ox: 0.5, stroke: '#000', strokeThickness: 6 });
      txt(this, W / 2, 140, `${this.run.kills} KILLS · ${(this.run.mods || []).length} MODS · ${this.run.perks.length} PERK`, 10, '#ffe066', { ox: 0.5 });
      keys(button(this, W / 2, b1, 'ANOTHER RUN', () => this.go('Game', { run: newElevatorRun() }), { w: 320, color: 0xe8a020 }),
        button(this, W / 2, b2, 'MAIN MENU', () => this.go('Menu'), { w: 320, color: 0x6b6580 }));
    } else if (this.mode === 'dead') {
      const t = TOUCH ? -40 : 0; // phones: the notes below wrap to two lines each
      txt(this, W / 2, 110 + t, 'YOU DIED', 32, '#ff5f56', { ox: 0.5, stroke: '#000', strokeThickness: 6 });
      txt(this, W / 2, 170 + t, `FLOOR ${this.run.floor}  ·  ${this.run.kills} KILLS`, 10, '#e8e2d4', { ox: 0.5 });
      clearResume(); // a death goes back to the checkpoint, not the start of this floor
      const cp = bumpMercy() || (() => { const r = newRun(); saveCheckpoint(r); return r; })();
      txt(this, W / 2, 196 + t, 'YOU KEEP THE GEAR YOU HAD AT YOUR LAST CHECKPOINT', 8, HINT, { ox: 0.5, align: 'center', wrap });
      if (cp.mercy && !cp.nightShift) txt(this, W / 2, TOUCH ? 204 : 218, `RETRY BONUS: ZOMBIES -${Math.round(cp.mercy * MERCY_STEP * 100)}% HEALTH UNTIL YOUR NEXT CHECKPOINT`, 8, '#4ade80', { ox: 0.5, align: 'center', wrap });
      const retry = cp.floor > MAX_BUILT_FLOOR
        ? () => this.go('End', { mode: 'victory', run: cp })
        : () => this.go('Game', { run: cp });
      keys(button(this, W / 2, b1, `RETRY FROM FLOOR ${cp.floor}`, retry, { w: 320 }),
        button(this, W / 2, b2, 'MAIN MENU', () => this.go('Menu'), { w: 320, color: 0x6b6580 }));
    } else if (this.mode === 'victory') {
      try { localStorage.setItem(WIN_KEY, String(Math.max(Number(localStorage.getItem(WIN_KEY)) || 0, 1))); } catch { /* ignore */ }
      txt(this, W / 2, 80, 'TOWER CONQUERED', 26, TEAL_HEX, { ox: 0.5, stroke: '#000', strokeThickness: 6 });
      clearResume();
      const v = TOUCH ? 24 : 0; // the line above wraps to two lines on phones
      txt(this, W / 2, 124, 'THE FOUNDER IS DEAD. THE SUN COMES UP OVER THE ROOFTOP.', 8, '#e8e2d4', { ox: 0.5, align: 'center', wrap });
      txt(this, W / 2, 152 + v, `${this.run.kills} KILLS · ${this.run.perks.length} PERKS · CREW SAVED ${(this.run.crew || []).length}/${CREW.length}`, 10, '#ffe066', { ox: 0.5 });
      txt(this, W / 2, 176 + v, this.run.nightShift ? 'NIGHT SHIFT CLEARED. RESPECT.' : 'NIGHT SHIFT UNLOCKED · NEW CLIMB TO TRY IT', 8, '#c77dff', { ox: 0.5 });
      const rook = this.add.sprite(W / 2, 226 + v, 'rook').setScale(3);
      if (this.anims.exists('rook_idle')) rook.play('rook_idle');
      this.tweens.add({ targets: rook, y: 220 + v, yoyo: true, repeat: -1, duration: 600 });
      keys(button(this, W / 2, TOUCH ? 336 : 300, 'NEW CLIMB', () => this.go('Setup'), { w: 320 }),
        button(this, W / 2, TOUCH ? 404 : 354, 'MAIN MENU', () => this.go('Menu'), { w: 320, color: 0x6b6580 }));
    }
  }

  go(scene, data) {
    fadeOut(this, 250, () => this.scene.start(scene, data));
  }
}
