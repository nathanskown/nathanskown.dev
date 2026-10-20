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
  /* The visitor's own zone first, then three market cities (a fourth stands in if the visitor is in one of them). */
  var LOCAL_TZ = 'UTC';
  try { LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) {}
  var ZONE = (function () {
    try {
      var n = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date()).filter(function (p) { return p.type === 'timeZoneName'; })[0];
      return n ? n.value.replace(/^([ECMP])[SD]T$/, '$1T') : 'LOCAL';
    } catch (e) { return 'LOCAL'; }
  })();
  var CLOCKS = [['LOCAL', LOCAL_TZ]].concat([['NYC', 'America/New_York'], ['LDN', 'Europe/London'], ['TYO', 'Asia/Tokyo'], ['HKG', 'Asia/Hong_Kong']]
    .filter(function (c) { return c[1] !== LOCAL_TZ; }).slice(0, 3));
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
    setBind('zoneLabel', ZONE);
    var up = Math.floor((Date.now() - started) / 1000);
    setBind('uptime', p2(Math.floor(up / 3600)) + ':' + p2(Math.floor(up / 60) % 60) + ':' + p2(up % 60));
    setBind('viewport', window.innerWidth + ' × ' + window.innerHeight);
    var chiTape = document.getElementById('tapeChi');
    if (chiTape) chiTape.textContent = ZONE + ' ' + chiNow;
    var chiTape2 = document.getElementById('tapeChi2');
    if (chiTape2) chiTape2.textContent = ZONE + ' ' + chiNow;
  }
  try { setBind('tz', Intl.DateTimeFormat().resolvedOptions().timeZone || '—'); } catch (e) { setBind('tz', '—'); }

  /* ---------- system log tape ---------- */
  var SYSLOG = ['WELCOME TO NSKN', 'TYPE HELP <GO> FOR COMMANDS', 'DGST <GO> · GET THE DETROIT + MSU MORNING DIGEST', 'MARKET ANALYSIS · LIVE · QUOTES FOR ANY US TICKER', 'SPORTS · LIVE SCORES, ODDS & TEAM PAGES', 'MUSIC · GUESS THE TRACK & GUESS THE ARTIST', '@CHI', 'BUILD v26.10', 'LINK nathanskown.dev'];
  (function buildTape() {
    var track = $('tape');
    if (!track) return;
    [0, 1].forEach(function (copy) {
      var wrap = copy ? el('span', 'nk-dup') : track;
      if (copy) wrap.setAttribute('aria-hidden', 'true');
      SYSLOG.forEach(function (t) {
        var q = el('span', 'nk-q', t === '@CHI' ? ZONE + ' --:--:--' : t);
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
    if (show && label) {
      $('panel').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
      // move keyboard and screen-reader focus to the panel that just opened
      var pt = $('panelTitle'); pt.setAttribute('tabindex', '-1'); try { pt.focus({ preventScroll: true }); } catch (e) { pt.focus(); }
    }
    try { history.replaceState(null, '', show ? '#' + k : location.pathname); } catch (e) { /* ignore */ }
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
  var FIN_URL = { WEI: '/finance/', TOP: '/finance/headlines/', DES: '/finance/quote/', HDS: '/finance/ownership/', ERN: '/finance/earnings/', ECO: '/finance/macro/', IPO: '/finance/ipo/', EQS: '/finance/screener/' };
  var SPRT = { SCOR: 'Scores & schedules', GAME: 'Game previews & recaps', TEAM: 'Team pages', ODDS: 'Playoff odds', SIM: 'Matchup simulator', INJ: 'Injury report' };
  var SPRT_URL = { SCOR: '/sports/', GAME: '/sports/game/', TEAM: '/sports/teams/', ODDS: '/sports/odds/', SIM: '/sports/simulator/', INJ: '/sports/injuries/' };
  var MUS = { TRCK: 'Guess the Track', ARTS: 'Guess the Artist' };
  var MUS_URL = { TRCK: '/music/track/', ARTS: '/music/artist/' };
  function helpLines() {
    var r = function (a, b) { return '  ' + a.padEnd(12) + b; };
    return ['SECTIONS', r('MKT', 'Market analysis              2'), r('SPRT', 'Sports                       3'), r('MUS', 'Music games                 4'), r('DGST', 'Morning digest signup        5'), '',
      'PAGES', r('HOME', 'Overview                     1'), r('ABOUT', 'Profile  (WHOAMI)            6'), r('CONTACT', 'Get in touch                 7'), '',
      'SHORTCUTS', '  WEI  TOP  DES  HDS  ERN  ECO  IPO  ·  SCOR  GAME  TEAM  ODDS  SIM  INJ  ·  TRCK  ARTS', '',
      'LOOK UP', r('MOD', 'Any US ticker → quote page'), r('MOD HDS', 'Ticker → 13F ownership'), r('LIONS', 'Any team → team page (add NFL, BB, FB…)'), '',
      'SYSTEM', r('HOOD', 'How the site works, sources, model scorecard'), r('STATUS', 'Data feed health'), r('REBOOT', 'Replay the boot sequence'), r('CLEAR', 'Clear this console')];
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
    else if (c === 'HOOD' || c === 'HOW') { out.push(L('WHERE EVERY NUMBER COMES FROM, HOW IT IS CHECKED, AND THE MODEL SCORECARD')); out.push(LINK('▸ OPEN UNDER THE HOOD', '/under-the-hood/')); }
    else if (c === 'STATUS' || c === 'SYS') { out.push(L('DATA FEEDS, REFRESH JOBS AND SANITY CHECKS')); out.push(LINK('▸ OPEN SYSTEM STATUS', '/status/')); }
    else if (c === 'REBOOT') { setLast('REBOOT <GO>'); $('drawer').hidden = true; reboot(); return; }
    else if (c === 'SUDO' || c.indexOf('SUDO ') === 0) out.push(L('PERMISSION DENIED. THIS INCIDENT WILL BE REPORTED.', 'err'));
    else { lookup(c, out); return; }
    state.log = state.log.concat(out).slice(-40);
    setLast(c + ' <GO>');
    if (active) setActive(active);
    renderDrawer();
  }
  /* Anything that isn't a function code: a ticker (MOD, MOD HDS, BRK.B), a team (LIONS, MICHIGAN STATE BB) or a
     company name. Lists load once, on first use. */
  var LISTS = null;
  function lists() {
    if (!LISTS) LISTS = Promise.all([
      fetch('/data/finance/tickers.json').then(function (r) { return r.json(); }).catch(function () { return { t: [] }; }),
      fetch('/data/sports/teams.json').then(function (r) { return r.json(); }).catch(function () { return { leagues: {} }; })
    ]);
    return LISTS;
  }
  var LG_WORD = { NFL: 'nfl', MLB: 'mlb', NBA: 'nba', NHL: 'nhl', FB: 'ncaaf', NCAAF: 'ncaaf', CFB: 'ncaaf', BB: 'ncaab', NCAAB: 'ncaab', CBB: 'ncaab', HKY: 'ncaah', HOCKEY: 'ncaah', NCAAH: 'ncaah' };
  var LG_PRI = { nfl: 0, mlb: 1, nba: 2, nhl: 3, ncaaf: 4, ncaab: 5, ncaah: 6 };
  function lookup(c, out) {
    var L = function (t, k) { return { t: t, k: k }; };
    var go = function (label, href) {
      out.push(L('LOADING ' + label + ' …'));
      state.log = state.log.concat(out).slice(-40); setLast(c + ' <GO>'); renderDrawer();
      location.href = href;
    };
    var words = c.split(/\s+/), fn = words.length > 1 && (FIN[words[words.length - 1]] || words[words.length - 1] === 'EQUITY') ? words.pop() : null;
    if (words[words.length - 1] === 'US' || words[words.length - 1] === 'EQUITY') words = words.filter(function (w) { return w !== 'US' && w !== 'EQUITY'; });
    var q = words.join(' ');
    lists().then(function (res) {
      var T = res[0].t || [], leagues = res[1].leagues || {};
      var sym = q.replace(/^([A-Z]{1,6})[./]([A-Z]{1,2})$/, '$1-$2');
      var tk = T.filter(function (x) { return x[0] === sym; })[0];
      var page = fn === 'HDS' ? '/finance/ownership/?ticker=' : '/finance/quote/?sym=';
      if (tk) return go(tk[0] + ' · ' + String(tk[1]).toUpperCase(), page + encodeURIComponent(tk[0]));
      // teams: "LIONS", "DETROIT LIONS", "MICHIGAN STATE BB"
      var tw = q.split(' '), lgWant = LG_WORD[tw[tw.length - 1]] || null;
      if (lgWant) tw.pop();
      var tq = tw.join(' ').toLowerCase();
      var hits = [];
      Object.keys(leagues).forEach(function (lg) {
        if (lgWant && lg !== lgWant) return;
        leagues[lg].forEach(function (t) {
          var names = [t.name, t.short, t.nick, t.loc + ' ' + t.nick].filter(Boolean).map(function (n) { return n.toLowerCase(); });
          var score = names.indexOf(tq) >= 0 ? 0 : (names.some(function (n) { return (' ' + n + ' ').indexOf(' ' + tq + ' ') >= 0; }) ? 1 : 9);
          if (score < 9) hits.push({ lg: lg, t: t, s: score * 10 + LG_PRI[lg] });
        });
      });
      hits.sort(function (a, b) { return a.s - b.s; });
      if (tq.length >= 3 && hits.length) {
        var h = hits[0];
        return go(h.t.name.toUpperCase() + ' (' + h.lg.toUpperCase() + ')', '/sports/team/?lg=' + h.lg + '&id=' + encodeURIComponent(h.t.id));
      }
      // company name
      if (q.length >= 3) {
        var co = T.filter(function (x) { return String(x[1]).toUpperCase().indexOf(q) === 0; })[0] || T.filter(function (x) { return String(x[1]).toUpperCase().indexOf(' ' + q) >= 0; })[0];
        if (co) return go(co[0] + ' · ' + String(co[1]).toUpperCase(), page + encodeURIComponent(co[0]));
      }
      out.push(L('"' + c + '" IS NOT A FUNCTION, TICKER OR TEAM.  TRY  HELP <GO>', 'err'));
      state.log = state.log.concat(out).slice(-40); setLast(c + ' <GO>'); renderDrawer();
    });
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

  /* ---------- hero: one big word that cycles MARKETS → SPORTS → MUSIC ----------
     Each mode recolors the hero, morphs the wireframe into its own surface, and retypes the line under the
     headline with live numbers when they're in. Hovering a section card (or a mode tab) jumps to that mode. */
  var MODES = [
    { k: 'mkt', word: 'MARKETS', rgb: [255, 191, 58], card: 'secMkt', fig: 'FIG.1 · IMPLIED VOL SURFACE · SIMULATED · MOVE TO TILT',
      line: function (L) { return L.spx ? 'S&P 500 ' + L.spx + '  ·  quotes, filings & 13F ownership for any US ticker' : 'quotes, filings & 13F ownership for any US ticker'; } },
    { k: 'sprt', word: 'SPORTS', rgb: [102, 230, 242], card: 'secSprt', fig: 'FIG.2 · WIN PROBABILITY FIELD · SIMULATED · MOVE TO TILT',
      line: function (L) { return (L.live ? L.live + ' games live right now  ·  ' : L.next ? 'next up: ' + L.next + '  ·  ' : '') + 'scores, odds & simulations, every league'; } },
    { k: 'mus', word: 'MUSIC', rgb: [213, 139, 255], card: 'secMusic', fig: 'FIG.3 · SPECTRUM RIPPLE · SIMULATED · MOVE TO TILT',
      line: function () { return 'name the song from a one-second clip  ·  new daily challenge every day'; } }
  ];
  var LIVE = window.NSKN_LIVE = window.NSKN_LIVE || {};
  var mode = 0, modeAt = 0, held = false, CYCLE = 6500;
  var scr = null, typ = null, typedOnce = false;
  var G = '#$%&*+=<>/?|0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  function type() {
    var T = MODES[mode].line(LIVE);
    var out = $('typed');
    clearInterval(typ);
    if (reduced) { out.textContent = T; return; }
    var i = 0;
    typ = setInterval(function () { i++; out.textContent = T.slice(0, i); if (i >= T.length) clearInterval(typ); }, 18);
  }
  function scramble() {
    var A = MODES[mode].word, a = $('wordA');
    typedOnce = true;
    if (reduced) { a.textContent = A; type(); return; }
    var from = a.textContent || '', n = Math.max(from.length, A.length), dur = 700, start = performance.now();
    var locks = []; for (var q = 0; q < n; q++) locks.push(dur * (0.25 + 0.75 * q / n) * (0.7 + Math.random() * 0.3));
    clearInterval(scr);
    scr = setInterval(function () {
      var e = performance.now() - start, out = '';
      for (var i = 0; i < n; i++) out += e >= locks[i] ? (A[i] || '') : G[Math.floor(Math.random() * G.length)];
      a.textContent = out;
      if (e >= dur) { clearInterval(scr); scr = null; a.textContent = A; }
    }, 40);
    type();
  }
  function setMode(i, why) {
    i = (i + MODES.length) % MODES.length;
    var changed = i !== mode;
    mode = i; modeAt = performance.now();
    var m = MODES[i], hero = $('hero');
    hero.setAttribute('data-mode', m.k);
    hero.style.setProperty('--hg', 'rgb(' + m.rgb.join(',') + ')');
    if ($('modeIdx')) $('modeIdx').textContent = '0' + (i + 1);
    $('modeName').textContent = m.word;
    if ($('fig')) $('fig').textContent = m.fig;
    var tabs = document.querySelectorAll('.nk-mode');
    for (var t = 0; t < tabs.length; t++) { var on = +tabs[t].getAttribute('data-mode') === i; tabs[t].classList.toggle('is-on', on); tabs[t].setAttribute('aria-selected', on); }
    MODES.forEach(function (x, k) { var c = $(x.card); if (c) c.classList.toggle('is-mode', k === i); });
    if (changed || why === 'start') scramble();
  }
  // a tab's progress bar shows time until the next mode; hovering anything in the hero holds the current one
  function cycleTick(now) {
    if (!state.booting && !held && !reduced && now - modeAt > CYCLE && !document.hidden) setMode(mode + 1);
    var bar = document.querySelector('.nk-mode.is-on .nk-mode-bar');
    var f = held || reduced ? 1 : Math.min(1, (now - modeAt) / CYCLE);
    if (bar) bar.style.transform = 'scaleX(' + f.toFixed(3) + ')';
  }
  MODES.forEach(function (m, i) {
    var c = $(m.card);
    if (!c) return;
    c.addEventListener('pointerenter', function () { held = true; setMode(i); });
    c.addEventListener('focus', function () { held = true; setMode(i); });
    c.addEventListener('pointerleave', function () { held = false; modeAt = performance.now(); });
    c.addEventListener('blur', function () { held = false; modeAt = performance.now(); });
  });
  document.querySelectorAll('.nk-mode').forEach(function (b) {
    b.addEventListener('click', function () { setMode(+b.getAttribute('data-mode')); });
  });
  $('word').addEventListener('pointerenter', function () { if (!state.booting && !scr) scramble(); });
  // cursor spotlight on the hero
  $('hero').addEventListener('pointermove', function (e) {
    var r = this.getBoundingClientRect();
    this.style.setProperty('--sx', (e.clientX - r.left) + 'px');
    this.style.setProperty('--sy', (e.clientY - r.top) + 'px');
  });
  // keys: / focuses the command line; 1-3 pick a mode; ← → step through modes
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); $('nk-cmd-in').focus(); }
    else if (e.key >= '1' && e.key <= '3') setMode(+e.key - 1);
    else if (e.key === 'ArrowRight') setMode(mode + 1);
    else if (e.key === 'ArrowLeft') setMode(mode - 1);
  });
  // live numbers arrive later; retype the line if the current mode can use them
  LIVE.onUpdate = function () { if (!state.booting && typedOnce) type(); };

  /* ---------- boot sequence ---------- */
  var BOOT = [
    ['NSKN TERMINAL v26.10 · (C) 2026 NATHAN SKOWN', 'READY'],
    ['POST · MEMORY CHECK · PHOSPHOR P1', 'OK'],
    ['MOUNT  /website', 'OK'],
    ['MOUNT  /website/finance', 'OK'],
    ['MOUNT  /website/sports', 'OK'],
    ['MOUNT  /website/music', 'OK'],
    ['HANDSHAKE  nathanskown.dev:443', 'OK'],
    ['SYNC CLOCKS  ' + CLOCKS.map(function (c) { return c[0]; }).join(' · '), 'OK'],
    ['BUILD SURFACES  IV(K,T) · WP(M,T) · FFT(F,T) · 36x22 MESH', 'OK'],
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
    bt = setTimeout(function () { $('boot').hidden = true; state.booting = false; modeAt = performance.now(); scramble(); }, skip ? 220 : 470);
  }
  function reboot() {
    clearInterval(scr); scr = null; clearInterval(typ); typedOnce = false; $('typed').textContent = ''; $('wordA').textContent = '';
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
  var RGB = '255,191,58', CUR = [255, 191, 58], MW = [1, 0, 0];
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
      cycleTick(now);
      // ease color and surface shape toward the current mode
      var tgt = MODES[mode].rgb, ease = reduced ? 1 : 0.06;
      for (var c3 = 0; c3 < 3; c3++) { CUR[c3] += (tgt[c3] - CUR[c3]) * ease; MW[c3] += ((c3 === mode ? 1 : 0) - MW[c3]) * ease; }
      RGB = CUR.map(Math.round).join(',');
      var dom = MW.indexOf(Math.max.apply(null, MW));
      var narrow = w < 700;
      var cx = narrow ? w * 0.5 : w * 0.8;
      var cy = narrow ? h - Math.min(170, h * 0.27) : h * 0.45;
      var S = narrow ? Math.min(w * 0.42, 172) : Math.min(w * 0.22, h * 0.4, 210);
      var yaw = -0.62 + Math.sin(t * 0.12) * 0.55 + mx * 0.7;
      var pitch = 0.5 + my * 0.28;
      var cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      var proj = function (u, v, z) {
        var X = u * cyw - v * syw, D = u * syw + v * cyw, zz = z * 0.85;
        var Y = zz * cp + D * sp, Dz = D * cp - zz * sp, k = 3.4 / (3.4 + Dz);
        return [cx + X * S * k, cy - Y * S * k, Dz];
      };
      var fMkt = function (u, v) {   // implied vol: smile across strikes, flattening with tenor
        var T = (v + 1) / 2;
        return 0.52 * u * u * (1.1 - 0.7 * T) - 0.17 * u * (1 - 0.55 * T) + 0.24 * Math.exp(-3.4 * T)
          + 0.05 * Math.sin(2.4 * u + 1.9 * v + t * 0.9) + 0.03 * Math.cos(3.3 * v - t * 0.6 + u * 1.3) - 0.12;
      };
      var fSprt = function (u, v) {  // win probability: a logistic cliff in score margin that sharpens as the clock runs out
        var T = (v + 1) / 2, k = 2.2 + 7 * T, m = u - 0.35 * Math.sin(t * 0.5 + T * 2.2);
        return 0.62 / (1 + Math.exp(-k * m)) - 0.3 + 0.025 * Math.sin(4 * u - t * 1.3 + v * 3);
      };
      var fMus = function (u, v) {   // spectrum ripple: rings spreading from a pulsing center
        var r = Math.sqrt(u * u + v * v), beat = 0.75 + 0.25 * Math.abs(Math.sin(t * 2.1));
        return 0.3 * beat * Math.cos(8 * r - t * 3.2) * Math.exp(-1.5 * r) + 0.05 * Math.sin(6 * u + t * 1.7) * Math.cos(5 * v - t) - 0.02;
      };
      var surf = function (u, v) {
        var z = 0;
        if (MW[0] > 0.002) z += MW[0] * fMkt(u, v);
        if (MW[1] > 0.002) z += MW[1] * fSprt(u, v);
        if (MW[2] > 0.002) z += MW[2] * fMus(u, v);
        return z;
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
      var AX = [
        { x: [['80%', -1], ['100%', 0], ['120%', 1]], xl: 'STRIKE / SPOT', y: [['1M', -1], ['6M', 0], ['2Y', 1]], yl: 'TENOR' },
        { x: [['-14', -1], ['0', 0], ['+14', 1]], xl: 'SCORE MARGIN', y: [['Q1', -1], ['HALF', 0], ['END', 1]], yl: 'CLOCK' },
        { x: [['-1', -1], ['0', 0], ['+1', 1]], xl: 'STEREO FIELD', y: [['20HZ', -1], ['1K', 0], ['20K', 1]], yl: 'FREQ' }
      ][dom];
      if (w >= 560) {  // axis labels only where there's room for them
        AX.x.forEach(function (x) { lab(x[1], -1.12, x[0], -12, 13); });
        lab(0, -1.4, AX.xl, -38, 15);
        AX.y.forEach(function (x) { lab(1.12, x[1], x[0], 6, 4); });
        lab(1.42, 0, AX.yl, 6, 18);
      }
      var sl = pts[js][NU - 1];
      ctx.fillStyle = 'rgba(' + RGB + ',0.95)';
      put(dom === 0 ? 'T=' + TENORS[js] : dom === 1 ? 'Q' + (1 + Math.floor(js / NV * 4)) + ' ' + p2(14 - (js * 7) % 15) + ':00' : 'BAR ' + (js + 1), sl[0] + 8, sl[1] + 3);
      if (best) {
        var bx = best[0], by = best[1];
        var txt = dom === 0 ? 'MAX IV ' + (16 + (best[3] + 0.2) * 22).toFixed(1) + '%  [SIM]'
          : dom === 1 ? 'WIN PROB ' + Math.min(99.9, 50 + (best[3] + 0.3) / 0.62 * 50).toFixed(1) + '%  [SIM]'
          : 'PEAK ' + (-12 + best[3] * 40).toFixed(1) + ' dB  [SIM]';
        var tw = ctx.measureText(txt).width, left = bx + 20 + tw > w - 8;
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
  setMode(0);
  if (!reduced && !seen) runBoot(); else scramble();
  // ?cmd= runs a command handed over from another page's command line (e.g. a ticker typed on a music page)
  try {
    var qc = new URLSearchParams(location.search).get('cmd');
    if (qc) { history.replaceState(null, '', location.pathname + location.hash); setTimeout(function () { run(qc); }, 50); }
  } catch (e) { /* ignore */ }
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); $('nk-cmd-in').focus(); }
  });
  function fromHash() { var k = location.hash.slice(1); if (TITLES[k]) setActive(k, LABEL[k]); }
  fromHash();
  window.addEventListener('hashchange', fromHash);

  /* ---------- Right Now: live markets + the next Detroit / MSU games ---------- */
  (function rightNow() {
    var box = document.getElementById('now');
    if (!box || !window.fetch) return;
    var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var v5 = Math.floor(Date.now() / 300000);
    var j = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); };
    var TILES = [['spx', 'S&P 500', 2], ['ixic', 'NASDAQ', 2], ['tnx', 'US 10Y', 2], ['vix', 'VIX', 2]];
    // league-wide scoreboards (trimmed by the site's ESPN proxy); teams this visitor follows on the Sports page come first
    var LGS = [['NFL', 'football/nfl', 'nfl'], ['MLB', 'baseball/mlb', 'mlb'], ['NBA', 'basketball/nba', 'nba'], ['NHL', 'hockey/nhl', 'nhl'],
      ['CFB', 'football/college-football', 'ncaaf'], ['CBB', 'basketball/mens-college-basketball', 'ncaab']];
    var FOLLOWS = [];
    try { FOLLOWS = JSON.parse(localStorage.getItem('skown.sports.follows.v2')) || []; } catch (e) {}
    var followed = function (lg, id) { return FOLLOWS.some(function (f) { return f && f.lg === lg && String(f.id) === String(id); }); };
    var mk = '', games = '';
    function render() { box.innerHTML = mk + games; }
    function when(iso) {
      var d = new Date(iso), now = new Date();
      var day = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      var same = d.toLocaleDateString('en-US') === now.toLocaleDateString('en-US');
      var t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
      return (same ? 'TODAY' : day) + ' ' + t;
    }
    // yields move in basis points, everything else in percent
    function chgTxt(t, up, sign) {
      if (t.id === 'tnx' && t.chg != null) return (up ? '▲' : '▼') + (sign ? (up ? ' +' : ' −') : '') + Math.abs(Math.round(t.chg * 100)) + ' bp';
      return (up ? '▲' : '▼') + (sign ? (up ? ' +' : ' −') : '') + Math.abs(t.pct || 0).toFixed(2) + '%';
    }
    j('/data/finance/dashboard.json?v=' + v5).then(function (d) {
      var by = {}; (d.tiles || []).forEach(function (t) { by[t.id] = t; });
      mk = '<dt class="nk-now-h">MARKETS</dt>' + TILES.map(function (x) {
        var t = by[x[0]]; if (!t || t.price == null) return '';
        var up = (t.pct || 0) >= 0;
        var px = x[0] === 'tnx' ? t.price.toFixed(2) + '%' : t.price.toLocaleString('en-US', { minimumFractionDigits: x[2], maximumFractionDigits: x[2] });
        return '<dt>' + esc(x[1]) + '</dt><dd>' + px + '</dd><dd class="nk-chg' + (up ? '' : ' nk-dn') + '">' + chgTxt(t, up, true) + '</dd>';
      }).join('');
      // hero line, MKT card and the scrolling ticker share these numbers
      var L = window.NSKN_LIVE || {}, spx = by.spx;
      if (spx && spx.price != null) {
        L.spx = spx.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + ((spx.pct || 0) >= 0 ? '▲' : '▼') + Math.abs(spx.pct || 0).toFixed(2) + '%';
        var cm = document.getElementById('cardMkt');
        if (cm) cm.innerHTML = '<span class="nk-live-dot"></span>S&amp;P 500 <b>' + esc(L.spx) + '</b>';
      }
      var NAMES = { spx: 'S&P 500', ixic: 'NASDAQ', dji: 'DOW', rut: 'RUSSELL', vix: 'VIX', tnx: 'US 10Y', dxy: 'DXY', wti: 'WTI', gold: 'GOLD', btc: 'BTC',
        ftse: 'FTSE', dax: 'DAX', sx5e: 'STOXX 50', n225: 'NIKKEI', hsi: 'HANG SENG', tsx: 'TSX', eurusd: 'EUR/USD', usdjpy: 'USD/JPY', gbpusd: 'GBP/USD' };
      var tk = document.getElementById('tickTrack');
      if (tk && d.tiles && d.tiles.length) {
        var one = d.tiles.filter(function (t) { return t.price != null; }).map(function (t) {
          var up = (t.pct || 0) >= 0, dp = t.price < 10 ? 4 : 2;
          return '<a class="nk-tk' + (up ? '' : ' nk-dn') + '" href="/finance/"><b>' + esc(NAMES[t.id] || t.name) + '</b> ' +
            (t.id === 'tnx' ? t.price.toFixed(2) + '%' : t.price.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })) +
            ' <span>' + chgTxt(t, up, false) + '</span></a>';
        }).join('');
        // the second copy only exists to make the loop seamless: hide it from screen readers and the Tab key
        tk.innerHTML = '<div class="nk-tick-run">' + one + '</div><div class="nk-tick-run" aria-hidden="true">' + one.replace(/<a /g, '<a tabindex="-1" ') + '</div>';
        tk.closest('.nk-tick').hidden = false;
      }
      if (L.onUpdate) L.onUpdate();
      var asof = document.getElementById('nowAsOf');
      if (asof && d.asOf) asof.textContent = 'As of ' + new Date(d.asOf * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' ' + ZONE;
      render();
    }).catch(function () { mk = ''; render(); });
    var day = function (ms) { return new Date(ms).toLocaleDateString('en-US'); };
    Promise.all(LGS.map(function (L) {
      return j('/api/espn/site/v2/sports/' + L[1] + '/scoreboard').then(function (sb) {
        return (sb.events || []).map(function (e) {
          var c = (e.competitions || [])[0] || {}, st = ((c.status || {}).type || {});
          var cs = c.competitors || [];
          var home = cs.filter(function (x) { return x.homeAway === 'home'; })[0] || cs[1] || {}, away = cs.filter(function (x) { return x.homeAway === 'away'; })[0] || cs[0] || {};
          var ab = function (x) { return ((x.team || {}).abbreviation || (x.team || {}).shortDisplayName || '?'); };
          var sc = function (x) { return x.score && typeof x.score === 'object' ? x.score.displayValue : (x.score == null ? '' : x.score); };
          var mine = cs.some(function (x) { return followed(L[2], (x.team || {}).id); });
          return { L: L, id: e.id, at: Date.parse(e.date), state: st.state, done: !!st.completed, detail: st.shortDetail || '', away: ab(away), home: ab(home),
            as: sc(away), hs: sc(home), mine: mine };
        });
      }).catch(function () { return null; });
    })).then(function (lists) {
      var failed = lists.every(function (x) { return x === null; });
      var all = [].concat.apply([], lists.filter(Boolean));
      var today = day(Date.now()), soon = Date.now() + 36 * 3600000;
      var live = all.filter(function (g) { return g.state === 'in'; });
      var next = all.filter(function (g) { return g.state === 'pre' && g.at < soon; }).sort(function (a, b) { return a.at - b.at; });
      var fin = all.filter(function (g) { return g.state === 'post' && day(g.at) === today; }).sort(function (a, b) { return b.at - a.at; });
      var pickMine = function (xs) { return xs.filter(function (g) { return g.mine; }).concat(xs.filter(function (g) { return !g.mine; })); };
      var rows = pickMine(live).concat(pickMine(next).slice(0, 4), fin).slice(0, 8);
      var L2 = window.NSKN_LIVE || {};
      L2.live = live.length;
      L2.next = next.length ? next[0].away + ' @ ' + next[0].home + ' ' + when(next[0].at) : '';
      var cs2 = document.getElementById('cardSprt');
      if (cs2 && !failed) cs2.innerHTML = live.length ? '<span class="nk-live-dot"></span><b>' + live.length + ' LIVE NOW</b> · ' + esc(live[0].L[0] + ' ' + live[0].away + ' ' + live[0].as + '-' + live[0].hs + ' ' + live[0].home)
        : next.length ? 'NEXT · <b>' + esc(next[0].L[0] + ' ' + next[0].away + ' @ ' + next[0].home) + '</b> ' + esc(when(next[0].at)) : 'No games in the next day and a half';
      if (L2.onUpdate) L2.onUpdate();
      var head = '<dt class="nk-now-h">SPORTS · ' + (live.length ? live.length + ' LIVE NOW' : 'TODAY') + '</dt>';
      games = head + (rows.length ? rows.map(function (g) {
        var left = '<b class="nk-lg">' + g.L[0] + '</b> ' + (g.state === 'pre' ? esc(g.away) + ' @ ' + esc(g.home) : esc(g.away) + ' ' + esc(g.as) + ' @ ' + esc(g.home) + ' ' + esc(g.hs));
        var right = g.state === 'in' ? '<span class="nk-live">' + esc(g.detail) + '</span>' : g.state === 'pre' ? esc(when(g.at)) : 'FINAL';
        return '<dd class="nk-ln"><a class="' + (g.mine ? 'nk-mine' : '') + '" href="/sports/game/?lg=' + g.L[2] + '&amp;id=' + encodeURIComponent(g.id) + '"><span>' + left + '</span><span>' + right + '</span></a></dd>';
      }).join('') : '<dd class="nk-now-note">' + (failed ? 'Scores are unavailable right now.' : 'No games in the next day and a half.') + '</dd>')
        + '<dd class="nk-ln"><a class="nk-now-more" href="/sports/"><span>All scores &amp; schedules</span><span>›</span></a></dd>';
      render();
    });
  })();
})();

/* "Last updated": the newest site change on GitHub, skipping the bots' data refreshes. Cached for the visit;
   the date written in index.html stays if GitHub can't be reached. */
(function () {
  var out = document.getElementById('lastUpd');
  if (!out || !window.fetch) return;
  var show = function (iso) {
    var d = new Date(iso);
    if (!isNaN(d)) out.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  };
  try { var c = sessionStorage.getItem('nskn.lastUpd'); if (c) { show(c); return; } } catch (e) {}
  var DATA = /^(data:|refresh |daily challenge|sports data|music: daily)/i;
  fetch('https://api.github.com/repos/nathanskown/nathanskown.dev/commits?sha=main&per_page=100')
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (list) {
      var hit = (list || []).filter(function (x) {
        var msg = ((x.commit || {}).message || '').split('\n')[0];
        var who = ((x.author || {}).login || '') + ' ' + (((x.commit || {}).author || {}).name || '');
        return !DATA.test(msg) && !/\[bot\]|actions|-bot\b/i.test(who);
      })[0];
      if (!hit) return;
      var iso = hit.commit.committer.date;
      show(iso);
      try { sessionStorage.setItem('nskn.lastUpd', iso); } catch (e) {}
    })
    .catch(function () {});
})();
