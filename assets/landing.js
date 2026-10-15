(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var root = $('root');
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var DGST_URL = 'mailto:skownclaude@agentmail.to?subject=SUBSCRIBE&body=Sign%20me%20up%20for%20the%20Detroit%20%2B%20MSU%20Morning%20Digest.';
  var started = Date.now();

  var state = { active: 'overview', last: 'NONE', log: [], booting: false, bootOut: false };

  /* ---------- small helpers ---------- */
  function setBind(name, value) {
    var els = document.querySelectorAll('[data-bind="' + name + '"]');
    for (var i = 0; i < els.length; i++) els[i].textContent = value;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function p2(n) { return String(n).padStart(2, '0'); }

  /* ---------- clocks, uptime, session ---------- */
  var CLOCKS = [['CHI', 'America/Chicago'], ['NYC', 'America/New_York'], ['LDN', 'Europe/London'], ['TYO', 'Asia/Tokyo']];
  var fmt = {};
  CLOCKS.forEach(function (c) {
    fmt[c[1]] = new Intl.DateTimeFormat('en-US', { timeZone: c[1], hourCycle: 'h23', weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  });
  var clockRows = CLOCKS.map(function (c) {
    var row = el('div', 'nk-clk');
    var city = el('span', 'nk-clk-c', c[0]);
    var t = el('span', 'nk-clk-t');
    var d = el('span', 'nk-clk-d');
    row.appendChild(city); row.appendChild(t); row.appendChild(d);
    $('clocks').appendChild(row);
    return { tz: c[1], t: t, d: d };
  });
  function parts(date, tz) {
    var o = {};
    fmt[tz].formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  var chiNow = '--:--:--';
  function tick() {
    var now = new Date();
    clockRows.forEach(function (r, i) {
      var p = parts(now, r.tz);
      var time = p.hour + ':' + p.minute + ':' + p.second;
      r.t.textContent = time;
      r.d.textContent = (p.weekday + ' ' + p.month + ' ' + p.day).toUpperCase();
      if (i === 0) chiNow = time;
    });
    setBind('chiTime', chiNow);
    var up = Math.floor((Date.now() - started) / 1000);
    setBind('uptime', p2(Math.floor(up / 3600)) + ':' + p2(Math.floor(up / 60) % 60) + ':' + p2(up % 60));
    setBind('viewport', window.innerWidth + ' × ' + window.innerHeight);
    var chiTape = document.getElementById('tapeChi');
    if (chiTape) chiTape.textContent = 'CHI ' + chiNow;
    var chiTape2 = document.getElementById('tapeChi2');
    if (chiTape2) chiTape2.textContent = 'CHI ' + chiNow;
  }
  try { setBind('tz', Intl.DateTimeFormat().resolvedOptions().timeZone || '—'); } catch (e) { setBind('tz', '—'); }

  /* ---------- system log tape ---------- */
  var SYSLOG = ['WELCOME TO NSKN', 'TYPE HELP <GO> FOR COMMANDS', 'DGST <GO> · GET THE DETROIT + MSU MORNING DIGEST', 'MARKET ANALYSIS · LIVE · QUOTES FOR ANY US TICKER', 'SPORTS · LIVE SCORES, ODDS & TEAM PAGES', '@CHI', 'BUILD v26.10', 'LINK nathanskown.dev'];
  (function buildTape() {
    var track = $('tape');
    [0, 1].forEach(function (copy) {
      var wrap = copy ? el('span', 'nk-dup') : track;
      if (copy) wrap.setAttribute('aria-hidden', 'true');
      SYSLOG.forEach(function (t) {
        var q = el('span', 'nk-q', t === '@CHI' ? 'CHI --:--:--' : t);
        if (t === '@CHI') q.id = copy ? 'tapeChi2' : 'tapeChi';
        wrap.appendChild(q);
      });
      if (copy) track.appendChild(wrap);
    });
  })();

  /* ---------- navigation + panels ---------- */
  var TITLES = { about: 'DES » NATHAN SKOWN', contact: 'CONTACT » NSKN', digest: 'DGST » DETROIT + MSU MORNING DIGEST' };
  function setLast(label) { state.last = label; setBind('last', label); }
  function setActive(k, label) {
    state.active = k;
    if (label) setLast(label + ' <GO>');
    var navs = document.querySelectorAll('.nk-side [data-go]');
    for (var i = 0; i < navs.length; i++) {
      var on = navs[i].getAttribute('data-go') === k;
      navs[i].classList.toggle('is-on', on);
      if (on) navs[i].setAttribute('aria-current', 'page'); else navs[i].removeAttribute('aria-current');
    }
    var show = !!TITLES[k];
    $('panel').hidden = !show;
    $('panelTitle').textContent = TITLES[k] || '';
    var panels = document.querySelectorAll('[data-panel]');
    for (var j = 0; j < panels.length; j++) panels[j].hidden = panels[j].getAttribute('data-panel') !== k;
    $('secDgst').classList.toggle('is-hl', k === 'digest');
    if (show && label) $('panel').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
  }
  var hlTimer;
  function flash(id) {
    clearTimeout(hlTimer);
    ['secMkt', 'secSprt', 'secMusic', 'secDgst'].forEach(function (x) { $(x).classList.toggle('is-hl', x === id || (x === 'secDgst' && state.active === 'digest')); });
    hlTimer = setTimeout(function () {
      ['secMkt', 'secSprt', 'secMusic'].forEach(function (x) { $(x).classList.remove('is-hl'); });
      $('secDgst').classList.toggle('is-hl', state.active === 'digest');
    }, 2600);
  }
  var LABEL = { overview: 'HOME', about: 'ABOUT', contact: 'CONTACT', digest: 'DGST' };
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-go],[data-cmd],[data-action]') : null;
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute('data-go')) { var k = t.getAttribute('data-go'); setActive(k, LABEL[k]); }
    else if (t.hasAttribute('data-cmd')) run(t.getAttribute('data-cmd'));
    else if (t.getAttribute('data-action') === 'closeDrawer') $('drawer').hidden = true;
  });

  /* ---------- command line ---------- */
  var FIN = { WEI: 'Market dashboard', TOP: 'Live headlines', DES: 'Stock quote & company page', HDS: '13F ownership tracker', ERN: 'Earnings dashboard', ECO: 'Macro monitor (FRED)', IPO: 'IPO tracker' };
  var FIN_URL = { WEI: '/finance/', TOP: '/finance/headlines/', DES: '/finance/quote/', HDS: '/finance/ownership/', ERN: '/finance/earnings/', ECO: '/finance/macro/', IPO: '/finance/ipo/' };
  var SPRT = { SCOR: 'Scores & schedules', GAME: 'Game previews & recaps', TEAM: 'Team pages', ODDS: 'Playoff odds', SIM: 'Matchup simulator', INJ: 'Injury report' };
  var SPRT_URL = { SCOR: '/sports/', GAME: '/sports/game/football/', TEAM: '/sports/team/lions/', ODDS: '/sports/odds/', SIM: '/sports/simulator/', INJ: '/sports/injuries/' };
  var MUS = { TRCK: 'Guess the Track', ARTS: 'Guess the Artist' };
  var MUS_URL = { TRCK: '/music/track/', ARTS: '/music/artist/' };
  function helpLines() {
    var r = function (a, b) { return '  ' + a.padEnd(12) + b; };
    return ['SECTIONS', r('MKT', 'Market analysis              2'), r('SPRT', 'Sports                       3'), r('MUS', 'Music games                 4'), r('DGST', 'Morning digest signup        5'), '',
      'PAGES', r('HOME', 'Overview                     1'), r('ABOUT', 'Profile  (WHOAMI)            6'), r('CONTACT', 'Get in touch                 7'), '',
      'SHORTCUTS', '  WEI  TOP  DES  HDS  ERN  ECO  IPO  ·  SCOR  GAME  TEAM  ODDS  SIM  INJ  ·  TRCK  ARTS', '',
      'SYSTEM', r('REBOOT', 'Replay the boot sequence'), r('CLEAR', 'Clear this console')];
  }
  function renderDrawer() {
    var box = $('drawerLines');
    box.textContent = '';
    state.log.slice(-16).forEach(function (l) {
      if (l.href) {
        var d = el('div'); var a = el('a', 'l-link', l.t); a.href = l.href; d.appendChild(a); box.appendChild(d);
      } else box.appendChild(el('div', 'l-' + (l.k || 'out'), l.t));
    });
    $('drawer').hidden = false;
  }
  function run(raw) {
    var c = String(raw || '').trim().toUpperCase().replace(/(\s+|<)GO>?$/, '').trim();
    var L = function (t, k) { return { t: t, k: k }; };
    var LINK = function (t, href) { return { t: t, href: href }; };
    if (!c) { state.log.push(L('TYPE A FUNCTION, E.G.  HELP  ·  MKT  ·  DGST', 'dim')); renderDrawer(); return; }
    var out = [L('NSKN › ' + c + ' <GO>', 'echo')];
    var active = null;
    if (c === 'HELP' || c === 'H' || c === '?') helpLines().forEach(function (t) { out.push(L(t)); });
    else if (['MKT', 'MARKET', 'MARKETS', 'FIN', 'FINANCE', '2'].indexOf(c) > -1) { flash('secMkt'); out.push(L('MARKET ANALYSIS · 8 PAGES · LIVE DATA')); out.push(LINK('▸ OPEN MARKET ANALYSIS', '/finance/')); }
    else if (['SPRT', 'SPORT', 'SPORTS', '3'].indexOf(c) > -1) { flash('secSprt'); out.push(L('SPORTS · SCORES, GAME CENTER, TEAMS, ODDS, SIMULATOR')); out.push(LINK('▸ OPEN SPORTS', '/sports/')); }
    else if (['MUS', 'MUSIC', '4'].indexOf(c) > -1) { flash('secMusic'); out.push(L('MUSIC · GUESS THE TRACK, GUESS THE ARTIST')); out.push(LINK('▸ OPEN MUSIC', '/music/')); }
    else if (MUS[c]) { flash('secMusic'); out.push(L(c + ' · ' + MUS[c].toUpperCase())); out.push(LINK('▸ OPEN ' + c, MUS_URL[c])); }
    else if (FIN[c]) { flash('secMkt'); out.push(L(c + ' · ' + FIN[c].toUpperCase())); out.push(LINK('▸ OPEN ' + c, FIN_URL[c])); }
    else if (SPRT[c]) { flash('secSprt'); out.push(L(c + ' · ' + SPRT[c].toUpperCase())); out.push(LINK('▸ OPEN ' + c, SPRT_URL[c])); }
    else if (['DGST', 'DIGEST', 'SUB', 'SUBSCRIBE', 'SIGNUP', '5'].indexOf(c) > -1) { active = 'digest'; out.push(L('DETROIT + MSU MORNING DIGEST · EVERY MORNING 5:15 AM CT')); out.push(LINK('▸ SUBSCRIBE BY EMAIL', DGST_URL)); }
    else if (['ABOUT', 'WHOAMI', 'BIO', '6'].indexOf(c) > -1) { active = 'about'; out.push(L('NATHAN SKOWN · CHICAGO, IL · MARKETS + SPORTS')); }
    else if (['CONTACT', 'MSG', '7'].indexOf(c) > -1) { active = 'contact'; out.push(L('CONTACT CHANNELS LISTED BELOW THE HERO')); }
    else if (['HOME', 'MENU', 'OVERVIEW', '1'].indexOf(c) > -1) { active = 'overview'; out.push(L('RETURNED TO HOME')); }
    else if (c === 'CLEAR' || c === 'CLS') { state.log = []; $('drawer').hidden = true; setLast(c + ' <GO>'); return; }
    else if (c === 'REBOOT') { setLast('REBOOT <GO>'); $('drawer').hidden = true; reboot(); return; }
    else if (c === 'SUDO' || c.indexOf('SUDO ') === 0) out.push(L('PERMISSION DENIED. THIS INCIDENT WILL BE REPORTED.', 'err'));
    else out.push(L('"' + c + '" IS NOT A RECOGNIZED FUNCTION.  TRY  HELP <GO>', 'err'));
    state.log = state.log.concat(out).slice(-40);
    setLast(c + ' <GO>');
    if (active) setActive(active);
    renderDrawer();
  }
  $('cmdForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('nk-cmd-in');
    var v = input.value; input.value = '';
    run(v);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') $('drawer').hidden = true;
  });

  /* ---------- headline scramble + typing ---------- */
  var scr = null, typ = null, typedOnce = false;
  function type() {
    var T = 'a personal terminal for market analysis & sports';
    var out = $('typed');
    if (reduced) { out.textContent = T; return; }
    var i = 0; clearInterval(typ);
    typ = setInterval(function () { i++; out.textContent = T.slice(0, i); if (i >= T.length) clearInterval(typ); }, 28);
  }
  function scramble() {
    var A = 'NATHAN', B = 'SKOWN', G = '#$%&*+=<>/?|0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    var a = $('nameA'), b = $('nameB');
    if (reduced) { a.textContent = A; b.textContent = B; if (!typedOnce) { typedOnce = true; type(); } return; }
    var dur = 1250, start = performance.now();
    var la = A.split('').map(function () { return dur * (0.2 + Math.random() * 0.8); });
    var lb = B.split('').map(function () { return dur * (0.2 + Math.random() * 0.8); });
    var mix = function (s, locks, e) { return s.split('').map(function (ch, i) { return e >= locks[i] ? ch : G[Math.floor(Math.random() * G.length)]; }).join(''); };
    clearInterval(scr);
    scr = setInterval(function () {
      var e = performance.now() - start;
      if (e >= dur) {
        clearInterval(scr); scr = null; a.textContent = A; b.textContent = B;
        if (!typedOnce) { typedOnce = true; type(); }
        return;
      }
      a.textContent = mix(A, la, e); b.textContent = mix(B, lb, e);
    }, 45);
  }
  $('name').addEventListener('pointerenter', function () { if (!state.booting && !scr) scramble(); });

  /* ---------- boot sequence ---------- */
  var BOOT = [
    ['NSKN TERMINAL v26.10 · (C) 2026 NATHAN SKOWN', 'READY'],
    ['POST · MEMORY CHECK · PHOSPHOR P1', 'OK'],
    ['MOUNT  /website', 'OK'],
    ['MOUNT  /website/finance', 'OK'],
    ['MOUNT  /website/sports', 'OK'],
    ['HANDSHAKE  nathanskown.dev:443', 'OK'],
    ['SYNC CLOCKS  CHI · NYC · LDN · TYO', 'OK'],
    ['BUILD SURFACE  IV(K,T) · 36x22 MESH', 'OK'],
    ['INDEX SECTIONS  MARKET ANALYSIS · SPORTS · MUSIC', 'OK']
  ];
  var bootN = 0, bt = null;
  function bootLine(b) {
    var row = el('div', 'nk-bl');
    row.appendChild(el('span', '', b[0]));
    row.appendChild(el('span', 'nk-lead'));
    row.appendChild(el('span', 'nk-ok', b[1]));
    return row;
  }
  function runBoot() {
    var boot = $('boot');
    state.booting = true; state.bootOut = false; bootN = 0;
    $('bootLines').textContent = ''; $('bootReady').textContent = ''; $('bootBar').style.width = '0%';
    boot.classList.remove('is-out'); boot.hidden = false;
    var step = function () {
      if (!state.booting || state.bootOut) return;
      $('bootLines').appendChild(bootLine(BOOT[bootN]));
      bootN++;
      $('bootBar').style.width = Math.round(bootN / BOOT.length * 100) + '%';
      if (bootN < BOOT.length) bt = setTimeout(step, 140 + Math.random() * 120);
      else { $('bootReady').textContent = 'READY. TYPE HELP <GO> FOR COMMANDS.'; bt = setTimeout(function () { endBoot(false); }, 700); }
    };
    clearTimeout(bt); bt = setTimeout(step, 260);
  }
  function endBoot(skip) {
    if (!state.booting || state.bootOut) return;
    clearTimeout(bt);
    state.bootOut = true;
    $('boot').classList.add('is-out');
    bt = setTimeout(function () { $('boot').hidden = true; state.booting = false; scramble(); }, skip ? 220 : 470);
  }
  function reboot() {
    clearInterval(scr); scr = null; clearInterval(typ); typedOnce = false; $('typed').textContent = '';
    if (reduced) { scramble(); return; }
    runBoot();
  }
  $('skipBoot').addEventListener('click', function () { endBoot(true); });

  /* ---------- implied-vol surface ---------- */
  var canvas = $('surface'), hero = $('hero');
  var t0 = 0, mx = 0, my = 0, tmx = 0, tmy = 0;
  hero.addEventListener('pointermove', function (e) {
    var r = hero.getBoundingClientRect();
    tmx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    tmy = ((e.clientY - r.top) / r.height - 0.5) * 2;
  });
  hero.addEventListener('pointerleave', function () { tmx = 0; tmy = 0; });
  var RGB = '141,255,156';
  var TENORS = ['1M', '2M', '3M', '4M', '5M', '6M', '7M', '8M', '9M', '10M', '11M', '1Y', '13M', '14M', '15M', '16M', '18M', '19M', '20M', '21M', '22M', '2Y'];
  function draw(now) {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (w > 0 && h > 0) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var W = Math.round(w * dpr), H = Math.round(h * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!t0) t0 = now;
      var t = reduced ? 3 : (now - t0) / 1000;
      mx += (tmx - mx) * 0.05; my += (tmy - my) * 0.05;
      var narrow = w < 700;
      var cx = narrow ? w * 0.5 : w * 0.72;
      var cy = narrow ? h - Math.min(170, h * 0.27) : h * 0.5;
      var S = narrow ? Math.min(w * 0.42, 172) : Math.min(w * 0.27, h * 0.48);
      var yaw = -0.62 + Math.sin(t * 0.12) * 0.55 + mx * 0.7;
      var pitch = 0.5 + my * 0.28;
      var cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      var proj = function (u, v, z) {
        var X = u * cyw - v * syw, D = u * syw + v * cyw, zz = z * 0.85;
        var Y = zz * cp + D * sp, Dz = D * cp - zz * sp, k = 3.4 / (3.4 + Dz);
        return [cx + X * S * k, cy - Y * S * k, Dz];
      };
      var surf = function (u, v) {
        var T = (v + 1) / 2;
        return 0.52 * u * u * (1.1 - 0.7 * T) - 0.17 * u * (1 - 0.55 * T) + 0.24 * Math.exp(-3.4 * T)
          + 0.05 * Math.sin(2.4 * u + 1.9 * v + t * 0.9) + 0.03 * Math.cos(3.3 * v - t * 0.6 + u * 1.3) - 0.12;
      };
      var NU = 36, NV = 22, zF = -0.36, pts = [], best = null, i, j;
      for (j = 0; j < NV; j++) {
        var v = -1 + 2 * j / (NV - 1), row = [];
        for (i = 0; i < NU; i++) {
          var u = -1 + 2 * i / (NU - 1), z = surf(u, v), p = proj(u, v, z);
          p.push(z); row.push(p);
          if (!best || z > best[3]) best = p;
        }
        pts.push(row);
      }
      ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(' + RGB + ',0.18)';
      ctx.beginPath();
      for (var q = 0; q <= 4; q++) {
        var s = -1 + q * 0.5, a = proj(s, -1, zF), b = proj(s, 1, zF);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        a = proj(-1, s, zF); b = proj(1, s, zF);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      [[-1, -1, 0, 0], [1, -1, NU - 1, 0], [-1, 1, 0, NV - 1], [1, 1, NU - 1, NV - 1]].forEach(function (k) {
        var a2 = proj(k[0], k[1], zF), b2 = pts[k[3]][k[2]];
        ctx.moveTo(a2[0], a2[1]); ctx.lineTo(b2[0], b2[1]);
      });
      ctx.stroke(); ctx.setLineDash([]);
      var NB = 7, paths = [];
      for (var bb = 0; bb < NB; bb++) paths.push(new Path2D());
      var bucket = function (z1, z2, d) {
        var zn = ((z1 + z2) / 2 + 0.25) / 1.2, dn = Math.max(0, Math.min(1, (1.4 - d) / 2.8));
        return Math.floor(Math.max(0, Math.min(0.999, 0.62 * zn + 0.38 * dn)) * NB);
      };
      for (j = 0; j < NV; j++) for (i = 0; i < NU; i++) {
        var pp = pts[j][i], qq, bk;
        if (i < NU - 1) { qq = pts[j][i + 1]; bk = bucket(pp[3], qq[3], pp[2]); paths[bk].moveTo(pp[0], pp[1]); paths[bk].lineTo(qq[0], qq[1]); }
        if (j < NV - 1) { qq = pts[j + 1][i]; bk = bucket(pp[3], qq[3], pp[2]); paths[bk].moveTo(pp[0], pp[1]); paths[bk].lineTo(qq[0], qq[1]); }
      }
      for (bb = 0; bb < NB; bb++) {
        ctx.strokeStyle = 'rgba(' + RGB + ',' + (0.1 + 0.82 * Math.pow(bb / (NB - 1), 1.35)).toFixed(3) + ')';
        ctx.lineWidth = bb >= NB - 2 ? 1.3 : 1;
        if (bb === NB - 1) { ctx.shadowColor = 'rgba(' + RGB + ',0.8)'; ctx.shadowBlur = 6; }
        ctx.stroke(paths[bb]); ctx.shadowBlur = 0;
      }
      var js = Math.floor(((t * 0.09) % 1) * NV);
      ctx.strokeStyle = 'rgba(' + RGB + ',0.95)'; ctx.lineWidth = 1.8;
      ctx.shadowColor = 'rgba(' + RGB + ',0.9)'; ctx.shadowBlur = 10;
      ctx.beginPath();
      pts[js].forEach(function (p3, k) { if (k === 0) ctx.moveTo(p3[0], p3[1]); else ctx.lineTo(p3[0], p3[1]); });
      ctx.stroke(); ctx.shadowBlur = 0;
      ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(' + RGB + ',0.72)';
      // keep every label fully inside the frame (narrow screens used to clip them)
      var put = function (txt, x, y) { var tw2 = ctx.measureText(txt).width; ctx.fillText(txt, Math.max(4, Math.min(x, w - tw2 - 4)), y); };
      var lab = function (u2, v2, txt, dx, dy) { var p4 = proj(u2, v2, zF); put(txt, p4[0] + dx, p4[1] + dy); };
      if (w >= 560) {  // axis labels only where there's room for them
        [['80%', -1], ['100%', 0], ['120%', 1]].forEach(function (x) { lab(x[1], -1.12, x[0], -12, 13); });
        lab(0, -1.4, 'STRIKE / SPOT', -38, 15);
        [['1M', -1], ['6M', 0], ['2Y', 1]].forEach(function (x) { lab(1.12, x[1], x[0], 6, 4); });
        lab(1.42, 0, 'TENOR', 6, 18);
      }
      var sl = pts[js][NU - 1];
      ctx.fillStyle = 'rgba(' + RGB + ',0.95)';
      put('T=' + TENORS[js], sl[0] + 8, sl[1] + 3);
      if (best) {
        var bx = best[0], by = best[1], iv = (16 + (best[3] + 0.2) * 22).toFixed(1);
        var txt = 'MAX IV ' + iv + '%  [SIM]', tw = ctx.measureText(txt).width, left = bx + 20 + tw > w - 8;
        ctx.strokeStyle = 'rgba(' + RGB + ',1)'; ctx.lineWidth = 1;
        ctx.strokeRect(bx - 3.5, by - 3.5, 7, 7);
        ctx.beginPath(); ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by - 34); ctx.lineTo(left ? bx - 14 : bx + 14, by - 34); ctx.stroke();
        ctx.fillStyle = 'rgba(' + RGB + ',1)';
        put(txt, left ? bx - 18 - tw : bx + 18, by - 30);
      }
    }
    if (!reduced) requestAnimationFrame(draw);
  }

  /* ---------- start ---------- */
  tick();
  setInterval(function () { tick(); if (reduced) draw(performance.now()); }, 1000);
  requestAnimationFrame(draw);
  var seen = false;
  try { seen = sessionStorage.getItem('nskn-booted') === '1'; sessionStorage.setItem('nskn-booted', '1'); } catch (e) { seen = false; }
  if (!reduced && !seen) runBoot(); else scramble();
  if (location.hash === '#digest') setActive('digest');
  if (location.hash === '#contact') setActive('contact');

  /* ---------- Right Now: live markets + the next Detroit / MSU games ---------- */
  (function rightNow() {
    var box = document.getElementById('now');
    if (!box || !window.fetch) return;
    var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var v5 = Math.floor(Date.now() / 300000);
    var j = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); };
    var TILES = [['spx', 'S&P 500', 2], ['ixic', 'NASDAQ', 2], ['tnx', 'US 10Y', 2], ['vix', 'VIX', 2]];
    // Detroit first, then MSU, in the order they matter
    var TEAMS = [
      ['Lions', 'football/nfl', '8', 'lions'], ['Tigers', 'baseball/mlb', '6', 'tigers'], ['Pistons', 'basketball/nba', '8', 'pistons'],
      ['Red Wings', 'hockey/nhl', '5', 'red-wings'], ['MSU Hoops', 'basketball/mens-college-basketball', '127', 'msu-basketball'],
      ['MSU Football', 'football/college-football', '127', 'msu-football'], ['MSU Hockey', 'hockey/mens-college-hockey', '127', 'msu-hockey']];
    var mk = '', games = '';
    function render() { box.innerHTML = mk + games; }
    function when(iso) {
      var d = new Date(iso), now = new Date();
      var day = d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).toUpperCase();
      var same = d.toLocaleDateString('en-US', { timeZone: 'America/Chicago' }) === now.toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
      var t = d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).replace(':00', '');
      return (same ? 'TODAY' : day) + ' ' + t;
    }
    j('/data/finance/dashboard.json?v=' + v5).then(function (d) {
      var by = {}; (d.tiles || []).forEach(function (t) { by[t.id] = t; });
      mk = '<dt class="nk-now-h">MARKETS</dt>' + TILES.map(function (x) {
        var t = by[x[0]]; if (!t || t.price == null) return '';
        var up = (t.pct || 0) >= 0;
        var px = x[0] === 'tnx' ? t.price.toFixed(2) + '%' : t.price.toLocaleString('en-US', { minimumFractionDigits: x[2], maximumFractionDigits: x[2] });
        return '<dt>' + esc(x[1]) + '</dt><dd>' + px + '</dd><dd class="nk-chg' + (up ? '' : ' nk-dn') + '">' + (up ? '▲ +' : '▼ −') + Math.abs(t.pct || 0).toFixed(2) + '%</dd>';
      }).join('');
      var asof = document.getElementById('nowAsOf');
      if (asof && d.asOf) asof.textContent = 'As of ' + new Date(d.asOf * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' CT';
      render();
    }).catch(function () { mk = ''; render(); });
    // next game for each team, then show the soonest few
    Promise.all(TEAMS.map(function (t) {
      return j('/api/espn/site/v2/sports/' + t[1] + '/teams/' + t[2] + '/schedule').then(function (s) {
        var now = Date.now();
        var next = (s.events || []).map(function (e) {
          var c = (e.competitions || [])[0] || {}, st = ((c.status || {}).type || {});
          var cs = c.competitors || [], me = cs.filter(function (x) { return String((x.team || {}).id) === t[2]; })[0] || {}, op = cs.filter(function (x) { return x !== me; })[0] || {};
          var sc = function (x) { return x.score && typeof x.score === 'object' ? x.score.displayValue : (x.score || ''); };
          return { t: t, at: Date.parse(e.date), state: st.state, detail: st.shortDetail || '', home: me.homeAway === 'home',
            opp: ((op.team || {}).abbreviation || (op.team || {}).shortDisplayName || 'TBD'), my: sc(me), their: sc(op) };
        }).filter(function (g) { return g.state === 'in' || (g.state === 'pre' && g.at > now - 3600000); })
          .sort(function (a, b) { return (a.state === 'in' ? -1 : 0) - (b.state === 'in' ? -1 : 0) || a.at - b.at; })[0];
        return next || null;
      }).catch(function () { return { err: true }; });
    })).then(function (list) {
      var week = Date.now() + 8 * 86400000;
      var failed = list.every(function (g) { return g && g.err; });
      var up = list.filter(function (g) { return g && !g.err && (g.state === 'in' || g.at < week); })
        .sort(function (a, b) { return (a.state === 'in' ? -1 : 0) - (b.state === 'in' ? -1 : 0) || a.at - b.at; }).slice(0, 5);
      games = '<dt class="nk-now-h">NEXT UP · DETROIT + MSU</dt>' + (up.length ? up.map(function (g) {
        var right = g.state === 'in' ? '<span class="nk-live">LIVE ' + esc(g.my) + '–' + esc(g.their) + ' · ' + esc(g.detail) + '</span>' : esc(when(g.at));
        return '<a href="/sports/team/' + g.t[3] + '/"><span>' + esc(g.t[0].toUpperCase()) + (g.home ? ' vs ' : ' @ ') + esc(g.opp) + '</span><span>' + right + '</span></a>';
      }).join('') : '<dd class="nk-now-note">' + (failed ? 'Schedules are unavailable right now.' : 'No Detroit or MSU games in the next week.') + '</dd>');
      render();
    });
  })();
})();
