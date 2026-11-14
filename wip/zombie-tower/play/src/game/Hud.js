// Heads-up display: health, floor, zombies left, weapons, armor, perks, boss bar,
// plus banners and toasts.

import { W, H, txt, TEAL, TEAL_HEX } from '../config.js';
import { SLOTS } from '../data/armor.js';
import { WEAPONS } from '../data/weapons.js';

const D = 1000; // HUD depth

export class Hud {
  constructor(scene, player, run, floorDef) {
    this.scene = scene;
    this.player = player;
    this.run = run;
    this.g = scene.add.graphics().setDepth(D);

    // top bar
    this.hpText = txt(scene, 102, 10, '', 8, '#ffffff', { ox: 0.5 }).setDepth(D + 1);
    const where = run.mode === 'elevator' ? `STOP ${run.step + 1}/${run.route.length}` : `FLOOR ${run.floor}`;
    this.floorText = txt(scene, W / 2, 11, `${where} · ${floorDef.name.toUpperCase()}${run.nightShift ? ' · NIGHT' : ''}`, 8, run.nightShift ? '#c77dff' : '#e8e2d4', { ox: 0.5 }).setDepth(D + 1);
    this.leftText = txt(scene, W - 52, 11, '', 8, '#ff8a8a', { ox: 1 }).setDepth(D + 1);

    // pause button (works for mouse and touch)
    this.pauseBtn = scene.add.rectangle(W - 22, 16, 30, 24, 0x14111c, 0.9).setStrokeStyle(2, 0x6b6580).setDepth(D);
    txt(scene, W - 22, 17, 'II', 8, '#ffffff', { ox: 0.5, oy: 0.5 }).setDepth(D + 1);
    this.pauseBtn.setInteractive({ useHandCursor: true });

    // weapon slots
    this.slotUi = [0, 1].map((i) => {
      const x = 12 + i * 158;
      const icon = scene.add.image(x + 22, H - 16, 'blank32').setDepth(D + 1).setScale(0.9);
      const name = txt(scene, x + 44, H - 26, '', 8, '#ffffff').setDepth(D + 1);
      const ammo = txt(scene, x + 44, H - 14, '', 8, '#ffe066').setDepth(D + 1);
      return { x, icon, name, ammo };
    });

    // armor slots
    this.armorUi = SLOTS.map((slot, i) => {
      const x = 340 + i * 30;
      const icon = scene.add.image(x + 13, H - 16, 'blank32').setDepth(D + 1).setScale(0.7);
      const lvl = txt(scene, x + 24, H - 10, '', 8, '#ffffff', { ox: 1, stroke: '#000', strokeThickness: 3 }).setDepth(D + 2);
      const empty = txt(scene, x + 13, H - 15, slot[0].toUpperCase(), 8, '#4a4560', { ox: 0.5, oy: 0.5 }).setDepth(D + 1);
      return { slot, x, icon, lvl, empty };
    });

    // perks (right side, bottom)
    this.perkIcons = [];
    this.modIcons = [];
    this.refreshLoadout();

    // boss bar
    this.bossName = txt(scene, W / 2, 40, '', 8, '#ff8a2a', { ox: 0.5 }).setDepth(D + 1).setVisible(false);
  }

  refreshLoadout() {
    const p = this.player;
    this.slotUi.forEach((ui, i) => {
      const s = p.slots[i];
      ui.icon.setTexture(s ? `gun_${s.id}` : 'blank32').setScale(s ? 29 / ui.icon.width : 0.9);
      ui.name.setText(s ? `${WEAPONS[s.id].short} L${s.lvl}` : 'EMPTY');
      ui.name.setColor(s ? '#ffffff' : '#4a4560');
    });
    this.armorUi.forEach((ui) => {
      const a = this.run.armor[ui.slot];
      ui.icon.setTexture(a ? `arm_${a.id}` : 'blank32');
      ui.lvl.setText(a ? String(a.lvl) : '');
      ui.empty.setVisible(!a);
    });
    this.modIcons.forEach((i) => i.destroy());
    this.modIcons = (this.run.mods || []).map((m, i) => {
      const c = this.scene.add.container(452 + i * 26, H - 16).setDepth(D + 1);
      c.add([this.scene.add.image(0, 0, `mod_${m.id}`).setScale(0.7),
        txt(this.scene, 9, 7, String(m.lvl), 8, '#ffffff', { ox: 1, oy: 1, stroke: '#000', strokeThickness: 3 })]);
      return c;
    });
    this.perkIcons.forEach((i) => i.destroy());
    this.perkIcons = this.run.perks.map((id, i) =>
      this.scene.add.image(W - 22 - i * 28, H - 16, `perk_${id}`).setScale(0.75).setDepth(D + 1));
  }

  update(time, remaining, boss) {
    const g = this.g;
    const p = this.player;
    g.clear();

    // bands
    g.fillStyle(0x0d0b12, 0.78);
    g.fillRect(0, 0, W, 30);
    g.fillRect(0, H - 32, W, 32);

    // HP
    const frac = Math.max(0, p.hp / p.stats.maxHp);
    g.fillStyle(0x2a1f2e, 1).fillRect(12, 4, 180, 16);
    g.fillStyle(frac > 0.5 ? 0x4ade80 : frac > 0.25 ? 0xffb84d : 0xff5f56, 1).fillRect(14, 6, 176 * frac, 12);
    g.lineStyle(2, 0x000000, 1).strokeRect(12, 4, 180, 16);
    // medkit meter: fills with kills, a medkit drops when full
    const mf = Math.min(1, (this.run.meter || 0) / p.stats.meterNeed);
    g.fillStyle(0x2a1f2e, 1).fillRect(12, 22, 180, 5);
    g.fillStyle(0x4ade80, 0.55 + 0.45 * (mf > 0.85 ? Math.abs(Math.sin(time / 150)) : 0)).fillRect(13, 23, 178 * mf, 3);
    this.hpText.setText(`HP ${Math.ceil(p.hp)}/${p.stats.maxHp}`);
    // shove recharge dot
    const sh = Math.min(1, (time - p.lastMelee) / p.stats.meleeCd);
    g.fillStyle(sh >= 1 ? 0xffffff : 0x4a4560, 1).fillCircle(204, 15, sh >= 1 ? 5 : 2 + 3 * sh);
    const label = typeof remaining === 'string';
    this.leftText.setText(label ? remaining : remaining > 0 ? `ZOMBIES ${remaining}` : 'CLEAR');
    this.leftText.setColor(label ? '#ffb84d' : remaining > 0 ? '#ff8a8a' : TEAL_HEX);

    // weapon slots
    this.slotUi.forEach((ui, i) => {
      const s = p.slots[i];
      const activeSlot = i === p.slotIdx;
      g.fillStyle(0x14111c, 0.95).fillRect(ui.x, H - 29, 150, 26);
      g.lineStyle(2, activeSlot ? TEAL : 0x3a3550, 1).strokeRect(ui.x, H - 29, 150, 26);
      if (!s) { ui.ammo.setText(''); return; }
      if (s.reloadEnd > time) {
        const t = 1 - (s.reloadEnd - time) / s.st.reloadMs;
        g.fillStyle(0xffe066, 0.35).fillRect(ui.x + 2, H - 27, 146 * t, 22);
        ui.ammo.setText('RELOADING');
      } else {
        ui.ammo.setText(`${s.ammo}/${s.st.mag}`);
      }
    });

    // armor boxes
    this.armorUi.forEach((ui) => {
      g.fillStyle(0x14111c, 0.95).fillRect(ui.x, H - 29, 26, 26);
      g.lineStyle(2, 0x3a3550, 1).strokeRect(ui.x, H - 29, 26, 26);
    });

    // boss bar
    if (boss && boss.alive) {
      this.bossName.setVisible(true).setText(boss.bossName);
      const bf = Math.max(0, boss.hp / boss.maxHp);
      g.fillStyle(0x2a1f2e, 1).fillRect(W / 2 - 180, 52, 360, 10);
      g.fillStyle(0xff8a2a, 1).fillRect(W / 2 - 179, 53, 358 * bf, 8);
      g.lineStyle(2, 0x000000, 1).strokeRect(W / 2 - 180, 52, 360, 10);
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
    const t = txt(s, W / 2, 84, msg, 10, color, { ox: 0.5, oy: 0.5, stroke: '#000', strokeThickness: 4 }).setDepth(D + 5);
    s.tweens.add({ targets: t, y: 74, alpha: 0, delay: 1200, duration: 500, onComplete: () => t.destroy() });
  }
}
