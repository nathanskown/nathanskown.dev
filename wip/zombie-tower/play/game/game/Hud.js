// Heads-up display: health, floor, zombies left, weapons, armor, perks, boss bar,
// plus banners and toasts.

import { W, H, txt, TEAL, TEAL_HEX, TOUCH, LOCKED, REDUCED } from '../config.js';
import { SLOTS } from '../data/armor.js';
import { WEAPONS } from '../data/weapons.js';

const D = 1000; // HUD depth
// Phones: 16px text needs a taller top and bottom band. TOP/BOT are the band heights.
export const TOP = TOUCH ? 40 : 30;
const BOT = TOUCH ? 46 : 32;
// The pause button's tap area (Touch.js leaves this corner alone).
export const PAUSE_HIT = TOUCH ? 60 : 30;

export class Hud {
  constructor(scene, player, run, floorDef) {
    this.scene = scene;
    this.player = player;
    this.run = run;
    this.g = scene.add.graphics().setDepth(D);

    // top bar
    this.hpText = txt(scene, 102, TOUCH ? 14 : 10, '', 8, '#ffffff', { ox: 0.5, oy: TOUCH ? 0.5 : 0, stroke: '#000', strokeThickness: TOUCH ? 4 : 0 }).setDepth(D + 1);
    const where = run.mode === 'elevator' ? `STOP ${run.step + 1}/${run.route.length}` : `FLOOR ${run.floor}`;
    // phones: the floor's name is in the opening banner; the bar just says where you are
    const name = TOUCH ? '' : ` · ${floorDef.name.toUpperCase()}`;
    this.floorText = txt(scene, TOUCH ? 360 : W / 2, TOUCH ? 12 : 11, `${where}${name}${run.nightShift ? ' · NIGHT' : ''}`, 8, run.nightShift ? '#c77dff' : '#e8e2d4', { ox: 0.5 }).setDepth(D + 1);
    this.leftText = txt(scene, TOUCH ? W - 68 : W - 52, TOUCH ? 12 : 11, '', 8, '#ff8a8a', { ox: 1 }).setDepth(D + 1);

    // pause button (works for mouse and touch); on phones the tap area is a 60x60 corner
    this.pauseBtn = scene.add.rectangle(W - 22, TOUCH ? 20 : 16, 30, 24, 0x14111c, 0.9).setStrokeStyle(2, 0x6b6580).setDepth(D);
    txt(scene, W - 22, TOUCH ? 21 : 17, 'II', 8, '#ffffff', { ox: 0.5, oy: 0.5 }).setDepth(D + 1);
    this.pauseHit = TOUCH ? scene.add.zone(W - PAUSE_HIT / 2, PAUSE_HIT / 2, PAUSE_HIT, PAUSE_HIT).setDepth(D + 3) : this.pauseBtn;
    this.pauseHit.setInteractive({ useHandCursor: true });

    // weapon slots
    this.slotW = TOUCH ? 200 : 150;
    this.slotUi = [0, 1].map((i) => {
      const x = 12 + i * (this.slotW + 8);
      const icon = scene.add.image(x + 22, H - BOT / 2, 'blank32').setDepth(D + 1).setScale(0.9);
      const name = txt(scene, x + 44, H - (TOUCH ? 41 : 26), '', 8, '#ffffff').setDepth(D + 1);
      const ammo = txt(scene, x + 44, H - (TOUCH ? 21 : 14), '', 8, '#ffe066').setDepth(D + 1);
      return { x, icon, name, ammo };
    });

    // armor slots
    this.armorUi = SLOTS.map((slot, i) => {
      const x = (TOUCH ? 440 : 340) + i * (TOUCH ? 36 : 30);
      const icon = scene.add.image(x + 13, H - BOT / 2, 'blank32').setDepth(D + 1).setScale(0.7);
      const lvl = txt(scene, x + (TOUCH ? 30 : 24), H - (TOUCH ? 18 : 10), '', 8, '#ffffff', { ox: 1, stroke: '#000', strokeThickness: 3 }).setDepth(D + 2);
      const empty = txt(scene, x + 13, H - BOT / 2 + 1, slot[0].toUpperCase(), 8, LOCKED, { ox: 0.5, oy: 0.5 }).setDepth(D + 1);
      return { slot, x, icon, lvl, empty };
    });

    // perks (right side, bottom)
    this.perkIcons = [];
    this.modIcons = [];
    this.refreshLoadout();

    // boss bar
    this.bossName = txt(scene, W / 2, TOUCH ? 46 : 40, '', 8, '#ff8a2a', { ox: 0.5 }).setDepth(D + 1).setVisible(false);
  }

  refreshLoadout() {
    const p = this.player;
    this.slotUi.forEach((ui, i) => {
      const s = p.slots[i];
      ui.icon.setTexture(s ? `gun_${s.id}` : 'blank32').setScale(s ? 29 / ui.icon.width : 0.9);
      ui.name.setText(s ? `${WEAPONS[s.id].short} L${s.lvl}` : 'EMPTY');
      ui.name.setColor(s ? '#ffffff' : LOCKED);
    });
    this.armorUi.forEach((ui) => {
      const a = this.run.armor[ui.slot];
      ui.icon.setTexture(a ? `arm_${a.id}` : 'blank32');
      ui.lvl.setText(a ? String(a.lvl) : '');
      ui.empty.setVisible(!a);
    });
    this.modIcons.forEach((i) => i.destroy());
    this.modIcons = (this.run.mods || []).map((m, i) => {
      const c = this.scene.add.container((TOUCH ? 568 : 452) + i * 26, H - BOT / 2).setDepth(D + 1);
      c.add([this.scene.add.image(0, 0, `mod_${m.id}`).setScale(0.7),
        txt(this.scene, 9, 7, String(m.lvl), 8, '#ffffff', { ox: 1, oy: 1, stroke: '#000', strokeThickness: 3 })]);
      return c;
    });
    this.perkIcons.forEach((i) => i.destroy());
    this.perkIcons = this.run.perks.map((id, i) =>
      this.scene.add.image(W - 22 - i * 28, H - BOT / 2, `perk_${id}`).setScale(0.75).setDepth(D + 1));
  }

  update(time, remaining, boss) {
    const g = this.g;
    const p = this.player;
    g.clear();

    // bands
    g.fillStyle(0x0d0b12, 0.78);
    g.fillRect(0, 0, W, TOP);
    g.fillRect(0, H - BOT, W, BOT);

    // HP
    const frac = Math.max(0, p.hp / p.stats.maxHp);
    const hb = TOUCH ? 22 : 16; // HP bar height
    g.fillStyle(0x2a1f2e, 1).fillRect(12, 4, 180, hb);
    g.fillStyle(frac > 0.5 ? 0x4ade80 : frac > 0.25 ? 0xffb84d : 0xff5f56, 1).fillRect(14, 6, 176 * frac, hb - 4);
    g.lineStyle(2, 0x000000, 1).strokeRect(12, 4, 180, hb);
    // medkit meter: fills with kills, a medkit drops when full
    const mf = Math.min(1, (this.run.meter || 0) / p.stats.meterNeed);
    const my = TOUCH ? 30 : 22;
    g.fillStyle(0x2a1f2e, 1).fillRect(12, my, 180, 5);
    // pulses when nearly full (steady with reduced motion)
    const pulse = mf > 0.85 ? (REDUCED ? 1 : Math.abs(Math.sin(time / 150))) : 0;
    g.fillStyle(0x4ade80, 0.55 + 0.45 * pulse).fillRect(13, my + 1, 178 * mf, 3);
    this.hpText.setText(`HP ${Math.ceil(p.hp)}/${p.stats.maxHp}`);
    // shove recharge dot
    const sh = Math.min(1, (time - p.lastMelee) / p.stats.meleeCd);
    g.fillStyle(sh >= 1 ? 0xffffff : 0x4a4560, 1).fillCircle(204, TOUCH ? 18 : 15, sh >= 1 ? 5 : 2 + 3 * sh);
    const label = typeof remaining === 'string';
    this.leftText.setText(label ? remaining : remaining > 0 ? `ZOMBIES ${remaining}` : 'CLEAR');
    this.leftText.setColor(label ? '#ffb84d' : remaining > 0 ? '#ff8a8a' : TEAL_HEX);

    // weapon slots
    this.slotUi.forEach((ui, i) => {
      const s = p.slots[i];
      const activeSlot = i === p.slotIdx;
      const sh2 = BOT - 6, sw = this.slotW;
      g.fillStyle(0x14111c, 0.95).fillRect(ui.x, H - BOT + 3, sw, sh2);
      g.lineStyle(2, activeSlot ? TEAL : 0x3a3550, 1).strokeRect(ui.x, H - BOT + 3, sw, sh2);
      if (!s) { ui.ammo.setText(''); return; }
      if (s.reloadEnd > time) {
        const t = 1 - (s.reloadEnd - time) / s.st.reloadMs;
        g.fillStyle(0xffe066, 0.35).fillRect(ui.x + 2, H - BOT + 5, (sw - 4) * t, sh2 - 4);
        ui.ammo.setText('RELOADING');
      } else {
        ui.ammo.setText(`${s.ammo}/${s.st.mag}`);
      }
    });

    // armor boxes
    this.armorUi.forEach((ui) => {
      const bs = TOUCH ? 32 : 26;
      g.fillStyle(0x14111c, 0.95).fillRect(ui.x, H - BOT / 2 - bs / 2, bs, bs);
      g.lineStyle(2, 0x3a3550, 1).strokeRect(ui.x, H - BOT / 2 - bs / 2, bs, bs);
    });

    // boss bar
    if (boss && boss.alive) {
      this.bossName.setVisible(true).setText(boss.bossName);
      const bf = Math.max(0, boss.hp / boss.maxHp);
      const by = TOUCH ? 66 : 52;
      g.fillStyle(0x2a1f2e, 1).fillRect(W / 2 - 180, by, 360, 10);
      g.fillStyle(0xff8a2a, 1).fillRect(W / 2 - 179, by + 1, 358 * bf, 8);
      g.lineStyle(2, 0x000000, 1).strokeRect(W / 2 - 180, by, 360, 10);
    } else {
      this.bossName.setVisible(false);
    }
  }

  banner(title, sub) {
    const s = this.scene;
    const a = txt(s, W / 2, H / 2 - 30, title, 24, '#ffffff', { ox: 0.5, oy: 0.5, stroke: '#000', strokeThickness: 6 }).setDepth(D + 5);
    const b = txt(s, W / 2, H / 2 + 8, sub, 10, TEAL_HEX, { ox: 0.5, oy: 0.5, stroke: '#000', strokeThickness: 4 }).setDepth(D + 5);
    s.tweens.add({ targets: [a, b], alpha: 0, delay: 1500, duration: 500, onComplete: () => { a.destroy(); b.destroy(); } });
  }

  toast(msg, color = '#ffffff') {
    const s = this.scene;
    const t = txt(s, W / 2, TOUCH ? 96 : 84, msg, 10, color, { ox: 0.5, oy: 0.5, stroke: '#000', strokeThickness: 4 }).setDepth(D + 5);
    s.tweens.add({ targets: t, y: t.y - 10, alpha: 0, delay: 1200, duration: 500, onComplete: () => t.destroy() });
  }
}
