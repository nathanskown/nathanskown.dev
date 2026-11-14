// Builds the 3-card drafts and applies a chosen card to the run.

import { WEAPONS, MAX_LVL, weaponLines, newWeaponWeight } from '../data/weapons.js';
import { ARMOR, ARMOR_MAX_LVL, armorLines } from '../data/armor.js';
import { PERKS } from '../data/perks.js';
import { MODS, MOD_BY_ID, MOD_MAX_LVL, MAX_MODS } from '../data/mods.js';
import { derived, cloneRun } from '../state/run.js';

// New guns show up near the level of your best gun, so switching is a real option.
export function newGunLevel(run) {
  const best = Math.max(1, ...run.weapons.filter(Boolean).map((w) => w.lvl));
  return Math.max(1, best - 3);
}

function weightedPick(list) {
  const total = list.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * total;
  for (const c of list) { r -= c.weight; if (r <= 0) return c; }
  return list[list.length - 1];
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function weaponCandidates(run, floor) {
  const out = [];
  for (const w of Object.values(WEAPONS)) {
    const owned = run.weapons.find((s) => s && s.id === w.id);
    if (owned) {
      if (owned.lvl < MAX_LVL) {
        out.push({ kind: 'weapon', id: w.id, upgrade: true, toLvl: owned.lvl + 1, weight: 8 });
      }
    } else if (newWeaponWeight(w, floor) > 0) {
      out.push({ kind: 'weapon', id: w.id, upgrade: false, toLvl: newGunLevel(run), weight: newWeaponWeight(w, floor) });
    }
  }
  return out;
}

function armorCandidates(run, floor) {
  const out = [];
  for (const a of Object.values(ARMOR)) {
    const worn = run.armor[a.slot];
    if (worn && worn.id === a.id) {
      if (worn.lvl < ARMOR_MAX_LVL) out.push({ kind: 'armor', id: a.id, upgrade: true, toLvl: worn.lvl + 1, weight: 6 });
    } else if (floor >= a.minFloor) {
      // empty slots are more likely to be offered
      out.push({ kind: 'armor', id: a.id, upgrade: false, toLvl: 1, weight: a.weight * (worn ? 0.6 : 1.4) });
    }
  }
  return out;
}

function modCandidates(run, floor) {
  const out = [];
  const mods = run.mods || [];
  for (const m of MODS) {
    const own = mods.find((x) => x.id === m.id);
    if (own) { if (own.lvl < MOD_MAX_LVL) out.push({ kind: 'mod', id: m.id, upgrade: true, toLvl: own.lvl + 1, weight: 6 }); }
    else if (mods.length < MAX_MODS && floor >= m.minFloor) out.push({ kind: 'mod', id: m.id, upgrade: false, toLvl: 1, weight: 5 });
  }
  return out;
}

function describe(card, run) {
  if (card.kind === 'mod') {
    const m = MOD_BY_ID[card.id];
    return { ...card, title: m.name, desc: m.desc(card.toLvl), icon: `mod_${card.id}`,
      lines: [`LEVEL ${card.toLvl}/${MOD_MAX_LVL}`, 'WORKS ON BOTH GUNS'] };
  }
  if (card.kind === 'weapon') {
    const w = WEAPONS[card.id];
    return { ...card, title: w.name, desc: w.desc, icon: `gun_${card.id}`, lines: weaponLines(card.id, card.toLvl) };
  }
  if (card.kind === 'armor') {
    const a = ARMOR[card.id];
    const worn = run.armor[a.slot];
    const replaces = !card.upgrade && worn ? `Replaces ${ARMOR[worn.id].name}` : null;
    const after = cloneRun(run);
    applyCard(after, card);
    const total = `TOTAL DEF ${derived(run).defense} > ${derived(after).defense}`;
    return { ...card, title: a.name, desc: replaces || a.desc, icon: `arm_${card.id}`, lines: [total, ...armorLines(card.id, card.toLvl)] };
  }
  const p = PERKS.find((x) => x.id === card.id);
  return { ...card, title: p.name, desc: p.desc, icon: `perk_${card.id}`, lines: [] };
}

// 3 gear cards: one weapon, one armor, one of either (when possible).
export function gearDraft(run, floor) {
  const weapons = weaponCandidates(run, floor);
  const armor = armorCandidates(run, floor);
  const picks = [];
  const take = (pool) => {
    const left = pool.filter((c) => !picks.some((p) => p.kind === c.kind && p.id === c.id));
    if (!left.length) return false;
    picks.push(weightedPick(left));
    return true;
  };
  const mods = modCandidates(run, floor);
  take(weapons);
  take(armor);
  // third card: a mod about 40% of the time, otherwise weapon or armor
  while (picks.length < 3) {
    const r = Math.random();
    const pool = mods.length && r < 0.4 ? mods : r < 0.7 ? weapons : armor;
    if (!take(pool) && !take(weapons) && !take(armor) && !take(mods)) break;
  }
  return shuffle(picks).map((c) => describe(c, run));
}

export function perkDraft(run) {
  const left = shuffle(PERKS.filter((p) => !run.perks.includes(p.id)));
  return left.slice(0, 3).map((p) => describe({ kind: 'perk', id: p.id, upgrade: false, toLvl: 1 }, run));
}

// True when taking this card needs the player to choose which weapon to drop.
export function needsReplaceChoice(run, card) {
  return card.kind === 'weapon' && !card.upgrade && run.weapons.every((w) => w);
}

export function applyCard(run, card, replaceSlot = null) {
  if (card.kind === 'weapon') {
    if (card.upgrade) {
      run.weapons.find((w) => w && w.id === card.id).lvl = card.toLvl;
    } else {
      let slot = run.weapons.findIndex((w) => !w);
      if (slot === -1) slot = replaceSlot ?? 1;
      run.weapons[slot] = { id: card.id, lvl: card.toLvl || 1 };
      run.activeSlot = slot;
    }
  } else if (card.kind === 'armor') {
    const slot = ARMOR[card.id].slot;
    if (card.upgrade) run.armor[slot].lvl = card.toLvl;
    else run.armor[slot] = { id: card.id, lvl: 1 };
  } else if (card.kind === 'mod') {
    run.mods ||= [];
    const own = run.mods.find((m) => m.id === card.id);
    if (own) own.lvl = card.toLvl;
    else run.mods.push({ id: card.id, lvl: 1 });
  } else if (card.kind === 'perk') {
    if (!run.perks.includes(card.id)) run.perks.push(card.id);
  }
}
