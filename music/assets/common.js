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
  MX.todayKey = function () {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  };

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
      document.body.classList.toggle("dev", t.checked);
      const peek = MX.$("peekBtn");
      if (peek) peek.classList.toggle("hidden", !t.checked);
    };
  };

  /* ---------- terminal chrome: title bar, command line, function keys ---------- */
  const ROUTES = {
    HOME: "/", MENU: "/", "1": "/", NSKN: "/",
    MUS: "/music/", MUSIC: "/music/",
    TRCK: "/music/track/", TRACK: "/music/track/", "2": "/music/track/",
    ARTS: "/music/artist/", ARTIST: "/music/artist/", "3": "/music/artist/",
    MKT: "/finance/", MARKET: "/finance/", FIN: "/finance/", FINANCE: "/finance/",
    SPRT: "/sports/", SPORTS: "/sports/", SPORT: "/sports/",
    CONTACT: "/#contact", ABOUT: "/"
  };
  MX.chrome = function (id, page) {
    const el = MX.$(id);
    if (!el) return;
    const keys = [["/", "1) HOME", ""], ["/music/track/", "2) TRCK", "track"], ["/music/artist/", "3) ARTS", "artist"], ["/music/", "4) MUSIC", "hub"]];
    el.innerHTML =
      '<div class="mx-title"><span class="mx-brand">1-NSKN</span>' +
      '<a class="mx-chip" href="/">Main Menu</a><span class="mx-chip on">MUSIC</span>' +
      (page.label ? '<span class="mx-chip">' + MX.esc(page.label) + "</span>" : "") +
      '<span class="mx-sp"></span><span class="mx-live"><span class="mx-dot"></span>LIVE <span id="mxClock" class="dim">CHI</span></span></div>' +
      '<div class="mx-help"><span><span class="mx-inv">&lt;HELP&gt;</span> for explanation. &lt;MENU&gt; to return &middot; type a function, then press &lt;GO&gt;</span>' +
      '<span class="dim">TRCK &middot; ARTS &middot; MUS &middot; MKT &middot; SPRT</span></div>' +
      '<form class="mx-cmd" id="mxCmd" autocomplete="off"><span class="pfx">NSKN &rsaquo;</span>' +
      '<input id="mxCmdIn" type="text" placeholder="TYPE HELP, THEN GO" spellcheck="false" aria-label="Command line">' +
      '<button type="submit">GO</button></form>' +
      '<div class="mx-msg" id="mxMsg"></div>' +
      '<div class="mx-fbar"><span class="t">Music</span>' +
      keys.map(k => '<a href="' + k[0] + '"' + (k[2] === page.key ? ' class="on"' : "") + ">" + k[1] + "</a>").join("") +
      '<span class="r">NSKN Terminal</span></div>';
    const msg = MX.$("mxMsg");
    MX.$("mxCmd").onsubmit = e => {
      e.preventDefault();
      const input = MX.$("mxCmdIn"), c = input.value.trim().toUpperCase().replace(/(\s+|<)GO>?$/, "").trim();
      input.value = "";
      if (!c) { msg.textContent = "Type a function, e.g. TRCK or ARTS, then press GO."; return; }
      if (c === "HELP" || c === "H" || c === "?") {
        msg.innerHTML = "TRCK guess the track &middot; ARTS guess the artist &middot; MUS music home &middot; HOME site menu &middot; MKT market analysis &middot; SPRT sports &middot; CONTACT";
        return;
      }
      if (ROUTES[c]) { msg.textContent = "Opening " + c + "…"; location.href = ROUTES[c]; return; }
      msg.innerHTML = '<span class="err">"' + MX.esc(c) + '" IS NOT A RECOGNIZED FUNCTION.</span> TRY HELP &lt;GO&gt;';
    };
    const clock = MX.$("mxClock");
    const tick = () => {
      try { clock.textContent = "CHI " + new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()); }
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

  window.MX = MX;
})();
