/*
 * The lab terminal screen: shell commands, the game feed, and the panels
 * (scene art, ticker, status, map, inventory). The game itself lives in
 * engine.js + story.js; this file only draws it.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var screen = $('screen'), out = $('out'), form = $('cmd'), input = $('input'), promptEl = $('prompt');
  var sceneEl = $('scene');
  var scenes = PleaseHoldScenes.Renderer($('sceneCanvas'), STORY, { reduceMotion: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches });
  var detonationUntil = 0, staticOn = false;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var flashesOn = !reduceMotion;
  try {
    var savedFlashes = localStorage.getItem('please-hold-v1:flashes');
    if (savedFlashes === 'off') flashesOn = false;
    if (savedFlashes === 'on') flashesOn = true;
  } catch (e) { /* private mode */ }

  var SHELL_PROMPT = 'guest@nskn:~$';
  var GAME_PROMPT = '>';
  var history = [], hIndex = 0;
  var roomOrder = Object.keys(STORY.rooms);
  var staticTimer = null, lastTicker = '';
  var TRANSCRIPT_KEY = 'please-hold-v1:transcript';
  var TRANSCRIPT_MAX = 200 * 1024;
  var transcript = [];
  var DIR_SHORT = { north: 'N', south: 'S', east: 'E', west: 'W', northeast: 'NE', northwest: 'NW', southeast: 'SE', southwest: 'SW', up: 'UP', down: 'DOWN', 'in': 'IN', out: 'OUT' };

  function loadTranscript() {
    try {
      var raw = localStorage.getItem(TRANSCRIPT_KEY);
      var saved = raw ? JSON.parse(raw) : null;
      if (Array.isArray(saved)) transcript = saved;
    } catch (e) { transcript = []; }
  }
  function saveTranscript() {
    try {
      var text = JSON.stringify(transcript);
      while (text.length > TRANSCRIPT_MAX && transcript.length > 1) {
        transcript.shift();
        text = JSON.stringify(transcript);
      }
      localStorage.setItem(TRANSCRIPT_KEY, text);
    } catch (e) { /* private mode or full */ }
  }
  function clearTranscript() {
    transcript = [];
    try { localStorage.removeItem(TRANSCRIPT_KEY); } catch (e) { /* ignore */ }
  }
  loadTranscript();

  // ------------------------------------------------------------------ feed
  // Old dialogue buttons stay in the scrollback. They stop working as soon as
  // the player sends a new command, so a leftover "2" can't answer a later menu.
  function retireChoices() {
    var old = out.querySelectorAll('button.ln-choice:not([disabled])');
    for (var i = 0; i < old.length; i++) old[i].disabled = true;
  }
  function print(text, kind) {
    transcript.push(kind === 'choice' ? '   ' + text : text);
    saveTranscript();
    var el;
    if (kind === 'choice') {
      el = document.createElement('button');
      el.type = 'button';
      var n = /^(\d+)\./.exec(text);
      if (n) el.addEventListener('click', function () { submit(n[1]); });
    } else {
      el = document.createElement('div');
    }
    el.className = 'ln ln-' + (kind || 'text');
    if (kind === 'boot') {
      var parts = text.split('|');
      el.innerHTML = '<span></span><span class="lead"></span><span class="ok"></span>';
      el.children[0].textContent = parts[0];
      el.children[2].textContent = parts[1] || 'OK';
    } else {
      el.textContent = text;
    }
    out.appendChild(el);
    return el;
  }

  var game = PleaseHoldEngine.createGame(STORY, {
    print: print,
    onExit: function () { refresh(); },
    onFx: function (name) { effect(name); },
    onNewGame: clearTranscript
  });

  // ------------------------------------------------------------------ effects
  function setFlashes(on, persist) {
    flashesOn = !!on;
    document.body.classList.toggle('no-flash', !flashesOn);
    if (persist) { try { localStorage.setItem('please-hold-v1:flashes', flashesOn ? 'on' : 'off'); } catch (e) { /* ignore */ } }
    var b = $('flashToggle');
    if (b) {
      b.textContent = flashesOn ? 'FLASH ON' : 'FLASH OFF';
      b.setAttribute('aria-pressed', flashesOn ? 'true' : 'false');
    }
  }
  function effect(name) {
    if (name === 'flash') {
      var f = $('flash');
      var v0 = game.view();
      var opening = !v0.playing || v0.time <= 12 * 60 + 20;
      f.className = 'flash';
      if (flashesOn && !reduceMotion) {
        void f.offsetWidth;
        f.className = 'flash ' + (opening ? 'go' : 'soft');
      }
      if (opening) { detonationUntil = Date.now() + 9000; setTimeout(refresh, 9100); }
    }
    if (name === 'static') {
      clearTimeout(staticTimer);
      staticOn = true;
      sceneEl.classList.add('static');
      scenes.show('static');
      staticTimer = setTimeout(function () { staticOn = false; sceneEl.classList.remove('static'); refresh(); }, 1100);
    }
  }

  // ------------------------------------------------------------------ panels
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function renderTicker(v) {
    var items;
    if (v.playing) {
      items = STORY.hud.ticker.map(function (t) { return game.resolve(t); }).filter(Boolean);
    } else {
      items = ['NSKN LAB ▲ WORK IN PROGRESS', 'PLEASE HOLD ▲ NOW PLAYING', 'NOVI, MI ▬ ONE AFTERNOON', 'TYPE “PLAY” TO BEGIN', '20 LOCATIONS · 6 ENDINGS · 1 CLOCK'];
    }
    var key = items.join('|');
    if (key === lastTicker) return;
    lastTicker = key;
    var html = items.map(function (t) {
      return '<span>' + esc(t).replace(/▼/g, '<b class="dn">▼</b>').replace(/▲/g, '<b class="up">▲</b>') + '</span>';
    }).join('');
    $('tick').innerHTML = html + html; // doubled for a seamless loop
  }

  function renderStatus(v) {
    var el = $('status');
    if (!v.playing) {
      el.innerHTML = '<div class="big">NO SESSION <small>TYPE PLAY</small></div>' +
        '<dt>STORY</dt><dd>PLEASE HOLD</dd><dt>SETTING</dt><dd>NOVI, MI</dd><dt>ENDINGS</dt><dd>6</dd>';
      return;
    }
    var html = '<div class="big">' + esc(v.clock) + ' <small>THU · ET</small></div>';
    STORY.hud.status.forEach(function (row) {
      var val = game.resolve(row.value).replace(/\n\n/g, ' + ');
      var tone = row.tone ? game.resolve(row.tone) : '';
      html += '<dt>' + esc(row.label) + '</dt><dd class="' + esc(tone) + '">' + esc(val) + '</dd>';
    });
    el.innerHTML = html;
  }

  function renderMap(v) {
    var labels = ART.mapLabels, byLabel = {};
    Object.keys(labels).forEach(function (id) { byLabel['[' + labels[id] + ']'] = id; });
    var near = {};
    (v.exits || []).forEach(function (x) { near[x.to] = x.dir; });
    var src = ART.map.replace(/^\n/, '');
    var html = esc(src).replace(/\[[^\]\n]+\]/g, function (m) {
      var id = byLabel[m.replace(/&amp;/g, '&')];
      if (!id) return m;
      var cls = 'node';
      if (v.playing && id === v.room) cls = 'here';
      else if (v.playing && near[id] && !v.talking && !v.ended) cls = 'near';
      else if (v.playing && v.visited.indexOf(id) >= 0) cls = 'seen';
      if (cls === 'near') {
        var place = m.replace(/^\[|\]$/g, '');
        return '<button type="button" class="' + cls + '" data-go="' + esc(near[id]) + '" aria-label="Go ' + esc(near[id]) + ' to ' + esc(place) + '">' + m + '</button>';
      }
      return '<span class="' + cls + '">' + m + '</span>';
    });
    $('map').innerHTML = html;
  }

  function renderInventory(v) {
    var inv = $('inv'), party = $('party');
    if (!v.playing) { inv.innerHTML = '<li class="empty">—</li>'; party.innerHTML = '<li class="empty">—</li>'; return; }
    var items = v.inventory.map(function (n) { return '<li>' + esc(n) + '</li>'; });
    (STORY.inventoryNotes || []).forEach(function (n) { var t = game.resolve(n); if (t) items.push('<li class="note">' + esc(t) + '</li>'); });
    inv.innerHTML = items.join('') || '<li class="empty">nothing</li>';
    party.innerHTML = v.party.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') || '<li class="empty">alone</li>';
  }

  function setHeader(title, idx) { $('sceneTitle').textContent = title; $('sceneIdx').textContent = idx; }
  function renderScene(v) {
    if (staticOn) return;
    sceneEl.classList.toggle('ending', !!(v.playing && v.ended));
    sceneEl.classList.toggle('person', !!(v.playing && v.talkingWith));
    if (!v.playing) { setHeader('PLEASE HOLD', 'LAB · WIP'); scenes.show('title', null, v); return; }
    if (Date.now() < detonationUntil && !v.ended) { setHeader('12:12 PM · SOUTHEAST', 'DETONATION'); scenes.show('detonation', null, v); return; }
    if (v.ended) {
      setHeader('ENDING · ' + STORY.endings[v.ended].title.toUpperCase(), (STORY.text.endingTypes[v.endingType] || '').toUpperCase());
      scenes.show('end:' + v.ended, v.ended, v); return;
    }
    if (v.talkingWith) {
      setHeader('FILE · ' + STORY.people[v.talkingWith].name.toUpperCase(), v.clock);
      scenes.show('person:' + v.talkingWith, v.talkingWith, v); return;
    }
    var idx = roomOrder.indexOf(v.room) + 1;
    setHeader('LOC ' + (idx < 10 ? '0' : '') + idx + ' · ' + v.roomName.toUpperCase(), v.clock);
    scenes.show('room:' + v.room, v.room, v);
  }

  function chip(label, cmd, cls, hint) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (cls ? ' ' + cls : '');
    if (hint) { var h = document.createElement('b'); h.textContent = hint; b.appendChild(h); }
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', function () { submit(cmd); });
    return b;
  }
  function renderChips(v) {
    var box = $('chips');
    box.innerHTML = '';
    if (!game.isActive()) { box.appendChild(chip('PLAY', 'play', 'alt')); return; }
    if (v.mode === 'name') return;
    if (!v.playing) { box.appendChild(chip('CONTINUE', '1', 'alt')); box.appendChild(chip('START OVER', '2')); return; }
    if (v.asking) { box.appendChild(chip('YES', 'yes', 'alt')); box.appendChild(chip('NO', 'no')); return; }
    if (v.ended) { ['restart', 'endings', 'share'].forEach(function (c) { box.appendChild(chip(c.toUpperCase(), c, c === 'share' ? 'alt' : '')); }); return; }
    if (v.talking) return; // dialogue answers are already buttons
    v.exits.forEach(function (x) { box.appendChild(chip(x.label, x.dir, 'go', DIR_SHORT[x.dir] || x.dir)); });
    v.people.forEach(function (n) { box.appendChild(chip(n, 'talk to ' + n, 'talk', 'TALK')); });
    v.items.forEach(function (n) { box.appendChild(chip(n, 'take ' + n, '', 'TAKE')); });
  }

  // ------------------------------------------------------------------ log / share
  function copyText(text, what) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.className = 'copybox';
      ta.value = text;
      ta.readOnly = true;
      out.appendChild(ta);
      ta.focus(); ta.select();
      print('Your browser blocked copying. Select the text above and copy it yourself.', 'dim');
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { print(what + ' copied to your clipboard.', 'note'); }, fallback);
    } else fallback();
  }
  function shareText(v) {
    return 'PLEASE HOLD · ' + v.endingTitle.toUpperCase() + ' (' + (STORY.text.endingTypes[v.endingType] || v.endingType) + ')\n' +
      'Ended at ' + v.clock + ' · ' + (v.sheltered === 1 ? 'just me' : v.sheltered + ' of us, counting me') + ' · ' +
      v.endingsFound + ' of ' + v.endingsTotal + ' endings found\n' + location.href.split('?')[0];
  }

  function refresh() {
    var v = game.view();
    var playing = !!v.playing || game.isActive();
    document.body.classList.toggle('playing', playing);
    promptEl.textContent = game.isActive() ? GAME_PROMPT : SHELL_PROMPT;
    $('clock').textContent = v.playing ? v.clock : '--:-- --';
    $('liveText').textContent = v.playing ? (v.ended ? 'ENDED' : 'LIVE') : (game.isActive() ? 'MENU' : 'IDLE');
    $('crumb').textContent = v.playing ? v.roomName.toUpperCase() : 'PLEASE HOLD';
    renderScene(v);
    renderTicker(v);
    renderStatus(v);
    renderMap(v);
    renderInventory(v);
    renderChips(v);
  }

  // ------------------------------------------------------------------ shell
  var shell = {
    help: function () {
      ['Commands:',
       '  play     start PLEASE HOLD, a text adventure (about 30 to 60 minutes)',
       '  about    what this page is',
       '  clear    clear the screen',
       '  flashes  turn the bright flashes on or off',
       '  feedback copy your playthrough to send to whoever shared this with you',
       '  help     this list'].forEach(function (l) { print(l, 'shell'); });
    },
    about: function () {
      print('Part of the work-in-progress corner of nathanskown.dev. Nothing here is finished.', 'shell');
      print('Right now: PLEASE HOLD. Novi, Michigan, the afternoon the bombs fall. Twenty places, six endings, one clock. Type “play”.', 'shell');
    },
    clear: function () { out.innerHTML = ''; },
    play: function () { game.start(); }
  };

  function dispatch(line) {
    var low = line.trim().toLowerCase();
    if (low === 'log' || low === 'transcript' || low === 'feedback') {
      copyText(transcript.join('\n'), 'Your playthrough was');
      if (low === 'feedback') print('Paste it into a text or email to whoever sent you this link, and add anything you want them to know: what confused you, what you liked, where you got stuck.', 'dim');
      return;
    }
    if (/^flashes( on| off)?$/.test(low)) {
      if (low === 'flashes off') setFlashes(false, true);
      else if (low === 'flashes on') setFlashes(true, true);
      else setFlashes(!flashesOn, true);
      print('Bright flashes are ' + (flashesOn ? 'on' : 'off') + '.', 'note');
      return;
    }
    if (low === 'share') {
      var v = game.view();
      if (v.playing && v.ended) copyText(shareText(v), 'Your result was');
      else print('Finish the story first, then type “share”.', 'dim');
      return;
    }
    if (game.isActive()) { game.handle(line); return; }
    var cmd = line.trim().toLowerCase();
    if (!cmd) return;
    if (shell[cmd]) return shell[cmd]();
    if (/^(start|start game|game|adventure|please hold|run)$/.test(cmd)) return shell.play();
    if (/^(look|inventory|listen to radio|hint)$/.test(cmd)) return print('No session running. Type “play” to start.', 'dim');
    print('command not found: ' + cmd + '. Type “help”.', 'dim');
  }

  function submit(value) {
    if (String(value).trim()) retireChoices();
    var echo = print(promptEl.textContent + ' ' + value, 'echo');
    if (String(value).trim()) { history.push(value); if (history.length > 100) history.shift(); }
    hIndex = history.length;
    dispatch(String(value));
    refresh();
    var replyHeight = out.scrollHeight - echo.offsetTop;
    if (replyHeight > screen.clientHeight - 60) screen.scrollTop = echo.offsetTop - 12;
    else screen.scrollTop = screen.scrollHeight;
    if (window.innerWidth > 960) input.focus();
  }

  function submitInput() { var v = input.value; input.value = ''; submit(v); }

  form.addEventListener('submit', function (e) { e.preventDefault(); submitInput(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitInput(); }
    else if (e.key === 'ArrowUp' && history.length) { e.preventDefault(); hIndex = Math.max(0, hIndex - 1); input.value = history[hIndex]; }
    else if (e.key === 'ArrowDown' && history.length) { e.preventDefault(); hIndex = Math.min(history.length, hIndex + 1); input.value = history[hIndex] || ''; }
  });
  screen.addEventListener('click', function (e) {
    if (e.target.closest('button')) return;
    if (!String(window.getSelection && window.getSelection())) input.focus();
  });

  function syncSide() {
    var narrow = window.matchMedia('(max-width: 960px)').matches;
    $('side').inert = narrow && !document.body.classList.contains('show-side');
  }
  $('fkeys').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.panel) {
      document.body.classList.toggle('show-side');
      syncSide();
      if (document.body.classList.contains('show-side')) document.querySelector('.side-close').focus();
      return;
    }
    submit(b.dataset.cmd);
  });
  document.querySelector('.side-close').addEventListener('click', function () {
    document.body.classList.remove('show-side');
    syncSide();
  });
  window.addEventListener('resize', syncSide);
  syncSide();
  setFlashes(flashesOn);
  $('flashToggle').addEventListener('click', function () { setFlashes(!flashesOn, true); });
  $('map').addEventListener('click', function (e) {
    var n = e.target.closest('[data-go]');
    if (!n) return;
    document.body.classList.remove('show-side');
    submit(n.dataset.go);
  });

  if (window.visualViewport) {
    var vv = window.visualViewport;
    // Normally the layout fills the page with CSS (height: 100%), which already leaves room for
    // the phone's notch and home bar. Only while the on-screen keyboard is open do we shrink it
    // to the visible area, so the input box stays above the keyboard.
    var root = document.documentElement;
    var sizeApp = function () {
      var keyboardOpen = vv.height < window.innerHeight - 80;
      if (keyboardOpen) {
        var padTop = parseFloat(getComputedStyle(root).paddingTop) || 0;
        root.style.setProperty('--app-h', Math.max(240, vv.height - padTop) + 'px');
        window.scrollTo(0, 0);
        screen.scrollTop = screen.scrollHeight;
      } else {
        root.style.removeProperty('--app-h');
      }
    };
    vv.addEventListener('resize', sizeApp);
    sizeApp();
  }

  if (window.ResizeObserver) new ResizeObserver(function () { scenes.redraw(); }).observe($('artWrap'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { scenes.redraw(); });

  // ------------------------------------------------------------------ boot
  var boot = [
    'NSKN LAB v26.11 · WORK IN PROGRESS|READY',
    'POST · MEMORY CHECK · PHOSPHOR P1|OK',
    'MOUNT /wip/nuke-survival-story|OK',
    'LOAD story.js · ' + roomOrder.length + ' LOCATIONS|OK',
    'LOAD scenes.js · ' + Object.keys(PleaseHoldScenes.rooms).length + ' SCENES|OK',
    'LINE STATUS · BRIGHTLINE FIBER|ON HOLD'
  ];
  refresh();
  var i = 0;
  (function next() {
    if (i < boot.length) { print(boot[i++], 'boot'); setTimeout(next, reduceMotion ? 0 : 110); return; }
    print('Type “help” for commands, or “play” to start PLEASE HOLD.', 'shell');
    input.focus();
  })();
})();
