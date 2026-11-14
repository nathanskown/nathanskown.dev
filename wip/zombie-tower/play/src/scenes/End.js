// Death screen and end-of-slice screen.

import { W, H, TEAL_HEX, MAX_BUILT_FLOOR, WIN_KEY, txt, button } from '../config.js';
import { bumpMercy, newRun, saveCheckpoint, MERCY_STEP, newElevatorRun } from '../state/run.js';
import { CREW } from '../data/crew.js';

export class EndScene extends Phaser.Scene {
  constructor() { super('End'); }

  init(data) {
    this.mode = data.mode; // 'dead' | 'zoneClear' | 'victory'
    this.run = data.run;
  }

  create() {
    this.cameras.main.fadeIn(300, 0, 0, 0);
    this.add.rectangle(W / 2, H / 2, W, H, 0x0d0b12, 1);
    this.add.image(W / 2, H / 2, 'vignette');

    const elev = this.run.mode === 'elevator';
    if (this.mode === 'dead' && elev) {
      txt(this, W / 2, 110, 'RUN OVER', 32, '#ff5f56', { ox: 0.5, stroke: '#000', strokeThickness: 6 });
      txt(this, W / 2, 170, `STOP ${this.run.step + 1} OF ${this.run.route.length}  ·  ${this.run.kills} KILLS`, 10, '#e8e2d4', { ox: 0.5 });
      button(this, W / 2, 262, 'NEW ELEVATOR RUN', () => this.go('Game', { run: newElevatorRun() }), { w: 320, color: 0xe8a020 });
      button(this, W / 2, 316, 'MAIN MENU', () => this.go('Menu'), { w: 320, color: 0x6b6580 });
    } else if (this.mode === 'victory' && elev) {
      txt(this, W / 2, 90, 'ELEVATOR RUN COMPLETE', 22, TEAL_HEX, { ox: 0.5, stroke: '#000', strokeThickness: 6 });
      txt(this, W / 2, 140, `${this.run.kills} KILLS · ${(this.run.mods || []).length} MODS · ${this.run.perks.length} PERK`, 10, '#ffe066', { ox: 0.5 });
      button(this, W / 2, 262, 'ANOTHER RUN', () => this.go('Game', { run: newElevatorRun() }), { w: 320, color: 0xe8a020 });
      button(this, W / 2, 316, 'MAIN MENU', () => this.go('Menu'), { w: 320, color: 0x6b6580 });
    } else if (this.mode === 'dead') {
      txt(this, W / 2, 110, 'YOU DIED', 32, '#ff5f56', { ox: 0.5, stroke: '#000', strokeThickness: 6 });
      txt(this, W / 2, 170, `FLOOR ${this.run.floor}  ·  ${this.run.kills} KILLS`, 10, '#e8e2d4', { ox: 0.5 });
      const cp = bumpMercy() || (() => { const r = newRun(); saveCheckpoint(r); return r; })();
      txt(this, W / 2, 196, 'YOU KEEP THE GEAR YOU HAD AT YOUR LAST CHECKPOINT', 8, '#8a85a0', { ox: 0.5 });
      if (cp.mercy && !cp.nightShift) txt(this, W / 2, 218, `RETRY BONUS: ZOMBIES -${Math.round(cp.mercy * MERCY_STEP * 100)}% HEALTH UNTIL YOUR NEXT CHECKPOINT`, 8, '#4ade80', { ox: 0.5 });
      const retry = cp.floor > MAX_BUILT_FLOOR
        ? () => this.go('End', { mode: 'zoneClear', run: cp })
        : () => this.go('Game', { run: cp });
      button(this, W / 2, 262, `RETRY FROM FLOOR ${cp.floor}`, retry, { w: 320 });
      button(this, W / 2, 316, 'MAIN MENU', () => this.go('Menu'), { w: 320, color: 0x6b6580 });
    } else if (this.mode === 'victory') {
      try { localStorage.setItem(WIN_KEY, String(Math.max(Number(localStorage.getItem(WIN_KEY)) || 0, 1))); } catch { /* ignore */ }
      txt(this, W / 2, 80, 'TOWER CONQUERED', 26, TEAL_HEX, { ox: 0.5, stroke: '#000', strokeThickness: 6 });
      txt(this, W / 2, 132, 'THE FOUNDER IS DEAD. THE SUN COMES UP OVER THE ROOFTOP.', 8, '#e8e2d4', { ox: 0.5 });
      txt(this, W / 2, 152, `${this.run.kills} KILLS · ${this.run.perks.length} PERKS · CREW SAVED ${(this.run.crew || []).length}/${CREW.length}`, 10, '#ffe066', { ox: 0.5 });
      txt(this, W / 2, 172, this.run.nightShift ? 'NIGHT SHIFT CLEARED. RESPECT.' : 'NIGHT SHIFT UNLOCKED · NEW CLIMB TO TRY IT', 8, '#c77dff', { ox: 0.5 });
      const rook = this.add.sprite(W / 2, 222, 'rook').setScale(3);
      if (this.anims.exists('rook_idle')) rook.play('rook_idle');
      this.tweens.add({ targets: rook, y: 216, yoyo: true, repeat: -1, duration: 600 });
      button(this, W / 2, 300, 'NEW CLIMB', () => this.go('Setup'), { w: 320 });
      button(this, W / 2, 354, 'MAIN MENU', () => this.go('Menu'), { w: 320, color: 0x6b6580 });
    } else {
      txt(this, W / 2, 90, 'ZONE 1 CLEARED', 24, TEAL_HEX, { ox: 0.5, stroke: '#000', strokeThickness: 6 });
      txt(this, W / 2, 140, 'THE LOBBY IS QUIET. THE OFFICES ABOVE ARE NOT.', 8, '#e8e2d4', { ox: 0.5 });
      txt(this, W / 2, 170, `${this.run.kills} KILLS · ${this.run.perks.length} PERK${this.run.perks.length === 1 ? '' : 'S'}`, 10, '#ffe066', { ox: 0.5 });
      txt(this, W / 2, 210, 'FLOORS 11-50 ARE STILL UNDER CONSTRUCTION.\nYOUR CHECKPOINT IS SAVED FOR WHEN THEY OPEN.', 8, '#8a85a0', { ox: 0.5, align: 'center' });
      button(this, W / 2, 290, 'MAIN MENU', () => this.go('Menu'), { w: 320 });
    }
  }

  go(scene, data) {
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(scene, data));
  }
}
