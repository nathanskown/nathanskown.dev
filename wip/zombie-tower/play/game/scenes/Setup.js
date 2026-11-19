// New climb setup: pick a starting kit (unlocked by how high you've reached) and, after
// beating the tower once, Night Shift.

import { W, H, TEAL, TEAL_HEX, TOUCH, HINT, LOCKED, txt, button, menuKeys } from '../config.js';
import { newRun, saveCheckpoint, clearResume } from '../state/run.js';
import { fadeIn, fadeOut } from '../game/motion.js';
import { KITS, kitUnlocked, applyKit, loadMeta, nightShiftUnlocked } from '../state/meta.js';

export class SetupScene extends Phaser.Scene {
  constructor() { super('Setup'); }

  init() {
    this.kit = this.registry.get('kit') || 'standard';
    this.night = !!this.registry.get('night');
  }

  create() {
    fadeIn(this, 200);
    this.add.tileSprite(W / 2, H / 2, W, H, 'floor_garage');
    this.add.rectangle(W / 2, H / 2, W, H, 0x0d0b12, 0.8);
    const meta = loadMeta();
    if (!KITS.some((k) => k.id === this.kit && kitUnlocked(k, meta))) this.kit = 'standard';

    // Phones get taller buttons, so the rows are spaced wider and Night Shift shares the bottom row.
    const T = TOUCH;
    txt(this, W / 2, T ? 14 : 28, 'NEW CLIMB', 20, '#ffffff', { ox: 0.5, stroke: '#000', strokeThickness: 5 });
    txt(this, W / 2, T ? 42 : 58, `STARTING KIT · BEST FLOOR ${meta.best}`, 8, TEAL_HEX, { ox: 0.5 });

    const buttons = [];
    const kitX = T ? 146 : 196, kitW = T ? 252 : 236, descX = T ? 284 : 334;
    KITS.forEach((k, i) => {
      const y = T ? 96 + i * 62 : 96 + i * 46;
      const open = kitUnlocked(k, meta);
      const on = open && this.kit === k.id;
      const b = button(this, kitX, y, open ? k.name : 'LOCKED', () => {
        if (!open) return;
        this.kit = k.id; this.registry.set('kit', k.id); this.scene.restart();
      }, { w: kitW, h: 36, size: 8, color: on ? TEAL : open ? 0x6b6580 : 0x2e2a3a, textColor: open ? '#ffffff' : LOCKED });
      if (on) { b.fill = 0x1f3a35; b.bg.setFillStyle(b.fill, 1); }
      buttons.push(b);
      txt(this, descX, y, open ? k.desc : `REACH FLOOR ${k.need} TO UNLOCK`, 8, open ? (on ? '#ffffff' : HINT) : LOCKED,
        { oy: 0.5, wrap: W - descX - 12, lineSpacing: 4 });
    });

    const nightOpen = nightShiftUnlocked(meta);
    const nb = button(this, W / 2, T ? 446 : 344, nightOpen ? `NIGHT SHIFT: ${this.night ? 'ON' : 'OFF'}` : 'NIGHT SHIFT: LOCKED', () => {
      if (!nightOpen) return;
      this.night = !this.night; this.registry.set('night', this.night); this.scene.restart();
    }, { w: T ? 280 : 300, h: 36, size: 8, color: nightOpen ? 0xc77dff : 0x2e2a3a, textColor: nightOpen ? '#ffffff' : LOCKED });
    if (this.night && nightOpen) { nb.fill = 0x2c1f3a; nb.bg.setFillStyle(nb.fill, 1); }
    txt(this, W / 2, T ? 396 : 370, nightOpen ? 'TOUGHER ZOMBIES AND BOSSES · NO RETRY BONUS' : 'BEAT THE TOWER ONCE TO UNLOCK', 8, HINT, { ox: 0.5 });

    const back = button(this, T ? 92 : W / 2 - 110, T ? 446 : 420, 'BACK', () => { this.registry.remove('focus:Setup'); this.scene.start('Menu'); }, { w: T ? 150 : 180, color: 0x6b6580 });
    const go = button(this, T ? W - 100 : W / 2 + 110, T ? 446 : 420, 'START', () => this.start(nightOpen && this.night), { w: T ? 170 : 200 });
    buttons.push(nb, back, go);
    // Enter starts the climb unless you've moved to another button.
    menuKeys(this, buttons, this.registry.get('focus:Setup') ?? buttons.length - 1);
  }

  start(night) {
    const run = applyKit(newRun(), this.kit);
    run.nightShift = night;
    saveCheckpoint(run);
    clearResume(); // a new climb replaces the old one
    this.registry.remove('focus:Setup');
    fadeOut(this, 250, () => this.scene.start('Game', { run }));
  }
}
