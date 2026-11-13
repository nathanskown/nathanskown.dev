/*
 * PLEASE HOLD — text adventure engine.
 *
 * No story text lives here. Everything the player reads is in story.js.
 * Works in the browser (window.PleaseHoldEngine) and in Node (require).
 *
 *   var game = PleaseHoldEngine.createGame(STORY, {
 *     print: function (text, kind) { ... },   // show one paragraph
 *     onExit: function () { ... },            // player typed "quit"
 *     storage: window.localStorage            // optional
 *   });
 *   game.start();          // when the visitor types "play"
 *   game.handle(line);     // every line they type while playing
 */
(function (root) {
  'use strict';

  var DIRS = {
    n: 'north', s: 'south', e: 'east', w: 'west',
    ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
    u: 'up', d: 'down',
    north: 'north', south: 'south', east: 'east', west: 'west',
    northeast: 'northeast', northwest: 'northwest', southeast: 'southeast', southwest: 'southwest',
    up: 'up', down: 'down', upstairs: 'up', downstairs: 'down',
    'in': 'in', inside: 'in', out: 'out', outside: 'out'
  };
  var ARTICLES = { the: 1, a: 1, an: 1, some: 1, my: 1, your: 1 };

  // ---------------------------------------------------------------- helpers
  function parseTime(str) {
    var m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(String(str).trim());
    if (!m) throw new Error('Bad time "' + str + '" (use a form like "3:45 PM")');
    var h = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return h * 60 + Number(m[2]);
  }
  function fmtTime(min) {
    var h = Math.floor(min / 60) % 24, m = min % 60;
    return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h >= 12 ? ' PM' : ' AM');
  }
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[‘’']/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function stripArticles(s) {
    return s.split(' ').filter(function (w) { return !ARTICLES[w]; }).join(' ');
  }
  function clean(s) { return stripArticles(norm(s)); }
  function arr(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }
  function compare(a, op, b) {
    switch (op) {
      case '>': return a > b; case '>=': return a >= b;
      case '<': return a < b; case '<=': return a <= b;
      case '=': case '==': return a === b; case '!=': return a !== b;
    }
    return false;
  }
  function safeStorage() {
    try { if (typeof localStorage !== 'undefined') return localStorage; } catch (e) { /* blocked */ }
    var mem = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; }
    };
  }

  // ---------------------------------------------------------------- game
  function createGame(story, opts) {
    opts = opts || {};
    var print = opts.print || function () {};
    // While a dialogue choice moves the clock, timed news is held back and shown after the reply.
    var held = null;
    function out(t, k, m) { if (held) held.push([t, k, m]); else print(t, k, m); }
    var pendingNews = null;
    function flushNews() { var n = pendingNews; pendingNews = null; (n || []).forEach(function (a) { print(a[0], a[1], a[2]); }); }
    var store = opts.storage || safeStorage();
    var onExit = opts.onExit || function () {};
    var fx = function (name) { if (opts.onFx) opts.onFx(name); };
    var KEY = story.meta.saveKey;
    var EKEY = KEY + ':endings';
    var TYPEKEY = KEY + ':endtypes';
    var random = opts.random || Math.random;
    var DL = story.clock.deadline;
    var DL_EARLY = parseTime(DL.earliest || DL.at), DL_LATE = parseTime(DL.latest || DL.at);
    var EVENTS = arr(story.clock.events).map(function (ev, i) {
      return { id: ev.id || ('event' + i), at: parseTime(ev.at), ev: ev };
    }).sort(function (a, b) { return a.at - b.at; });

    var S = null;          // current state (saved)
    var mode = 'off';      // off | menu | play | confirm | ended
    var convo = null;      // { pid, choices }
    var seenThisTalk = {};
    var pendingSave = null;
    var halt = false;      // set when a death/ending interrupts the current command
    var pendingAsk = null; // a yes/no question waiting for an answer

    // ---- storage
    function load(key) { try { var v = store.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
    function save(key, v) { try { store.setItem(key, JSON.stringify(v)); } catch (e) { /* full or blocked */ } }
    function del(key) { try { store.removeItem(key); } catch (e) { /* ignore */ } }
    function endingsFound() { var e = load(EKEY); return Array.isArray(e) ? e : []; }
    function persist() { if (S) save(KEY, S); }
    function resolveType(en) {
      if (!en) return '';
      return (en.type && typeof en.type === 'object') ? T(en.type) : en.type;
    }
    function rememberType(id, type) {
      var types = load(TYPEKEY) || {};
      var rank = { bad: 0, mixed: 1, good: 2 };
      if (!types[id] || (rank[type] || 0) > (rank[types[id]] || 0)) { types[id] = type; save(TYPEKEY, types); }
    }
    function typeName(id) {
      var en = story.endings[id];
      if (S && S.ended === id) return resolveType(en);
      var saved = (load(TYPEKEY) || {})[id];
      if (saved) return saved;
      return typeof en.type === 'string' ? en.type : resolveType(en);
    }
    function isYes(line) { return /^(y|yes|yeah|yep|ok|okay|sure|do it)$/.test(line); }
    function isNo(line) { return /^(n|no|nope|nah|not yet)$/.test(line); }

    // ---- output
    function say(text, kind) {
      if (!text) return;
      String(text).split(/\n{2,}/).forEach(function (p) { if (p.trim()) out(p.trim(), kind || 'text'); });
    }
    // The generator cough and the line after it keep the original gaps around an
    // 8:10 fallout (115 minutes before, 80 minutes after) and slide with the real time.
    function falloutOffset(delta) {
      var t = S.deadline + delta;
      // A time before fallout (the generator cough) can't be before the player sat down.
      if (delta < 0) {
        if (t < S.time) t = S.time;
        if (t >= S.deadline) t = Math.max(S.time, S.deadline - 1);
      }
      return fmtTime(t);
    }
    function fill(s) {
      return s.replace(/\{(\w+)\}/g, function (all, name) {
        if (name === 'time') return fmtTime(S.time);
        if (name === 'eta') return etaText();
        if (name === 'fallout') return fmtTime(S.deadline);
        if (name === 'falloutBefore') return falloutOffset(-115);
        if (name === 'falloutAfter') return fmtTime(S.deadline + 80);
        if (name === 'weddingTime') return fmtTime(Math.max(S.time, parseTime('1:15 PM')));
        if (name === 'party') return String(shelteredCount());
        if (name === 'wedAt' && !(S.vars && S.vars.wedAt)) return '1:45 PM';
        if (S.vars && Object.prototype.hasOwnProperty.call(S.vars, name)) return String(S.vars[name]);
        return all;
      });
    }
    // The radio's estimate: a window that always contains the real time and narrows as it gets closer.
    function etaText() {
      var left = Math.max(0, S.deadline - S.time);
      var w = Math.max(30, Math.min(180, Math.round(left * 0.6 / 15) * 15));
      var lo = Math.max(S.time, S.deadline - Math.round(w * (S.etaSeed || 0.5) / 15) * 15);
      lo = Math.ceil(lo / 15) * 15 > S.deadline ? lo : Math.ceil(lo / 15) * 15;
      return fmtTime(lo).replace(/ (AM|PM)$/, '') + '–' + fmtTime(lo + w);
    }
    function T(t) {
      if (t == null || t === false) return '';
      if (typeof t === 'string') return S ? fill(t) : t;
      if (Array.isArray(t)) return t.map(T).filter(Boolean).join('\n\n');
      if (typeof t === 'object') return test(t['if']) ? T(t.text) : T(t['else']);
      return String(t);
    }

    // ---- state
    function newState() {
      var s = {
        v: story.meta.version, room: story.start.room, time: parseTime(story.clock.start),
        inv: arr(story.start.inventory).slice(), flags: {},
        vars: JSON.parse(JSON.stringify(story.start.vars || {})),
        party: [], where: {}, roomItems: {}, visited: {}, fired: {}, once: {},
        ended: null, prev: null, checkpoints: [],
        picked: {},
        // When the fallout arrives this game (minutes), and a fixed offset used for the radio's estimate.
        deadline: DL_EARLY + Math.round((DL_LATE - DL_EARLY) * random() / 5) * 5,
        etaSeed: random()
      };
      Object.keys(story.people).forEach(function (id) { s.where[id] = story.people[id].room || null; });
      Object.keys(story.rooms).forEach(function (id) { s.roomItems[id] = arr(story.rooms[id].items).slice(); });
      return s;
    }
    function snapshot() {
      var p = S.prev, c = S.checkpoints;
      S.prev = null; S.checkpoints = [];
      var snap = JSON.stringify(S);
      S.prev = p; S.checkpoints = c;
      return snap;
    }
    function restore(snap) {
      var cps = S.checkpoints;
      var ns = JSON.parse(snap);
      ns.checkpoints = cps.filter(function (c) { return c.time <= ns.time; });
      ns.prev = null;
      if (!ns.picked || typeof ns.picked !== 'object') ns.picked = {};
      S = ns;
    }
    function markPicked(id) {
      if (!S || !id) return;
      if (!S.picked || typeof S.picked !== 'object') S.picked = {};
      S.picked[id] = 1;
    }
    function isPicked(id) { return !!(S && S.picked && S.picked[id]); }
    function checkpoint() {
      var cps = S.checkpoints, last = cps[cps.length - 1];
      if (!last || S.time - last.time >= 20) {
        cps.push({ time: S.time, snap: snapshot() });
        if (cps.length > 30) cps.shift();
      }
    }
    function partySize() {
      return 1 + S.party.reduce(function (n, id) { return n + (story.people[id].count || 1); }, 0);
    }
    // People in the party, plus Adam when the ending is his bunker. He never joins the party; he is already down there.
    function shelteredCount() {
      return partySize() + (S.ended === 'bunker' ? 1 : 0);
    }

    // ---- conditions
    function test(c) {
      if (c == null) return true;
      if (Array.isArray(c)) return c.every(test);
      return Object.keys(c).every(function (k) { return check(k, c[k]); });
    }
    function check(k, v) {
      switch (k) {
        case 'has': return arr(v).every(function (i) { return S.inv.indexOf(i) >= 0; });
        case 'lacks': return arr(v).every(function (i) { return S.inv.indexOf(i) < 0; });
        case 'flag': return arr(v).every(function (f) { return !!S.flags[f]; });
        case 'notFlag': return arr(v).every(function (f) { return !S.flags[f]; });
        case 'with': return arr(v).every(function (p) { return S.party.indexOf(p) >= 0; });
        case 'without': return arr(v).every(function (p) { return S.party.indexOf(p) < 0; });
        case 'in': return arr(v).indexOf(S.room) >= 0;
        case 'notIn': return arr(v).indexOf(S.room) < 0;
        case 'before': return S.time < parseTime(v);
        case 'after': return S.time >= parseTime(v);
        case 'visited': return arr(v).every(function (r) { return !!S.visited[r]; });
        case 'var': return compare(S.vars[v[0]] || 0, v[1], v[2]);
        case 'party': return compare(partySize(), v[0], v[1]);
        case 'alone': return v ? S.party.length === 0 : S.party.length > 0;
        case 'ending': return arr(v).indexOf(S.ended) >= 0;
        case 'any': return arr(v).some(test);
        case 'not': return !test(v);
      }
      if (typeof console !== 'undefined') console.warn('Unknown condition "' + k + '"');
      return false;
    }

    // ---- effects
    function run(e) {
      if (e == null || halt) return;
      if (Array.isArray(e)) { for (var i = 0; i < e.length && !halt; i++) run(e[i]); return; }
      if (e['if'] && !test(e['if'])) { if (e['else']) run(e['else']); return; }
      if (e.once) { if (S.once[e.once]) return; S.once[e.once] = 1; }
      if (e.text) say(T(e.text), e.kind);
      if (e.fx) fx(e.fx);
      arr(e.give).forEach(function (id) { if (S.inv.indexOf(id) < 0) S.inv.push(id); });
      arr(e.take).forEach(function (id) { var i = S.inv.indexOf(id); if (i >= 0) S.inv.splice(i, 1); });
      arr(e.place).forEach(function (p) { var list = S.roomItems[p.room] || (S.roomItems[p.room] = []); if (list.indexOf(p.item) < 0) list.push(p.item); });
      arr(e.flag).forEach(function (f) { S.flags[f] = true; });
      arr(e.unflag).forEach(function (f) { delete S.flags[f]; });
      if (e.add) Object.keys(e.add).forEach(function (k) { S.vars[k] = (S.vars[k] || 0) + e.add[k]; });
      if (e.set) Object.keys(e.set).forEach(function (k) {
        var v = e.set[k];
        S.vars[k] = typeof v === 'string' ? fill(v) : v;
      });
      arr(e.join).forEach(function (id) { if (S.party.indexOf(id) < 0) S.party.push(id); S.where[id] = 'party'; });
      if (e.dismiss) { S.party.forEach(function (id) { S.where[id] = S.room; }); S.party = []; }
      arr(e.part).forEach(function (id) { var i = S.party.indexOf(id); if (i >= 0) S.party.splice(i, 1); S.where[id] = S.room; });
      if (e.move) Object.keys(e.move).forEach(function (id) {
        var i = S.party.indexOf(id); if (i >= 0) S.party.splice(i, 1);
        S.where[id] = e.move[id];
      });
      if (e.time) advance(e.time);
      if (halt) return;
      if (e['goto']) enterRoom(e['goto']);
      if (e.ending) endGame(e.ending);
      else if (e.death) die(e.death);
      else if (e.ask) { pendingAsk = e.ask; mode = 'ask'; convo = null; say(T(e.ask.text), 'note'); out('(yes / no)', 'dim'); }
    }

    // ---- clock
    function advance(mins) {
      if (!mins || halt) return;
      var target = S.time + mins;
      for (var i = 0; i < EVENTS.length && !halt; i++) {
        var E = EVENTS[i];
        if (S.fired[E.id] || E.at > target || E.at >= S.deadline) continue;
        S.time = Math.max(S.time, E.at);
        S.fired[E.id] = 1;
        if (test(E.ev['if'])) { say(T(E.ev.text), 'event'); run(E.ev.effects); }
      }
      if (halt) return;
      if (target >= S.deadline && !S.ended) { S.time = S.deadline; deadline(); return; }
      S.time = Math.max(S.time, target);
    }
    function deadline() {
      var d = story.clock.deadline;
      fx('static');
      say(T(d.text), 'death');
      var goal = S.deadline - (d.rewindMinutes || 120);
      var cps = S.checkpoints, pickCp = null;
      for (var i = cps.length - 1; i >= 0; i--) { if (cps[i].time <= goal) { pickCp = cps[i]; break; } }
      if (!pickCp && cps.length) pickCp = cps[0];
      halt = true;
      convo = null;
      if (!pickCp) { say(T(story.text.rewindRestart), 'dim'); S = newState(); describe(true); return; }
      restore(pickCp.snap);
      say(T(story.text.rewindDeadline), 'dim');
      describe(true);
    }
    function die(text) {
      fx('static');
      say(T(text), 'death');
      halt = true;
      convo = null;
      if (S.prev) restore(S.prev); else S = newState();
      say(T(story.text.rewindStep), 'dim');
      describe(true);
    }
    function endGame(id) {
      var en = story.endings[id];
      halt = true;
      convo = null;
      S.ended = id;
      mode = 'ended';
      fx('ending');
      out(en.title, 'ending-title');
      say(T(en.text), 'ending');
      var after = arr(story.afterword).filter(function (a) { return test(a['if']); }).map(function (a) { return T(a.text); }).filter(Boolean);
      if (after.length) { out('AFTERWARD', 'afterword-title'); after.forEach(function (t) { out(t, 'afterword'); }); }
      var found = endingsFound();
      var type = resolveType(en);
      if (found.indexOf(id) < 0) { found.push(id); save(EKEY, found); }
      rememberType(id, type);
      var total = Object.keys(story.endings).length;
      out('ENDING: ' + en.title + ' (' + (story.text.endingTypes[type] || type) + '). You have found ' + found.length + ' of ' + total + ' endings.', 'note');
      say(T(story.text.afterEnding), 'dim');
    }

    // ---- rooms
    function room() { return story.rooms[S.room]; }
    function exitObj(v) { return typeof v === 'string' ? { to: v } : v; }
    function visibleExits(r) {
      return Object.keys(r.exits || {}).map(function (dir) { return { dir: dir, e: exitObj(r.exits[dir]) }; })
        .filter(function (x) { return test(x.e.show); });
    }
    function exitLine() {
      var xs = visibleExits(room());
      if (!xs.length) return 'There is no obvious way out.';
      return 'Exits: ' + xs.map(function (x) {
        var m = moveMinutes(x.e);
        return x.dir + ' (' + (x.e.label ? T(x.e.label) : story.rooms[x.e.to].name) + (m >= LONG_WALK ? ', ' + m + ' min' : '') + ')';
      }).join(', ') + '.';
    }
    function peopleHere() {
      return Object.keys(S.where).filter(function (id) {
        return S.where[id] === S.room && test(story.people[id].present);
      });
    }
    function roomItemsVisible() {
      return (S.roomItems[S.room] || []).filter(function (id) { return test(story.items[id].visible); });
    }
    function describe(full) {
      var r = room();
      out(r.name + '  ·  ' + fmtTime(S.time), 'title');
      var useShort = !full && r.short && (S.visited[S.room] || 0) > 1;
      say(T(useShort ? r.short : r.text));
      var lines = [], names = [];
      peopleHere().forEach(function (id) {
        var p = story.people[id], h = T(p.here);
        if (h) lines.push(h); else names.push(p.name);
      });
      if (lines.length) say(lines.join(' '));
      if (names.length) out('Here: ' + names.join(', ') + '.', 'note');
      var items = roomItemsVisible();
      if (items.length) out('You can see: ' + items.map(function (id) { return story.items[id].name; }).join(', ') + '.', 'note');
      if (S.party.length) out('With you: ' + S.party.map(function (id) { return story.people[id].name; }).join(', ') + '.', 'note');
      out(exitLine(), 'dim');
    }
    function enterRoom(id) {
      S.room = id;
      S.visited[id] = (S.visited[id] || 0) + 1;
      describe(false);
      arr(room().onEnter).forEach(function (e, i) {
        if (halt) return;
        if (e.once !== false && !e.repeat) {
          var key = 'enter:' + id + ':' + i;
          if (S.once[key]) return;
          if (!test(e['if'])) return;
          S.once[key] = 1;
          var copy = {}; Object.keys(e).forEach(function (k) { if (k !== 'if') copy[k] = e[k]; });
          run(copy);
        } else run(e);
      });
    }

    // ---- matching
    function score(q, names) {
      var best = 0;
      names.forEach(function (n) {
        n = clean(n);
        if (!n) return;
        if (q === n) best = Math.max(best, 3);
        else if ((' ' + n + ' ').indexOf(' ' + q + ' ') >= 0) best = Math.max(best, 2);
        else if (q.length >= 3 && (n.indexOf(q) >= 0 || (n.length >= 3 && q.indexOf(n) >= 0))) best = Math.max(best, 1);
      });
      return best;
    }
    function pick(q, list) {
      q = clean(q);
      if (!q) return null;
      var best = null, bs = 0;
      list.forEach(function (c) { var s = score(q, c.names); if (s > bs) { bs = s; best = c.id; } });
      return best;
    }
    function itemCands(ids) { return ids.map(function (id) { var it = story.items[id]; return { id: id, names: [it.name].concat(it.aliases || []) }; }); }
    function peopleCands(ids) { return ids.map(function (id) { var p = story.people[id]; return { id: id, names: [p.name].concat(p.aliases || []) }; }); }
    function sceneryText(q, sc) {
      if (!sc) return null;
      var list = Object.keys(sc).map(function (k) { return { id: k, names: k.split(',') }; });
      var k = pick(q, list);
      return k ? sc[k] : null;
    }
    function phraseMatch(q, phrases) {
      q = clean(q);
      return arr(phrases).some(function (p) { return clean(p) === q; });
    }

    // ---- commands
    function findExit(q) {
      var r = room(), t = clean(q), dir = DIRS[t];
      var xs = visibleExits(r);
      if (dir) { for (var i = 0; i < xs.length; i++) if (xs[i].dir === dir) return xs[i].e; }
      for (var j = 0; j < xs.length; j++) if (phraseMatch(t, xs[j].e.also)) return xs[j].e;
      var cands = xs.map(function (x, i) {
        var dest = story.rooms[x.e.to];
        return { id: i, names: [dest.name].concat(dest.aliases || [], x.e.label ? [T(x.e.label)] : []) };
      });
      var k = pick(t, cands);
      return k == null ? null : xs[k].e;
    }
    // Walks this long or longer show their minutes on exits, chips and the map.
    var LONG_WALK = 5;
    function moveMinutes(e) {
      var base = e.time != null ? e.time : story.clock.moveMinutes;
      var f = 1;
      arr(story.clock.moveModifiers).forEach(function (m) { if (test(m['if'])) f *= m.factor; });
      return Math.max(1, Math.round(base * f));
    }
    function go(q) {
      var e = findExit(q);
      if (!e) { say(DIRS[clean(q)] ? "You can't go that way." : "You can't go there from here."); out(exitLine(), 'dim'); return; }
      if (e['if'] && !test(e['if'])) { say(T(e.blocked) || "You can't go that way right now."); return; }
      markPicked(S.room + '|' + (e.label ? T(e.label) : story.rooms[e.to].name));
      advance(moveMinutes(e));
      if (halt) return;
      if (e.text) say(T(e.text));
      enterRoom(e.to);
    }
    function examine(q) {
      var id = pick(q, itemCands(S.inv)) || pick(q, itemCands(roomItemsVisible()));
      if (id) return say(T(story.items[id].desc) || 'Nothing unusual about it.');
      var pid = pick(q, peopleCands(peopleHere()));
      if (pid) return say(T(story.people[pid].desc) || story.people[pid].name + '.');
      var sc = sceneryText(q, room().scenery) || sceneryText(q, story.scenery);
      if (sc) return say(T(sc));
      if (clean(q) === 'room' || clean(q) === 'around') return describe(true);
      say("You don't see that here.");
    }
    function take(q) {
      if (/^(all|everything)$/.test(clean(q))) {
        var any = false;
        roomItemsVisible().forEach(function (id) { if (story.items[id].take !== false && test(story.items[id].takeIf)) { any = true; take(story.items[id].name); } });
        if (!any) say('There is nothing here you can take.');
        return;
      }
      var id = pick(q, itemCands(roomItemsVisible()));
      if (!id) {
        if (pick(q, itemCands(S.inv))) return say('You already have that.');
        if (pick(q, peopleCands(peopleHere()))) return say("That's a person.");
        if (sceneryText(q, room().scenery)) return say("You can't take that with you.");
        return say("You don't see that here.");
      }
      var it = story.items[id];
      if (it.take === false || !test(it.takeIf)) return say(T(it.noTake) || "You can't take that.");
      var list = S.roomItems[S.room];
      if (S.inv.indexOf(id) >= 0) {
        list.splice(list.indexOf(id), 1);
        return say('You already have that.');
      }
      advance(1);
      if (halt) return;
      list.splice(list.indexOf(id), 1);
      S.inv.push(id);
      markPicked(S.room + '|' + it.name);
      say(T(it.takeText) || 'Taken: ' + it.name + '.');
      run(it.onTake);
    }
    function drop(q) {
      var id = pick(q, itemCands(S.inv));
      if (!id) return say("You aren't carrying that.");
      var it = story.items[id];
      if (it.drop === false) return say(T(it.noDrop) || "You'd better hold on to that.");
      S.inv.splice(S.inv.indexOf(id), 1);
      S.roomItems[S.room].push(id);
      say(T(it.dropText) || 'You put down the ' + it.name + '.');
      run(it.onDrop);
    }
    function inventory() {
      var names = S.inv.map(function (id) { return story.items[id].name; });
      var notes = arr(story.inventoryNotes).filter(function (n) { return test(n['if']); }).map(function (n) { return T(n.text); });
      if (!names.length && !notes.length) return say("You're carrying nothing.");
      if (names.length) say('You have: ' + names.join(', ') + '.');
      notes.forEach(function (n) { out(n, 'note'); });
    }
    function useCmd(itemQ, targetQ) {
      var id = pick(itemQ, itemCands(S.inv));
      var who = targetQ ? pick(targetQ, peopleCands(peopleHere().concat(S.party))) : null;
      var tryTalk = who ? '(Try talking to ' + story.people[who].name + '.)' : null;
      if (!id && tryTalk) return say(tryTalk);
      if (!id) {
        if (pick(itemQ, itemCands(roomItemsVisible()))) return say("You'd need to pick it up first.");
        return say("You don't have that.");
      }
      var cands = arr(story.uses).filter(function (u) {
        return arr(u.item).indexOf(id) >= 0 && (!u['in'] || arr(u['in']).indexOf(S.room) >= 0);
      });
      var pid = targetQ ? pick(targetQ, peopleCands(peopleHere())) : null;
      var fits = cands.filter(function (u) {
        if (!targetQ) return !u.on && !u.to;
        if (u.to) return pid === u.to;
        return u.on && (phraseMatch(targetQ, u.on) || pick(targetQ, [{ id: 1, names: arr(u.on) }]));
      });
      var ok = fits.filter(function (u) { return test(u['if']); })[0];
      if (!ok) {
        if (fits.length && fits[0].fail) return say(T(fits[0].fail));
        if (tryTalk) return say(tryTalk);
        return say(targetQ ? "That doesn't do anything useful." : 'Use it on what?');
      }
      advance(ok.time != null ? ok.time : 2);
      if (halt) return;
      run(ok.effects);
    }
    function tryActions(l) {
      var acts = arr(room().actions).concat(arr(story.actions).filter(function (a) { return !a['in'] || arr(a['in']).indexOf(S.room) >= 0; }));
      for (var i = 0; i < acts.length; i++) {
        var a = acts[i];
        if (!phraseMatch(l, a.say)) continue;
        if (!test(a['if'])) { if (a.fail) { say(T(a.fail)); return true; } continue; }
        if (a.time) { advance(a.time); if (halt) return true; }
        run(a.effects);
        return true;
      }
      return false;
    }
    function wait(n) {
      n = Math.min(Math.max(n || story.clock.waitMinutes || 15, 1), 120);
      say(T(story.text.wait));
      advance(n);
      if (!halt) out("It's " + fmtTime(S.time) + '.', 'note');
    }
    function hint() {
      var h = arr(story.hints).filter(function (x) { return test(x['if']); });
      say(h.length ? T(h[0].text) : T(story.text.noHint));
    }
    // ---- notes: what the player has learned and what's still open
    function noteList() {
      return arr(story.notes).filter(function (n) { return test(n.show); }).map(function (n) {
        var state = n.done && test(n.done) ? 'done' : (n.missed && test(n.missed) ? 'missed' : 'open');
        return { id: n.id, text: T(n.text), state: state, due: state === 'open' && n.due ? n.due : '' };
      });
    }
    function listNotes() {
      var list = noteList();
      if (!list.length) return say(T(story.text.noNotes || "Nothing written down yet. Talk to people; what they tell you ends up here."), 'dim');
      out('NOTES · ' + fmtTime(S.time), 'title');
      var order = { open: 0, done: 1, missed: 2 };
      list.sort(function (a, b) { return order[a.state] - order[b.state]; }).forEach(function (n) {
        var mark = n.state === 'done' ? '✓ ' : (n.state === 'missed' ? '✗ ' : '▸ ');
        var tail = n.state === 'missed' ? ' (missed)' : (n.due ? ' (by ' + n.due + ')' : '');
        out(mark + n.text + tail, n.state === 'open' ? 'text' : 'dim');
      });
    }
    // After a move or an answer, mention any note that just appeared, once.
    function announceNotes() {
      if (!S || S.ended || mode === 'off') return;
      noteList().forEach(function (n) {
        var k = 'note:' + n.id;
        if (S.once[k]) return;
        S.once[k] = 1;
        if (n.id === 'water') return; // the first note is there from the start; the intro covers it
        var tip = S.once['tip:notes'] ? '' : ' (Type “notes” to see them all.)';
        S.once['tip:notes'] = 1;
        out('New note: ' + n.text + tip, 'note');
      });
    }
    function listEndings() {
      var found = endingsFound(), keys = Object.keys(story.endings);
      out('Endings found: ' + found.filter(function (k) { return story.endings[k]; }).length + ' of ' + keys.length, 'title');
      keys.forEach(function (k) {
        var en = story.endings[k];
        var type = typeName(k);
        out(found.indexOf(k) >= 0 ? '  ✓ ' + en.title + ' (' + (story.text.endingTypes[type] || type) + ')' : '  · ???', found.indexOf(k) >= 0 ? 'text' : 'dim');
      });
    }

    // ---- conversation
    function startTalk(q) {
      var ids = peopleHere().concat(S.party.filter(function (id) { return peopleHere().indexOf(id) < 0; }));
      var pid = q ? pick(q, peopleCands(ids)) : (ids.length === 1 ? ids[0] : null);
      if (!pid) {
        if (!q && ids.length) return say('Talk to whom? ' + ids.map(function (id) { return story.people[id].name; }).join(', ') + '.');
        return say(q ? "There's nobody here by that name." : "There's nobody here to talk to.");
      }
      var p = story.people[pid];
      if (!p.talk) return say(T(p.noTalk) || p.name + " doesn't want to talk.");
      markPicked('talk:' + pid);
      seenThisTalk = {};
      var st = p.talk.start, nid = st;
      if (Array.isArray(st)) { nid = null; for (var i = 0; i < st.length; i++) if (test(st[i]['if'])) { nid = st[i].node; break; } }
      showNode(pid, nid);
      S.once['talked:' + pid] = 1;
    }
    function showNode(pid, nid, menuOnly) {
      var p = story.people[pid], node = p.talk.nodes[nid];
      if (!node) { say('[' + p.name + ' has no line "' + nid + '" in story.js]', 'dim'); convo = null; return; }
      var startId = Array.isArray(p.talk.start) ? null : p.talk.start;
      var repeat = seenThisTalk[nid] || (S.once['talked:' + pid] && (nid === startId || node.againOnReturn));
      seenThisTalk[nid] = 1;
      if (!menuOnly) {
        say(T(repeat && node.again ? node.again : node.text));
        run(node.effects);
        if (halt || S.ended || mode === 'ask') return;
        if (node.menu && !arr(node.choices).length) { showNode(pid, node.menu, true); return; }
      }
      var choices = arr(node.choices).map(function (c, i) {
        var key = c.id || (pid + ':' + nid + ':' + i);
        var open = test(c['if']) && !(c.once && S.once[key]);
        return { c: c, key: key, open: open };
      }).filter(function (x) { return x.open || isPicked(x.key); });
      choices.forEach(function (x, i) { x.n = i + 1; });
      var anyOpen = false;
      for (var oi = 0; oi < choices.length; oi++) if (choices[oi].open) anyOpen = true;
      if (!anyOpen) { convo = null; flushNews(); if (node.next) showNode(pid, node.next); return; }
      convo = { pid: pid, choices: choices };
      flushNews();
      choices.forEach(function (x) {
        out(x.n + '. ' + T(x.c.text), 'choice', { id: x.key, picked: isPicked(x.key), spent: !x.open });
      });
      if (!S.once['tip:choices']) { S.once['tip:choices'] = 1; say(T(story.text.choiceTip), 'dim'); }
    }
    function choose(n) {
      var x = null;
      for (var i = 0; i < convo.choices.length; i++) if (convo.choices[i].n === n) { x = convo.choices[i]; break; }
      if (!x) { out('That isn\'t one of the numbers.', 'dim'); return; }
      if (!x.open) { out('You\'ve already been through that.', 'dim'); return; }
      var pid = convo.pid;
      convo = null;
      markPicked(x.key);
      if (x.c.once) S.once[x.key] = 1;
      // `pre` runs before the clock moves, so a flag can suppress an event the choice would otherwise cross.
      if (x.c.pre) run(x.c.pre);
      if (halt) return;
      held = [];
      var mins = x.c.time != null ? x.c.time : story.clock.talkMinutes;
      // `until` makes a choice end no earlier than that clock time (a ceremony that starts at 1:15 runs to 1:35).
      if (x.c.until) mins = Math.max(mins, parseTime(x.c.until) - S.time);
      advance(mins);
      pendingNews = held; held = null;
      if (halt) { flushNews(); return; }
      run(x.c.effects);
      if (S.ended) { pendingNews = null; return; }
      if (!halt && mode !== 'ask' && x.c.next) showNode(pid, x.c.next);
      flushNews();
    }

    // ---- top level
    function resetLog() { if (opts.onNewGame) opts.onNewGame(); }
    function newGame(keepLog) {
      if (!keepLog) {
        resetLog();
        out(story.meta.title, 'banner');
        if (story.meta.subtitle) out(story.meta.subtitle, 'dim');
        if (story.meta.warning) say(story.meta.warning, 'dim');
      }
      S = newState();
      convo = null;
      if (story.text.askName) { mode = 'name'; say(T(story.text.askName), 'note'); return; }
      beginStory();
    }
    function cleanName(raw) {
      var n = String(raw || '').replace(/[^A-Za-z\u00C0-\u024F .'-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
      return n ? n.charAt(0).toUpperCase() + n.slice(1) : '';
    }
    function beginStory() {
      mode = 'play';
      fx('flash');
      say(T(story.intro), 'intro');
      say(T(story.text.afterIntro), 'dim');
      enterRoom(S.room);
      persist();
    }
    function exitGame() {
      convo = null;
      persist();
      mode = 'off';
      say(T(story.text.quit), 'dim');
      onExit();
    }
    function start() {
      halt = false;
      var saved = load(KEY);
      var canContinue = saved && saved.v === story.meta.version && story.rooms[saved.room] && !saved.ended;
      if (!canContinue) resetLog();
      out(story.meta.title, 'banner');
      if (story.meta.subtitle) out(story.meta.subtitle, 'dim');
      if (story.meta.warning) say(story.meta.warning, 'dim');
      if (canContinue) {
        pendingSave = saved;
        mode = 'menu';
        out('Saved game found: ' + fmtTime(saved.time) + ', ' + story.rooms[saved.room].name + '.', 'note');
        out('1. Continue', 'choice');
        out('2. Start over', 'choice');
        return;
      }
      if (saved && saved.v !== story.meta.version) say(T(story.text.saveOutdated), 'dim');
      newGame(true);
    }
    function exec(l) {
      var m;
      if (tryActions(l)) return;
      if (l === 'l' || l === 'look' || l === 'look around') return describe(true);
      if ((m = /^(?:look at|look in|look|examine|x|inspect|read|check|search|study|watch) (.+)$/.exec(l))) return examine(m[1]);
      if (DIRS[l]) return go(l);
      if (l === 'exit' || l === 'leave') { if (findExit('out')) return go('out'); return say(T(story.text.exitHint)); }
      if ((m = /^(?:go|walk|run|head|travel|enter|climb|bike|cycle|ride|return|back)(?: to| into| toward| towards| back to)? (.+)$/.exec(l))) return go(m[1]);
      if ((m = /^(?:take|get|grab|pick up|pickup|collect|carry) (.+)$/.exec(l))) return take(m[1]);
      if ((m = /^pick (.+) up$/.exec(l))) return take(m[1]);
      if ((m = /^(?:drop|put down) (.+)$/.exec(l))) return drop(m[1]);
      if ((m = /^leave (.+)$/.exec(l))) {
        var here = room();
        var leavingHere = pick(m[1], [{ id: 1, names: [here.name].concat(here.aliases || []) }]);
        if (leavingHere) { if (findExit('out')) return go('out'); return say(T(story.text.exitHint)); }
        if (findExit(m[1])) return go(m[1]);
        return drop(m[1]);
      }
      if (/^(i|inv|inventory|items|bag|pockets)$/.test(l)) return inventory();
      if ((m = /^(?:talk|talk to|talk with|speak|speak to|speak with|ask|chat|chat with|greet|hello|hi)(?: (.+))?$/.exec(l))) return startTalk(m[1]);
      if ((m = /^(?:give|show|hand|offer|bring) (.+?) to (.+)$/.exec(l))) return useCmd(m[1], m[2]);
      if ((m = /^(?:use|apply|put|attach) (.+?) (?:on|with|in|into|to|over) (.+)$/.exec(l))) return useCmd(m[1], m[2]);
      if ((m = /^use (.+)$/.exec(l))) return useCmd(m[1], null);
      if ((m = /^(?:wait|z|rest)(?: for)?(?: (\d+))?(?: min| mins| minutes)?$/.exec(l))) return wait(m[1] ? Number(m[1]) : 0);
      if (/^(hint|hints|stuck)$/.test(l)) return hint();
      if (/^(time|clock|what time is it)$/.test(l)) return out("It's " + fmtTime(S.time) + '.', 'note');
      if (findExit(l)) return go(l);
      say(T(story.text.unknown));
    }
    function handle(raw) {
      halt = false;
      var line = norm(raw);
      if (mode === 'off') return;
      if (mode === 'name') {
        if (line === 'quit') { mode = 'off'; say(T(story.text.quit), 'dim'); onExit(); return; }
        var n = cleanName(raw);
        if (/^(play|help|look|l|hint|restart|start|continue|yes|no|y|n|inventory|i|quit|q|go|north|south|east|west|up|down|out|in)$/.test(line)) {
          say(T(story.text.nameIsCommand || "That sounds like a command, not a name. Please enter the first name on the account."), 'note');
          return;
        }
        if (!n) { say(T(story.text.askNameAgain || story.text.askName), 'note'); return; }
        S.vars.name = n;
        beginStory();
        return;
      }
      if (mode === 'menu') {
        if (line === '1' || line === 'continue') {
          S = pendingSave;
          if (!S.picked || typeof S.picked !== 'object') S.picked = {};
          pendingSave = null;
          mode = 'play';
          describe(true);
          return;
        }
        if (line === '2' || line === 'start over' || line === 'new' || line === 'restart') { del(KEY); newGame(); return; }
        if (line === 'quit') { mode = 'off'; say(T(story.text.quit), 'dim'); onExit(); return; }
        out('Type 1 to continue or 2 to start over.', 'dim');
        return;
      }
      if (mode === 'ask') {
        if (!line) return;
        if (isYes(line) || isNo(line)) {
          var a = pendingAsk; pendingAsk = null; mode = 'play';
          if (!a) return;
          S.prev = snapshot();
          if (isYes(line)) run(a.yes); else say(T(a.no) || 'Not yet.');
          persist();
          return;
        }
        // Anything else is a command. Keep the question unless it moves them on.
        var held = pendingAsk, roomAtAsk = S.room;
        pendingAsk = null;
        mode = 'play';
        playLine(line);
        if (held && mode === 'play' && !halt && !S.ended && S.room === roomAtAsk && !convo) {
          pendingAsk = held;
          mode = 'ask';
          out('(yes / no)', 'dim');
        }
        return;
      }
      if (mode === 'confirm') {
        if (/^(y|yes)$/.test(line)) { del(KEY); newGame(); return; }
        if (isNo(line)) { mode = 'play'; out('Okay, carrying on.', 'dim'); return; }
        mode = 'play';
      }
      if (mode === 'ended') {
        if (/^(restart|play|play again|new|again|start over)$/.test(line)) { del(KEY); newGame(); return; }
        if (line === 'endings') return listEndings();
        if (line === 'quit' || line === 'exit') { mode = 'off'; say(T(story.text.quit), 'dim'); onExit(); return; }
        say(T(story.text.afterEnding), 'dim');
        return;
      }
      playLine(line);
    }
    function playLine(line) {
      if (!line) return;
      if (line === 'quit' || line === 'q') return exitGame();
      if (convo) {
        if (/^\d+$/.test(line)) {
          var n = Number(line);
          var known = false;
          for (var ci = 0; ci < convo.choices.length; ci++) if (convo.choices[ci].n === n) known = true;
          if (known) {
            S.prev = snapshot(); checkpoint();
            choose(n); announceNotes(); persist(); return;
          }
          out('That isn\'t one of the numbers.', 'dim');
          return;
        }
        convo = null;
        if (/^(bye|goodbye|leave|nevermind|never mind|0|stop|back)$/.test(line)) { say(T(story.text.endTalk), 'dim'); return; }
      }
      if (/^\d+$/.test(line)) {
        var here = peopleHere().map(function (id) { return story.people[id].name; });
        return say(here.length
          ? "You're not talking to anyone right now. (Type “talk to " + here[0] + "” to start.)"
          : "You're not talking to anyone right now.", 'dim');
      }
      if (/^(help|\?|commands)$/.test(line)) return say(T(story.help));
      if (line === 'endings') return listEndings();
      if (/^(notes|note|journal|todo|tasks|to do)$/.test(line)) return listNotes();
      if (line === 'restart') { mode = 'confirm'; out('Start over from the beginning? Your current game will be lost. (yes / no)', 'note'); return; }
      if (line === 'save') return out('The game saves automatically after every move.', 'note');
      S.prev = snapshot();
      checkpoint();
      exec(stripArticles(line));
      announceNotes();
      persist();
    }

    // A snapshot for the on-screen panels (map, status, inventory).
    function view() {
      if (!S || mode === 'off' || mode === 'menu' || mode === 'name') return { mode: mode, playing: false };
      var r = room();
      return {
        mode: mode, playing: true, ended: S.ended,
        room: S.room, roomName: r.name, time: S.time, clock: fmtTime(S.time),
        inventory: S.inv.map(function (id) { return story.items[id].name; }),
        party: S.party.map(function (id) { return story.people[id].name; }),
        visited: Object.keys(S.visited),
        exits: visibleExits(r).map(function (x) { return { dir: x.dir, to: x.e.to, label: x.e.label ? T(x.e.label) : story.rooms[x.e.to].name, mins: moveMinutes(x.e), long: moveMinutes(x.e) >= LONG_WALK }; }),
        people: peopleHere().map(function (id) { return { id: id, name: story.people[id].name, picked: isPicked('talk:' + id) }; }),
        items: roomItemsVisible().map(function (id) { return story.items[id].name; }),
        picked: S.picked ? JSON.parse(JSON.stringify(S.picked)) : {},
        choices: convo ? convo.choices.map(function (x) {
          return { n: x.n, text: T(x.c.text), id: x.key, picked: isPicked(x.key), spent: !x.open };
        }) : [],
        talking: !!convo || mode === 'ask',
        asking: mode === 'ask',
        talkingWith: convo ? convo.pid : null,
        flags: JSON.parse(JSON.stringify(S.flags)),
        vars: JSON.parse(JSON.stringify(S.vars)),
        name: S.vars.name || '',
        endingTitle: S.ended ? story.endings[S.ended].title : null,
        endingType: S.ended ? resolveType(story.endings[S.ended]) : null,
        fallout: fmtTime(S.deadline),
        endingsFound: endingsFound().length,
        endingsTotal: Object.keys(story.endings).length,
        sheltered: shelteredCount(),
        notes: noteList()
      };
    }

    return {
      start: start,
      handle: handle,
      view: view,
      resolve: function (t) { return S ? T(t) : ''; },
      isActive: function () { return mode !== 'off'; },
      // for tests and tools
      _state: function () { return S; },
      _mode: function () { return mode; }
    };
  }

  var api = { createGame: createGame, parseTime: parseTime, fmtTime: fmtTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PleaseHoldEngine = api;
})(typeof window !== 'undefined' ? window : this);
