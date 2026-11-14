// New climb setup: pick a starting kit (unlocked by how high you've reached) and, after
// beating the tower once, Night Shift.

import { W, H, TEAL, TEAL_HEX, txt, button } from '../config.js';
import { newRun, saveCheckpoint } from '../state/run.js';
import { KITS, kitUnlocked, applyKit, loadMeta, nightShiftUnlocked } from '../state/meta.js';

export class SetupScene extends Phaser.Scene {
  constructor() { super('Setup'); }

  init() {
    this.kit = this.registry.get('kit') || 'standard';
    this.night = !!this.registry.get('night');
  }

  create() {
    this.cameras.main.fadeIn(200, 0, 0, 0);
    this.add.tileSprite(W / 2, H / 2, W, H, 'floor_garage');
    this.add.rectangle(W / 2, H / 2, W, H, 0x0d0b12, 0.8);
    const meta = loadMeta();
    if (!KITS.some((k) => k.id === this.kit && kitUnlocked(k, meta))) this.kit = 'standard';

    txt(this, W / 2, 28, 'NEW CLIMB', 20, '#ffffff', { ox: 0.5, stroke: '#000', strokeThickness: 5 });
    txt(this, W / 2, 58, `STARTING KIT · BEST FLOOR ${meta.best}`, 8, TEAL_HEX, { ox: 0.5 });

    KITS.forEach((k, i) => {
      const y = 96 + i * 46;
      const open = kitUnlocked(k, meta);
      const on = open && this.kit === k.id;
      const b = button(this, 196, y, open ? k.name : 'LOCKED', () => {
        if (!open) return;
        this.kit = k.id; this.registry.set('kit', k.id); this.scene.restart();
      }, { w: 236, h: 36, size: 8, color: on ? TEAL : open ? 0x6b6580 : 0x2e2a3a, textColor: open ? '#ffffff' : '#4a4560' });
      if (on) b.bg.setFillStyle(0x1f3a35, 1);
      txt(this, 334, y, open ? k.desc : `REACH FLOOR ${k.need} TO UNLOCK`, 8, open ? (on ? '#ffffff' : '#b9b4c9') : '#4a4560', { oy: 0.5 });
    });

    const nightOpen = nightShiftUnlocked(meta);
    const nb = button(this, W / 2, 344, nightOpen ? `NIGHT SHIFT: ${this.night ? 'ON' : 'OFF'}` : 'NIGHT SHIFT: LOCKED', () => {
      if (!nightOpen) return;
      this.night = !this.night; this.registry.set('night', this.night); this.scene.restart();
    }, { w: 300, h: 36, size: 8, color: nightOpen ? 0xc77dff : 0x2e2a3a, textColor: nightOpen ? '#ffffff' : '#4a4560' });
    if (this.night && nightOpen) nb.bg.setFillStyle(0x2c1f3a, 1);
    txt(this, W / 2, 370, nightOpen ? 'TOUGHER ZOMBIES AND BOSSES · NO RETRY BONUS' : 'BEAT THE TOWER ONCE TO UNLOCK', 8, '#8a85a0', { ox: 0.5 });

    button(this, W / 2 - 110, 420, 'BACK', () => this.scene.start('Menu'), { w: 180, color: 0x6b6580 });
    button(this, W / 2 + 110, 420, 'START', () => this.start(nightOpen && this.night), { w: 200 });
  }

  start(night) {
    const run = applyKit(newRun(), this.kit);
    run.nightShift = night;
    saveCheckpoint(run);
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Game', { run }));
  }
}
