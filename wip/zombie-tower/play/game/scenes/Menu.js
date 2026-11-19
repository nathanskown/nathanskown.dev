// Title screen.

import { W, H, TEAL_HEX, MAX_BUILT_FLOOR, TOUCH, HINT, txt, button, menuKeys } from '../config.js';
import { loadCheckpoint, loadResume, newElevatorRun } from '../state/run.js';
import { loadMeta } from '../state/meta.js';
import { aimMode } from '../game/aim.js';
import { fadeIn, fadeOut } from '../game/motion.js';

// What the phone controls do, matching the aim mode on the pause screen.
export function phoneHint() {
  return aimMode() === 'auto'
    ? 'PHONE: LEFT THUMB MOVES · AUTO-AIM SHOOTS · DRAG RIGHT SIDE TO AIM'
    : 'PHONE: LEFT THUMB MOVES · RIGHT THUMB AIMS + SHOOTS';
}

export class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    fadeIn(this, 300);
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

    // phones: buttons are taller, so everything sits a little higher
    const top = TOUCH ? 44 : 70;
    txt(this, W / 2, top, 'ZOMBIE', 40, '#ffffff', { ox: 0.5, stroke: '#000', strokeThickness: 8 });
    txt(this, W / 2, top + 52, 'TOWER', 40, TEAL_HEX, { ox: 0.5, stroke: '#000', strokeThickness: 8 });
    txt(this, W / 2, top + 108, 'FIGHT YOUR WAY UP 50 FLOORS', 10, '#e8e2d4', { ox: 0.5 });

    const meta = loadMeta();
    const stats = [meta.wins ? `* TOWER CONQUERED${meta.wins > 1 ? ' x' + meta.wins : ''} *` : '', meta.best ? `BEST FLOOR ${meta.best}` : ''].filter(Boolean).join('  ·  ');
    if (stats) txt(this, W / 2, top + 132, stats, 8, '#ffe066', { ox: 0.5 });

    // Continue: the save from the start of your latest floor, else your last checkpoint.
    const res = loadResume();
    const cp = res && res.floor > 1 ? res : loadCheckpoint();
    const step = TOUCH ? 66 : 48;
    let y = TOUCH ? 222 : 232;
    const buttons = [];
    if (cp && cp.floor > 1) {
      const label = `CONTINUE · FLOOR ${Math.min(cp.floor, MAX_BUILT_FLOOR)}${cp.nightShift ? ' (NIGHT)' : ''}`;
      buttons.push(button(this, W / 2, y, label, () => this.startRun(cp), { w: 320 }));
      y += step;
    }
    buttons.push(button(this, W / 2, y, 'NEW CLIMB', () => this.scene.start('Setup'), { w: 320 }));
    y += step;
    buttons.push(button(this, W / 2, y, 'ELEVATOR RUN · 10 FLOORS', () => this.startRun(newElevatorRun()), { w: 320, color: 0xe8a020 }));
    menuKeys(this, buttons);

    if (TOUCH) {
      txt(this, W / 2, H - 52, phoneHint(), 8, HINT, { ox: 0.5, align: 'center', wrap: W - 40 });
    } else {
      txt(this, W / 2, H - 34, 'WASD MOVE · MOUSE AIM + SHOOT · R RELOAD · Q SWAP · SPACE SHOVE', 8, HINT, { ox: 0.5 });
      txt(this, W / 2, H - 18, phoneHint(), 8, HINT, { ox: 0.5 });
    }
  }

  startRun(run) {
    fadeOut(this, 250, () => {
      if (run.floor > MAX_BUILT_FLOOR) this.scene.start('End', { mode: 'victory', run });
      else this.scene.start('Game', { run });
    });
  }
}
