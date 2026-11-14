// Zombie Tower entry point.

import { W, H } from './config.js';
import { BootScene } from './scenes/Boot.js';
import { MenuScene } from './scenes/Menu.js';
import { GameScene } from './scenes/Game.js';
import { DraftScene } from './scenes/Draft.js';
import { PauseScene } from './scenes/Pause.js';
import { EndScene } from './scenes/End.js';
import { SetupScene } from './scenes/Setup.js';

async function start() {
  // Wait (briefly) for the pixel font so text doesn't render in a fallback font.
  try {
    await Promise.race([
      document.fonts.load('16px "Press Start 2P"'),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* fallback font is fine */ }

  // eslint-disable-next-line no-new
  window.game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: W,
    height: H,
    backgroundColor: '#0d0b12',
    pixelArt: true,
    // Load images as plain <img> files instead of blob: URLs, which the website's security policy blocks.
    loader: { imageLoadType: 'HTMLImageElement' },
    disableContextMenu: true,
    physics: { default: 'arcade', arcade: { debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { activePointers: 3 },
    scene: [BootScene, MenuScene, SetupScene, GameScene, DraftScene, PauseScene, EndScene],
  });
}

start();
