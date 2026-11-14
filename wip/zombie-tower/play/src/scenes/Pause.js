// Pause overlay (runs on top of the paused Game scene).

import { W, H, TEAL, txt, button } from '../config.js';
import { aimMode, setAimMode } from '../game/aim.js';
import { setting, toggleSetting } from '../state/settings.js';
import { CREW_BY_ID } from '../data/crew.js';

export class PauseScene extends Phaser.Scene {
  constructor() { super('Pause'); }

  create() {
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65).setInteractive();
    const run = this.scene.get('Game').run;
    txt(this, W / 2, 60, 'PAUSED', 24, '#ffffff', { ox: 0.5, stroke: '#000', strokeThickness: 6 });
    button(this, W / 2, 124, 'RESUME', () => this.resume(), { w: 300 });
    const auto = aimMode() === 'auto';
    button(this, W / 2, 176, `PHONE AIM: ${auto ? 'AUTO' : 'ASSIST'}`, () => {
      setAimMode(auto ? 'assist' : 'auto');
      this.scene.restart();
    }, { w: 300, color: 0xe8a020 });
    txt(this, W / 2, 202, auto ? 'AIMS AND SHOOTS FOR YOU. RIGHT THUMB TAKES OVER.' : 'YOU AIM WITH THE RIGHT THUMB. SHOTS SNAP TO TARGETS.',
      8, '#8a85a0', { ox: 0.5 });
    [['shake', 'SHAKE'], ['vibrate', 'VIBRATE'], ['numbers', 'NUMBERS']].forEach(([k, label], i) => {
      button(this, W / 2 - 200 + i * 200, 244, `${label}: ${setting(k) ? 'ON' : 'OFF'}`, () => {
        toggleSetting(k);
        this.scene.restart();
      }, { w: 184, h: 34, size: 8, color: setting(k) ? TEAL : 0x6b6580 });
    });
    button(this, W / 2, 316, 'QUIT TO MENU', () => {
      this.scene.stop('Game');
      this.scene.start('Menu');
    }, { w: 300, color: 0x6b6580 });
    txt(this, W / 2, 346, run.mode === 'elevator' ? 'QUITTING ENDS THIS ELEVATOR RUN' : 'QUITTING RETURNS YOU TO YOUR LAST CHECKPOINT', 8, '#8a85a0', { ox: 0.5 });
    const crew = (run.crew || []).map((id) => `${CREW_BY_ID[id].name}: ${CREW_BY_ID[id].perk}`);
    if (crew.length) txt(this, W / 2, 380, 'CREW\n' + crew.join('\n').toUpperCase(), 8, '#ffc27f', { ox: 0.5, align: 'center', lineSpacing: 4 });
    this.input.keyboard.once('keydown-ESC', () => this.resume());
  }

  resume() {
    this.scene.resume('Game');
    this.scene.stop();
  }
}
