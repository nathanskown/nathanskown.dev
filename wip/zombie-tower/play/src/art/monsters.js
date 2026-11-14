// Placeholder sprites for zones 2-5: zombies, bosses, enemy projectiles.
// Replace any of these with real art via manifest.js (same key, same size).

import { asciiTexture, canvasTexture } from './pixel.js';

const K = '#241a2e';
const ZG = '#7fa37a';
const ZE = '#3dffc5';

export function makeMonsters(scene) {
  // ---------------------------------------------------------------- zone 2
  asciiTexture(scene, 'crawler', [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '....kkkk........',
    '...kggggk.......',
    '...kgegek..kk...',
    '.kkkggggkkkwwk..',
    'kggkkwwwwwwwwwk.',
    'kgggkwwbwwwwwwkk',
    '.kkkkwwbkkkkkkk.',
    '.......bb.......',
  ], { k: K, g: ZG, e: ZE, w: '#9ab8d8', b: '#2a5ac8' });

  asciiTexture(scene, 'spitter', [
    '................',
    '......kkkk......',
    '.....kggggk.....',
    '.....kegegk.....',
    '....kTTTTTTk....',
    '....kTttTTTk....',
    '.kk.kTTTTTTk.kk.',
    'kggkkppppppkkggk',
    '.kgkpppppPppkgk.',
    '..kkppppppppkk..',
    '....kppppppk....',
    '....knnnnnnk....',
    '....knnkknnk....',
    '....knnkknnk....',
    '....kkkk.kkk....',
    '................',
  ], { k: K, g: ZG, e: ZE, T: '#3dffc5', t: '#e0fff6', p: '#2a6ab8', P: '#ffffff', n: '#8a7a5a' });

  // ---------------------------------------------------------------- zone 3
  asciiTexture(scene, 'testsubject', [
    '................',
    '......kkkk......',
    '.....kggggk.....',
    '.....kegegk.....',
    '.....kggGgk.....',
    '..k...kggk...k..',
    '.kTkkwwwwwwkkTk.',
    '.kgTkwwwwwwkTgk.',
    '..kgkwwbwwwkgk..',
    '...kkwwwwwwkk...',
    '....kwwwwwwk....',
    '....kwwwwwwk....',
    '....kggkkggk....',
    '....kggkkggk....',
    '....kkkk.kkk....',
    '................',
  ], { k: K, g: '#a8b89a', G: '#7a8a6a', e: ZE, w: '#a8c0c8', b: '#f2f2f2', T: ZE });

  const hazmat = (cracked) => [
    '................',
    '.....kkkkkk.....',
    '....kyyyyyyk....',
    `...kyv${cracked ? 'c' : 'v'}vvvvyk...`,
    `...kyvgeg${cracked ? 'T' : 'v'}vyk...`,
    `...kyv${cracked ? 'vTc' : 'vvv'}vvyk...`,
    '..kkyyyyyyyykk..',
    '.kyykyyyyyykyyk.',
    '.kyykyyyyyykyyk.',
    '.kyykyyYyyykyyk.',
    '..kkkyyyyyykkk..',
    '....kyyyyyyk....',
    '....kyykkyyk....',
    '....kyykkyyk....',
    '....kkkk.kkk....',
    '................',
  ];
  const hzPal = { k: K, y: '#e8c020', Y: '#b8901a', v: '#3a5a6a', g: ZG, e: ZE, c: '#e8ffff', T: ZE };
  asciiTexture(scene, 'hazmat', hazmat(false), hzPal);
  asciiTexture(scene, 'hazmat_cracked', hazmat(true), hzPal);

  // ---------------------------------------------------------------- zone 4
  asciiTexture(scene, 'guard', [
    '................',
    '......kkkk......',
    '.....khhhhk.....',
    '....khhhhhhk....',
    '....khvvvvhk....',
    '....kgegegk.....',
    '.....kggggk.....',
    '...kkoonnookk...',
    '..kgoyonnoyogk..',
    '..kgoonnnnoogk..',
    '...kkoonnookk...',
    '....knnnnnnk....',
    '....knnkknnk....',
    '....knnkknnk....',
    '....kbbkkbbk....',
    '.....kk..kk.....',
  ], { k: K, h: '#1d2230', v: '#7fb6d9', g: ZG, e: ZE, n: '#2b3a67', o: '#b8601a', y: '#c9b040', b: '#3b2a20' });

  asciiTexture(scene, 'bloater', [
    '................',
    '......kkkk......',
    '.....kggggk.....',
    '.....kegegk.....',
    '...kkkggggkkk...',
    '..kgGgggggggGk..',
    '.kggggTgggggggk.',
    '.kgggggggggTggk.',
    '.kgGgggggggggGk.',
    '.kggggTgggggggk.',
    '..kggggggggggk..',
    '...kkggggggkk...',
    '....kppkkppk....',
    '....kppkkppk....',
    '....kkkk.kkk....',
    '................',
  ], { k: K, g: '#8fae7a', G: '#6a8a5a', e: ZE, T: ZE, p: '#3d4a5c' });

  // ---------------------------------------------------------------- zone 5
  asciiTexture(scene, 'executive', [
    '................',
    '......kkkk......',
    '.....khhhhk.....',
    '.....kggggk.....',
    '.....kegegk.....',
    '.....kggggk.....',
    '..kk.kkwwkk.kk..',
    '.kskkswrrwskksk.',
    '.kskssswrssskYk.',
    '..kkssssrssskk..',
    '....kssssssk....',
    '....kssssssk....',
    '....kssksssk....',
    '....kssk.ssk....',
    '....kkkk.kkk....',
    '................',
  ], { k: K, h: '#2a1a12', g: '#9ab08a', e: ZE, s: '#2a2a3a', w: '#e8e8e8', r: '#b8222a', Y: '#e8c547' });

  asciiTexture(scene, 'blob', [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkk......',
    '....kkTTTTkk....',
    '...kTTtTTtTTk...',
    '...kTTTTTTTTk...',
    '..kTTTTTTTTTTk..',
    '...kkkkkkkkkk...',
    '................',
  ], { k: K, T: '#2abf96', t: '#e0fff6' });

  canvasTexture(scene, 'riotshield', 8, 24, (ctx) => {
    ctx.fillStyle = K; ctx.fillRect(0, 0, 8, 24);
    ctx.fillStyle = '#5a8aa8'; ctx.fillRect(1, 1, 6, 22);
    ctx.fillStyle = '#9ad0e8'; ctx.fillRect(2, 2, 2, 20);
    ctx.fillStyle = '#e8ffff'; ctx.fillRect(4, 8, 1, 4); ctx.fillRect(5, 11, 1, 3);
  });

  // ------------------------------------------------------------------ bosses
  asciiTexture(scene, 'manager', [
    '....kkkkkkkk....',
    '...khhhhhhhhk...',
    '...kggggggggk...',
    '...kgeggggegk...',
    '...kggGGGGggk...',
    '.kkkkwwrrwwkkkk.',
    'kbbkwwwrrwwwkbbk',
    'kbbkwwwrrwwwkbbk',
    'kkkkcccrrccckkkk',
    'kcccccccccccccck',
    'kcccccccccccccck',
    '.kkkkkkkkkkkkkk.',
    '......kssk......',
    '....kkksssskk...',
    '...kk.k..k..kk..',
    '................',
  ], { k: K, h: '#4a3a2a', g: ZG, G: '#5c7d5a', e: ZE, w: '#c8d0e0', r: '#2a4a8a', b: '#1d1d22', c: '#2a2a32', s: '#8a8d93' }, 4);

  asciiTexture(scene, 'specimen', [
    '....k......k....',
    '...kgk....kgk...',
    '..kgggkkkkgggk..',
    '..kgGgggggggGk..',
    '.kgggeggggegggk.',
    'kgGggggggggggGgk',
    'kggggkTTTTkggggk',
    'kgGgkTttttTkgGgk',
    'kggggkTTTTkggggk',
    '.kgggggggggggggk',
    '.kgGggsgggsggGk.',
    '..kggggggggggk..',
    '.kgk.kggggk.kgk.',
    'kgk..kgkkgk..kgk',
    'kk...kk..kk...kk',
    '................',
  ], { k: K, g: '#9ab89a', G: '#6a8a6a', e: ZE, s: '#c8f0ff', T: '#2abf96', t: '#e0fff6' }, 4);

  asciiTexture(scene, 'warden', [
    '.....kkkkkk.....',
    '....kaaaaaak....',
    '...kaaTTTTaak...',
    '...kaggggggak...',
    '...kageggegak...',
    '.kkkaaaaaaaakkk.',
    'kaaakaaTaaaakaak',
    'kaaakaaaaaaakaak',
    'kaaakaaaTaaakaak',
    '.kkkkaaaaaaakkk.',
    'cc..kaaaaaaak.cc',
    '.cc.kaakkaak.cc.',
    '..c.kaak.kaak.c.',
    '..s.kaak.kaak.s.',
    '....kkkk.kkkk...',
    '................',
  ], { k: K, a: '#3a3f46', T: ZE, g: ZG, e: ZE, c: '#7a8088', s: '#a0a6ae' }, 4);

  const founderPal = { k: K, h: '#2a1a12', s: '#d8b090', u: '#1a1a24', w: '#e8e8e8', r: '#b8222a', g: '#5a8a6a', G: '#3a6a4a', T: ZE, t: '#e0fff6' };
  asciiTexture(scene, 'founder', [
    '................',
    '......kkkk......',
    '.....khhhhk.....',
    '.....kssssk.....',
    '.....kskksk.....',
    '......kssk......',
    '..kkkkuwwukkkk..',
    '.kuuuuuwruuuuuk.',
    '.ksuuuuwruuuusk.',
    '..kkuuuuuuuukk..',
    '..kgggTTTTgggk..',
    '.kggGgTttTgGggk.',
    'kgGggggTTggggGgk',
    'kggGgggggggGgggk',
    '.kkggkkggkkggkk.',
    '...kk..kk..kk...',
  ], founderPal, 6);
  asciiTexture(scene, 'founder2', [
    '...T....T....T..',
    '..kTk..kTk..kTk.',
    '..kgk.kkkkk.kgk.',
    '..kgkkgggggkkgk.',
    '...kggeTggeTgk..',
    '..kgggggggggggk.',
    '.kgGgTTTTTTgGgk.',
    'kggGTTttttTTGggk',
    'kgggTTttttTTgggk',
    'kgGggTTTTTTggGgk',
    '.kgggggggggggggk',
    '.kgGgggkkgggGgk.',
    'kgggk.kgk.kgggk.',
    'kggk..kgk..kggk.',
    'kkk...kkk...kkk.',
    '................',
  ], founderPal, 6);

  // ------------------------------------------------------------- projectiles
  const tex = (key, w, h, fn) => canvasTexture(scene, key, w, h, fn);
  tex('goo', 10, 10, (c) => {
    c.fillStyle = '#1f8f6a'; c.beginPath(); c.arc(5, 5, 5, 0, Math.PI * 2); c.fill();
    c.fillStyle = ZE; c.beginPath(); c.arc(5, 5, 3.4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e0fff6'; c.fillRect(3, 3, 2, 2);
  });
  tex('paper', 10, 8, (c) => { c.fillStyle = K; c.fillRect(0, 0, 10, 8); c.fillStyle = '#f2f2ee'; c.fillRect(1, 1, 8, 6); c.fillStyle = '#8a8678'; c.fillRect(2, 3, 6, 1); });
  tex('shackle', 12, 12, (c) => {
    c.strokeStyle = K; c.lineWidth = 4; c.beginPath(); c.arc(6, 6, 4, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = '#a0a6ae'; c.lineWidth = 2; c.beginPath(); c.arc(6, 6, 4, 0, Math.PI * 2); c.stroke();
  });
  tex('syringe', 16, 6, (c) => {
    c.fillStyle = K; c.fillRect(0, 1, 14, 4);
    c.fillStyle = '#e8f0f2'; c.fillRect(1, 2, 10, 2); c.fillStyle = ZE; c.fillRect(4, 2, 6, 2);
    c.fillStyle = '#c0c6cc'; c.fillRect(13, 2, 3, 1);
  });
  tex('orb', 12, 12, (c) => {
    c.fillStyle = 'rgba(61,255,197,0.35)'; c.beginPath(); c.arc(6, 6, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = ZE; c.beginPath(); c.arc(6, 6, 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff'; c.fillRect(4, 4, 3, 3);
  });
  tex('cloud', 128, 128, (c) => {
    for (const [r, a] of [[64, 0.18], [52, 0.2], [38, 0.22]]) {
      c.fillStyle = `rgba(61,255,197,${a})`; c.beginPath(); c.arc(64, 64, r, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = 'rgba(31,143,106,0.35)';
    for (const [x, y, r] of [[40, 50, 16], [84, 46, 18], [62, 84, 20], [36, 82, 12], [92, 80, 12]]) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
  });

  // player projectiles for the new weapons
  tex('flame', 10, 10, (c) => {
    c.fillStyle = 'rgba(255,90,40,0.6)'; c.beginPath(); c.arc(5, 5, 5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffb84d'; c.beginPath(); c.arc(5, 5, 3, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff2c0'; c.fillRect(4, 4, 2, 2);
  });
  tex('plasma', 12, 12, (c) => {
    c.fillStyle = 'rgba(176,74,208,0.4)'; c.beginPath(); c.arc(6, 6, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#d080ff'; c.beginPath(); c.arc(6, 6, 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff'; c.fillRect(5, 5, 2, 2);
  });
  tex('grenade', 8, 8, (c) => { c.fillStyle = K; c.fillRect(0, 1, 8, 6); c.fillStyle = '#4a5a3a'; c.fillRect(1, 2, 6, 4); c.fillStyle = '#ffe066'; c.fillRect(6, 3, 2, 2); });
  tex('rail', 26, 4, (c) => { c.fillStyle = 'rgba(61,255,197,0.5)'; c.fillRect(0, 0, 26, 4); c.fillStyle = '#e0fff6'; c.fillRect(2, 1, 24, 2); });
}

// Icons for the new guns and armor (same rect format as placeholders.js).
export const MORE_GUNS = {
  carbine: [[2, 2, 11, 2, '#3d4248'], [13, 3, 3, 1, '#2a2e33'], [4, 4, 2, 3, '#2e3238'], [8, 4, 2, 3, '#2e3238'], [0, 2, 2, 3, '#3d4248'], [6, 1, 4, 1, '#55595f']],
  stapler: [[2, 1, 11, 3, '#c03030'], [3, 4, 9, 2, '#555a60'], [12, 3, 3, 2, '#888d92'], [5, 6, 3, 2, '#222222']],
  torch: [[2, 2, 8, 4, '#c0c6cc'], [10, 3, 5, 2, '#5a5e64'], [15, 3, 1, 2, '#ff8a2a'], [3, 6, 2, 2, '#333333'], [4, 0, 4, 2, '#e86a1a']],
  plasma: [[2, 2, 10, 4, '#4a3a6a'], [12, 3, 3, 2, '#b04ad0'], [5, 3, 4, 2, '#e0a0ff'], [4, 6, 2, 2, '#2a2238']],
  breacher: [[3, 2, 12, 2, '#3a3f45'], [1, 3, 4, 3, '#2a2e33'], [8, 4, 4, 2, '#2e3238'], [6, 4, 2, 3, '#1d1f22'], [15, 2, 1, 2, '#555a60']],
  launcher: [[2, 1, 9, 5, '#4a5a3a'], [11, 2, 5, 3, '#3a4a2a'], [4, 6, 2, 2, '#222222'], [3, 2, 4, 2, '#6a7a5a']],
  minigun: [[4, 1, 12, 1, '#8a8f96'], [4, 3, 12, 1, '#8a8f96'], [4, 5, 12, 1, '#8a8f96'], [1, 1, 4, 6, '#3a3f45'], [2, 7, 3, 1, '#222222']],
  railgun: [[1, 2, 15, 2, '#2a2e33'], [3, 1, 10, 1, '#3dffc5'], [3, 4, 10, 1, '#3dffc5'], [4, 5, 2, 2, '#222222']],
};

export const MORE_ARMOR = {
  sprintboots: [[4, 3, 4, 9, '#3a6ab8'], [8, 3, 4, 9, '#3a6ab8'], [3, 12, 5, 3, '#f2f2f2'], [8, 12, 5, 3, '#f2f2f2']],
  gasmask: [[4, 4, 8, 8, '#3a3f45'], [3, 9, 3, 4, '#5a6068'], [10, 9, 3, 4, '#5a6068'], [5, 5, 2, 2, '#7fd0c0'], [9, 5, 2, 2, '#7fd0c0'], [7, 10, 2, 3, '#222222']],
  hazsuit: [[3, 3, 10, 11, '#e8c020'], [6, 3, 4, 3, null], [3, 8, 10, 1, '#b8901a'], [7, 9, 2, 4, '#3a3f45']],
  tactical: [[3, 5, 10, 7, '#2e3a2a'], [2, 10, 12, 2, '#1d241a'], [4, 8, 8, 2, '#111111'], [5, 5, 6, 1, '#4a5a42']],
  greaves: [[4, 3, 4, 12, '#3a3f4a'], [8, 3, 4, 12, '#3a3f4a'], [4, 6, 4, 7, '#8a8f96'], [8, 6, 4, 7, '#8a8f96']],
  exoframe: [[3, 3, 10, 11, '#3a3f45'], [4, 4, 8, 9, '#c9a84a'], [6, 3, 4, 2, null], [7, 6, 2, 6, '#3dffc5']],
};
