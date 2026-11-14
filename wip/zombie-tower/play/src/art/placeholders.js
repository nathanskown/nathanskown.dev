// Code-drawn placeholder art. Every texture here is only created if a real
// image with the same key hasn't already been loaded (see manifest.js).

import { asciiTexture, canvasTexture, pix, seeded } from './pixel.js';
import { TILE, FONT } from '../config.js';
import { PERKS } from '../data/perks.js';
import { MODS } from '../data/mods.js';
import { makeTiles } from './tiles.js';
import { makeMonsters, MORE_GUNS, MORE_ARMOR } from './monsters.js';

const K = '#241a2e'; // outline
const ZG = '#7fa37a'; // zombie skin
const ZE = '#3dffc5'; // infection teal

export function makePlaceholders(scene) {
  characters(scene);
  makeMonsters(scene);
  Object.assign(GUNS, MORE_GUNS);
  Object.assign(ARMOR_ART, MORE_ARMOR);
  weapons(scene);
  armor(scene);
  perks(scene);
  mods(scene);
  tiles(scene);
  misc(scene);
}

// ---------------------------------------------------------------- characters
function characters(scene) {
  asciiTexture(scene, 'rook', [
    '................',
    '......kkkk......',
    '.....khhhhk.....',
    '....khhhhhhk....',
    '....khsssshk....',
    '....kskssksk....',
    '.....kssssk.....',
    '...kkoonnookk...',
    '..ksoyonnoyosk..',
    '..ksoonnnnoosk..',
    '...kkoonnookk...',
    '....knnnnnnk....',
    '....knnkknnk....',
    '....knnkknnk....',
    '....kbbkkbbk....',
    '.....kk..kk.....',
  ], { k: K, h: '#4a2e1f', s: '#e0a878', n: '#2b3a67', o: '#ff8a2a', y: '#ffe066', b: '#3b2a20' });

  asciiTexture(scene, 'shambler', [
    '................',
    '......kkkk......',
    '.....kggggk.....',
    '....kggggggk....',
    '....kgeggegk....',
    '....kggGGggk....',
    '.kk..kggggk..kk.',
    'kggkkwwrwwwkkggk',
    '.kgkwwwrwwwwkgk.',
    '..kkwwwrwwGwkk..',
    '....kwwwwwwk....',
    '....kppppppk....',
    '....kppkkppk....',
    '....kppkkppk....',
    '....kkkk.kkk....',
    '................',
  ], { k: K, g: ZG, G: '#5c7d5a', e: ZE, w: '#b9bfc9', r: '#7a2433', p: '#3d4a5c' });

  asciiTexture(scene, 'valet', [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkk......',
    '.....kggggk.....',
    '.....kegegk.....',
    '..kk.kggggk.kk..',
    '.kgkkvvvvvvkkgk.',
    '.kgkvvwwwwvvkgk.',
    '..kkvvwwwwvvkk..',
    '....kvvvvvvk....',
    '...kbbk..kbbk...',
    '...kggk..kggk...',
    '....kk....kk....',
  ], { k: K, g: '#8fb07f', e: ZE, v: '#b8322a', w: '#d9d9d9', b: '#222630' });

  asciiTexture(scene, 'doorman', [
    '.....kkkkkk.....',
    '....khhhhhhk....',
    '...khhyyyyhhk...',
    '...kkkkkkkkkk...',
    '....kggggggk....',
    '....kgeggegk....',
    '....kggGGggk....',
    '.kkkkccyycckkkk.',
    'kgggkcccwcckgggk',
    'kgegkcyccyckgegk',
    'kgggkcccccckgggk',
    '.kkkkcycccyckkk.',
    '....kcccccck....',
    '....kcckkcck....',
    '....kbbk.kbbk...',
    '....kkk...kkk...',
  ], { k: K, h: '#3a1218', y: '#e8c547', g: ZG, G: '#5c7d5a', e: ZE, c: '#6b1f2a', w: '#e8e8e8', b: '#1d1a22' }, 4);
}

// ------------------------------------------------------------------- weapons
// 16x8 art grid, scale 2 -> 32x16 texture. Gun points right; origin near grip.
const GUNS = {
  pistol: [[3, 2, 9, 2, '#9aa3ad'], [3, 4, 8, 1, '#6c737c'], [4, 5, 3, 3, '#3b3f45']],
  nailgun: [[3, 1, 9, 4, '#e8a020'], [12, 2, 3, 2, '#555a60'], [5, 5, 3, 3, '#333638'], [9, 5, 4, 1, '#888d92'], [4, 1, 7, 1, '#f5c050']],
  smg: [[2, 2, 10, 3, '#50565e'], [12, 3, 4, 1, '#3a3f45'], [7, 5, 2, 3, '#2e3238'], [3, 5, 2, 2, '#2e3238'], [0, 3, 2, 1, '#50565e']],
  shotgun: [[5, 2, 11, 1, '#8a8f96'], [2, 3, 7, 2, '#7a4e2a'], [9, 3, 4, 1, '#5a3a20'], [0, 3, 3, 3, '#7a4e2a']],
  revolver: [[7, 2, 8, 2, '#c0c6cc'], [4, 1, 4, 5, '#8e959c'], [2, 4, 3, 4, '#6b3f22']],
  rifle: [[6, 3, 10, 1, '#4a5058'], [2, 2, 8, 3, '#3d4248'], [5, 0, 5, 2, '#1f2226'], [0, 3, 3, 3, '#5a4a3a'], [6, 5, 2, 2, '#2e3238']],
};

function weapons(scene) {
  for (const [id, rects] of Object.entries(GUNS)) {
    canvasTexture(scene, `gun_${id}`, 32, 16, (ctx) => {
      // dark outline pass, then fill
      for (const [x, y, w, h] of rects) pix(ctx, x - 0.5, y - 0.5, w + 1, h + 1, K);
      for (const [x, y, w, h, c] of rects) pix(ctx, x, y, w, h, c);
    });
  }
}

// --------------------------------------------------------------------- armor
const ARMOR_ART = {
  hardhat: [[3, 6, 10, 5, '#f2c230'], [1, 10, 14, 2, '#d9a81f'], [5, 6, 3, 2, '#ffe27a']],
  riot: [[3, 3, 10, 10, '#2e3440'], [4, 7, 8, 4, '#7fb6d9'], [5, 7, 3, 1, '#c7e6f7']],
  vest: [[3, 3, 10, 11, '#ff8a2a'], [3, 8, 10, 1, '#ffe066'], [3, 11, 10, 1, '#ffe066'], [6, 3, 4, 3, null]],
  kevlar: [[3, 3, 10, 11, '#4c5560'], [4, 5, 3, 4, '#6b7682'], [9, 5, 3, 4, '#6b7682'], [4, 10, 8, 3, '#6b7682'], [6, 3, 4, 2, null]],
  cargo: [[4, 3, 4, 12, '#b8a27a'], [8, 3, 4, 12, '#b8a27a'], [4, 3, 8, 2, '#8a7650'], [4, 8, 2, 3, '#9c8862'], [10, 8, 2, 3, '#9c8862']],
  kneeguards: [[4, 3, 4, 12, '#3a3f4a'], [8, 3, 4, 12, '#3a3f4a'], [3, 8, 6, 3, '#15171c'], [7, 8, 6, 3, '#15171c'], [4, 8, 2, 1, '#555c6a'], [8, 8, 2, 1, '#555c6a']],
};

function armor(scene) {
  for (const [id, rects] of Object.entries(ARMOR_ART)) {
    canvasTexture(scene, `arm_${id}`, 32, 32, (ctx) => {
      for (const [x, y, w, h, c] of rects) if (c) pix(ctx, x - 0.5, y - 0.5, w + 1, h + 1, K);
      for (const [x, y, w, h, c] of rects) {
        if (c) pix(ctx, x, y, w, h, c);
        else ctx.clearRect(x * 2, y * 2, w * 2, h * 2);
      }
    });
  }
}

// --------------------------------------------------------------------- perks
function perks(scene) {
  for (const p of PERKS) {
    canvasTexture(scene, `perk_${p.id}`, 32, 32, (ctx) => {
      ctx.fillStyle = K;
      ctx.fillRect(1, 1, 30, 30);
      ctx.fillStyle = p.color;
      ctx.fillRect(3, 3, 26, 26);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(3, 21, 26, 8);
      ctx.fillStyle = '#ffffff';
      ctx.font = `14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.glyph, 16, 17);
    });
  }
}

// ---------------------------------------------------------------------- mods
// Diamond badges so mods never look like perks.
function mods(scene) {
  for (const m of MODS) {
    canvasTexture(scene, `mod_${m.id}`, 32, 32, (ctx) => {
      const diamond = (r, color) => {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(16, 16 - r); ctx.lineTo(16 + r, 16); ctx.lineTo(16, 16 + r); ctx.lineTo(16 - r, 16); ctx.closePath(); ctx.fill();
      };
      diamond(16, K);
      diamond(13, m.color);
      ctx.fillStyle = '#14111c';
      ctx.font = `12px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.glyph, 16, 17);
    });
  }
}

// --------------------------------------------------------------------- tiles
function speckle(ctx, rand, colors, n) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    ctx.fillRect(Math.floor(rand() * 16) * 2, Math.floor(rand() * 16) * 2, 2, 2);
  }
}

function tiles(scene) {
  const T = TILE;
  makeTiles(scene);

  // ---- stairs
  canvasTexture(scene, 'stairs_locked', T, T, (ctx) => {
    ctx.fillStyle = '#26262c';
    ctx.fillRect(0, 0, T, T);
    ctx.fillStyle = '#3a3a42';
    for (let i = 0; i < 4; i++) ctx.fillRect(2, 3 + i * 7, 28, 4);
    ctx.strokeStyle = '#ff5f56';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(6, 6); ctx.lineTo(26, 26);
    ctx.moveTo(26, 6); ctx.lineTo(6, 26);
    ctx.stroke();
  });
  canvasTexture(scene, 'stairs_open', T, T, (ctx) => {
    ctx.fillStyle = '#1a2a26';
    ctx.fillRect(0, 0, T, T);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#2a5a4c' : '#357a66';
      ctx.fillRect(2, 2 + i * 7, 28, 6);
    }
    ctx.fillStyle = ZE;
    ctx.beginPath();
    ctx.moveTo(16, 4); ctx.lineTo(26, 16); ctx.lineTo(20, 16); ctx.lineTo(20, 28);
    ctx.lineTo(12, 28); ctx.lineTo(12, 16); ctx.lineTo(6, 16);
    ctx.closePath();
    ctx.fill();
  });
}

// ---------------------------------------------------------------------- misc
function misc(scene) {
  canvasTexture(scene, 'px', 4, 4, (ctx) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 4, 4); });
  canvasTexture(scene, 'blank32', TILE, TILE, () => {});
  canvasTexture(scene, 'bullet', 8, 4, (ctx) => {
    ctx.fillStyle = '#ffb84d'; ctx.fillRect(0, 0, 8, 4);
    ctx.fillStyle = '#fff7c2'; ctx.fillRect(3, 1, 5, 2);
  });
  canvasTexture(scene, 'flash', 12, 12, (ctx) => {
    ctx.fillStyle = '#ffe066'; ctx.fillRect(2, 2, 8, 8);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(4, 4, 4, 4);
  });
  canvasTexture(scene, 'medkit', 16, 16, (ctx) => {
    ctx.fillStyle = K; ctx.fillRect(0, 2, 16, 13);
    ctx.fillStyle = '#f2f2f2'; ctx.fillRect(1, 3, 14, 11);
    ctx.fillStyle = '#ff5f56'; ctx.fillRect(6, 4, 4, 9); ctx.fillRect(3, 7, 10, 3);
    ctx.fillStyle = K; ctx.fillRect(5, 0, 6, 3);
  });
  canvasTexture(scene, 'crate', 20, 20, (ctx) => {
    ctx.fillStyle = K; ctx.fillRect(0, 0, 20, 20);
    ctx.fillStyle = '#c99a2e'; ctx.fillRect(1, 1, 18, 18);
    ctx.fillStyle = '#ffc94a'; ctx.fillRect(3, 3, 14, 14);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(8, 5, 4, 10); ctx.fillRect(5, 8, 10, 4);
  });
  canvasTexture(scene, 'vignette', 800, 480, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(5,3,10,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}
