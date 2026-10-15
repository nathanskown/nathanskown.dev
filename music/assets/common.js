/* Shared helpers for the Music section. Plain script, no build step. */
(function () {
  "use strict";
  const MX = {};

  MX.$ = id => document.getElementById(id);
  MX.esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- randomness (seedable, so the daily challenge is the same for everyone) ---------- */
  MX.hashStr = function (s) {
    let h = 2166136261;
    for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  MX.mulberry32 = function (a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  };
  MX.shuffle = function (arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  /* "today" is Chicago's calendar day for everyone, so the daily challenge and leaderboard
     roll over at the same moment worldwide. */
  MX.todayKey = function () {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    } catch (e) {
      const d = new Date(), p = n => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    }
  };
  /* The visitor's own short time-zone label (ET, CT, GMT+9…) for the header clock. */
  MX.zoneLabel = function () {
    try {
      const n = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date()).find(p => p.type === "timeZoneName");
      return n ? n.value.replace(/^([ECMP])[SD]T$/, "$1T") : "";
    } catch (e) { return ""; }
  };
  /* When today's daily ends, in the visitor's own clock: "at 1:00 AM your time" (midnight US Central). */
  MX.dailyResetText = function () {
    try {
      const now = new Date(), key = MX.todayKey();
      for (let h = 0; h < 48; h++) {                    // first hour from now where Chicago's date changes
        const t = new Date(Math.floor(now / 3600000) * 3600000 + h * 3600000);
        const k = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
        if (k !== key) {
          const loc = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(t);
          return "A new daily challenge starts every day at " + loc + " your time (midnight US Central), the same moment for everyone.";
        }
      }
    } catch (e) {}
    return "A new daily challenge starts at midnight US Central time, the same moment for everyone.";
  };

  /* ---------- no recent repeats (per browser; harmless without storage) ---------- */
  /* Remembers what this browser has been shown so random rounds skip it until the pool runs low. */
  MX.seen = function (game, cap) {
    const key = "nskn.music.seen." + game;
    cap = cap || 400;
    const read = () => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; } };
    return {
      add(id) {
        if (!id) return;
        const a = read().filter(x => x !== id); a.push(id);
        try { localStorage.setItem(key, JSON.stringify(a.slice(-cap))); } catch (e) {}
      },
      /* list minus recently seen; if that leaves fewer than `need`, forget the oldest half and try again */
      fresh(list, idOf, need) {
        let s = read();
        while (s.length) {
          const set = new Set(s), left = list.filter(x => !set.has(idOf(x)));
          if (left.length >= need) return left;
          s = s.slice(Math.ceil(s.length / 2));
          try { localStorage.setItem(key, JSON.stringify(s)); } catch (e) {}
        }
        return list;
      }
    };
  };

  /* ---------- multi-select pool filter ---------- */
  /* groups: [{ key, label, opts: [{ v, label, n }] }]. Picks within a group widen the pool (OR),
     picks across groups narrow it (AND). Nothing picked in a group means "any". Choices persist per game. */
  MX.chipFilter = function (id, game, groups, onChange) {
    const el = MX.$(id), skey = "nskn.music.pool." + game;
    let sel = {};
    try { sel = JSON.parse(localStorage.getItem(skey)) || {}; } catch (e) {}
    groups.forEach(g => { sel[g.key] = (sel[g.key] || []).filter(v => g.opts.some(o => o.v === v)); });
    const save = () => { try { localStorage.setItem(skey, JSON.stringify(sel)); } catch (e) {} };
    const render = () => {
      el.innerHTML = groups.map(g =>
        '<div class="mx-cg" role="group" aria-label="' + MX.esc(g.label) + '"><span class="mx-cgl">' + MX.esc(g.label) + "</span>" +
        '<button type="button" class="mx-fc' + (sel[g.key].length ? "" : " on") + '" data-g="' + g.key + '" data-v="" aria-pressed="' + !sel[g.key].length + '">ANY</button>' +
        g.opts.map(o => {
          const on = sel[g.key].includes(o.v);
          return '<button type="button" class="mx-fc' + (on ? " on" : "") + '" data-g="' + g.key + '" data-v="' + MX.esc(o.v) + '" aria-pressed="' + on + '">' +
            MX.esc(o.label) + ' <span class="dim">' + o.n + "</span></button>";
        }).join("") + "</div>").join("") +
        '<div class="mx-cgn" id="' + id + 'N"></div>';
      onChange && onChange();
    };
    el.addEventListener("click", e => {
      const b = e.target.closest("button.mx-fc");
      if (!b) return;
      const g = b.dataset.g, v = b.dataset.v;
      if (!v) sel[g] = [];
      else sel[g] = sel[g].includes(v) ? sel[g].filter(x => x !== v) : sel[g].concat(v);
      save(); render();
    });
    render();
    return {
      get: () => sel,
      note: txt => { const n = MX.$(id + "N"); if (n) n.textContent = txt; },
      /* test(item, groupKey, value) -> bool */
      apply(list, test) {
        return list.filter(x => groups.every(g => !sel[g.key].length || sel[g.key].some(v => test(x, g.key, v))));
      }
    };
  };

  /* Autocomplete is only a convenience (answers are matched on what you type, never on what was
     suggested). It waits for SUGGEST_MIN characters and only matches at the start of a word. */
  MX.suggestMin = () => Math.max(2, +((window.MUSIC_CONFIG || {}).SUGGEST_MIN) || 4);
  MX.wordStart = (hay, needle) => hay.startsWith(needle) || hay.includes(" " + needle);

  /* ---------- guess matching ---------- */
  /* Normalize: lowercase, strip accents, drop (parentheticals), [brackets],
     " - Remastered" suffixes, "feat." credits and punctuation. */
  MX.norm = function (s) {
    return String(s).toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\(.*?\)|\[.*?\]/g, " ")
      .replace(/\s[-–—]\s.*$/, " ")
      .replace(/\b(feat|ft)\.?\s.*$/, " ")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ").trim();
  };
  MX.normArtist = s => MX.norm(s).replace(/^the /, "");
  MX.lev = function (a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  };
  /* both inputs already normalized; allow ~1 typo per 6 characters */
  MX.fuzzyEq = function (g, t) {
    if (!g || !t) return false;
    if (g === t) return true;
    return MX.lev(g, t) <= Math.floor(t.length / 6);
  };
  MX.isTitleMatch = (guess, title) => MX.fuzzyEq(MX.norm(guess), MX.norm(title));
  MX.isArtistMatch = function (guess, artist) {
    const g = MX.normArtist(guess);
    return [artist.name].concat(artist.aliases || []).some(n => MX.fuzzyEq(g, MX.normArtist(n)));
  };

  /* ---------- autocomplete ----------
     getItems(query) -> Promise<[{label, sub?}]>
     opts.onEnter()  -> called when Enter is pressed with nothing highlighted */
  MX.Autocomplete = function (input, box, getItems, opts) {
    opts = opts || {};
    let items = [], idx = -1, timer = null;
    function hide() { box.classList.add("hidden"); items = []; idx = -1; }
    function mark() { Array.prototype.forEach.call(box.children, (d, i) => d.classList.toggle("on", i === idx)); }
    function pick(i) { input.value = items[i].label; hide(); input.focus(); }
    async function show() {
      const found = await getItems(input.value);
      items = found || []; idx = -1;
      if (!items.length) { box.classList.add("hidden"); return; }
      box.innerHTML = items.map((s, i) =>
        '<div data-i="' + i + '">' + MX.esc(s.label) + (s.sub ? " <small>— " + MX.esc(s.sub) + "</small>" : "") + "</div>").join("");
      box.classList.remove("hidden");
    }
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(show, 120); });
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" && items.length) { e.preventDefault(); idx = (idx + 1) % items.length; mark(); }
      else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; mark(); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (idx >= 0) pick(idx); else if (opts.onEnter) opts.onEnter();
      }
      else if (e.key === "Escape") hide();
    });
    box.addEventListener("mousedown", e => {
      const d = e.target.closest("[data-i]");
      if (d) { e.preventDefault(); pick(+d.dataset.i); }
    });
    document.addEventListener("click", e => { if (!e.target.closest(".guess")) hide(); });
    return { hide };
  };

  /* ---------- small utilities ---------- */
  MX.copyText = async function (text, msgEl) {
    try { await navigator.clipboard.writeText(text); msgEl.textContent = "Copied."; }
    catch (e) { msgEl.textContent = "Couldn't reach the clipboard. Select the text above and copy it."; }
  };
  MX.initDevToggle = function () {
    const t = MX.$("devToggle");
    if (!t) return;
    t.onchange = () => {
      document.body.classList.toggle("dev", t.checked);   // shows layout notes only; answers are never revealed
    };
  };

  /* ---------- terminal chrome: title bar, command line, function keys ---------- */
  const ROUTES = {
    HOME: "/", MENU: "/", "1": "/", NSKN: "/",
    MUS: "/music/", MUSIC: "/music/",
    TRCK: "/music/track/", TRACK: "/music/track/", "2": "/music/track/",
    ARTS: "/music/artist/", ARTIST: "/music/artist/", "3": "/music/artist/",
    LB: "/music/leaderboard/", BOARD: "/music/leaderboard/", LEADERBOARD: "/music/leaderboard/", "5": "/music/leaderboard/",
    MKT: "/finance/", MARKET: "/finance/", FIN: "/finance/", FINANCE: "/finance/",
    SPRT: "/sports/", SPORTS: "/sports/", SPORT: "/sports/",
    CONTACT: "/#contact", ABOUT: "/"
  };
  MX.chrome = function (id, page) {
    const el = MX.$(id);
    if (!el) return;
    const keys = [["/", "1) HOME", ""], ["/music/track/", "2) TRCK", "track"], ["/music/artist/", "3) ARTS", "artist"], ["/music/", "4) MUSIC", "hub"], ["/music/leaderboard/", "5) BOARD", "board"]];
    el.innerHTML =
      '<div class="mx-title"><span class="mx-brand">1-NSKN</span>' +
      '<a class="mx-chip" href="/">Main Menu</a><span class="mx-chip on">MUSIC</span>' +
      (page.label ? '<span class="mx-chip">' + MX.esc(page.label) + "</span>" : "") +
      '<span class="mx-sp"></span><span class="mx-live"><span class="mx-dot"></span>LIVE <span id="mxClock" class="dim"></span></span></div>' +
      '<div class="mx-help"><span><span class="mx-inv">&lt;HELP&gt;</span> for explanation. &lt;MENU&gt; to return &middot; type a function, then press &lt;GO&gt;</span>' +
      '<span class="dim">TRCK &middot; ARTS &middot; LB &middot; MUS &middot; MKT &middot; SPRT</span></div>' +
      '<form class="mx-cmd" id="mxCmd" autocomplete="off"><span class="pfx">NSKN &rsaquo;</span>' +
      '<input id="mxCmdIn" type="text" placeholder="TYPE HELP, THEN GO" spellcheck="false" aria-label="Command line">' +
      '<button type="submit">GO</button></form>' +
      '<div class="mx-msg" id="mxMsg" role="status" aria-live="polite"></div>' +
      '<nav class="mx-fbar" aria-label="Music"><span class="t">Music</span>' +
      keys.map(k => '<a href="' + k[0] + '"' + (k[2] === page.key ? ' class="on" aria-current="page"' : "") + ">" + k[1] + "</a>").join("") +
      '<span class="r">NSKN Terminal</span></nav>';
    // skip link past the header, outside the header so it is the first thing a keyboard reaches
    if (!document.querySelector(".mx-skip")) {
      const sk = document.createElement("a");
      sk.className = "mx-skip"; sk.href = "#main"; sk.textContent = "Skip to content";
      sk.addEventListener("click", ev => {
        const m = document.querySelector("main");
        if (!m) return;
        ev.preventDefault(); m.setAttribute("tabindex", "-1"); m.focus(); m.scrollIntoView();
      });
      document.body.insertBefore(sk, document.body.firstChild);
    }
    const msg = MX.$("mxMsg");
    MX.$("mxCmd").onsubmit = e => {
      e.preventDefault();
      const input = MX.$("mxCmdIn"), c = input.value.trim().toUpperCase().replace(/(\s+|<)GO>?$/, "").trim();
      input.value = "";
      if (!c) { msg.textContent = "Type a function, e.g. TRCK or ARTS, then press GO."; return; }
      if (c === "HELP" || c === "H" || c === "?") {
        msg.innerHTML = "TRCK guess the track &middot; ARTS guess the artist &middot; LB leaderboard &middot; MUS music home &middot; HOME site menu &middot; MKT market analysis &middot; SPRT sports &middot; CONTACT";
        return;
      }
      if (ROUTES[c]) { msg.textContent = "Opening " + c + "…"; location.href = ROUTES[c]; return; }
      msg.innerHTML = '<span class="err">"' + MX.esc(c) + '" IS NOT A RECOGNIZED FUNCTION.</span> TRY HELP &lt;GO&gt;';
    };
    const clock = MX.$("mxClock");
    const tick = () => {
      try { clock.textContent = MX.zoneLabel() + " " + new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()); }
      catch (e) { clock.textContent = ""; }
    };
    tick(); setInterval(tick, 1000);
  };

  /* ---------- per-viewer best scores (browser storage; works without it) ---------- */
  const SKEY = "nskn.music.v1";
  const sread = () => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { return {}; } };
  MX.stats = {
    get: game => sread()[game] || null,
    record: (game, score, max, daily) => {
      try {
        const all = sread(), g = all[game] || { plays: 0 };
        g.plays++;
        if (!g.best || score / max > g.best / g.bestMax) { g.best = score; g.bestMax = max; }
        if (daily) { g.dailyKey = MX.todayKey(); g.dailyScore = score; g.dailyMax = max; }
        all[game] = g;
        localStorage.setItem(SKEY, JSON.stringify(all));
      } catch (e) { /* storage blocked: nothing to save */ }
    },
    dailyToday: game => { const g = MX.stats.get(game); return g && g.dailyKey === MX.todayKey() ? g : null; }
  };

  /* ---------- leaderboard client (talks to the site Worker at /api/music; see worker/music.js) ---------- */
  const NAMEKEY = "nskn.music.name";
  const LB_ERR = {
    leaderboard_not_configured: "The leaderboard isn't switched on yet.",
    name_not_allowed: "Please pick a different name.",
    bad_name: "Names need 2 to 16 letters or numbers.",
    wrong_day: "The day changed while you were playing (a new daily starts at midnight US Central). Play today's daily to post.",
    too_many: "Too many posts from this connection today. Try again tomorrow.",
    origin_not_allowed: "This address isn't allowed to post scores."
  };
  MX.lb = {
    base: () => String((window.MUSIC_CONFIG || {}).LB_URL || "/api/music").replace(/\/+$/, ""),
    enabled: () => !!MX.lb.base(),
    savedName: () => { try { return localStorage.getItem(NAMEKEY) || ""; } catch (e) { return ""; } },
    saveName: n => { try { localStorage.setItem(NAMEKEY, n); } catch (e) { /* storage blocked */ } },
    message: code => LB_ERR[code] || "Couldn't reach the leaderboard. Try again in a minute.",
    async call(path, opts) {
      let r, j = {};
      try { r = await fetch(MX.lb.base() + path, opts); j = await r.json().catch(() => ({})); }
      catch (e) { throw Object.assign(new Error("network"), { code: "network" }); }
      if (!r.ok) throw Object.assign(new Error(j.error || "http " + r.status), { code: j.error || "http" });
      return j;
    },
    post: (game, name, score, max) => MX.lb.call("/score", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ game, name, score, max, date: MX.todayKey() })
    }),
    board: (game, scope) => MX.lb.call("/board?game=" + encodeURIComponent(game) + "&scope=" + encodeURIComponent(scope)),
    table(entries, withDate, mine) {
      if (!entries || !entries.length) return '<p class="hint" style="margin:10px 0">No scores yet. Be the first.</p>';
      return '<table class="lb"><thead><tr><th>#</th><th>NAME</th><th class="n">SCORE</th>' + (withDate ? "<th class=\"n\">DAY</th>" : "") + "</tr></thead><tbody>" +
        entries.map((e, i) => '<tr' + (mine && e.name.toLowerCase() === mine.toLowerCase() ? ' class="me"' : "") + "><td>" + (i + 1) + "</td><td>" + MX.esc(e.name) + '</td><td class="n">' + e.score + " / " + e.max + "</td>" +
          (withDate ? '<td class="n">' + MX.esc(e.date) + "</td>" : "") + "</tr>").join("") + "</tbody></table>";
    }
  };

  /* ---------- little equalizer that dances while a clip plays ---------- */
  MX.eq = function (id) {
    const el = MX.$(id);
    if (!el) return { on() {}, off() {} };
    el.className = "eq"; el.innerHTML = "";
    for (let i = 0; i < 28; i++) {
      const b = document.createElement("i");
      b.style.setProperty("--h", (8 + Math.round(Math.abs(Math.sin(i * 1.7)) * 24)) + "px");
      b.style.setProperty("--d", ((i * 73) % 600) / 1000 + "s");
      el.appendChild(b);
    }
    return { on: () => el.classList.add("on"), off: () => el.classList.remove("on") };
  };

  MX.isLive = () => (window.MUSIC_CONFIG || {}).MODE === "live";

  /* ---------- when the next daily starts (midnight US Central), found by bisecting on Chicago's calendar date ---------- */
  let NEXT_DAILY = null;
  MX.nextDaily = function () {
    const now = Date.now();
    if (NEXT_DAILY && NEXT_DAILY > now) return NEXT_DAILY;
    try {
      const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
      const k0 = fmt.format(new Date(now));
      let lo = now, hi = now + 49 * 3600000;
      while (hi - lo > 1000) { const mid = Math.floor((lo + hi) / 2); if (fmt.format(new Date(mid)) === k0) lo = mid; else hi = mid; }
      NEXT_DAILY = hi;
    } catch (e) { NEXT_DAILY = now + 86400000; }
    return NEXT_DAILY;
  };
  MX.countdown = function () {
    const s = Math.max(0, Math.round((MX.nextDaily() - Date.now()) / 1000)), p = n => String(n).padStart(2, "0");
    return p(Math.floor(s / 3600)) + ":" + p(Math.floor(s / 60) % 60) + ":" + p(s % 60);
  };

  /* ---------- decorative visualizer bars (hidden from screen readers) ---------- */
  MX.viz = function (el, n, max) {
    if (!el) return;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const b = document.createElement("i");
      b.style.setProperty("--h", (10 + Math.round(Math.abs(Math.sin(i * 1.3 + 0.4)) * (max - 10))) + "px");
      b.style.setProperty("--d", ((i * 97) % 700) / 1000 + "s");
      el.appendChild(b);
    }
  };

  /* ---------- bottom tape on every music page: countdown to the next daily, today's top scores, your status ----------
     It pauses on hover or keyboard focus, has a pause button (moving content must be stoppable), and sits still for
     people who ask their system for reduced motion. */
  MX.tape = function () {
    if (document.querySelector(".mx-tape")) return;
    const box = document.createElement("aside");
    box.className = "mx-tape";
    box.setAttribute("aria-label", "Today's daily challenge: time until the next one, and the leaderboard");
    box.innerHTML = '<span class="mx-tape-l">DAILY<span class="x"> · NEXT IN</span> <b id="mxTapeCd">--:--:--</b></span>' +
      '<div class="mx-tape-win"><div class="mx-tape-track" id="mxTape"><div class="mx-tape-run"><a href="/music/leaderboard/"><span class="s">Loading today\'s board…</span></a></div></div></div>' +
      '<button type="button" aria-pressed="false" aria-label="Pause the scrolling scores" title="Pause">❚❚</button>';
    document.body.appendChild(box);
    document.body.classList.add("has-tape");
    const btn = box.querySelector("button");
    let paused = false;
    try { paused = localStorage.getItem("nskn.music.tape.paused") === "1"; } catch (e) {}
    const setPaused = v => {
      paused = v; box.classList.toggle("is-paused", v);
      btn.setAttribute("aria-pressed", String(v)); btn.textContent = v ? "▶" : "❚❚";
      btn.setAttribute("aria-label", v ? "Play the scrolling scores" : "Pause the scrolling scores"); btn.title = v ? "Play" : "Pause";
      try { localStorage.setItem("nskn.music.tape.paused", v ? "1" : "0"); } catch (e) {}
    };
    setPaused(paused);
    btn.addEventListener("click", () => setPaused(!paused));
    const cd = MX.$("mxTapeCd");
    const tick = () => { const c = MX.countdown(); cd.textContent = c; document.querySelectorAll(".mxCd").forEach(x => { x.textContent = c; }); };
    tick(); setInterval(tick, 1000);
    const GAMES = [["track", "TRCK", "Guess the Track", "/music/track/"], ["artist", "ARTS", "Guess the Artist", "/music/artist/"]];
    const mine = g => {
      const t = MX.stats.dailyToday(g[0]);
      return '<a href="' + g[3] + '"><span class="g">' + g[1] + '</span> <span class="s">YOUR DAILY</span> ' +
        (t ? '<span class="ok">' + t.dailyScore + " / " + t.dailyMax + "</span>" : '<span class="r">not played yet · play now</span>') + "</a>";
    };
    const render = boards => {
      let html = GAMES.map(mine).join("");
      GAMES.forEach((g, gi) => {
        const b = boards[gi];
        if (b && b.entries && b.entries.length) {
          html += b.entries.slice(0, 5).map((e, i) => '<a href="/music/leaderboard/"><span class="g">' + g[1] + '</span> <span class="r">#' + (i + 1) + "</span> " +
            MX.esc(e.name) + ' <span class="s">' + e.score + " / " + e.max + "</span></a>").join("");
        } else if (b) {
          html += '<a href="' + g[3] + '"><span class="g">' + g[1] + '</span> <span class="s">No scores posted today. Be the first.</span></a>';
        }
      });
      const tr = MX.$("mxTape");
      // second copy makes the loop seamless; hidden from screen readers and the tab order so each item is read once
      tr.innerHTML = '<div class="mx-tape-run">' + html + '</div><div class="mx-tape-run" aria-hidden="true">' + html.replace(/<a /g, '<a tabindex="-1" ') + "</div>";
    };
    const load = () => {
      if (!MX.lb.enabled()) { render([null, null]); return; }
      Promise.all(GAMES.map(g => MX.lb.board(g[0], "today").catch(() => null))).then(render);
    };
    load(); setInterval(load, 300000);
  };

  window.MX = MX;
})();
