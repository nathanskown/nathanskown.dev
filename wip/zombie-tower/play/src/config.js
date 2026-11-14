// Shared constants and small UI helpers.

export const TILE = 32;
export const COLS = 25;
export const ROWS = 15;
export const W = COLS * TILE; // 800
export const H = ROWS * TILE; // 480

export const FONT = '"Press Start 2P", monospace';
export const TEAL = 0x3dffc5;
export const TEAL_HEX = '#3dffc5';

// Highest floor that exists in this build.
export const MAX_BUILT_FLOOR = 50;
export const SAVE_KEY = 'zombieTower.checkpoint.v1';
export const WIN_KEY = 'zombieTower.conquered';
export const AIM_KEY = 'zombieTower.aimMode';

export function txt(scene, x, y, str, size = 10, color = '#ffffff', o = {}) {
  const t = scene.add.text(x, y, str, {
    fontFamily: FONT,
    fontSize: `${size}px`,
    color,
    align: o.align || 'left',
    wordWrap: o.wrap ? { width: o.wrap } : undefined,
    stroke: o.stroke || '#000000',
    strokeThickness: o.strokeThickness ?? 0,
    lineSpacing: o.lineSpacing ?? 6,
  });
  t.setOrigin(o.ox ?? 0, o.oy ?? 0);
  return t;
}

// A simple clickable pixel button. Returns a container.
export function button(scene, x, y, label, onClick, o = {}) {
  const w = o.w || 240, h = o.h || 40;
  const color = o.color ?? TEAL;
  const c = scene.add.container(x, y);
  const bg = scene.add.rectangle(0, 0, w, h, 0x14111c, 1).setStrokeStyle(2, color);
  const t = txt(scene, 0, 1, label, o.size || 10, o.textColor || '#ffffff', { ox: 0.5, oy: 0.5 });
  c.add([bg, t]);
  c.setSize(w, h);
  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => bg.setFillStyle(0x241d33, 1));
  bg.on('pointerout', () => bg.setFillStyle(0x14111c, 1));
  bg.on('pointerdown', () => onClick());
  c.bg = bg;
  c.label = t;
  return c;
}
