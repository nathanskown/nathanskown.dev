/* Market pages: a skip link past the long header, and a bottom market tape on every page.
   The tape reads the same live feed as the dashboard (/api/live?part=tiles, cached at the edge) and falls back to
   the hourly file. It pauses on hover or keyboard focus, has a pause button (moving content must be stoppable),
   and sits still for people who ask their system for reduced motion. Prices are about 15 minutes delayed. */
(function () {
  if (typeof document === 'undefined') return;
  var ORDER = ['spx', 'ixic', 'dji', 'rut', 'vix', 'tnx', 'dxy', 'wti', 'gold', 'btc', 'ftse', 'dax', 'n225', 'hsi', 'eurusd', 'usdjpy'];
  var SHORT = { spx: 'S&P 500', ixic: 'NASDAQ', dji: 'DOW', rut: 'RUSSELL 2K', vix: 'VIX', tnx: 'US 10Y', dxy: 'DOLLAR', wti: 'WTI CRUDE',
    gold: 'GOLD', btc: 'BITCOIN', ftse: 'FTSE 100', dax: 'DAX', sx5e: 'STOXX 50', n225: 'NIKKEI', hsi: 'HANG SENG', tsx: 'TSX', eurusd: 'EUR/USD', usdjpy: 'USD/JPY', gbpusd: 'GBP/USD' };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var num = function (v, d) { return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); };

  function skip() {
    var a = document.createElement('a');
    a.className = 't-skip'; a.href = '#main'; (function () { var m = document.querySelector('main'); if (m && !m.id) m.id = 'main'; })(); a.textContent = 'Skip to content';
    a.addEventListener('click', function (ev) {
      var m = document.querySelector('main') || document.querySelector('h1');
      if (!m) return;
      ev.preventDefault(); if (!m.id) m.id = 'main'; m.setAttribute('tabindex', '-1'); m.focus(); m.scrollIntoView();
    });
    document.body.insertBefore(a, document.body.firstChild);   // outside the rendered page tree, which the runtime owns
  }

  function tape() {
    if (document.querySelector('.f-tape')) return;
    var box = document.createElement('aside');
    box.className = 'f-tape';
    box.setAttribute('aria-label', 'Market tape: major indices, rates, commodities and the day’s biggest S&P 500 moves, delayed about 15 minutes');
    box.innerHTML = '<span class="f-tape-l"><span aria-hidden="true">▲▼</span> MARKETS<span class="x"> · DELAYED</span></span>' +
      '<div class="f-tape-win"><div class="f-tape-track" id="fTape"><div class="f-tape-run"><a href="/finance/"><span class="s">Loading markets…</span></a></div></div></div>' +
      '<button type="button" aria-pressed="false" aria-label="Pause the market tape" title="Pause">❚❚</button>';
    document.body.appendChild(box);
    document.body.classList.add('has-tape');
    var btn = box.querySelector('button'), paused = false;
    try { paused = localStorage.getItem('nskn.tape.paused') === '1'; } catch (e) {}
    var setPaused = function (v) {
      paused = v; box.classList.toggle('is-paused', v);
      btn.setAttribute('aria-pressed', String(v)); btn.textContent = v ? '▶' : '❚❚';
      btn.setAttribute('aria-label', v ? 'Play the market tape' : 'Pause the market tape'); btn.title = v ? 'Play' : 'Pause';
      try { localStorage.setItem('nskn.tape.paused', v ? '1' : '0'); } catch (e) {}
    };
    setPaused(paused);
    btn.addEventListener('click', function () { setPaused(!paused); });

    var dir = function (v) { return v > 0 ? 'u' : (v < 0 ? 'd' : 's'); };
    var arrow = function (v) { return v > 0 ? '▲' : (v < 0 ? '▼' : '■'); };
    var tile = function (t) {
      var px = t.price == null ? '—' : (t.unit === '$' ? '$' : '') + num(t.price, t.unit === '%' ? 2 : t.dec) + (t.unit === '%' ? '%' : '');
      var ch = t.unit === '%'
        ? (t.chg == null ? '' : arrow(t.chg) + ' ' + (t.chg >= 0 ? '+' : '−') + Math.abs(Math.round(t.chg * 100)) + ' bp')
        : (t.pct == null ? '' : arrow(t.pct) + ' ' + (t.pct >= 0 ? '+' : '−') + Math.abs(t.pct).toFixed(2) + '%');
      return '<a href="/finance/"><b>' + esc(SHORT[t.id] || t.name) + '</b> <span class="px">' + esc(px) + '</span> <span class="' + dir(t.unit === '%' ? t.chg : t.pct) + '">' + esc(ch) + '</span></a>';
    };
    var mover = function (m) {
      return '<a href="/finance/quote/?sym=' + encodeURIComponent(m.sym) + '"><b>' + esc(m.sym) + '</b> <span class="px">$' + num(m.price, 2) + '</span> <span class="' + dir(m.pct) + '">' + arrow(m.pct) + ' ' + (m.pct >= 0 ? '+' : '−') + Math.abs(m.pct).toFixed(1) + '%</span></a>';
    };
    var render = function (d) {
      var tiles = (d.tiles || []).slice().sort(function (a, b) {
        var ia = ORDER.indexOf(a.id), ib = ORDER.indexOf(b.id); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      }).filter(function (t) { return ORDER.indexOf(t.id) >= 0; });
      var mv = d.movers || {}, b = d.breadth;
      var html = tiles.map(tile).join('');
      if (b && b.n) html += '<a href="/finance/"><b>S&amp;P 500 BREADTH</b> <span class="u">' + b.adv + ' up</span> <span class="s">·</span> <span class="d">' + b.dec + ' down</span></a>';
      if ((mv.gainers || []).length) html += '<span class="lbl">Top gainers</span>' + mv.gainers.slice(0, 3).map(mover).join('');
      if ((mv.losers || []).length) html += '<span class="lbl">Top decliners</span>' + mv.losers.slice(0, 3).map(mover).join('');
      if (!html) html = '<a href="/finance/"><span class="s">Market data is not available right now. The dashboard has the latest stored prices.</span></a>';
      var tr = document.getElementById('fTape');
      // second copy makes the loop seamless; hidden from screen readers and the tab order so each item is read once
      tr.innerHTML = '<div class="f-tape-run">' + html + '</div><div class="f-tape-run" aria-hidden="true">' + html.replace(/<a (?![^>]*tabindex)/g, '<a tabindex="-1" ') + '</div>';
    };
    var get = function (u) { return fetch(u, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); };
    var timer;
    function open() {
      var ny = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      var m = ny.getHours() * 60 + ny.getMinutes(), wd = ny.getDay();
      return wd > 0 && wd < 6 && m >= 240 && m < 1200;      // pre-market through after-hours
    }
    function load() {
      var file = get('/data/finance/dashboard.json').catch(function () { return {}; });
      Promise.all([file, get('/api/live?part=tiles').catch(function () { return null; }), get('/api/live?part=movers').catch(function () { return null; })])
        .then(function (r) {
          var d = r[0] || {}, live = r[1], mv = r[2];
          var out = { tiles: (live && live.tiles && live.tiles.length) ? live.tiles : (d.tiles || []),
            movers: (mv && mv.movers) || d.movers, breadth: (mv && mv.breadth) || d.breadth };
          render(out);
        }, function () { render({}); });
      clearTimeout(timer); timer = setTimeout(load, open() ? 90000 : 900000);
    }
    load();
  }

  function init() { skip(); tape(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);
})();
