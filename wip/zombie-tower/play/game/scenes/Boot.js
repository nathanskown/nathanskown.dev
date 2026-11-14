// Loads any real art from the manifest, then fills every missing key with placeholders.

import { REAL_ART } from '../art/manifest.js';
import { SHEETS, IMAGES } from '../art/sheets.js';
import { defineAnims } from '../game/anim.js';
import { makePlaceholders } from '../art/placeholders.js';
import { validateFloors } from '../data/floors.js';

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    for (const [key, path] of Object.entries(REAL_ART)) this.load.image(key, path);
    for (const [key, file] of Object.entries(IMAGES)) if (!REAL_ART[key]) this.load.image(key, file);
    for (const [key, s] of Object.entries(SHEETS)) {
      if (!REAL_ART[key]) this.load.spritesheet(key, s.file, { frameWidth: s.fw, frameHeight: s.fh });
    }
    // a missing file just falls back to the placeholder
    this.load.on('loaderror', (f) => console.warn('[Zombie Tower] art missing, using placeholder:', f.key));
  }

  create() {
    makePlaceholders(this);
    defineAnims(this);
    validateFloors();
    this.scene.start('Menu');
  }
}
