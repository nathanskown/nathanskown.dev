/* Sports data layer for the NSKN Sports pages.
   Live data comes from ESPN's public site API through the site's own cached proxy (/api/espn/...),
   and slower data (standings, injuries, leaders, house ratings and odds) from JSON files the
   refresh-sports workflow commits under /data/sports/. Everything here turns those payloads into
   small, predictable records the page templates can render. Betting odds, ESPN win probabilities
   and pick'em data in the feeds are deliberately ignored. */
(function () {
  'use strict';

  var LEAGUES = {
    nfl:   { sport: 'football',   slug: 'nfl',                     label: 'NFL',           short: 'NFL',  teams: true, model: true, unit: 'pts' },
    mlb:   { sport: 'baseball',   slug: 'mlb',                     label: 'MLB',           short: 'MLB',  teams: true, model: true, unit: 'runs' },
    nhl:   { sport: 'hockey',     slug: 'nhl',                     label: 'NHL',           short: 'NHL',  teams: true, model: true, unit: 'goals' },
    nba:   { sport: 'basketball', slug: 'nba',                     label: 'NBA',           short: 'NBA',  teams: true, model: true, unit: 'pts' },
    ncaaf: { sport: 'football',   slug: 'college-football',        label: 'College football', short: 'NCAAF', teams: true, model: true, unit: 'pts', groups: '80' },
    ncaab: { sport: 'basketball', slug: 'mens-college-basketball', label: 'College basketball', short: 'NCAAB', teams: true, model: true, unit: 'pts', groups: '50' },
    ncaah: { sport: 'hockey',     slug: 'mens-college-hockey',     label: 'College hockey', short: 'NCAAH', teams: true, model: true, unit: 'goals' },
    epl:   { sport: 'soccer',     slug: 'eng.1',                   label: 'Premier League', short: 'EPL' },
    ucl:   { sport: 'soccer',     slug: 'uefa.champions',          label: 'Champions League', short: 'UCL' },
    mls:   { sport: 'soccer',     slug: 'usa.1',                   label: 'MLS',           short: 'MLS' },
    pga:   { sport: 'golf',       slug: 'pga',                     label: 'PGA Tour',      short: 'PGA',  kind: 'golf' },
    atp:   { sport: 'tennis',     slug: 'atp',                     label: 'ATP',           short: 'ATP',  kind: 'tennis' },
    wta:   { sport: 'tennis',     slug: 'wta',                     label: 'WTA',           short: 'WTA',  kind: 'tennis' }
  };
  var ORDER = ['nfl', 'mlb', 'nhl', 'nba', 'ncaaf', 'ncaab', 'ncaah', 'epl', 'ucl', 'mls', 'pga', 'atp', 'wta'];

  function api(lg, kind, params) {
    var L = LEAGUES[lg];
    var base = kind === 'standings' ? '/api/espn/v2/sports/' : '/api/espn/site/v2/sports/';
    var q = [];
    for (var k in (params || {})) if (params[k] !== undefined && params[k] !== null && params[k] !== '') q.push(k + '=' + encodeURIComponent(params[k]));
    return base + L.sport + '/' + L.slug + '/' + kind + (q.length ? '?' + q.join('&') : '');
  }
  // live feeds are shared for 20 seconds, so the page and the score crawl don't fetch the same scoreboard twice
  var recent = {};
  function get(url) {
    var hit = recent[url];
    if (hit && Date.now() - hit.at < 20000) return hit.p;
    var p = fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); });
    recent[url] = { at: Date.now(), p: p };
    p.catch(function () { delete recent[url]; });
    return p;
  }
  function data(path) { return window.DC ? DC.load('/data/sports/' + path) : get('/data/sports/' + path); }

  function num(v) { if (v === null || v === undefined || v === '') return null; var n = typeof v === 'object' ? Number(v.value) : Number(v); return isNaN(n) ? null : n; }
  function rec(c) {
    var r = (c.records || c.record || []);
    if (!r.length) return '';
    var t = r.filter(function (x) { return x.type === 'total' || x.name === 'overall' || x.name === 'All Splits'; })[0] || r[0];
    return t.summary || t.displayValue || '';
  }
  function hex(c, fb) { return c ? '#' + String(c).replace('#', '') : fb; }

  function teamOf(c, lg) {
    var t = c.team || {};
    return {
      id: String(t.id || c.id || ''), abbr: t.abbreviation || '', name: t.displayName || t.name || '', short: t.shortDisplayName || t.name || t.abbreviation || '',
      loc: t.location || '', color: hex(t.color, '#12363B'), alt: hex(t.alternateColor, '#C8F7FC'),
      score: c.score && typeof c.score === 'object' ? c.score.displayValue : (c.score === undefined ? '' : String(c.score)),
      home: c.homeAway === 'home', winner: c.winner === true, record: rec(c),
      rank: c.curatedRank && c.curatedRank.current && c.curatedRank.current < 99 ? c.curatedRank.current : null,
      lines: (c.linescores || []).map(function (l) { return l.displayValue !== undefined ? l.displayValue : (l.value === undefined ? '' : String(l.value)); }),
      href: LEAGUES[lg] && LEAGUES[lg].teams && t.id ? teamHref(lg, t.id) : ''
    };
  }

  function status(s) {
    s = s || {}; var t = s.type || {};
    return { state: t.state || 'pre', done: !!t.completed, detail: t.shortDetail || t.detail || t.description || '', name: t.name || '', period: s.period || 0, clock: s.displayClock || '' };
  }

  /* one scoreboard event -> card record (team sports) */
  function normEvent(e, lg) {
    var L = LEAGUES[lg] || {};
    var c = (e.competitions || [])[0] || {};
    var st = status(c.status || e.status);
    var teams = (c.competitors || []).map(function (x) { return teamOf(x, lg); });
    teams.sort(function (a, b) { return (a.home ? 1 : 0) - (b.home ? 1 : 0); }); // away first, home second
    var tv = (c.broadcasts || []).map(function (b) { return (b.names || []).join('/'); }).filter(Boolean).join(', ') || (c.broadcast || '');
    var note = ((c.notes || [])[0] || {}).headline || '';
    var series = c.series && c.series.summary ? c.series.summary : '';
    return {
      lg: lg, id: String(e.id), start: e.date, name: e.name || '', short: e.shortName || '', week: e.week ? e.week.number : null,
      // ESPN marks games without a set start time (it fills in 11:59 PM Eastern as a placeholder)
      tbd: c.timeValid === false || /\bTBD\b/i.test(st.detail || '') || /T0[34]:59/.test(e.date || ''),
      state: st.state, done: st.done, detail: st.detail, period: st.period, clock: st.clock,
      neutral: !!c.neutralSite, venue: (c.venue || {}).fullName || '', city: ((c.venue || {}).address || {}).city || '',
      tv: tv, note: note || series, away: teams[0] || null, home: teams[1] || null,
      href: L.teams ? gameHref(lg, e.id) : ''
    };
  }

  /* golf: one tournament with its top of the leaderboard */
  function normGolf(e) {
    var c = (e.competitions || [])[0] || {};
    var st = status(c.status || e.status);
    var players = (c.competitors || []).slice(0, 10).map(function (p) {
      var a = p.athlete || {};
      return { pos: (p.status && p.status.position && p.status.position.displayName) || p.order || '', name: a.displayName || a.shortName || '', score: p.score && p.score.displayValue ? p.score.displayValue : (p.score || ''), thru: p.status && p.status.thru ? 'thru ' + p.status.thru : '' };
    });
    return { lg: 'pga', kind: 'golf', id: String(e.id), name: e.name, start: e.date, end: e.endDate, state: st.state, detail: st.detail, players: players };
  }

  /* tennis: a tournament's singles matches, newest and live first */
  function normTennis(e, lg) {
    var out = [];
    (e.groupings || []).forEach(function (g) {
      var gname = (g.grouping || {}).displayName || '';
      if (!/singles/i.test(gname)) return;
      (g.competitions || []).forEach(function (m) {
        var st = status(m.status);
        var ps = (m.competitors || []).map(function (p) {
          var a = p.athlete || {};
          return { name: a.shortName || a.displayName || 'TBD', winner: p.winner === true, sets: (p.linescores || []).map(function (l) { return String(l.value === undefined ? '' : l.value) + (l.tiebreak !== undefined ? '(' + l.tiebreak + ')' : ''); }).join(' ') };
        });
        out.push({ id: String(m.id), round: (m.round || {}).displayName || '', state: st.state, detail: st.detail, start: m.date, players: ps, draw: gname });
      });
    });
    var rank = { 'in': 0, post: 1, pre: 2 };
    out.sort(function (a, b) { return (rank[a.state] - rank[b.state]) || (a.state === 'post' ? (b.start > a.start ? 1 : -1) : (a.start > b.start ? 1 : -1)); });
    return { lg: lg, kind: 'tennis', id: String(e.id), name: e.name, start: e.date, end: e.endDate, matches: out };
  }

  function scores(lg, params) {
    var L = LEAGUES[lg];
    var p = Object.assign({}, params || {});
    if (L.groups && !p.groups) p.groups = L.groups;
    if (L.kind === undefined && (lg === 'ncaaf' || lg === 'ncaab' || lg === 'ncaah') && !p.limit) p.limit = 300;
    return get(api(lg, 'scoreboard', p)).then(function (j) {
      var evs = j.events || [];
      if (L.kind === 'golf') return { lg: lg, events: evs.map(normGolf) };
      if (L.kind === 'tennis') return { lg: lg, events: evs.map(function (e) { return normTennis(e, lg); }) };
      return { lg: lg, events: evs.map(function (e) { return normEvent(e, lg); }), week: j.week ? j.week.number : null, season: j.season || null };
    });
  }

  /* a team's season schedule (results and upcoming) */
  function schedule(lg, id, params) {
    return get(api(lg, 'teams/' + id + '/schedule', params || {})).then(function (j) {
      var me = String((j.team || {}).id || id);
      var games = (j.events || []).map(function (e) {
        var c = (e.competitions || [])[0] || {};
        var st = status(c.status);
        var cs = c.competitors || [];
        var mine = cs.filter(function (x) { return String((x.team || {}).id) === me; })[0] || cs[0] || {};
        var opp = cs.filter(function (x) { return x !== mine; })[0] || {};
        var my = teamOf(mine, lg), op = teamOf(opp, lg);
        var res = '';
        if (st.done && my.score !== '' && op.score !== '') res = mine.winner ? 'W' : (opp.winner ? 'L' : 'T');
        return { id: String(e.id), start: e.date, week: e.week ? e.week.text || e.week.number : '', season: (e.seasonType || {}).name || '', home: mine.homeAway === 'home', neutral: !!c.neutralSite,
          opp: op, me: my, state: st.state, done: st.done, detail: st.detail, result: res, score: my.score && op.score ? my.score + '–' + op.score : '',
          tv: (c.broadcasts || []).map(function (b) { return (b.media || {}).shortName || (b.names || []).join('/'); }).filter(Boolean).join(', '), href: gameHref(lg, e.id) };
      });
      var t = j.team || {};
      return { lg: lg, id: me, team: { id: me, abbr: t.abbreviation, name: t.displayName, loc: t.location, color: hex(t.color, '#12363B'), alt: hex(t.alternateColor, '#C8F7FC'),
        record: t.recordSummary || '', standing: t.standingSummary || '' }, season: j.season || {}, bye: j.byeWeek || null, games: games };
    });
  }

  /* team detail: record splits and next event */
  function team(lg, id) {
    return get(api(lg, 'teams/' + id)).then(function (j) {
      var t = j.team || {};
      var items = ((t.record || {}).items || []);
      var stat = {};
      var tot = items.filter(function (x) { return x.type === 'total'; })[0] || items[0] || {};
      (tot.stats || []).forEach(function (s) { stat[s.name] = s.value; });
      var splits = items.map(function (x) { return { type: x.type, label: x.description || x.type, summary: x.summary }; });
      return { lg: lg, id: String(t.id), abbr: t.abbreviation, name: t.displayName, short: t.shortDisplayName, loc: t.location, nick: t.nickname || t.name,
        color: hex(t.color, '#12363B'), alt: hex(t.alternateColor, '#C8F7FC'), record: tot.summary || '', standing: t.standingSummary || '', stats: stat, splits: splits,
        next: (t.nextEvent || []).map(function (e) { return normEvent(e, lg); })[0] || null };
    });
  }

  /* game summary -> page record. Odds, pick'em, ESPN predictor and win probability are dropped. */
  function summary(lg, id) {
    return get(api(lg, 'summary', { event: id })).then(function (j) {
      var h = j.header || {}; var c = (h.competitions || [])[0] || {};
      var st = status(c.status);
      var teams = (c.competitors || []).map(function (x) { return teamOf(x, lg); });
      teams.sort(function (a, b) { return (a.home ? 1 : 0) - (b.home ? 1 : 0); });
      var gi = j.gameInfo || {};
      var stats = {};
      ((j.boxscore || {}).teams || []).forEach(function (t) {
        var tid = String((t.team || {}).id);
        var add = function (k, v) { if (!k || v === undefined) return; if (!stats[k]) stats[k] = { label: k, v: {} }; stats[k].v[tid] = v; };
        (t.statistics || []).forEach(function (s) {
          if (s.stats) { // baseball: grouped batting / pitching / fielding stats
            var keep = BASEBALL_BOX[s.name] || {};
            (s.stats || []).forEach(function (x) { if (keep[x.name]) add(keep[x.name], x.displayValue); });
            return;
          }
          add(s.label || s.displayName || s.name, s.displayValue);
        });
      });
      var statRows = Object.keys(stats).map(function (k) { return stats[k]; });
      var leaders = (j.leaders || []).map(function (L) {
        return { team: String((L.team || {}).id), abbr: (L.team || {}).abbreviation, cats: (L.leaders || []).map(function (x) {
          var top = (x.leaders || [])[0] || {}; var a = top.athlete || {};
          return { cat: x.displayName || x.name, name: a.shortName || a.displayName || '', line: top.displayValue || '' };
        }).filter(function (x) { return x.name; }) };
      });
      var abbrOf = {}; teams.forEach(function (t) { abbrOf[t.id] = t.abbr; });
      var sp = (j.scoringPlays && j.scoringPlays.length) ? j.scoringPlays : (j.plays || []).filter(function (p) { return p.scoringPlay; });
      var scoring = sp.map(function (p) {
        var tid = String((p.team || {}).id || ''); return { period: (p.period || {}).displayValue || (p.period || {}).number || '', clock: (p.clock || {}).displayValue || '', team: tid, abbr: (p.team || {}).abbreviation || abbrOf[tid] || '', text: p.text || '', away: p.awayScore, home: p.homeScore };
      });
      var injuries = (j.injuries || []).map(function (t) {
        return { team: String((t.team || {}).id || ''), abbr: (t.team || {}).abbreviation || '', list: (t.injuries || []).map(function (x) {
          var a = x.athlete || {}; return { name: a.displayName || '', pos: ((a.position || {}).abbreviation) || '', status: x.status || ((x.type || {}).description) || '', detail: (x.details && x.details.type) || '' };
        }) };
      });
      var last5 = (j.lastFiveGames || []).map(function (t) {
        return { team: String((t.team || {}).id || ''), abbr: (t.team || {}).abbreviation || '', games: (t.events || []).map(function (g) {
          return { date: g.gameDate, opp: (g.opponent || {}).abbreviation || '', at: g.atVs || '', result: g.gameResult || '', score: g.score || '' };
        }) };
      });
      var series = (j.seasonseries || []).map(function (s) { return s.summary || s.description || ''; }).filter(Boolean);
      var standings = [];
      ((j.standings || {}).groups || []).forEach(function (g) {
        var rows = (((g.standings || {}).entries) || []).map(function (e) {
          var s = {}; (e.stats || []).forEach(function (x) { s[x.type || x.name] = x.summary || x.displayValue; });
          return { team: e.team, id: String(e.id || ''), wl: s.total || s.overall || '', s: s };
        });
        standings.push({ name: g.header || '', rows: rows });
      });
      return {
        lg: lg, id: String(id), start: c.date, state: st.state, done: st.done, detail: st.detail, period: st.period, clock: st.clock, neutral: !!c.neutralSite,
        away: teams[0] || null, home: teams[1] || null, note: ((c.notes || [])[0] || {}).headline || '',
        venue: (gi.venue || {}).fullName || '', city: [((gi.venue || {}).address || {}).city, ((gi.venue || {}).address || {}).state].filter(Boolean).join(', '),
        attendance: gi.attendance || null, weather: gi.weather ? (gi.weather.displayValue || '') + (gi.weather.temperature ? ' · ' + gi.weather.temperature + '°' : '') : '',
        officials: (gi.officials || []).map(function (o) { return o.displayName + (o.position && o.position.displayName ? ' (' + o.position.displayName + ')' : ''); }),
        tv: (j.broadcasts || []).map(function (b) { return (b.media || {}).shortName || ''; }).filter(Boolean).join(', '),
        stats: statRows, leaders: leaders, scoring: scoring, injuries: injuries, last5: last5, series: series, standings: standings,
        linescoreHeads: (teams[0] && teams[0].lines.length ? teams[0].lines.map(function (_, i) { return periodLabel(lg, i); }) : [])
      };
    });
  }
  var BASEBALL_BOX = {
    batting: { hits: 'Hits', homeRuns: 'Home runs', walks: 'Walks', strikeouts: 'Strikeouts', runnersLeftOnBase: 'Left on base', stolenBases: 'Stolen bases' },
    pitching: { pitches: 'Pitches thrown' },
    fielding: { errors: 'Errors' }
  };
  function periodLabel(lg, i) {
    var sp = (LEAGUES[lg] || {}).sport;
    if (sp === 'baseball') return String(i + 1);
    if (sp === 'hockey') return i < 3 ? String(i + 1) : (i === 3 ? 'OT' : 'SO');
    if (sp === 'soccer') return i === 0 ? '1H' : i === 1 ? '2H' : 'ET';
    if (lg === 'ncaab') return i < 2 ? (i === 0 ? '1H' : '2H') : 'OT' + (i > 2 ? i - 1 : '');
    return i < 4 ? 'Q' + (i + 1) : 'OT' + (i > 4 ? i - 3 : '');
  }

  /* standings straight from ESPN (pages prefer the slimmer /data/sports/standings files) */
  function standingsLive(lg, params) {
    return get(api(lg, 'standings', params || {})).then(function (j) { return slimStandings(j); });
  }
  function slimStandings(j) {
    var groups = [];
    (function walk(n, parent) {
      if (n.standings && n.standings.entries) {
        groups.push({ name: n.name || n.abbreviation || parent || '', abbr: n.abbreviation || '', rows: n.standings.entries.map(function (e) {
          var s = {}; (e.stats || []).forEach(function (x) { s[x.name] = x.displayValue !== undefined ? x.displayValue : x.value; if (x.type === 'total' || x.name === 'overall') s.overall = x.displayValue || x.summary; });
          var t = e.team || {};
          return { id: String(t.id), abbr: t.abbreviation, name: t.displayName, short: t.shortDisplayName, s: s };
        }) });
      }
      (n.children || []).forEach(function (c) { walk(c, n.name); });
    })(j, '');
    return { groups: groups };
  }

  /* links */
  function teamHref(lg, id) { return 'Team.dc.html?lg=' + lg + '&id=' + encodeURIComponent(id); }
  function gameHref(lg, id) { return 'Game.dc.html?lg=' + lg + '&id=' + encodeURIComponent(id); }

  /* house model: projected margin and win probability from /data/sports/model/<lg>.json */
  function Phi(z) { var t = 1 / (1 + 0.2316419 * Math.abs(z)); var d = 0.3989423 * Math.exp(-z * z / 2); var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
  /* rest edge for a game starting at `start` (ISO): per-day edge x (home rest - away rest), rest = days since the
     team's previous game (capped), from the game dates in the model file; 0 beyond those dates or without a start */
  function dayNo(d) { return Math.round(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') / 864e5); }
  function restEdge(model, H, A, start) {
    if (!model.rest || !start || String(start).slice(0, 10) > (model.restUntil || '')) return 0;
    var cap = model.restCap || 7, day = dayNo(start), s0 = String(start).slice(0, 10);
    var rest = function (T) {
      var prev = (T.dates || []).filter(function (d) { return d < s0; });
      return prev.length ? Math.min(cap, day - dayNo(prev[prev.length - 1])) : cap;
    };
    return model.rest * (rest(H) - rest(A));
  }
  function project(model, awayId, homeId, neutral, start) {
    if (!model || !model.teams) return null;
    var A = model.teams[String(awayId)], H = model.teams[String(homeId)];
    if (!A || !H || A.rating === null || H.rating === null || A.rating === undefined || H.rating === undefined) return null;
    var hfa = neutral ? 0 : (model.hfa || 0);
    if (model.divHfa !== undefined && A.group && A.group === H.group && !neutral) hfa = model.divHfa;
    var m = H.rating - A.rating + hfa + restEdge(model, H, A, start);
    // MLB: announced starting pitchers' edge for this exact game, when the model file has it
    if (model.spEdges && start) m += model.spEdges[String(start).slice(0, 16) + '|' + homeId + '|' + awayId] || 0;
    // when the model says so (pv), widen the spread by how unsure both ratings still are (w = weight of evidence in games)
    var sg = (model.sigma || 13.5) * (model.pv && H.w && A.w ? Math.sqrt(1 + 1 / H.w + 1 / A.w) : 1);
    var p = Phi(m / sg);
    return { margin: m, pHome: p, pAway: 1 - p, hfa: hfa, coverage: model.coverage || null, basis: model.basis || '' };
  }

  /* In-game win probability: the current score plus the pre-game edge scaled to the time left, with the
     model's spread shrinking as the game runs out: P(home) = Φ((lead + edge·r) ÷ (σ·√r)), r = share of game left. */
  var GAME_SECS = { nfl: [4, 900], ncaaf: [4, 900], nba: [4, 720], ncaab: [2, 1200], nhl: [3, 1200], ncaah: [3, 1200] };
  function liveProb(model, lg, g, pre) {
    if (!model || !pre || !g || g.state !== 'in' || !g.home || !g.away) return null;
    var lead = (num(g.home.score) || 0) - (num(g.away.score) || 0), f = null, per = +g.period || 0;
    if (lg === 'mlb') {
      var d = String(g.detail || ''), half = /^top/i.test(d) ? 0 : (/^(mid|bot)/i.test(d) ? 1 : (/^end/i.test(d) ? 2 : 0));
      f = Math.min(0.97, ((per - 1) * 2 + half) / 18);
    } else if (GAME_SECS[lg]) {
      var P = GAME_SECS[lg], m = /(\d+):(\d+)/.exec(g.clock || ''), left = m ? +m[1] * 60 + +m[2] : P[1] / 2;
      f = per > P[0] ? 0.97 : Math.min(0.99, ((per - 1) * P[1] + (P[1] - left)) / (P[0] * P[1]));
    }
    if (f === null || f < 0) return null;
    var r = Math.max(0.01, 1 - f), sg = (model.sigma || 13.5) * Math.sqrt(r), mu = lead + pre.margin * r;
    var p = Phi(mu / sg);
    return { pHome: p, pAway: 1 - p, margin: mu, left: r };
  }

  /* team search for the command line on every Sports page: "lions", "gonzaga", "Michigan State Spartans (NCAAB)" */
  var teamsP = null, LG_PRI = { nfl: 0, mlb: 1, nba: 2, nhl: 3, ncaaf: 4, ncaab: 5, ncaah: 6 };
  function teamList() {
    if (!teamsP) teamsP = data('teams.json').then(function (j) {
      var out = [];
      Object.keys(j.leagues || {}).forEach(function (lg) { j.leagues[lg].forEach(function (t) { out.push({ lg: lg, t: t }); }); });
      return out;
    }, function () { teamsP = null; return []; });
    return teamsP;
  }
  function findTeams(list, q, n) {
    var m = /\(([A-Z]{3,5})\)\s*$/i.exec(q), want = null;
    if (m) { var s = m[1].toUpperCase(); ORDER.forEach(function (k) { if (LEAGUES[k].short === s) want = k; }); q = q.slice(0, m.index); }
    q = q.trim().toLowerCase();
    if (!q) return [];
    var hits = [];
    list.forEach(function (x) {
      if (want && x.lg !== want) return;
      var t = x.t, names = [t.name, t.nick, t.loc, t.short, t.abbr].filter(Boolean).map(function (v) { return v.toLowerCase(); });
      var score = names.indexOf(q) >= 0 ? 0 : names.some(function (v) { return v.indexOf(q) === 0; }) ? 1 : (q.length >= 3 && names.some(function (v) { return v.indexOf(q) >= 0; }) ? 2 : -1);
      if (score >= 0) hits.push({ lg: x.lg, t: t, score: score });
    });
    hits.sort(function (a, b) { return a.score - b.score || LG_PRI[a.lg] - LG_PRI[b.lg] || (a.t.name < b.t.name ? -1 : 1); });
    return hits.slice(0, n || 12);
  }
  window.DC_SPORTS = true;
  var PAGE_WORDS = {
    'injuries': 'injuries', 'injury': 'injuries', 'injury report': 'injuries', 'playoff odds': 'odds', 'playoffs': 'odds', 'odds': 'odds',
    'simulator': 'simulator', 'matchup': 'simulator', 'methodology': 'methodology', 'method': 'methodology', 'how it works': 'methodology',
    'track record': 'track-record', 'record': 'track-record', 'picks': 'track-record', 'schedule strength': 'schedule-strength',
    'strength of schedule': 'schedule-strength', 'luck watch': 'luck-watch', 'luck': 'luck-watch', 'spots': 'spots', 'situational spots': 'spots'
  };
  window.DC_LOOKUP = function (q) {
    var pg = PAGE_WORDS[String(q || '').trim().toLowerCase()];
    if (pg) return Promise.resolve('/sports/' + pg + '/');
    return teamList().then(function (list) {
      var h = findTeams(list, q, 1)[0];
      return h && h.score <= 1 ? '/sports/team/?lg=' + h.lg + '&id=' + encodeURIComponent(h.t.id) : null;
    });
  };
  /* horizontally scrollable tables must be reachable by keyboard */
  function focusScrollers() {
    document.querySelectorAll('.s-scroll:not([data-kb])').forEach(function (el) {
      el.setAttribute('data-kb', '1'); el.tabIndex = 0; el.setAttribute('role', 'region');
      var t = el.querySelector('caption,th'); el.setAttribute('aria-label', 'Scrollable table' + (t && t.textContent.trim() ? ': ' + t.textContent.trim().slice(0, 40) : ''));
    });
  }
  function watchScrollers() {
    focusScrollers();
    try { new MutationObserver(focusScrollers).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }
  if (document.body) watchScrollers(); else document.addEventListener('DOMContentLoaded', watchScrollers);
  window.DC_SUGGEST = function (q) {
    return teamList().then(function (list) {
      return findTeams(list, q, 12).map(function (h) { return { value: h.t.name + ' (' + LEAGUES[h.lg].short + ')', label: LEAGUES[h.lg].label + (h.t.group ? ' · ' + h.t.group : '') }; });
    });
  };

  /* teams this visitor follows, saved in their browser only: [{lg, id, name}] */
  var FKEY = 'skown.sports.follows.v2';
  function follows() { try { var l = JSON.parse(window.localStorage.getItem(FKEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function setFollows(l) { try { window.localStorage.setItem(FKEY, JSON.stringify(l)); } catch (e) {} return l; }
  function isFollowed(lg, id) { return follows().some(function (f) { return f.lg === lg && String(f.id) === String(id); }); }
  function toggleFollow(lg, id, name) {
    var l = follows(), on = isFollowed(lg, id);
    setFollows(on ? l.filter(function (f) { return !(f.lg === lg && String(f.id) === String(id)); }) : l.concat([{ lg: lg, id: String(id), name: name || '' }]));
    return !on;
  }
  /* chips for the "My teams" bar: the visitor's own follows, or a prompt to follow some */
  function favChips(curLg, curId) {
    var l = follows();
    if (!l.length) return [{ label: '+ FOLLOW TEAMS', href: '/sports/#follow', cls: 't-chipl' }];
    return l.map(function (f) {
      var words = String(f.name || f.id).trim().split(/\s+/), nick = words.length > 1 && /^(red|blue|white|golden|maple|blue|trail|black|crimson|fighting|sun|tar)$/i.test(words[words.length - 2]) ? words.slice(-2).join(' ') : words[words.length - 1];
      var college = /^ncaa/.test(f.lg);
      return { label: (nick + (college ? ' ' + ({ ncaaf: 'FB', ncaab: 'BB', ncaah: 'HKY' }[f.lg] || '') : '')).toUpperCase(), href: teamHref(f.lg, f.id),
        cls: 't-chipl' + (f.lg === curLg && String(f.id) === String(curId) ? ' is-on' : '') };
    });
  }

  /* team logos load from ESPN's image server; if one fails, leave its space blank instead of broken-image alt text */
  if (typeof document !== 'undefined') document.addEventListener('error', function (e) {
    var el = e.target;
    if (el && el.tagName === 'IMG' && /espncdn\.com/.test(el.src || '')) { el.style.visibility = 'hidden'; el.alt = ''; }
  }, true);

  /* ---------- bottom-line score crawl on every sports page ----------
     Live games first, then upcoming, then finals, across the major leagues. Teams the visitor follows lead.
     It pauses on hover or keyboard focus, has a pause button (moving content must be stoppable), and sits
     still for people who ask their system for reduced motion. */
  function crawl() {
    if (typeof document === 'undefined' || document.querySelector('.s-crawl')) return;
    var LGS = ['nfl', 'mlb', 'nba', 'nhl', 'ncaaf', 'ncaab'];
    var box = document.createElement('aside');
    box.className = 's-crawl';
    box.setAttribute('aria-label', 'Scores across the major leagues');
    box.innerHTML = '<span class="s-crawl-l"><span aria-hidden="true">●</span> SCORES<span class="x"> · ALL LEAGUES</span></span>' +
      '<div class="s-crawl-win"><div class="s-crawl-track" id="sCrawl"><div class="s-crawl-run"><a href="/sports/"><span class="st">Loading scores…</span></a></div></div></div>' +
      '<button type="button" aria-pressed="false" aria-label="Pause the score crawl" title="Pause">❚❚</button>';
    document.body.appendChild(box);
    document.body.classList.add('has-crawl');
    // skip link past the long header to the page's main content
    var skip = document.createElement('a');
    skip.className = 't-skip'; skip.href = '#main'; skip.textContent = 'Skip to content';
    skip.addEventListener('click', function (ev) {
      var m = document.querySelector('main');
      if (!m) return;
      ev.preventDefault(); m.setAttribute('tabindex', '-1'); m.focus(); m.scrollIntoView();
    });
    document.body.insertBefore(skip, document.body.firstChild);   // outside the page's rendered tree, which the runtime owns
    var btn = box.querySelector('button');
    var paused = false;
    try { paused = localStorage.getItem('nskn.crawl.paused') === '1'; } catch (e) {}
    var setPaused = function (v) {
      paused = v; box.classList.toggle('is-paused', v);
      btn.setAttribute('aria-pressed', String(v)); btn.textContent = v ? '▶' : '❚❚';
      btn.setAttribute('aria-label', v ? 'Play the score crawl' : 'Pause the score crawl'); btn.title = v ? 'Play' : 'Pause';
      try { localStorage.setItem('nskn.crawl.paused', v ? '1' : '0'); } catch (e) {}
    };
    setPaused(paused);
    btn.addEventListener('click', function () { setPaused(!paused); });
    var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    // game links are written as design-file names (Game.dc.html?...); outside the page renderer, map them to real URLs
    var R = window.DC_ROUTES || {}, url = function (h) { var q = String(h || '').indexOf('?'), b = q < 0 ? h : h.slice(0, q); return R[b] ? R[b] + (q < 0 ? '' : h.slice(q)) : (h || '/sports/'); };
    var tz = window.TZ, tm = function (iso) {
      try { return new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(':00', ''); } catch (e) { return ''; }
    };
    var timer;
    function load() {
      Promise.all(LGS.map(function (lg) { return scores(lg).then(function (b) { return b.events.map(function (e) { e.lg = lg; return e; }); }, function () { return []; }); }))
        .then(function (lists) {
          var all = [].concat.apply([], lists), fol = follows();
          var mine = function (e) { return fol.some(function (f) { return f.lg === e.lg && (String(f.id) === String(e.away.id) || String(f.id) === String(e.home.id)); }); };
          var rank = { 'in': 0, pre: 1, post: 2 }, soon = Date.now() + 36 * 3600000;
          all = all.filter(function (e) { return e.away && e.home && (e.state !== "pre" || Date.parse(e.start) < soon); })
            .sort(function (a, b) { return (mine(b) - mine(a)) || (rank[a.state] - rank[b.state]) || (a.start < b.start ? -1 : 1); }).slice(0, 40);
          var live = all.some(function (e) { return e.state === 'in'; });
          var item = function (e) {
            var A = e.away, H = e.home, pre = e.state === 'pre';
            var nm = function (t) { return (t.rank ? t.rank + ' ' : '') + esc(t.abbr || t.short); };
            var sc = function (t) { return pre ? '' : ' <span class="' + (e.done && t.winner ? 'w' : '') + '">' + esc(t.score) + '</span>'; };
            var st = e.state === 'in' ? '<span class="lv">' + esc(e.detail) + '</span>' : '<span class="st">' + esc(pre ? tm(e.start) : (e.detail || 'Final')) + '</span>';
            return '<a href="' + esc(url(e.href)) + '"><b>' + LEAGUES[e.lg].short + '</b> ' + nm(A) + sc(A) + ' <span class="st">' + (pre ? '@' : '·') + '</span> ' + nm(H) + sc(H) + ' ' + st + '</a>';
          };
          var html = all.length ? all.map(item).join('') : '<a href="/sports/"><span class="st">No games in the next day and a half. Full schedules on the scores page.</span></a>';
          var tr = document.getElementById('sCrawl');
          // second copy makes the loop seamless; hidden from screen readers so each game is announced once
          tr.innerHTML = '<div class="s-crawl-run">' + html + '</div><div class="s-crawl-run" aria-hidden="true">' + html.replace(/<a /g, '<a tabindex="-1" ') + '</div>';
          clearTimeout(timer); timer = setTimeout(load, live ? 30000 : 300000);
        });
    }
    load();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', crawl); else setTimeout(crawl, 0);
  }

  window.SD = { follows: follows, setFollows: setFollows, isFollowed: isFollowed, toggleFollow: toggleFollow, favChips: favChips, LEAGUES: LEAGUES, ORDER: ORDER, api: api, get: get, data: data, scores: scores, schedule: schedule, team: team, summary: summary,
    standingsLive: standingsLive, slimStandings: slimStandings, normEvent: normEvent, teamHref: teamHref, gameHref: gameHref, project: project, liveProb: liveProb, Phi: Phi, num: num, teamList: teamList, findTeams: findTeams };
})();
