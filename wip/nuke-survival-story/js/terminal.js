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
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var scenes = PleaseHoldScenes.Renderer($('sceneCanvas'), STORY, {
    reduceMotion: reduceMotion,
    onReadout: function (items) { renderReadout(items); }
  });
  var sceneImages = PleaseHoldSceneArt.mount($('sceneImageA'), $('sceneImageB'), reduceMotion, function (on) {
    $('artWrap').classList.toggle('has-art', !!on);
    if (scenes.setForceReadout) scenes.setForceReadout(!!on);
    if (!on && scenes.redraw) scenes.redraw();
  });
  var detonationUntil = 0, staticOn = false;
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
  var tickItems = [], tickIndex = 0, tickTimer = 0, tickPaused = false;
  var readoutKey = '', resetReadoutScroll = false, pendingStripReset = false;
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
  // One passage at a time. A passage is every line from a single command.
  // If it is taller than the pane, it is split into pages. The next command
  // replaces the passage instead of stacking under it.
  var batch = null;
  var booting = true;
  var passage = [];
  var pages = [];
  var pageIndex = 0;
  var pager = $('pager');

  function choiceAsChips() {
    return window.matchMedia('(max-width: 600px)').matches && !document.body.classList.contains('compact');
  }
  function hasMore() { return pageIndex < pages.length - 1; }
  function markDiscussed(el) {
    el.classList.add('picked');
    var note = document.createElement('span');
    note.className = 'sr-only';
    note.textContent = ' (already discussed)';
    el.appendChild(note);
  }
  function renderBlock(block) {
    var el;
    if (block.kind === 'choice') {
      el = document.createElement('button');
      el.type = 'button';
      el.className = 'ln ln-choice';
      var n = /^(\d+)\./.exec(block.text);
      if (n) el.addEventListener('click', function () { submit(n[1]); });
      el.appendChild(document.createTextNode(block.text));
      if (block.meta && block.meta.picked) markDiscussed(el);
      return el;
    }
    if (block.kind === 'copy') {
      el = document.createElement('textarea');
      el.className = 'copybox';
      el.value = block.text;
      el.readOnly = true;
      return el;
    }
    el = document.createElement('div');
    el.className = 'ln ln-' + (block.kind || 'text');
    if (block.kind === 'boot') {
      var parts = String(block.text).split('|');
      el.innerHTML = '<span></span><span class="lead"></span><span class="ok"></span>';
      el.children[0].textContent = parts[0];
      el.children[2].textContent = parts[1] || 'OK';
    } else {
      el.textContent = block.text;
    }
    return el;
  }
  function splitSentences(text) {
    var parts = [];
    var re = /[^.!?]+[.!?]+["”']?(?:\s+|$)|[^.!?]+$/g;
    var m;
    while ((m = re.exec(text))) {
      var s = m[0].trim();
      if (s) parts.push(s);
    }
    return parts.length ? parts : [text];
  }
  function splitBlock(block) {
    var bits = splitSentences(block.text);
    if (bits.length < 2) {
      var words = String(block.text).split(/\s+/);
      if (words.length < 2) return [block];
      var mid = Math.ceil(words.length / 2);
      bits = [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
    }
    return bits.map(function (t) { return { text: t, kind: block.kind, meta: block.meta }; });
  }
  function storyBlocks(blocks) {
    return blocks.filter(function (b) { return !(b.kind === 'choice' && choiceAsChips()); });
  }
  function fillOut(blocks) {
    out.innerHTML = '';
    blocks.forEach(function (b) { out.appendChild(renderBlock(b)); });
  }
  function overflows() { return out.scrollHeight > out.clientHeight + 2; }
  function takeFitting(blocks) {
    var kept = [];
    out.innerHTML = '';
    for (var i = 0; i < blocks.length; i++) {
      out.appendChild(renderBlock(blocks[i]));
      if (overflows()) {
        out.removeChild(out.lastChild);
        break;
      }
      kept.push(blocks[i]);
    }
    return kept;
  }
  function setPager(on) { pager.hidden = !on; }
  function withChipReserve(blocks, fn) {
    var box = $('chips');
    var need = choiceAsChips() && blocks.some(function (b) { return b.kind === 'choice'; });
    var stamp = need ? box.innerHTML : '';
    if (need && !box.firstChild) {
      var dummy = document.createElement('span');
      dummy.className = 'chip';
      dummy.setAttribute('aria-hidden', 'true');
      dummy.textContent = '1';
      box.appendChild(dummy);
    }
    var result = fn();
    if (need && !stamp) box.innerHTML = '';
    return result;
  }
  function paginate(blocks) {
    var live = out.getAttribute('aria-live');
    out.setAttribute('aria-live', 'off');
    var body = storyBlocks(blocks);
    var built = withChipReserve(blocks, function () {
      var pagesBuilt;
      if (out.clientHeight < 24) pagesBuilt = [body];
      else if (!body.length) pagesBuilt = [[]];
      else {
        setPager(false);
        fillOut(body);
        if (!overflows()) pagesBuilt = [body];
        else {
          setPager(true);
          pagesBuilt = [];
          var rest = body.slice();
          var guard = 0;
          while (rest.length && guard < 400) {
            guard++;
            var page = takeFitting(rest);
            if (page.length) {
              pagesBuilt.push(page);
              rest = rest.slice(page.length);
            } else {
              var parts = splitBlock(rest[0]);
              if (parts.length < 2 || parts[0].text === rest[0].text) pagesBuilt.push([rest.shift()]);
              else rest.splice.apply(rest, [0, 1].concat(parts));
            }
          }
          if (!pagesBuilt.length) pagesBuilt = [[]];
          if (pagesBuilt.length < 2) setPager(false);
        }
      }
      return pagesBuilt;
    });
    if (live) out.setAttribute('aria-live', live);
    return built;
  }
  function setPageBtn(btn, on) {
    btn.disabled = !on;
    if (on) btn.removeAttribute('aria-hidden');
    else btn.setAttribute('aria-hidden', 'true');
  }
  function showPage() {
    var page = pages[pageIndex] || [];
    fillOut(page);
    var multi = pages.length > 1;
    setPager(multi);
    if (multi) {
      $('pageCount').textContent = (pageIndex + 1) + '/' + pages.length;
      setPageBtn($('pageBack'), pageIndex > 0);
      setPageBtn($('pageMore'), hasMore());
      $('pageMore').setAttribute('aria-label', 'Next page, ' + (pageIndex + 1) + ' of ' + pages.length);
      $('pageBack').setAttribute('aria-label', 'Previous page, ' + (pageIndex + 1) + ' of ' + pages.length);
    }
    if (typeof game !== 'undefined' && game && game.view) renderChips(game.view());
  }
  function layoutPassage(blocks, index) {
    passage = blocks || [];
    pages = paginate(passage);
    pageIndex = Math.min(index || 0, Math.max(0, pages.length - 1));
    showPage();
    if (out.clientHeight >= 24 && overflows()) {
      var i = pageIndex;
      pages = paginate(passage);
      pageIndex = Math.min(i, Math.max(0, pages.length - 1));
      showPage();
    }
  }
  function commitPassage(blocks) { layoutPassage(blocks, 0); }
  function relayoutPages() {
    if (!passage.length) return;
    layoutPassage(passage, pageIndex);
  }
  function advancePage(step) {
    var next = pageIndex + step;
    if (next < 0 || next >= pages.length) return;
    pageIndex = next;
    showPage();
  }
  function print(text, kind, meta) {
    if (kind !== 'copy') {
      transcript.push(kind === 'choice' ? '   ' + text : text);
      saveTranscript();
    }
    var block = { text: text, kind: kind || 'text', meta: meta || null };
    if (batch) batch.push(block);
    else if (booting) {
      passage.push(block);
      layoutPassage(passage, 999);
    } else commitPassage([block]);
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
    if (scenes.setNoFlash) scenes.setNoFlash(!flashesOn || reduceMotion);
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
      sceneEl.classList.toggle('static', flashesOn && !reduceMotion);
      noteScene('static');
      sceneImages.show('');
      if (scenes.setForceReadout) scenes.setForceReadout(false);
      $('artWrap').classList.remove('has-art');
      scenes.show('static');
      staticTimer = setTimeout(function () { staticOn = false; sceneEl.classList.remove('static'); refresh(); }, 1100);
    }
  }

  // ------------------------------------------------------------------ panels
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function tickHtml(t) {
    return '<span>' + esc(t).replace(/▼/g, '<b class="dn">▼</b>').replace(/▲/g, '<b class="up">▲</b>') + '</span>';
  }
  // One headline, swapped in place. No slide, fade, or flash. Arrows move immediately.
  function showTick(i) {
    if (!tickItems.length) return;
    tickIndex = ((i % tickItems.length) + tickItems.length) % tickItems.length;
    var el = $('tick');
    el.innerHTML = tickHtml(tickItems[tickIndex]);
    if (el.parentNode) el.parentNode.scrollLeft = 0;
  }
  function armTick() {
    clearInterval(tickTimer);
    tickTimer = 0;
    if (!reduceMotion || tickPaused || tickItems.length < 2) return;
    tickTimer = setInterval(function () { showTick(tickIndex + 1); }, 5000);
  }
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
    tickItems = items;
    var el = $('tick');
    var ticker = el.closest('.ticker');
    var track = el.parentNode;
    if (reduceMotion) {
      ticker.removeAttribute('aria-hidden');
      track.tabIndex = 0;
      track.setAttribute('aria-label', 'News headlines. Left and right arrows change the headline.');
      showTick(0);
      armTick();
    } else {
      ticker.setAttribute('aria-hidden', 'true');
      track.removeAttribute('tabindex');
      track.removeAttribute('aria-label');
      clearInterval(tickTimer);
      tickTimer = 0;
      var html = items.map(tickHtml).join('');
      el.innerHTML = html + html; // doubled so the scroll can loop
    }
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
    var cash = (v.vars && v.vars.cash) || 0;
    var water = [];
    if (v.flags && v.flags.bathtub_full) water.push('bathtub');
    if (v.flags && v.flags.heater_drained) water.push('heater tank');
    if (v.vars && v.vars.water > 0) water.push(v.vars.water + ' case' + (v.vars.water === 1 ? '' : 's'));
    items.push('<li class="note">cash: $' + cash + '</li>');
    items.push('<li class="note">stored water: ' + esc(water.join(', ') || 'none') + '</li>');
    inv.innerHTML = items.join('') || '<li class="empty">nothing</li>';
    party.innerHTML = v.party.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') || '<li class="empty">alone</li>';
  }

  function markReadout(el) {
    var overflow = el.scrollHeight > el.clientHeight + 2;
    var notAtEnd = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    el.classList.toggle('more', overflow && notAtEnd);
    // A scrolling strip has to be a keyboard stop, or the rows below the fold are mouse-only.
    if (overflow) el.tabIndex = 0;
    else el.removeAttribute('tabindex');
  }
  function renderReadout(items) {
    var el = $('sceneReadout');
    if (!el) return;
    if (!el._roScroll) {
      el._roScroll = true;
      el.addEventListener('scroll', function () { markReadout(el); }, { passive: true });
    }
    if (items === undefined && scenes.readout) items = scenes.readout();
    if (!items || !items.length) {
      el.hidden = true; el.className = 'scene-readout'; el.innerHTML = '';
      el.scrollTop = 0; resetReadoutScroll = false; return;
    }
    // Keep the place while a live value ticks. A new room or scene starts at the top.
    // On a phone the strip is display:none while the keyboard is up, and a scroll
    // reset during that time is forgotten when the strip comes back.
    var reset = resetReadoutScroll;
    resetReadoutScroll = false;
    var top = reset ? 0 : el.scrollTop;
    if (reset && document.body.classList.contains('scene-hidden')) pendingStripReset = true;
    el.hidden = false;
    el.className = 'scene-readout show';
    el.innerHTML = items.map(function (it) {
      if (it.chip) return '<div class="ro-chip ' + (it.on ? 'on' : 'off') + '"><i></i>' + esc(it.label) + '</div>';
      var solo = !it.value;
      return '<div class="ro-row' + (solo ? ' solo' : '') + '"><span class="k">' + esc(it.label) + '</span>' +
        (it.value ? '<span class="v">' + esc(it.value) + '</span>' : '') + '</div>';
    }).join('');
    el.scrollTop = top;
    markReadout(el);
  }
  function showPersonPhoto(id) {
    var img = $('personPhoto');
    if (!img || !window.PleaseHoldPeople) return;
    var p = id && STORY.people[id];
    if (!p || !PleaseHoldPeople.has(id)) {
      PleaseHoldPeople.clear(img);
      $('sceneCanvas').style.visibility = '';
      return;
    }
    var role = p.dossier && p.dossier.role ? ', ' + p.dossier.role : '';
    PleaseHoldPeople.show(img, id, p.name + role);
    $('sceneCanvas').style.visibility = 'hidden';
  }
  function setHeader(title, idx) { $('sceneTitle').textContent = title; $('sceneIdx').textContent = idx; }
  function sceneKey(v) {
    if (!v || !v.playing) return 'title';
    if (Date.now() < detonationUntil && !v.ended) return 'detonation';
    if (v.ended) return 'end:' + v.ended;
    if (v.talkingWith) return 'person:' + v.talkingWith;
    return 'room:' + v.room;
  }
  function noteScene(key) {
    if (key === readoutKey) return;
    readoutKey = key;
    resetReadoutScroll = true;
  }
  function renderScene(v) {
    if (staticOn) return;
    var key = sceneKey(v);
    noteScene(key);
    var artOn = sceneImages.show(PleaseHoldSceneArt.hookFor(v, key));
    $('artWrap').classList.toggle('has-art', !!artOn);
    if (scenes.setForceReadout) scenes.setForceReadout(!!artOn || !!(v && v.talkingWith));
    showPersonPhoto(v && v.talkingWith);
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

  function chip(label, cmd, cls, hint, picked) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (cls ? ' ' + cls : '');
    if (hint) { var h = document.createElement('b'); h.textContent = hint; b.appendChild(h); }
    b.appendChild(document.createTextNode(label));
    if (picked) markDiscussed(b);
    b.addEventListener('click', function () { submit(cmd); });
    return b;
  }
  function renderChips(v) {
    var box = $('chips');
    box.innerHTML = '';
    if (!v || !game.isActive()) { box.appendChild(chip('PLAY', 'play', 'alt')); return; }
    if (v.mode === 'name') return;
    if (!v.playing) { box.appendChild(chip('CONTINUE', '1', 'alt')); box.appendChild(chip('START OVER', '2')); return; }
    if (v.asking) { box.appendChild(chip('YES', 'yes', 'alt')); box.appendChild(chip('NO', 'no')); return; }
    if (v.ended) { ['restart', 'endings', 'share'].forEach(function (c) { box.appendChild(chip(c.toUpperCase(), c, c === 'share' ? 'alt' : '')); }); return; }
    var last = !pages.length || pageIndex >= pages.length - 1;
    if (v.talking && choiceAsChips() && last && v.choices && v.choices.length) {
      v.choices.forEach(function (c) { box.appendChild(chip(c.text, String(c.n), '', c.n + '.', c.picked)); });
      syncChipHint();
      return;
    }
    if (v.talking) return; // dialogue answers are buttons in the page
    var picked = v.picked || {};
    v.exits.forEach(function (x) { box.appendChild(chip(x.label, x.dir, 'go', DIR_SHORT[x.dir] || x.dir, !!picked[v.room + '|' + x.label])); });
    v.people.forEach(function (p) { box.appendChild(chip(p.name, 'talk to ' + p.name, 'talk', 'TALK', p.picked)); });
    v.items.forEach(function (n) { box.appendChild(chip(n, 'take ' + n, '', 'TAKE', !!picked[v.room + '|' + n])); });
    syncChipHint();
  }
  // A fade on the right edge of the phone chip row, only while more chips sit past it.
  function syncChipHint() {
    var box = $('chips');
    var hidden = getComputedStyle(box).display === 'none';
    var more = !hidden && box.scrollWidth - box.clientWidth - box.scrollLeft > 4;
    box.classList.toggle('more', more);
    box.classList.toggle('scrolled', !hidden && box.scrollLeft > 4);
  }

  // ------------------------------------------------------------------ log / share
  function copyText(text, what) {
    function fallback() {
      print(text, 'copy');
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
    renderReadout();
    renderTicker(v);
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
    clear: function () { commitPassage([]); },
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
    var trimmed = String(value).trim();
    if (trimmed) { history.push(value); if (history.length > 100) history.shift(); }
    hIndex = history.length;
    booting = false;
    batch = [];
    print(promptEl.textContent + ' ' + value, 'echo');
    dispatch(String(value));
    var blocks = batch;
    batch = null;
    refresh();
    commitPassage(blocks);
    if (window.innerWidth > 960) input.focus();
  }

  function submitInput() {
    var v = input.value;
    if (!String(v).trim()) { if (hasMore()) advancePage(1); return; }
    input.value = '';
    submit(v);
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); submitInput(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === ' ' && !input.value && hasMore()) { e.preventDefault(); advancePage(1); return; }
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitInput(); }
    else if (e.key === 'ArrowUp' && history.length) { e.preventDefault(); hIndex = Math.max(0, hIndex - 1); input.value = history[hIndex]; }
    else if (e.key === 'ArrowDown' && history.length) { e.preventDefault(); hIndex = Math.min(history.length, hIndex + 1); input.value = history[hIndex] || ''; }
  });
  screen.addEventListener('click', function (e) {
    if (e.target.closest('button')) return;
    if (hasMore()) {
      if (String(window.getSelection && window.getSelection())) return;
      advancePage(1);
      return;
    }
    if (!String(window.getSelection && window.getSelection())) input.focus();
  });
  $('pageMore').addEventListener('click', function () { advancePage(1); });
  $('pageBack').addEventListener('click', function () { advancePage(-1); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target === input) return;
    if (e.target && e.target.closest && e.target.closest('button, a, input, textarea, select')) return;
    if (!hasMore()) return;
    e.preventDefault();
    advancePage(1);
  });

  var sideOpener = null;
  function syncSide() {
    $('side').inert = !document.body.classList.contains('show-side');
  }
  function openSide(opener, which) {
    sideOpener = opener || document.activeElement;
    document.body.classList.add('show-side');
    syncSide();
    var target = which === 'map' ? $('map') : $('inv');
    var panel = target && target.closest ? target.closest('.panel') : null;
    if (panel && panel.scrollIntoView) panel.scrollIntoView();
    document.querySelector('.side-close').focus();
  }
  function closeSide() {
    if (!document.body.classList.contains('show-side')) return;
    document.body.classList.remove('show-side');
    delete document.body.dataset.side;
    syncSide();
    if (sideOpener && sideOpener.focus) sideOpener.focus();
    sideOpener = null;
  }
  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])'), function (el) {
      return !el.disabled && el.getAttribute('aria-hidden') !== 'true';
    });
  }
  $('fkeys').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.panel) {
      if (document.body.classList.contains('show-side') && document.body.dataset.side === b.dataset.panel) closeSide();
      else { document.body.dataset.side = b.dataset.panel; openSide(b, b.dataset.panel); }
      setMenu(false);
      return;
    }
    setMenu(false);
    submit(b.dataset.cmd);
  });
  document.querySelector('.side-close').addEventListener('click', function () { closeSide(); });
  var tickTrack = document.querySelector('.tick-track');
  function pauseTicks() { tickPaused = true; clearInterval(tickTimer); tickTimer = 0; }
  function resumeTicks() { tickPaused = false; armTick(); }
  tickTrack.addEventListener('keydown', function (e) {
    if (!reduceMotion) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    pauseTicks();
    showTick(tickIndex + (e.key === 'ArrowRight' ? 1 : -1));
  });
  // Pause only while the ticker has keyboard focus. A hover pause sticks on a phone
  // after the first tap, and then the later headlines never come around.
  tickTrack.addEventListener('focus', function () { if (reduceMotion) pauseTicks(); });
  tickTrack.addEventListener('blur', function () { if (reduceMotion) resumeTicks(); });
  function setMenu(open) {
    document.body.classList.toggle('nav-open', !!open);
    var b = $('menuToggle');
    if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  $('menuToggle').addEventListener('click', function () { setMenu(!document.body.classList.contains('nav-open')); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !document.body.classList.contains('nav-open')) return;
    if (document.body.classList.contains('show-side')) return;
    e.preventDefault();
    setMenu(false);
    $('menuToggle').focus();
  });
  document.addEventListener('keydown', function (e) {
    if (!document.body.classList.contains('show-side')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSide(); return; }
    if (e.key !== 'Tab') return;
    var list = focusables($('side'));
    if (!list.length) return;
    var first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  window.addEventListener('resize', syncSide);
  syncSide();
  setFlashes(flashesOn);
  $('flashToggle').addEventListener('click', function () { setFlashes(!flashesOn, true); });

  // Phones: a HIDE SCENE / SHOW SCENE button (remembered). The picture stays while
  // the keyboard is open; the app shrinks to the visible area instead.
  function setSceneHidden(hidden, persist) {
    document.body.classList.toggle('scene-hidden', hidden);
    var b = $('sceneToggle');
    b.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    b.textContent = hidden ? 'SHOW SCENE' : 'HIDE SCENE';
    if (persist) { try { localStorage.setItem('please-hold:scene-hidden', hidden ? '1' : '0'); } catch (e) { /* storage blocked */ } }
    if (!hidden) {
      scenes.redraw();
      if (pendingStripReset) { $('sceneReadout').scrollTop = 0; pendingStripReset = false; }
    }
  }
  $('sceneToggle').addEventListener('click', function () { setSceneHidden(!document.body.classList.contains('scene-hidden'), true); });
  try { if (localStorage.getItem('please-hold:scene-hidden') === '1') setSceneHidden(true, false); } catch (e) { /* storage blocked */ }
  input.addEventListener('blur', function () {
    if (pendingStripReset && !document.body.classList.contains('scene-hidden')) {
      $('sceneReadout').scrollTop = 0;
      pendingStripReset = false;
    }
  });
  $('map').addEventListener('click', function (e) {
    var n = e.target.closest('[data-go]');
    if (!n) return;
    closeSide();
    submit(n.dataset.go);
  });

  var root = document.documentElement;
  // A short window, or the phone keyboard (via --app-h), drops the picture and the chips.
  function syncCompact() {
    var raw = getComputedStyle(root).getPropertyValue('--app-h').trim();
    var fromVar = raw ? parseFloat(raw) : window.innerHeight;
    var visible = window.visualViewport ? window.visualViewport.height : fromVar;
    var h = Math.min(fromVar, visible, window.innerHeight);
    var was = document.body.classList.contains('compact');
    document.body.classList.toggle('compact', h <= 520);
    // The picture is already gone in compact mode, so the header button goes with it.
    // Its label and the saved hide/show choice stay as they were.
    if (!was && document.body.classList.contains('compact') && document.activeElement === $('sceneToggle')) input.focus();
    if (was !== document.body.classList.contains('compact')) relayoutPages();
    requestAnimationFrame(syncChipHint);
  }
  if (window.visualViewport) {
    var vv = window.visualViewport;
    // Normally the layout fills the page with CSS (height: 100%), which already leaves room for
    // the phone's notch and home bar. Only while the on-screen keyboard is open do we shrink it
    // to the visible area, so the input box stays above the keyboard. The picture stays in the
    // layout until that visible height is short enough to need the compact mode.
    var sizeApp = function () {
      var keyboardOpen = vv.height < window.innerHeight - 80;
      if (keyboardOpen) {
        var padTop = parseFloat(getComputedStyle(root).paddingTop) || 0;
        root.style.setProperty('--app-h', Math.max(240, vv.height - padTop) + 'px');
        window.scrollTo(0, 0);
      } else {
        root.style.removeProperty('--app-h');
      }
      syncCompact();
    };
    vv.addEventListener('resize', sizeApp);
    sizeApp();
  } else syncCompact();
  window.addEventListener('resize', function () { syncCompact(); relayoutPages(); });
  if (window.MutationObserver) new MutationObserver(syncCompact).observe(root, { attributes: true, attributeFilter: ['style'] });
  $('chips').addEventListener('scroll', syncChipHint, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(syncChipHint).observe($('chips'));

  if (window.ResizeObserver) new ResizeObserver(function () { scenes.redraw(); }).observe($('artWrap'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { scenes.redraw(); relayoutPages(); });

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
    if (!booting) return;
    if (i < boot.length) { print(boot[i++], 'boot'); setTimeout(next, reduceMotion ? 0 : 110); return; }
    print('Type “help” for commands, or “play” to start PLEASE HOLD.', 'shell');
    if (window.innerWidth > 960) input.focus();
  })();
})();
