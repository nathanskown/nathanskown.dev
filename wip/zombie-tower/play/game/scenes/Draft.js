// Between floors: pick 1 of 3 cards (gear after normal floors, perks after bosses).

import { W, H, TEAL, TEAL_HEX, MAX_BUILT_FLOOR, txt, button } from '../config.js';
import { gearDraft, perkDraft, needsReplaceChoice, applyCard } from '../game/cards.js';
import { derived, saveCheckpoint, isElevator, ELEVATOR_PERK_AFTER } from '../state/run.js';
import { MOD_BY_ID } from '../data/mods.js';
import { CREW_BY_ID } from '../data/crew.js';
import { WEAPONS } from '../data/weapons.js';
import { themeFor, FLOORS } from '../data/floors.js';
import { ARMOR } from '../data/armor.js';

const KIND_COLOR = { weapon: 0xff8a2a, armor: 0x66a3ff, perk: TEAL, mod: 0xc77dff };
const KIND_HEX = { weapon: '#ff8a2a', armor: '#66a3ff', perk: TEAL_HEX, mod: '#c77dff' };

export class DraftScene extends Phaser.Scene {
  constructor() { super('Draft'); }

  init(data) {
    this.run = data.run;
    this.kind = data.kind; // 'gear' | 'perk'
    this.second = !!data.second; // Elevator Run: second pick after the same stop
    this.locked = false;
    this.replacePanel = null; // the scene object is reused between drafts
  }

  create() {
    this.cameras.main.fadeIn(250, 0, 0, 0);
    this.add.tileSprite(W / 2, H / 2, W, H, `floor_${themeFor(Math.min(50, this.run.floor + 1))}`).setAlpha(0.25);
    this.add.rectangle(W / 2, H / 2, W, H, 0x0d0b12, 0.7);

    const isPerk = this.kind === 'perk';
    const elev = isElevator(this.run);
    const head = isPerk && !elev ? 'BOSS DEFEATED' : elev ? `STOP ${this.run.step + 1} CLEARED` : `FLOOR ${this.run.floor} CLEARED`;
    txt(this, W / 2, 34, head, 18, isPerk ? '#ff8a2a' : '#ffffff', { ox: 0.5 });
    const sub = isPerk ? 'CHOOSE A PERK' : elev ? `PICK ${this.second ? 2 : 1} OF 2` : 'CHOOSE ONE: WEAPON, ARMOR OR MOD';
    txt(this, W / 2, 64, sub, 10, TEAL_HEX, { ox: 0.5 });

    const nextFloor = elev ? this.run.route[this.run.step + 1] || this.run.floor : this.run.floor + 1;
    const cards = isPerk ? perkDraft(this.run) : gearDraft(this.run, elev ? Math.max(nextFloor, this.run.step * 2 + 2) : nextFloor);
    if (!cards.length) { this.proceed(); return; }

    const cw = 224, ch = 270, gap = 20;
    const total = cards.length * cw + (cards.length - 1) * gap;
    cards.forEach((card, i) => {
      const x = (W - total) / 2 + cw / 2 + i * (cw + gap);
      this.makeCard(card, x, 96 + ch / 2, cw, ch, i);
    });

    // hotkeys 1-3
    this.input.keyboard.on('keydown', (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= cards.length && !this.replacePanel) this.choose(cards[n - 1]);
    });

    // footer: current loadout
    const w = this.run.weapons.map((s) => (s ? `${WEAPONS[s.id].name} L${s.lvl}` : '—')).join('  |  ');
    const a = Object.values(this.run.armor).filter(Boolean).map((p) => `${ARMOR[p.id].name} L${p.lvl}`).join(', ') || 'none';
    const mods = (this.run.mods || []).map((m) => `${MOD_BY_ID[m.id].name} L${m.lvl}`).join(', ') || 'none';
    const crew = (this.run.crew || []).map((id) => CREW_BY_ID[id].name).join(', ');
    txt(this, W / 2, H - 98, `GUNS: ${w}`, 8, '#b9b4c9', { ox: 0.5 });
    txt(this, W / 2, H - 82, `ARMOR: ${a}`, 8, '#b9b4c9', { ox: 0.5 });
    txt(this, W / 2, H - 66, `MODS: ${mods}`, 8, '#c77dff', { ox: 0.5 });
    if (crew) txt(this, W / 2, H - 50, `CREW: ${crew}`, 8, '#ffc27f', { ox: 0.5 });
    const foot = isPerk ? (elev ? 'FULL HEAL AFTER THIS PICK' : 'CHECKPOINT SAVES AFTER THIS PICK · FULL HEAL')
      : elev && !this.second ? 'ONE MORE PICK AFTER THIS' : 'YOU HEAL 25% AFTER PICKING';
    txt(this, W / 2, H - 16, foot, 8, '#4ade80', { ox: 0.5 });
  }

  makeCard(card, x, y, w, h, i) {
    const color = KIND_COLOR[card.kind];
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, 0x14111c, 1).setStrokeStyle(3, color);
    const band = this.add.rectangle(0, -h / 2 + 14, w - 6, 22, color, 0.25);
    const tag = card.kind === 'perk' ? 'PERK'
      : `${card.kind.toUpperCase()} · ${card.upgrade ? `UPGRADE L${card.toLvl}` : card.toLvl > 1 ? `NEW L${card.toLvl}` : 'NEW'}`;
    const tagT = txt(this, 0, -h / 2 + 14, tag, 8, KIND_HEX[card.kind], { ox: 0.5, oy: 0.5 });
    const icon = this.add.image(0, -h / 2 + 76, card.icon);
    icon.setScale(card.kind === 'weapon' ? 96 / icon.width : 2.4);
    const title = txt(this, 0, -h / 2 + 122, card.title.toUpperCase(), 10, '#ffffff', { ox: 0.5, align: 'center', wrap: w - 20 });
    const desc = txt(this, 0, -h / 2 + 146, card.desc, 8, '#b9b4c9', { ox: 0.5, align: 'center', wrap: w - 24 });
    const lines = txt(this, 0, -h / 2 + 196, card.lines.join('\n'), 8, '#ffe066', { ox: 0.5, align: 'center' });
    const key = txt(this, 0, h / 2 - 16, `[${i + 1}]`, 8, '#6b6580', { ox: 0.5, oy: 0.5 });
    c.add([bg, band, tagT, icon, title, desc, lines, key]);

    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => { bg.setFillStyle(0x221c30, 1); this.tweens.add({ targets: c, scale: 1.03, duration: 80 }); });
    bg.on('pointerout', () => { bg.setFillStyle(0x14111c, 1); this.tweens.add({ targets: c, scale: 1, duration: 80 }); });
    bg.on('pointerdown', () => this.choose(card));

    c.setAlpha(0).setY(y + 20);
    this.tweens.add({ targets: c, alpha: 1, y, delay: 80 * i, duration: 220 });
  }

  choose(card) {
    if (this.locked) return;
    if (needsReplaceChoice(this.run, card)) { this.showReplace(card); return; }
    this.finish(card, null);
  }

  showReplace(card) {
    const objs = [];
    objs.push(this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.7).setInteractive());
    objs.push(this.add.rectangle(W / 2, H / 2, 420, 220, 0x14111c, 1).setStrokeStyle(3, 0xff8a2a));
    objs.push(txt(this, W / 2, H / 2 - 80, `TAKE ${WEAPONS[card.id].name.toUpperCase()}?`, 10, '#ffffff', { ox: 0.5 }));
    objs.push(txt(this, W / 2, H / 2 - 58, 'YOUR HANDS ARE FULL. DROP ONE:', 8, '#b9b4c9', { ox: 0.5 }));
    this.run.weapons.forEach((s, i) => {
      objs.push(button(this, W / 2, H / 2 - 14 + i * 50, `DROP ${WEAPONS[s.id].name.toUpperCase()} L${s.lvl}`, () => this.finish(card, i), { w: 360, color: 0xff8a2a, size: 8 }));
    });
    objs.push(button(this, W / 2, H / 2 + 82, 'CANCEL', () => { objs.forEach((o) => o.destroy()); this.replacePanel = null; }, { w: 160, color: 0x6b6580, size: 8 }));
    this.replacePanel = objs;
  }

  finish(card, replaceSlot) {
    if (this.locked) return;
    this.locked = true;
    applyCard(this.run, card, replaceSlot);
    this.proceed();
  }

  proceed() {
    const run = this.run;
    if (isElevator(run)) { this.proceedElevator(); return; }
    run.floor += 1;
    const maxHp = derived(run).maxHp;
    if (this.kind === 'perk') {
      run.hp = maxHp;
      saveCheckpoint(run);
    } else if (run.floor % 10 === 6) {
      // Halfway through each zone: a second checkpoint, so a death costs at most 5 floors.
      run.hp = Math.min(maxHp, run.hp + Math.round(maxHp * 0.25));
      saveCheckpoint(run);
    } else if (FLOORS[run.floor]?.boss) {
      run.hp = maxHp; // walk into every boss fight at full health
    } else {
      run.hp = Math.min(maxHp, run.hp + Math.round(maxHp * 0.25));
    }
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      if (run.floor > MAX_BUILT_FLOOR) this.scene.start('End', { mode: 'zoneClear', run });
      else this.scene.start('Game', { run });
    });
  }

  proceedElevator() {
    const run = this.run;
    if (this.kind === 'gear' && !this.second) {
      this.cameras.main.fadeOut(150, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart({ run, kind: 'gear', second: true }));
      return;
    }
    if (this.kind === 'gear' && run.step === ELEVATOR_PERK_AFTER && !run.perkTaken) {
      run.perkTaken = true;
      this.cameras.main.fadeOut(150, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart({ run, kind: 'perk' }));
      return;
    }
    run.step += 1;
    run.floor = run.route[run.step];
    const maxHp = derived(run).maxHp;
    if (this.kind === 'perk' || FLOORS[run.floor]?.boss) run.hp = maxHp;
    else run.hp = Math.min(maxHp, run.hp + Math.round(maxHp * 0.25));
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Game', { run }));
  }
}
