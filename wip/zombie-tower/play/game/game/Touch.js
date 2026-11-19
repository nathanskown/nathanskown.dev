// Phone controls: twin floating joysticks + buttons.
//   Left half of the screen: drag to move.
//   Right half: aim / fire (how depends on the aim mode, see game/aim.js).
//   Buttons in the bottom-right corner: shove-dash (big), reload, swap. Kept out of the middle of the
//   right half so starting an aim drag doesn't hit them by accident.
// Hidden until the first touch, so desktop players never see it.
// When the phone is wide enough that the game has black bars at the sides (80+ CSS px), the three
// buttons move out of the game into the right-hand bar (the #pad buttons in index.html), so they never
// cover the floor.

import { W, H, TOUCH, txt } from '../config.js';
import { PAUSE_HIT } from './Hud.js';

const SIDE_BAR_MIN = 80; // CSS px

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
    // in-game buttons (used when there are no side bars); bigger on phones so 16px labels fit
    const big = TOUCH ? 6 : 0;
    this.allButtons = [
      { id: 'melee', x: W - 70, y: H - 124, r: 40 + big, label: 'SHOVE' },
      { id: 'reload', x: W - 172, y: H - 84, r: 28 + big * 1.5, label: 'RELOAD' },
      { id: 'swap', x: W - 52, y: H - 232, r: 28 + big * 1.5, label: 'SWAP' },
    ];
    this.buttons = this.allButtons;
    this.labels = this.buttons.map((b) =>
      txt(scene, b.x, b.y + 1, b.label, 8, '#ffffff', { ox: 0.5, oy: 0.5 }).setDepth(D + 1).setVisible(false));

    scene.input.addPointer(2);
    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerup', this.onUp, this);
    scene.input.on('pointerupoutside', this.onUp, this);

    // side-bar buttons
    this.pad = document.getElementById('pad');
    this.padDown = (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || !this.enabled) return;
      e.preventDefault();
      this.pressed[b.dataset.act] = true;
    };
    this.pad?.addEventListener('pointerdown', this.padDown);
    this.layout = () => this.place();
    scene.scale.on('resize', this.layout);
    window.addEventListener('resize', this.layout);
    scene.events.on('pause', this.layout);
    scene.events.on('resume', this.layout);
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.g.setVisible(true);
    this.place();
  }

  // Buttons in the side bar when it is wide enough, otherwise in the game.
  place() {
    const canvas = this.scene.game.canvas;
    const bar = canvas ? (window.innerWidth - canvas.getBoundingClientRect().width) / 2 : 0;
    this.side = !!this.pad && bar >= SIDE_BAR_MIN;
    const live = this.enabled && this.scene.scene.isActive();
    if (this.pad) {
      this.pad.hidden = !(this.side && live);
      this.pad.style.width = `${Math.floor(bar)}px`;
    }
    this.buttons = this.side ? [] : this.allButtons;
    this.labels.forEach((l) => l.setVisible(this.enabled && !this.side));
  }

  onDown(p) {
    if (!p.wasTouch) return;
    this.enable();
    // ignore the HUD pause button area
    if (p.x > W - PAUSE_HIT && p.y < PAUSE_HIT) return;
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
    if (this.pad) this.pad.hidden = true;
    this.pad?.removeEventListener('pointerdown', this.padDown);
    this.scene.scale.off('resize', this.layout);
    window.removeEventListener('resize', this.layout);
    this.scene.events.off('pause', this.layout);
    this.scene.events.off('resume', this.layout);
    const i = this.scene.input;
    i.off('pointerdown', this.onDown, this);
    i.off('pointermove', this.onMove, this);
    i.off('pointerup', this.onUp, this);
    i.off('pointerupoutside', this.onUp, this);
  }
}
