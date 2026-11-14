// Code-drawn environment art for every theme: floors (with variants), walls, wall faces
// with details, props, hazards, decals, and the lighting textures.
// Real art can replace any key via manifest.js, same as the characters.

import { canvasTexture, seeded } from './pixel.js';
import { TILE } from '../config.js';
import { THEMES } from './themes.js';

const T = TILE;
const K = '#241a2e';

const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
const E = (ctx, x, y, rx, ry, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };
const blob = (ctx, rand, cx, cy, size, c, n = 6) => {
  for (let i = 0; i < n; i++) E(ctx, cx + (rand() - 0.5) * size, cy + (rand() - 0.5) * size * 0.6, 2 + rand() * size * 0.35, 2 + rand() * size * 0.25, c);
};

export function makeTiles(scene) {
  for (const [name, th] of Object.entries(THEMES)) themeTiles(scene, name, th);
  props(scene);
  decals(scene);
  lighting(scene);
}

// ------------------------------------------------------------------ floors
function floorBase(ctx, th, rand) {
  const [a1, a2, a3] = [th.floorAlt[0], th.floorAlt[1] || th.floorAlt[0], th.floorAlt[2] || th.floorAlt[0]];
  R(ctx, 0, 0, T, T, th.floor);
  switch (th.pattern) {
    case 'concrete':
      for (let i = 0; i < 30; i++) R(ctx, Math.floor(rand() * 16) * 2, Math.floor(rand() * 16) * 2, 2, 2, [a1, a2, a3][i % 3]);
      R(ctx, 0, 0, T, 1, 'rgba(0,0,0,0.18)');
      R(ctx, 0, 0, 1, T, 'rgba(0,0,0,0.18)');
      break;
    case 'checker':
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) R(ctx, x * 16, y * 16, 16, 16, (x + y) % 2 ? a1 : th.floor);
      R(ctx, 0, 15, T, 1, 'rgba(0,0,0,0.08)');
      R(ctx, 15, 0, 1, T, 'rgba(0,0,0,0.08)');
      R(ctx, 3, 4, 3, 2, 'rgba(255,255,255,0.35)');
      break;
    case 'carpet':
      for (let y = 1; y < T; y += 4) for (let x = (y % 8) === 1 ? 1 : 3; x < T; x += 4) R(ctx, x, y, 1, 1, a1);
      for (let i = 0; i < 10; i++) R(ctx, Math.floor(rand() * 32), Math.floor(rand() * 32), 2, 1, a2);
      R(ctx, 0, 0, T, 1, 'rgba(0,0,0,0.25)');
      R(ctx, 0, 0, 1, T, 'rgba(0,0,0,0.25)');
      break;
    case 'tile':
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        R(ctx, x * 16, y * 16, 16, 16, (x + y) % 2 ? a1 : th.floor);
        R(ctx, x * 16 + 2, y * 16 + 2, 4, 1, 'rgba(255,255,255,0.5)');
      }
      R(ctx, 0, 0, T, 1, '#9fabb0'); R(ctx, 0, 16, T, 1, '#9fabb0');
      R(ctx, 0, 0, 1, T, '#9fabb0'); R(ctx, 16, 0, 1, T, '#9fabb0');
      break;
    case 'grate':
      for (let y = 0; y < T; y += 8) for (let x = 0; x < T; x += 8) {
        R(ctx, x + 1, y + 1, 6, 6, a1);
        R(ctx, x + 2, y + 2, 4, 1, a3);
        R(ctx, x + 1, y + 6, 6, 1, 'rgba(0,0,0,0.35)');
      }
      R(ctx, 1, 1, 2, 2, '#5a6068'); R(ctx, 29, 1, 2, 2, '#5a6068'); R(ctx, 1, 29, 2, 2, '#5a6068'); R(ctx, 29, 29, 2, 2, '#5a6068');
      break;
    case 'wood':
      for (let r = 0; r < 4; r++) {
        R(ctx, 0, r * 8, T, 8, [th.floor, a1, a3, a1][r]);
        R(ctx, 0, r * 8 + 7, T, 1, 'rgba(0,0,0,0.35)');
        const end = Math.floor(rand() * 28) + 2;
        R(ctx, end, r * 8, 1, 7, 'rgba(0,0,0,0.3)');
        R(ctx, (end + 9) % 30, r * 8 + 3, 4, 1, 'rgba(255,255,255,0.06)');
      }
      break;
    case 'gravel':
      for (let i = 0; i < 70; i++) R(ctx, Math.floor(rand() * 32), Math.floor(rand() * 32), 1 + Math.floor(rand() * 2), 1, [a1, a2, a3, '#6c6f75'][i % 4]);
      break;
    default:
      break;
  }
}

function floorVariant(ctx, th, v, rand) {
  if (v === 1) { // crack
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    let x = 4 + rand() * 8, y = 6 + rand() * 6;
    for (let i = 0; i < 9; i++) { ctx.fillRect(Math.floor(x), Math.floor(y), 2, 1); x += 2 + rand() * 2; y += (rand() - 0.4) * 4; }
  } else if (v === 2) { // stain
    ctx.globalAlpha = 0.45;
    blob(ctx, rand, 16, 17, 16, th.stain, 5);
    ctx.globalAlpha = 1;
  } else if (v === 3) { // drain / worn patch
    if (['concrete', 'tile', 'gravel', 'grate'].includes(th.pattern)) {
      R(ctx, 10, 10, 12, 12, K);
      R(ctx, 11, 11, 10, 10, '#2a2c30');
      for (let i = 0; i < 4; i++) R(ctx, 12 + i * 2 + i, 12, 1, 8, '#5a5e64');
    } else {
      ctx.globalAlpha = 0.25;
      blob(ctx, rand, 16, 16, 18, '#ffffff', 4);
      ctx.globalAlpha = 1;
    }
  }
}

// ------------------------------------------------------------------- walls
function wallTop(ctx, th) {
  R(ctx, 0, 0, T, T, th.wallTop);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  if (th.wallPattern === 'block') {
    for (let r = 0; r < 4; r++) { const off = r % 2 ? 8 : 0; for (let c = -1; c < 3; c++) ctx.fillRect(c * 16 + off + 1, r * 8 + 1, 14, 6); }
  } else if (th.wallPattern === 'wood') {
    for (let x = 0; x < T; x += 8) R(ctx, x, 0, 2, T, 'rgba(0,0,0,0.2)');
  } else if (th.wallPattern === 'panel') {
    R(ctx, 2, 2, 28, 28, 'rgba(255,255,255,0.06)');
    R(ctx, 3, 3, 2, 2, 'rgba(0,0,0,0.3)'); R(ctx, 27, 27, 2, 2, 'rgba(0,0,0,0.3)');
  }
  R(ctx, 0, 0, T, 2, th.wallHi);
}

// A wall seen from the front (walls with open floor below them).
function wallFace(ctx, th, detail) {
  R(ctx, 0, 0, T, 9, th.wallTop);
  R(ctx, 0, 0, T, 2, th.wallHi);
  R(ctx, 0, 8, T, 1, 'rgba(0,0,0,0.5)');
  R(ctx, 0, 9, T, 21, th.face);
  if (th.wallPattern === 'block') for (let y = 13; y < 30; y += 6) R(ctx, 0, y, T, 1, 'rgba(0,0,0,0.12)');
  else if (th.wallPattern === 'wood') for (let x = 3; x < T; x += 8) R(ctx, x, 9, 1, 21, 'rgba(0,0,0,0.18)');
  else if (th.wallPattern === 'panel') { R(ctx, 0, 19, T, 1, 'rgba(0,0,0,0.2)'); R(ctx, 15, 9, 1, 21, 'rgba(0,0,0,0.15)'); }
  R(ctx, 0, 28, T, 2, th.faceDark);
  R(ctx, 0, 30, T, 2, 'rgba(0,0,0,0.55)');
  if (detail) FACE_DETAILS[detail](ctx, th);
}

const FACE_DETAILS = {
  pipes: (ctx) => {
    R(ctx, 0, 11, T, 4, '#6a7078'); R(ctx, 0, 11, T, 1, '#9aa0a8');
    R(ctx, 0, 18, T, 3, '#7a4a30'); R(ctx, 0, 18, T, 1, '#a0694a');
    R(ctx, 20, 10, 4, 6, '#3a3f46'); R(ctx, 19, 9, 6, 2, '#c03030');
  },
  signLevel: (ctx, th) => {
    R(ctx, 7, 11, 18, 13, K); R(ctx, 8, 12, 16, 11, th.accent);
    R(ctx, 12, 14, 2, 7, K); R(ctx, 14, 14, 4, 2, K); R(ctx, 17, 15, 2, 2, K); R(ctx, 14, 17, 4, 2, K);
  },
  extinguisher: (ctx) => {
    R(ctx, 12, 12, 9, 14, K); R(ctx, 13, 13, 7, 12, '#c8302a'); R(ctx, 14, 14, 2, 8, '#ff6a5a');
    R(ctx, 14, 10, 5, 3, '#333'); R(ctx, 19, 11, 4, 2, '#222');
  },
  signExit: (ctx) => {
    R(ctx, 7, 12, 18, 9, K); R(ctx, 8, 13, 16, 7, '#1f9f4a');
    R(ctx, 10, 15, 3, 3, '#e8ffe8'); R(ctx, 15, 15, 2, 3, '#e8ffe8'); R(ctx, 19, 15, 3, 3, '#e8ffe8');
    R(ctx, 8, 21, 16, 3, 'rgba(60,255,120,0.25)');
  },
  painting: (ctx) => {
    R(ctx, 6, 11, 20, 15, '#8a6a2a'); R(ctx, 7, 12, 18, 13, '#c9a84a');
    R(ctx, 9, 14, 14, 9, '#5a7aa0'); R(ctx, 9, 19, 14, 4, '#3f6a3a'); R(ctx, 17, 15, 3, 3, '#f2e6a0');
  },
  sconce: (ctx) => {
    E(ctx, 16, 16, 9, 7, 'rgba(255,220,150,0.25)');
    R(ctx, 13, 14, 6, 6, '#c9a84a'); R(ctx, 14, 12, 4, 3, '#fff2c0'); R(ctx, 15, 20, 2, 4, '#8a6a2a');
  },
  window: (ctx, th) => {
    R(ctx, 3, 10, 26, 18, th.faceDark); R(ctx, 4, 11, 24, 16, '#0f1a2e');
    R(ctx, 15, 11, 2, 16, th.faceDark);
    const r = seeded(5);
    for (let i = 0; i < 9; i++) R(ctx, 5 + Math.floor(r() * 22), 17 + Math.floor(r() * 9), 1, 1, '#ffd36a');
    R(ctx, 5, 21, 4, 6, '#1c2740'); R(ctx, 10, 18, 4, 9, '#1c2740'); R(ctx, 19, 20, 5, 7, '#1c2740');
    R(ctx, 5, 12, 6, 1, 'rgba(255,255,255,0.25)');
  },
  whiteboard: (ctx) => {
    R(ctx, 4, 11, 24, 15, '#888'); R(ctx, 5, 12, 22, 13, '#f2f2ee');
    R(ctx, 7, 14, 10, 1, '#2a5ac8'); R(ctx, 7, 17, 14, 1, '#2a5ac8'); R(ctx, 7, 20, 6, 1, '#c82a2a');
    R(ctx, 18, 19, 6, 4, 'rgba(200,40,40,0.6)');
  },
  poster: (ctx, th) => {
    R(ctx, 10, 11, 12, 16, K); R(ctx, 11, 12, 10, 14, th.accent);
    R(ctx, 12, 14, 8, 2, '#fff'); R(ctx, 12, 18, 8, 6, 'rgba(0,0,0,0.25)');
  },
  monitor: (ctx) => {
    R(ctx, 6, 11, 20, 14, '#222'); R(ctx, 7, 12, 18, 11, '#06221c');
    ctx.fillStyle = '#3dffc5';
    let y = 19;
    for (let x = 8; x < 24; x += 2) { y = Math.max(13, Math.min(21, y + ((x * 7) % 5) - 2)); ctx.fillRect(x, y, 2, 1); }
    R(ctx, 14, 25, 4, 3, '#333');
  },
  biohazard: (ctx) => {
    R(ctx, 9, 11, 14, 14, K); R(ctx, 10, 12, 12, 12, '#f2c230');
    E(ctx, 16, 18, 4, 4, K); E(ctx, 16, 18, 2, 2, '#f2c230');
    R(ctx, 15, 13, 2, 3, K); R(ctx, 11, 21, 3, 2, K); R(ctx, 18, 21, 3, 2, K);
  },
  vent: (ctx) => {
    R(ctx, 7, 12, 18, 13, K); R(ctx, 8, 13, 16, 11, '#6a7078');
    for (let y = 14; y < 24; y += 2) R(ctx, 8, y, 16, 1, '#2a2e33');
  },
  warnLight: (ctx) => {
    for (let x = 0; x < T; x += 8) { R(ctx, x, 24, 4, 4, '#f2c230'); R(ctx, x + 4, 24, 4, 4, '#1d1d20'); }
    E(ctx, 16, 15, 9, 7, 'rgba(255,60,50,0.3)');
    R(ctx, 12, 12, 8, 7, K); R(ctx, 13, 13, 6, 5, '#ff3b30'); R(ctx, 14, 13, 2, 2, '#ffb0a8');
  },
  cellDoor: (ctx) => {
    R(ctx, 5, 10, 22, 19, '#14161a');
    for (let x = 6; x < 27; x += 4) { R(ctx, x, 10, 2, 19, '#7a8088'); R(ctx, x, 10, 1, 19, '#a0a6ae'); }
    R(ctx, 5, 18, 22, 2, '#5a6068');
  },
  bookshelf: (ctx) => {
    R(ctx, 3, 10, 26, 19, '#3a2418');
    for (const y of [11, 19]) {
      let x = 4;
      const r = seeded(y);
      while (x < 27) { const w = 2 + Math.floor(r() * 2); R(ctx, x, y + (r() < 0.3 ? 1 : 0), w, 7, ['#7a2a2a', '#2a4a7a', '#c9a84a', '#2a6a3a', '#5a3a6a'][Math.floor(r() * 5)]); x += w + 1; }
      R(ctx, 3, y + 7, 26, 1, '#24160e');
    }
  },
  railing: (ctx) => {
    R(ctx, 0, 9, T, 21, '#1a2033');
    R(ctx, 0, 12, T, 2, '#9a9da3'); R(ctx, 0, 20, T, 1, '#7a7d83');
    for (let x = 2; x < T; x += 10) R(ctx, x, 12, 2, 16, '#8a8d93');
    R(ctx, 22, 15, 1, 1, '#ffd36a'); R(ctx, 8, 17, 1, 1, '#ffd36a');
  },
};

// ------------------------------------------------------------------ per theme
function themeTiles(scene, name, th) {
  for (let v = 0; v < 4; v++) {
    canvasTexture(scene, v ? `floor_${name}_${v}` : `floor_${name}`, T, T, (ctx) => {
      const rand = seeded(name.length * 97 + v * 13);
      floorBase(ctx, th, rand);
      floorVariant(ctx, th, v, rand);
    });
  }
  canvasTexture(scene, `wall_${name}`, T, T, (ctx) => wallTop(ctx, th));
  canvasTexture(scene, `wallface_${name}`, T, T, (ctx) => wallFace(ctx, th, null));
  th.faceDetails.forEach((d, i) => canvasTexture(scene, `wallface_${name}_${i + 1}`, T, T, (ctx) => wallFace(ctx, th, d)));

  canvasTexture(scene, `spawn_${name}`, T, T, (ctx) => {
    floorBase(ctx, th, seeded(3));
    R(ctx, 5, 5, 22, 22, K);
    R(ctx, 6, 6, 20, 20, '#1b1c20');
    for (let i = 0; i < 5; i++) R(ctx, 8 + i * 4, 8, 2, 16, '#55595f');
    R(ctx, 6, 24, 20, 2, 'rgba(61,255,197,0.35)');
  });

  canvasTexture(scene, `hazard_${name}`, T, T, (ctx) => {
    const rand = seeded(11);
    floorBase(ctx, th, rand);
    ctx.globalAlpha = 0.85;
    blob(ctx, seeded(4), 16, 16, 30, '#1f8f6a', 7);
    blob(ctx, seeded(9), 16, 16, 22, '#3dffc5', 5);
    ctx.globalAlpha = 1;
    R(ctx, 9, 11, 2, 2, '#c8fff0'); R(ctx, 20, 18, 2, 2, '#c8fff0'); R(ctx, 14, 21, 1, 1, '#c8fff0');
  });
}

// ------------------------------------------------------------------- props
// All prop textures are transparent; the floor tile is drawn underneath.
function pillar(scene, key, o) {
  canvasTexture(scene, key, T, T, (ctx) => {
    E(ctx, 16, 28, 13, 4, 'rgba(0,0,0,0.35)');
    if (o.round) {
      E(ctx, 16, 16, 14, 14, K); E(ctx, 16, 16, 12, 12, o.fill);
      E(ctx, 12, 12, 4, 4, o.hi);
      if (o.band) R(ctx, 4, 15, 24, 3, o.band);
    } else {
      R(ctx, 3, 3, 26, 26, K); R(ctx, 5, 5, 22, 22, o.fill); R(ctx, 5, 5, 22, 3, o.hi);
      if (o.stripes) for (let i = 0; i < 6; i++) R(ctx, 5 + i * 4, 19, 4, 5, i % 2 ? o.stripes : '#1d1d20');
      if (o.band) R(ctx, 5, 15, 22, 2, o.band);
      if (o.rivets) { R(ctx, 7, 9, 2, 2, o.rivets); R(ctx, 23, 9, 2, 2, o.rivets); R(ctx, 7, 24, 2, 2, o.rivets); R(ctx, 23, 24, 2, 2, o.rivets); }
    }
  });
}

function props(scene) {
  pillar(scene, 'pillar_garage', { fill: '#7a7e86', hi: '#8f939b', stripes: '#f2c230' });
  pillar(scene, 'pillar_lobby', { round: true, fill: '#e8e2d4', hi: '#ffffff', band: '#c9a84a' });
  pillar(scene, 'pillar_office', { fill: '#cfc9bc', hi: '#e8e2d4', band: '#9a9488' });
  pillar(scene, 'pillar_labs', { fill: '#9aa8b0', hi: '#c2cdd2', rivets: '#5a6870', band: '#3dffc5' });
  pillar(scene, 'pillar_containment', { fill: '#4a5058', hi: '#5a6068', stripes: '#ff5a4a', rivets: '#2a2e33' });
  pillar(scene, 'pillar_executive', { round: true, fill: '#2a2430', hi: '#4a4054', band: '#c9a84a' });
  canvasTexture(scene, 'pillar_rooftop', T, T, (ctx) => { // radio mast
    E(ctx, 16, 28, 10, 3, 'rgba(0,0,0,0.35)');
    R(ctx, 8, 22, 16, 8, K); R(ctx, 9, 23, 14, 6, '#6a6d73');
    R(ctx, 14, 2, 4, 22, K); R(ctx, 15, 2, 2, 22, '#a0a3a9');
    R(ctx, 10, 8, 12, 1, '#a0a3a9'); R(ctx, 11, 14, 10, 1, '#a0a3a9');
    R(ctx, 14, 0, 4, 3, '#ff3b30');
  });

  // 'd' props
  canvasTexture(scene, 'desk_garage', T, T, (ctx) => { // crates
    E(ctx, 16, 29, 14, 3, 'rgba(0,0,0,0.35)');
    R(ctx, 3, 3, 26, 26, K); R(ctx, 5, 5, 22, 22, '#8a6440');
    R(ctx, 5, 14, 22, 3, '#6b4a2f'); R(ctx, 14, 5, 3, 22, '#6b4a2f'); R(ctx, 5, 5, 22, 2, '#a07a52');
  });
  canvasTexture(scene, 'desk_lobby', T, T, (ctx) => {
    R(ctx, 0, 4, T, 26, K); R(ctx, 0, 6, T, 22, '#6b4a2f'); R(ctx, 0, 6, T, 8, '#8a6440'); R(ctx, 0, 22, T, 2, '#5a3d26');
  });
  canvasTexture(scene, 'desk_office', T, T, (ctx) => { // cubicle desk
    R(ctx, 0, 2, T, 28, K);
    R(ctx, 0, 3, T, 5, '#7a8494'); R(ctx, 0, 3, T, 1, '#9aa4b4');
    R(ctx, 1, 8, 30, 20, '#c9b48a'); R(ctx, 1, 26, 30, 2, '#9a8462');
    R(ctx, 10, 9, 12, 8, '#222'); R(ctx, 11, 10, 10, 6, '#3a6aa0'); R(ctx, 15, 17, 2, 2, '#333');
    R(ctx, 9, 21, 14, 3, '#e8e8e8'); R(ctx, 25, 12, 4, 5, '#fff'); R(ctx, 3, 18, 4, 4, '#b8322a');
  });
  canvasTexture(scene, 'desk_labs', T, T, (ctx) => { // lab bench
    R(ctx, 0, 4, T, 26, K); R(ctx, 0, 6, T, 22, '#c2cdd2'); R(ctx, 0, 6, T, 3, '#e2e9ec'); R(ctx, 0, 25, T, 3, '#8a98a0');
    R(ctx, 4, 10, 4, 8, '#ffffff'); R(ctx, 4, 13, 4, 5, '#3dffc5');
    R(ctx, 11, 12, 5, 6, '#ffffff'); R(ctx, 11, 14, 5, 4, '#b04ad0');
    R(ctx, 20, 9, 6, 10, '#3a3f46'); R(ctx, 22, 7, 2, 4, '#3a3f46'); R(ctx, 19, 19, 8, 2, '#3a3f46');
  });
  canvasTexture(scene, 'desk_containment', T, T, (ctx) => { // steel barrier
    E(ctx, 16, 28, 15, 3, 'rgba(0,0,0,0.4)');
    R(ctx, 0, 8, T, 20, K); R(ctx, 1, 9, 30, 18, '#8a8d93'); R(ctx, 1, 9, 30, 3, '#b0b3b9');
    for (let i = 0; i < 8; i++) R(ctx, 1 + i * 4, 18, 4, 5, i % 2 ? '#ff5a4a' : '#f2f2f2');
  });
  canvasTexture(scene, 'desk_executive', T, T, (ctx) => { // boardroom table
    R(ctx, 0, 3, T, 27, K); R(ctx, 0, 5, T, 23, '#2e1c14'); R(ctx, 0, 5, T, 2, '#c9a84a'); R(ctx, 0, 26, T, 2, '#c9a84a');
    R(ctx, 0, 9, T, 1, 'rgba(255,255,255,0.08)');
    R(ctx, 6, 12, 8, 6, '#e8e2d4'); R(ctx, 20, 14, 5, 5, '#7a1a2a'); R(ctx, 21, 15, 3, 1, '#c03040');
  });
  canvasTexture(scene, 'desk_rooftop', T, T, (ctx) => { // AC unit
    E(ctx, 16, 29, 15, 3, 'rgba(0,0,0,0.4)');
    R(ctx, 1, 2, 30, 27, K); R(ctx, 2, 3, 28, 25, '#9a9da3'); R(ctx, 2, 3, 28, 2, '#c0c3c9');
    E(ctx, 16, 15, 10, 10, '#3a3d42'); E(ctx, 16, 15, 8, 8, '#55585e');
    R(ctx, 8, 14, 16, 2, '#2a2c30'); R(ctx, 15, 7, 2, 16, '#2a2c30');
  });

  // 'o' props
  canvasTexture(scene, 'pod_garage', T, T, (ctx) => { // barrel
    E(ctx, 16, 28, 11, 3, 'rgba(0,0,0,0.35)');
    R(ctx, 7, 4, 18, 24, K); R(ctx, 8, 5, 16, 22, '#e86a1a');
    R(ctx, 8, 10, 16, 3, '#f2f2f2'); R(ctx, 8, 18, 16, 3, '#f2f2f2'); R(ctx, 9, 5, 3, 22, 'rgba(255,255,255,0.2)');
  });
  canvasTexture(scene, 'pod_lobby', T, T, (ctx) => { // planter
    R(ctx, 5, 15, 22, 15, K); R(ctx, 7, 17, 18, 11, '#5a4a3a');
    E(ctx, 16, 12, 11, 11, '#2f6b2c'); R(ctx, 9, 5, 6, 6, '#5aa04f'); R(ctx, 18, 9, 6, 5, '#5aa04f');
  });
  canvasTexture(scene, 'pod_office', T, T, (ctx) => { // water cooler
    E(ctx, 16, 29, 9, 3, 'rgba(0,0,0,0.35)');
    R(ctx, 9, 14, 14, 15, K); R(ctx, 10, 15, 12, 13, '#e8e8e8'); R(ctx, 12, 19, 3, 2, '#3a6aa0'); R(ctx, 17, 19, 3, 2, '#c03030');
    E(ctx, 16, 8, 8, 8, '#2a4a7a'); E(ctx, 16, 8, 6, 7, '#7ac0f0'); R(ctx, 12, 5, 2, 5, 'rgba(255,255,255,0.6)');
  });
  canvasTexture(scene, 'pod_labs', T, T, (ctx) => { // specimen tank
    E(ctx, 16, 29, 13, 3, 'rgba(0,0,0,0.4)');
    R(ctx, 4, 1, 24, 30, K); R(ctx, 5, 2, 22, 3, '#7a868c'); R(ctx, 5, 27, 22, 3, '#7a868c');
    R(ctx, 6, 5, 20, 22, '#1f8f6a'); R(ctx, 6, 5, 20, 3, '#3dffc5');
    E(ctx, 16, 15, 4, 4, '#0d3a2c'); R(ctx, 13, 18, 6, 8, '#0d3a2c'); R(ctx, 11, 19, 2, 5, '#0d3a2c'); R(ctx, 19, 19, 2, 5, '#0d3a2c');
    R(ctx, 8, 7, 2, 18, 'rgba(255,255,255,0.35)'); R(ctx, 21, 22, 2, 2, '#c8fff0'); R(ctx, 12, 9, 2, 2, '#c8fff0');
  });
  canvasTexture(scene, 'pod_containment', T, T, (ctx) => { // cryo pod
    E(ctx, 16, 29, 13, 3, 'rgba(0,0,0,0.4)');
    E(ctx, 16, 16, 13, 15, K); E(ctx, 16, 16, 11, 13, '#4a5058');
    E(ctx, 16, 15, 8, 10, '#9ad0e8'); E(ctx, 16, 15, 6, 8, '#c8f0ff');
    R(ctx, 13, 10, 6, 10, 'rgba(40,60,80,0.5)'); R(ctx, 14, 26, 4, 2, '#ff3b30');
  });
  canvasTexture(scene, 'pod_executive', T, T, (ctx) => { // fern in gold pot
    E(ctx, 16, 29, 10, 3, 'rgba(0,0,0,0.35)');
    R(ctx, 9, 18, 14, 12, K); R(ctx, 10, 19, 12, 10, '#c9a84a'); R(ctx, 10, 19, 12, 2, '#f2d77a');
    E(ctx, 16, 11, 12, 9, '#1f4a1c'); E(ctx, 10, 9, 5, 4, '#3a7a34'); E(ctx, 22, 9, 5, 4, '#3a7a34'); E(ctx, 16, 5, 4, 4, '#4f9a46');
  });
  canvasTexture(scene, 'pod_rooftop', T, T, (ctx) => { // exhaust vent
    E(ctx, 16, 28, 11, 3, 'rgba(0,0,0,0.4)');
    E(ctx, 16, 16, 11, 11, K); E(ctx, 16, 16, 9, 9, '#8a8d93'); E(ctx, 16, 16, 6, 6, '#2a2c30');
    R(ctx, 6, 15, 20, 2, '#a0a3a9');
  });

  // garage cars (64x32 / 32x64), transparent background
  for (const [i, body] of ['#8a2a2a', '#2a5a8a', '#b9b9b9'].entries()) {
    const drawCar = (ctx) => {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(4, 26, 58, 4);
      R(ctx, 2, 4, 60, 24, K); R(ctx, 4, 6, 56, 20, body);
      R(ctx, 4, 6, 56, 3, 'rgba(255,255,255,0.18)');
      R(ctx, 16, 8, 8, 16, '#2a3a48'); R(ctx, 40, 8, 6, 16, '#2a3a48'); R(ctx, 16, 8, 3, 16, '#4a6a80');
      R(ctx, 58, 7, 2, 4, '#ffe9a8'); R(ctx, 58, 21, 2, 4, '#ffe9a8');
      R(ctx, 4, 7, 2, 4, '#ff5f56'); R(ctx, 4, 21, 2, 4, '#ff5f56');
      R(ctx, 26, 12, 10, 8, 'rgba(0,0,0,0.12)');
    };
    canvasTexture(scene, `car_h_${i}`, 64, 32, (ctx) => drawCar(ctx));
    canvasTexture(scene, `car_v_${i}`, 32, 64, (ctx) => { ctx.translate(32, 0); ctx.rotate(Math.PI / 2); drawCar(ctx); });
  }
}

// ------------------------------------------------------------------ decals
const DECALS = {
  oil: (ctx, r) => { ctx.globalAlpha = 0.7; blob(ctx, r, 16, 16, 20, '#15161a', 6); ctx.globalAlpha = 0.3; R(ctx, 12, 13, 4, 2, '#6a5ab0'); },
  tire: (ctx) => { ctx.fillStyle = 'rgba(15,15,18,0.45)'; for (let x = 0; x < 32; x += 3) { ctx.fillRect(x, 9 + Math.round(Math.sin(x / 6) * 2), 2, 3); ctx.fillRect(x, 20 + Math.round(Math.sin(x / 6) * 2), 2, 3); } },
  crack: (ctx, r) => { ctx.fillStyle = 'rgba(0,0,0,0.45)'; let x = 3, y = 14 + r() * 4; for (let i = 0; i < 12; i++) { ctx.fillRect(Math.floor(x), Math.floor(y), 2, 1); if (i === 5) ctx.fillRect(Math.floor(x), Math.floor(y), 1, 5); x += 2.3; y += (r() - 0.5) * 3; } },
  puddle: (ctx, r) => { ctx.globalAlpha = 0.45; blob(ctx, r, 16, 16, 22, '#2a3a52', 6); ctx.globalAlpha = 0.5; R(ctx, 10, 13, 6, 1, '#8ab0d0'); },
  cone: (ctx) => { E(ctx, 16, 24, 8, 3, 'rgba(0,0,0,0.35)'); R(ctx, 9, 20, 14, 4, K); R(ctx, 10, 21, 12, 2, '#e86a1a'); R(ctx, 13, 8, 6, 13, K); R(ctx, 14, 9, 4, 12, '#ff8a2a'); R(ctx, 14, 13, 4, 3, '#f2f2f2'); },
  trash: (ctx) => { R(ctx, 8, 14, 7, 5, '#c8c0a8'); R(ctx, 18, 10, 5, 7, '#3a7ab8'); R(ctx, 13, 20, 8, 3, '#b8322a'); R(ctx, 22, 19, 4, 4, '#e8e2d4'); },
  blood: (ctx, r) => { ctx.globalAlpha = 0.75; blob(ctx, r, 16, 16, 18, '#5a1218', 6); ctx.globalAlpha = 0.6; for (let i = 0; i < 6; i++) R(ctx, Math.floor(r() * 30), Math.floor(r() * 30), 2, 2, '#7a1a22'); },
  papers: (ctx, r) => { for (let i = 0; i < 4; i++) { const x = 3 + r() * 20, y = 4 + r() * 20; R(ctx, x, y, 9, 11, '#d8d4c8'); R(ctx, x + 1, y + 2, 6, 1, '#8a8678'); R(ctx, x + 1, y + 5, 7, 1, '#8a8678'); } },
  glass: (ctx, r) => { for (let i = 0; i < 9; i++) R(ctx, 6 + Math.floor(r() * 20), 6 + Math.floor(r() * 20), 2 + Math.floor(r() * 3), 1 + Math.floor(r() * 2), i % 2 ? 'rgba(200,240,255,0.8)' : 'rgba(160,210,230,0.6)'); },
  suitcase: (ctx) => { E(ctx, 16, 25, 11, 3, 'rgba(0,0,0,0.3)'); R(ctx, 6, 10, 20, 14, K); R(ctx, 7, 11, 18, 12, '#5a2a6a'); R(ctx, 13, 7, 6, 4, K); R(ctx, 7, 16, 18, 1, '#3a1a4a'); },
  coffee: (ctx, r) => { ctx.globalAlpha = 0.6; blob(ctx, r, 18, 18, 16, '#4a2e1a', 5); ctx.globalAlpha = 1; R(ctx, 8, 9, 6, 7, '#f2f2f2'); R(ctx, 8, 9, 6, 2, '#c8302a'); },
  chair: (ctx) => { E(ctx, 16, 26, 10, 3, 'rgba(0,0,0,0.35)'); R(ctx, 9, 6, 14, 6, K); R(ctx, 10, 7, 12, 4, '#2a2e3a'); R(ctx, 8, 12, 16, 9, K); R(ctx, 9, 13, 14, 7, '#3a4050'); R(ctx, 15, 21, 2, 3, '#555'); R(ctx, 10, 24, 12, 2, '#555'); },
  cables: (ctx) => { ctx.fillStyle = '#1a1a1a'; for (let x = 0; x < 32; x += 2) ctx.fillRect(x, 14 + Math.round(Math.sin(x / 4) * 4), 2, 2); ctx.fillStyle = '#2a4a8a'; for (let x = 0; x < 32; x += 2) ctx.fillRect(x, 19 + Math.round(Math.cos(x / 5) * 3), 2, 1); },
  goo: (ctx, r) => { ctx.globalAlpha = 0.7; blob(ctx, r, 16, 16, 20, '#1f8f6a', 6); ctx.globalAlpha = 0.9; blob(ctx, r, 16, 16, 10, '#3dffc5', 3); },
  drain: (ctx) => { R(ctx, 9, 9, 14, 14, K); R(ctx, 10, 10, 12, 12, '#2a2c30'); for (let i = 0; i < 4; i++) R(ctx, 11 + i * 3, 11, 1, 10, '#6a7078'); },
  hazardStripe: (ctx) => { for (let i = 0; i < 8; i++) R(ctx, i * 4, 12, 4, 8, i % 2 ? '#f2c230' : '#1d1d20'); },
  chains: (ctx) => { for (let i = 0; i < 6; i++) { R(ctx, 3 + i * 5, 14 + (i % 2) * 2, 5, 4, '#5a6068'); R(ctx, 4 + i * 5, 15 + (i % 2) * 2, 3, 2, '#2a2e33'); } R(ctx, 28, 12, 4, 8, '#7a8088'); },
  scorch: (ctx, r) => { ctx.globalAlpha = 0.6; blob(ctx, r, 16, 16, 24, '#0a0a0c', 7); ctx.globalAlpha = 0.4; blob(ctx, r, 16, 16, 10, '#3a1a0a', 3); },
  bolts: (ctx, r) => { for (let i = 0; i < 6; i++) R(ctx, 6 + Math.floor(r() * 20), 6 + Math.floor(r() * 20), 3, 3, i % 2 ? '#8a8d93' : '#5a5e64'); },
  rug: (ctx) => { R(ctx, 0, 4, 32, 24, '#5a1a22'); R(ctx, 2, 6, 28, 20, '#7a2a32'); R(ctx, 4, 8, 24, 16, '#c9a84a'); R(ctx, 5, 9, 22, 14, '#6a1a22'); R(ctx, 12, 13, 8, 6, '#c9a84a'); },
  money: (ctx, r) => { for (let i = 0; i < 5; i++) { const x = 4 + r() * 20, y = 6 + r() * 18; R(ctx, x, y, 9, 5, '#5a8a4a'); R(ctx, x + 3, y + 1, 3, 3, '#8ab07a'); } },
  wine: (ctx, r) => { ctx.globalAlpha = 0.65; blob(ctx, r, 16, 18, 16, '#5a0a2a', 5); ctx.globalAlpha = 1; R(ctx, 6, 8, 3, 12, '#1a3a1a'); R(ctx, 7, 6, 1, 3, '#1a3a1a'); },
};
export const DECAL_KEYS = Object.keys(DECALS);

function decals(scene) {
  for (const [k, fn] of Object.entries(DECALS)) {
    canvasTexture(scene, `decal_${k}`, T, T, (ctx) => { fn(ctx, seeded(k.length * 17 + k.charCodeAt(0))); ctx.globalAlpha = 1; });
  }
  canvasTexture(scene, 'decal_arrow', T, T, (ctx) => {
    ctx.fillStyle = 'rgba(230,230,220,0.45)';
    ctx.fillRect(14, 12, 4, 16);
    ctx.beginPath(); ctx.moveTo(16, 3); ctx.lineTo(24, 13); ctx.lineTo(8, 13); ctx.closePath(); ctx.fill();
  });
  canvasTexture(scene, 'carpet_runner', T, T, (ctx) => {
    R(ctx, 2, 0, 28, T, '#6a1a22'); R(ctx, 2, 0, 2, T, '#c9a84a'); R(ctx, 28, 0, 2, T, '#c9a84a');
    R(ctx, 6, 0, 20, T, '#7a222a'); R(ctx, 14, 12, 4, 8, 'rgba(201,168,74,0.5)');
  });
  canvasTexture(scene, 'helipad', 160, 160, (ctx) => {
    ctx.strokeStyle = 'rgba(242,194,48,0.6)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(80, 80, 72, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(240,240,235,0.55)';
    ctx.fillRect(52, 40, 12, 80); ctx.fillRect(96, 40, 12, 80); ctx.fillRect(64, 74, 32, 12);
  });
}

// ----------------------------------------------------------------- lighting
function lighting(scene) {
  // Banded (posterized) radial gradients look more "pixel" than smooth ones.
  const banded = (key, size, bands) => canvasTexture(scene, key, size, size, (ctx) => {
    for (let i = 0; i < bands.length; i++) {
      const [rf, a] = bands[i];
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath(); ctx.arc(size / 2, size / 2, (size / 2) * rf, 0, Math.PI * 2); ctx.fill();
    }
  });
  banded('lightmask', 224, [[1, 0.2], [0.82, 0.25], [0.64, 0.3], [0.46, 0.4]]);
  banded('glow', 224, [[1, 0.25], [0.7, 0.35], [0.45, 0.5]]);
}
