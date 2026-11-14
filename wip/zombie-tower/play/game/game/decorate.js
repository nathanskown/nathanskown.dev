// Set dressing for a floor: decals (oil, papers, blood...), theme extras
// (parking lines, carpet runner, helipad), and the lighting layer.
// Purely visual: nothing here collides or affects gameplay.

import { TILE, W, H } from '../config.js';
import { THEMES } from '../art/themes.js';
import { seeded } from '../art/pixel.js';

const UPRIGHT = new Set(['cone', 'chair', 'suitcase', 'wine', 'coffee']); // don't spin these

const cx = (c) => c * TILE + TILE / 2;

export function decorate(scene, map, theme, floorN, cars = []) {
  const th = THEMES[theme];
  const rand = seeded(floorN * 7349 + 11);
  const at = (c, r) => map[r]?.[c] ?? '#';
  const open = [];
  for (let r = 1; r < map.length - 1; r++) for (let c = 1; c < map[r].length - 1; c++) if (at(c, r) === '.') open.push([c, r]);

  // ---- theme extras (painted on the floor)
  const g = scene.add.graphics().setDepth(0.4);
  const used = new Set();
  if (theme === 'garage') {
    g.fillStyle(0xe8e2c8, 0.3);
    for (const car of cars) {
      if (car.horiz) {
        g.fillRect(car.x - 38, car.y - 19, 76, 2); g.fillRect(car.x - 38, car.y + 17, 76, 2); g.fillRect(car.x - 38, car.y - 19, 2, 38);
      } else {
        g.fillRect(car.x - 19, car.y - 38, 2, 76); g.fillRect(car.x + 17, car.y - 38, 2, 76); g.fillRect(car.x - 19, car.y + 36, 38, 2);
      }
    }
    for (const r of [4, 10]) if (at(12, r) === '.') { scene.add.image(cx(12), cx(r), 'decal_arrow').setDepth(0.45); used.add(`12,${r}`); }
  } else if (theme === 'lobby') {
    for (let r = 2; r <= 12; r++) if (at(12, r) === '.' || at(12, r) === 'B') { scene.add.image(cx(12), cx(r), 'carpet_runner').setDepth(0.35); used.add(`12,${r}`); }
  } else if (theme === 'rooftop') {
    scene.add.image(cx(12), cx(7), 'helipad').setDepth(0.35);
  }

  // ---- decals
  const entries = Object.entries(th.decals);
  const totalW = entries.reduce((s, [, w]) => s + w, 0);
  const pickKey = () => {
    let x = rand() * totalW;
    for (const [k, w] of entries) { x -= w; if (x <= 0) return k; }
    return entries[0][0];
  };
  const n = Math.min(open.length, 14 + Math.floor(rand() * 8));
  for (let i = 0; i < n; i++) {
    const [c, r] = open[Math.floor(rand() * open.length)];
    if (used.has(`${c},${r}`)) continue;
    used.add(`${c},${r}`);
    const key = pickKey();
    const img = scene.add.image(cx(c) + (rand() - 0.5) * 10, cx(r) + (rand() - 0.5) * 10, `decal_${key}`).setDepth(0.5);
    if (!UPRIGHT.has(key)) img.setAngle(Math.floor(rand() * 4) * 90);
    img.setFlipX(rand() < 0.5);
  }

  lights(scene, map, th, rand);
}

function lights(scene, map, th, rand) {
  const dark = scene.add.renderTexture(0, 0, W, H).setOrigin(0, 0).setDepth(940);
  dark.fill(th.dark, th.darkAlpha);
  const small = scene.make.image({ key: 'lightmask', add: false });
  const lamps = [];

  for (const r of th.lightGrid.rows) {
    for (const c of th.lightGrid.cols) {
      const x = cx(c) + (rand() - 0.5) * 12, y = cx(r) + (rand() - 0.5) * 12;
      dark.erase('lightmask', x - 112, y - 112);
      const glow = scene.add.image(x, y, 'glow').setTint(th.light).setAlpha(th.glow)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(1.5);
      lamps.push({ x, y, glow });
    }
  }

  // little pools of light around the stairs, spawn vents, and toxic spills
  map.forEach((row, r) => [...row].forEach((ch, c) => {
    const scale = ch === 'E' ? 0.55 : ch === 'h' ? 0.35 : ch === 'S' ? 0.28 : 0;
    if (!scale) return;
    small.setScale(scale).setPosition(cx(c), cx(r));
    dark.erase(small);
    const tint = ch === 'E' ? 0xffffff : 0x3dffc5;
    scene.add.image(cx(c), cx(r), 'glow').setTint(tint).setScale(scale).setAlpha(ch === 'E' ? 0.08 : 0.12)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(1.5);
  }));
  small.destroy();

  // a couple of bad bulbs
  for (let i = 0; i < th.flicker && lamps.length; i++) {
    const L = lamps[Math.floor(rand() * lamps.length)];
    if (L.shade) continue;
    L.shade = scene.add.image(L.x, L.y, 'lightmask').setTint(0x000000).setAlpha(0).setDepth(940.5);
    const flicker = () => {
      if (!L.shade.active) return;
      let k = 0;
      const steps = 2 + Math.floor(Math.random() * 4);
      scene.time.addEvent({
        delay: 60 + Math.random() * 50, repeat: steps * 2 - 1, callback: () => {
          k++;
          const off = k % 2 === 1;
          L.shade.setAlpha(off ? 0.8 : 0);
          L.glow.setAlpha(off ? 0 : th.glow);
        },
      });
      scene.time.delayedCall(2500 + Math.random() * 6000, flicker);
    };
    scene.time.delayedCall(800 + Math.random() * 3000, flicker);
  }
  return dark;
}
