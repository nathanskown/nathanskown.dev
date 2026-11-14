// Title screen.

import { W, H, TEAL_HEX, MAX_BUILT_FLOOR, WIN_KEY, txt, button } from '../config.js';
import { loadCheckpoint, newElevatorRun } from '../state/run.js';
import { loadMeta } from '../state/meta.js';

export class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    this.cameras.main.fadeIn(300, 0, 0, 0);
    this.add.tileSprite(W / 2, H / 2, W, H, 'floor_garage');
    this.add.rectangle(W / 2, H / 2, W, H, 0x0d0b12, 0.55);

    // shuffling zombies across the bottom
    for (let i = 0; i < 5; i++) {
      const key = ['shambler', 'valet', 'crawler', 'shambler', 'executive'][i];
      const z = this.add.sprite(-40 - i * 140, H - 70 - (i % 2) * 18, key).setScale(2);
      this.tweens.add({ targets: z, x: W + 60, duration: 16000 + i * 1500, repeat: -1, delay: i * 900 });
      if (this.anims.exists(`${key}_side`)) z.play(`${key}_side`);
      else this.tweens.add({ targets: z, scaleY: 2.15, yoyo: true, repeat: -1, duration: 300 + i * 40 });
    }
    this.add.image(W / 2, H / 2, 'vignette');

    txt(this, W / 2, 70, 'ZOMBIE', 40, '#ffffff', { ox: 0.5, stroke: '#000', strokeThickness: 8 });
    txt(this, W / 2, 122, 'TOWER', 40, TEAL_HEX, { ox: 0.5, stroke: '#000', strokeThickness: 8 });
    txt(this, W / 2, 182, 'FIGHT YOUR WAY UP 50 FLOORS', 10, '#e8e2d4', { ox: 0.5 });

    const meta = loadMeta();
    const stats = [meta.wins ? `* TOWER CONQUERED${meta.wins > 1 ? ' x' + meta.wins : ''} *` : '', meta.best ? `BEST FLOOR ${meta.best}` : ''].filter(Boolean).join('  ·  ');
    if (stats) txt(this, W / 2, 202, stats, 8, '#ffe066', { ox: 0.5 });

    const cp = loadCheckpoint();
    let y = 232;
    if (cp && cp.floor > 1) {
      const label = cp.floor > MAX_BUILT_FLOOR ? `CONTINUE · ZONE ${Math.ceil(cp.floor / 10)}` : `CONTINUE · FLOOR ${cp.floor}${cp.nightShift ? ' (NIGHT)' : ''}`;
      button(this, W / 2, y, label, () => this.startRun(cp), { w: 320 });
      y += 48;
    }
    button(this, W / 2, y, 'NEW CLIMB', () => this.scene.start('Setup'), { w: 320 });
    y += 48;
    button(this, W / 2, y, 'ELEVATOR RUN · 10 FLOORS', () => this.startRun(newElevatorRun()), { w: 320, color: 0xe8a020 });

    txt(this, W / 2, H - 34, 'WASD MOVE · MOUSE AIM + SHOOT · R RELOAD · Q SWAP · SPACE SHOVE', 8, '#8a85a0', { ox: 0.5 });
    txt(this, W / 2, H - 18, 'PHONE: LEFT THUMB MOVES · RIGHT THUMB AIMS + SHOOTS', 8, '#8a85a0', { ox: 0.5 });
  }

  startRun(run) {
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      if (run.floor > MAX_BUILT_FLOOR) this.scene.start('End', { mode: 'zoneClear', run });
      else this.scene.start('Game', { run });
    });
  }
}
