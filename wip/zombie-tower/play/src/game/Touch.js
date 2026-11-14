// Phone controls: twin floating joysticks + buttons.
//   Left half of the screen: drag to move.
//   Right half: aim / fire (how depends on the aim mode, see game/aim.js).
//   Buttons in the bottom-right corner: shove-dash (big), reload, swap. Kept out of the middle of the
//   right half so starting an aim drag doesn't hit them by accident.
// Hidden until the first touch, so desktop players never see it.

import { W, H, txt } from '../config.js';

const STICK_R = 46;
const D = 1100;

export class TouchControls {
  constructor(scene) {
    this.scene = scene;
    this.enabled = false;
    this.move = { x: 0, y: 0 };
    this.aim = { x: 0, y: 0, mag: 0 };
    this.movePtr = null;
    this.aimPtr = null;
    this.moveOrigin = null;
    this.aimOrigin = null;
    this.pressed = { reload: false, swap: false, melee: false };

    this.g = scene.add.graphics().setDepth(D).setVisible(false);
    this.buttons = [
      { id: 'melee', x: W - 66, y: H - 112, r: 40, label: 'SHOVE' },
      { id: 'reload', x: W - 158, y: H - 72, r: 28, label: 'RELOAD' },
      { id: 'swap', x: W - 48, y: H - 214, r: 28, label: 'SWAP' },
    ];
    this.labels = this.buttons.map((b) =>
      txt(scene, b.x, b.y + 1, b.label, 8, '#ffffff', { ox: 0.5, oy: 0.5 }).setDepth(D + 1).setVisible(false));

    scene.input.addPointer(2);
    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerup', this.onUp, this);
    scene.input.on('pointerupoutside', this.onUp, this);
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.g.setVisible(true);
    this.labels.forEach((l) => l.setVisible(true));
  }

  onDown(p) {
    if (!p.wasTouch) return;
    this.enable();
    // ignore the HUD pause button area
    if (p.x > W - 44 && p.y < 32) return;
    const btn = this.buttons.find((b) => Math.hypot(p.x - b.x, p.y - b.y) <= b.r + 10);
    if (btn) { this.pressed[btn.id] = true; btn.down = p.id; return; }
    if (p.x < W / 2 && this.movePtr === null) {
      this.movePtr = p.id;
      this.moveOrigin = { x: p.x, y: p.y };
    } else if (p.x >= W / 2 && this.aimPtr === null) {
      this.aimPtr = p.id;
      this.aimOrigin = { x: p.x, y: p.y };
    }
  }

  onMove(p) {
    if (p.id === this.movePtr) {
      const v = this.vec(this.moveOrigin, p);
      this.move = { x: v.x, y: v.y };
    } else if (p.id === this.aimPtr) {
      const v = this.vec(this.aimOrigin, p);
      this.aim = v;
    }
  }

  onUp(p) {
    if (p.id === this.movePtr) { this.movePtr = null; this.move = { x: 0, y: 0 }; }
    if (p.id === this.aimPtr) { this.aimPtr = null; this.aim = { x: 0, y: 0, mag: 0 }; }
    for (const b of this.buttons) if (b.down === p.id) b.down = null;
  }

  vec(o, p) {
    let dx = p.x - o.x, dy = p.y - o.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_R) { // drag the base along so the stick stays responsive
      o.x = p.x - (dx / len) * STICK_R;
      o.y = p.y - (dy / len) * STICK_R;
      dx = p.x - o.x; dy = p.y - o.y;
    }
    const mag = Math.min(1, len / STICK_R);
    return { x: (dx / STICK_R), y: (dy / STICK_R), mag };
  }

  // One-shot button presses (cleared once read).
  take(id) {
    const v = this.pressed[id];
    this.pressed[id] = false;
    return v;
  }

  get firing() { return this.aimPtr !== null && this.aim.mag > 0.35; }

  draw() {
    if (!this.enabled) return;
    const g = this.g;
    g.clear();
    const stick = (o, v) => {
      g.fillStyle(0xffffff, 0.08).fillCircle(o.x, o.y, STICK_R);
      g.lineStyle(2, 0xffffff, 0.25).strokeCircle(o.x, o.y, STICK_R);
      g.fillStyle(0xffffff, 0.35).fillCircle(o.x + v.x * STICK_R, o.y + v.y * STICK_R, 18);
    };
    if (this.movePtr !== null) stick(this.moveOrigin, this.move);
    if (this.aimPtr !== null) stick(this.aimOrigin, this.aim);
    for (const b of this.buttons) {
      g.fillStyle(b.down != null ? 0x3dffc5 : 0x14111c, b.down != null ? 0.5 : 0.55).fillCircle(b.x, b.y, b.r);
      g.lineStyle(2, 0xffffff, 0.35).strokeCircle(b.x, b.y, b.r);
    }
  }

  destroy() {
    const i = this.scene.input;
    i.off('pointerdown', this.onDown, this);
    i.off('pointermove', this.onMove, this);
    i.off('pointerup', this.onUp, this);
    i.off('pointerupoutside', this.onUp, this);
  }
}
