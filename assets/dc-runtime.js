/* Tiny runtime for the NSKN page templates.
   A page ships its markup as a JSON tree (window.DC_TREE) plus a
   `class Component extends DCLogic` with renderVals(). The runtime fills
   {{holes}}, expands <sc-for>/<sc-if>, wires onX handlers, and patches the
   DOM in place on every setState so inputs keep focus. */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  /* page-wide values any template can use, e.g. {{todayLabel}} */
  var G = window.DC_G = window.DC_G || {};
  G.todayLabel = new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).replace(/,/g, '');

  /* formatting helpers shared by every page */
  var F = window.F = {
    n: function (v, d) { return v === null || v === undefined || isNaN(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); },
    pct: function (v, d) { return v === null || v === undefined || isNaN(v) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d === undefined ? 2 : d) + '%'; },
    usd: function (v, d) { return v === null || v === undefined || isNaN(v) ? '—' : (v < 0 ? '−$' : '$') + F.n(Math.abs(v), d === undefined ? 2 : d); },
    arrow: function (v) { return v === null || v === undefined ? '' : (v >= 0 ? '▲' : '▼'); },
    money: function (v, d) {
      if (v === null || v === undefined || isNaN(v)) return '—';
      var a = Math.abs(v), s = v < 0 ? '−$' : '$';
      if (a >= 1e12) return s + (a / 1e12).toFixed(d === undefined ? 2 : d) + 'T';
      if (a >= 1e9) return s + (a / 1e9).toFixed(d === undefined ? 1 : d) + 'B';
      if (a >= 1e6) return s + (a / 1e6).toFixed(d === undefined ? 1 : d) + 'M';
      if (a >= 1e3) return s + (a / 1e3).toFixed(0) + 'K';
      return s + a.toFixed(2);
    },
    big: function (v) { if (v === null || v === undefined) return '—'; var a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e9 ? s + (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? s + (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? s + (a / 1e3).toFixed(0) + 'K' : s + a.toFixed(0); },
    time: function (iso) { if (!iso) return ''; var d = typeof iso === 'number' ? new Date(iso * 1000) : new Date(iso); return d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }); },
    day: function (iso) { if (!iso) return ''; var d = typeof iso === 'number' ? new Date(iso * 1000) : new Date(String(iso).length === 10 ? iso + 'T12:00:00Z' : iso); return d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }); },
    ago: function (iso) {
      if (!iso) return '';
      var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
      return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' hr ago' : Math.round(m / 1440) + ' d ago';
    },
    updated: function (iso) { return iso ? 'LIVE · UPDATED ' + F.day(iso).toUpperCase() + ' ' + F.time(iso) + ' CT' : 'LOADING…'; }
  };
  var ROUTES = window.DC_ROUTES || {};
  function route(href) {
    var q = href.indexOf('?'), base = q < 0 ? href : href.slice(0, q);
    return ROUTES[base] ? ROUTES[base] + (q < 0 ? '' : href.slice(q)) : href;
  }
  var EVENT_MAP = { change: 'input', doubleclick: 'dblclick' };
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;
  var SVG_ATTR = { viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio' };

  function lookup(scope, path) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    var parts = path.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v === null || v === undefined) return undefined;
      v = v[parts[i]];
    }
    if (v === undefined && parts.length === 1 && G[path] !== undefined) return G[path];
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) {
      var v = lookup(scope, p);
      return v === undefined || v === null ? '' : String(v);
    });
  }
  function attrValue(raw, scope) {
    var m = WHOLE.exec(raw);
    return m ? lookup(scope, m[1]) : interp(raw, scope);
  }

  /* template tree -> virtual nodes */
  function build(node, scope, out, svg) {
    if (typeof node === 'string') { out.push(interp(node, scope)); return; }
    var tag = node.t;
    if (tag === 'sc-for') {
      var list = attrValue(node.a.list || '', scope) || [];
      var as = node.a.as || 'item';
      for (var i = 0; i < list.length; i++) {
        var child = Object.create(scope);
        child[as] = list[i]; child.$index = i;
        for (var k = 0; k < node.c.length; k++) build(node.c[k], child, out, svg);
      }
      return;
    }
    if (tag === 'sc-if') {
      if (attrValue(node.a.value || '', scope)) for (var j = 0; j < node.c.length; j++) build(node.c[j], scope, out, svg);
      return;
    }
    var isSvg = svg || tag === 'svg';
    var v = { tag: tag, svg: isSvg, attrs: {}, ev: {}, ref: null, kids: [] };
    for (var name in node.a) {
      if (name.indexOf('hint-') === 0) continue;
      var val = attrValue(node.a[name], scope);
      if (/^on[a-z]+$/i.test(name) && (typeof val === 'function' || WHOLE.test(node.a[name]))) {
        var type = name.slice(2).toLowerCase();
        if (typeof val === 'function') v.ev[EVENT_MAP[type] || type] = val;
        continue;
      }
      if (SVG_ATTR[name]) name = SVG_ATTR[name];
      if (name === 'ref') { if (typeof val === 'function') v.ref = val; continue; }
      if (name === 'classname') name = 'class';
      if (name === 'href' && typeof val === 'string') {
        val = route(val);
        // a link with nowhere to go renders as plain text instead of a dead link
        if (tag === 'a' && (val === '#' || val === '')) continue;
      }
      if (val === undefined || val === null || val === false) continue;
      v.attrs[name] = val === true ? '' : String(val);
    }
    for (var c = 0; c < node.c.length; c++) build(node.c[c], scope, v.kids, isSvg);
    out.push(v);
  }

  /* virtual nodes -> DOM, patched in place */
  function create(v) {
    if (typeof v === 'string') return document.createTextNode(v);
    var el = v.svg ? document.createElementNS(SVG_NS, v.tag) : document.createElement(v.tag);
    el._ev = {};
    update(el, null, v);
    v.kids.forEach(function (k) { el.appendChild(create(k)); });
    if (v.ref) v.ref(el);
    return el;
  }
  function handler(e) { var f = this._ev && this._ev[e.type]; if (f) f(e); }
  function update(el, old, v) {
    var oa = old ? old.attrs : {}, name;
    for (name in oa) if (!(name in v.attrs)) el.removeAttribute(name);
    for (name in v.attrs) {
      var val = v.attrs[name];
      if (name === 'value' && 'value' in el && el.tagName !== 'BUTTON') { if (el.value !== val) el.value = val; continue; }
      if (oa[name] !== val || el.getAttribute(name) !== val) el.setAttribute(name, val);
    }
    var oe = old ? old.ev : {};
    for (name in v.ev) if (!oe[name]) el.addEventListener(name, handler);
    el._ev = v.ev;
  }
  function patch(parent, olds, news) {
    var nodes = parent.childNodes, i;
    for (i = 0; i < news.length; i++) {
      var o = olds[i], n = news[i], dom = nodes[i];
      if (o === undefined || dom === undefined) { parent.appendChild(create(n)); continue; }
      var oText = typeof o === 'string', nText = typeof n === 'string';
      if (oText && nText) { if (o !== n) dom.nodeValue = n; continue; }
      if (oText || nText || o.tag !== n.tag) { parent.replaceChild(create(n), dom); continue; }
      update(dom, o, n);
      patch(dom, o.kids, n.kids);
    }
    while (parent.childNodes.length > news.length) parent.removeChild(parent.lastChild);
  }

  /* component base */
  function DCLogic(props) { this.props = props || {}; }
  DCLogic.prototype.setState = function (p) {
    var next = typeof p === 'function' ? p(this.state || {}, this.props) : p;
    this.state = Object.assign({}, this.state || {}, next || {});
    schedule(this);
  };
  DCLogic.prototype.forceUpdate = function () { schedule(this); };
  window.DCLogic = DCLogic;

  var queued = false;
  function schedule(c) {
    if (!c._mounted || queued) return;
    queued = true;
    Promise.resolve().then(function () { queued = false; render(c); if (c.componentDidUpdate) c.componentDidUpdate(); });
  }
  function render(c) {
    var out = [];
    var vals = c.renderVals ? c.renderVals() || {} : {};
    DC_TREE.forEach(function (n) { build(n, vals, out, false); });
    patch(c._root, c._v || [], out);
    c._v = out;
  }

  /* command line on every inner page: type a page code, team or ticker and press Enter */
  var CMDS = {
    HOME: '/', MENU: '/', DGST: '/#digest', DIGEST: '/#digest',
    MKT: '/finance/', FIN: '/finance/', WEI: '/finance/', TOP: '/finance/headlines/', NEWS: '/finance/headlines/',
    DES: '/finance/quote/', QUOTE: '/finance/quote/', NWND: '/finance/quote/', HDS: '/finance/ownership/', OWN: '/finance/ownership/',
    ERN: '/finance/earnings/', ECO: '/finance/macro/', MACRO: '/finance/macro/', IPO: '/finance/ipo/',
    PRSM: '/finance/ownership/?ticker=PRSM', HLWY: '/finance/ownership/?ticker=HLWY', ODEN: '/finance/ownership/?ticker=ODEN', KTRA: '/finance/ownership/?ticker=KTRA',
    SPRT: '/sports/', SPORTS: '/sports/', SCOR: '/sports/', SCORES: '/sports/',
    GAME: '/sports/game/football/', NFL: '/sports/game/football/', MLB: '/sports/game/baseball/', NBA: '/sports/game/basketball/', NHL: '/sports/game/hockey/',
    TEAM: '/sports/team/lions/', LIONS: '/sports/team/lions/', TIGERS: '/sports/team/tigers/', PISTONS: '/sports/team/pistons/',
    REDWINGS: '/sports/team/red-wings/', WINGS: '/sports/team/red-wings/', MSU: '/sports/team/msu-football/', MSUFB: '/sports/team/msu-football/',
    MSUBB: '/sports/team/msu-basketball/', MSUHKY: '/sports/team/msu-hockey/',
    SIM: '/sports/simulator/', ODDS: '/sports/odds/', SPOT: '/sports/spots/', INJ: '/sports/injuries/', LUCK: '/sports/luck-watch/',
    SOS: '/sports/schedule-strength/', TRAK: '/sports/track-record/', METH: '/sports/methodology/'
  };
  function runCmd(input) {
    var c = input.value.trim().toUpperCase().replace(/(\s+|<)GO>?$/, '').replace(/[\s-]+/g, '');
    if (!c) return;
    if (CMDS[c]) { location.href = CMDS[c]; return; }
    input.value = '';
    input.placeholder = c === 'HELP' ? 'TRY WEI · TOP · DES · ERN · SCOR · LIONS · MSU · HOME' : '"' + c + '" NOT FOUND · TRY HELP';
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('t-input')) { e.preventDefault(); runCmd(e.target); }
  });
  document.addEventListener('submit', function (e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-cmd')) {
      e.preventDefault();
      var i = e.target.querySelector('.t-input'); if (i) runCmd(i);
    }
  });

  window.DC = {
    /* fetch one data file; ?v= changes every 5 minutes so browsers don't hold stale copies */
    load: function (path) {
      var v = Math.floor(Date.now() / 300000);
      return fetch(path + (path.indexOf('?') < 0 ? '?' : '&') + 'v=' + v).then(function (r) {
        if (!r.ok) throw new Error(r.status + ' ' + path);
        return r.json();
      });
    },
    mount: function (Component, defaults) {
      var props = {};
      for (var k in (defaults || {})) if (k.charAt(0) !== '$' && defaults[k] && 'default' in defaults[k]) props[k] = defaults[k]['default'];
      var c = new Component(props);
      // deep links: ?mode=1&sport=football or ?ticker=PRSM preset the page's state
      var init = {};
      new URLSearchParams(location.search).forEach(function (v, k) { init[k] = /^-?\d+$/.test(v) ? Number(v) : v; });
      if (Object.keys(init).length) c.state = Object.assign({}, c.state || {}, init);
      c._root = document.getElementById('app');
      c._mounted = true;
      render(c);
      if (c.componentDidMount) c.componentDidMount();
      window.addEventListener('pagehide', function () { if (c.componentWillUnmount) c.componentWillUnmount(); });
      return c;
    }
  };
})();
