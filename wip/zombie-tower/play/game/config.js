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
export const RESUME_KEY = 'zombieTower.resume.v1';

// Phones and tablets. On a phone held sideways the 800x480 game is drawn at about 0.78-0.81 of its size,
// so text and tap targets get minimums that still read as 12 CSS px text and 44 CSS px targets there.
export const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const MIN_TEXT = TOUCH ? 16 : 8; // game px
export const MIN_TAP = TOUCH ? 58 : 0; // game px
export const fs = (size) => Math.max(size, MIN_TEXT);

// Hint and locked text: readable on the dark background (at least 4.5:1).
export const HINT = '#b9b4c9';
export const LOCKED = '#8f88aa';

// Reduced motion: no screen shake by default, no fades or blinking.
export const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function txt(scene, x, y, str, size = 10, color = '#ffffff', o = {}) {
  const t = scene.add.text(x, y, str, {
    fontFamily: FONT,
    fontSize: `${fs(size)}px`,
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
  const size = fs(o.size || 10);
  const h = Math.max(o.h || 40, MIN_TAP);
  // wide enough for the label at its (possibly raised) size
  const w = Math.max(o.w || 240, TOUCH ? label.length * size + 28 : 0);
  const color = o.color ?? TEAL;
  const c = scene.add.container(x, y);
  const bg = scene.add.rectangle(0, 0, w, h, 0x14111c, 1).setStrokeStyle(2, color);
  const t = txt(scene, 0, 1, label, size, o.textColor || '#ffffff', { ox: 0.5, oy: 0.5 });
  c.add([bg, t]);
  c.setSize(w, h);
  bg.setInteractive({ useHandCursor: true });
  c.fill = 0x14111c;
  bg.on('pointerover', () => bg.setFillStyle(0x241d33, 1));
  bg.on('pointerout', () => bg.setFillStyle(c.focused ? 0x241d33 : c.fill, 1));
  bg.on('pointerdown', () => onClick());
  c.bg = bg;
  c.label = t;
  c.press = onClick;
  c.color = color;
  return c;
}

// Keyboard for menus: arrow keys move between buttons, Enter (or Space) presses the focused one.
// `start` is the button focused first.
export function menuKeys(scene, buttons, start = 0) {
  let i = Math.max(0, Math.min(buttons.length - 1, start));
  const show = () => buttons.forEach((b, j) => {
    b.focused = j === i;
    b.bg.setFillStyle(b.focused ? 0x241d33 : b.fill, 1);
    b.bg.setStrokeStyle(b.focused ? 3 : 2, b.focused ? 0xffffff : b.color);
  });
  show();
  const kb = scene.input.keyboard;
  const move = (d) => { i = (i + d + buttons.length) % buttons.length; show(); scene.registry.set(`focus:${scene.scene.key}`, i); };
  kb.on('keydown-UP', () => move(-1));
  kb.on('keydown-LEFT', () => move(-1));
  kb.on('keydown-DOWN', () => move(1));
  kb.on('keydown-RIGHT', () => move(1));
  const go = () => buttons[i].press();
  kb.on('keydown-ENTER', go);
  kb.on('keydown-SPACE', go);
  return { focus: (j) => { i = j; show(); } };
}
