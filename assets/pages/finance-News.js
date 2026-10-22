window.DC_TREE=[{"t":"div","a":{"class":"t"},"c":[{"t":"header","a":{},"c":[{"t":"div","a":{"class":"t-title"},"c":[{"t":"a","a":{"class":"t-brand","href":"/"},"c":["1-NSKN"]},{"t":"span","a":{"style":"flex: 1 1 auto"},"c":[]},{"t":"span","a":{"class":"t-live"},"c":[{"t":"span","a":{"class":"t-dot"},"c":[]},"DELAYED 15 MIN"]}]},{"t":"div","a":{"class":"t-help"},"c":[{"t":"span","a":{"class":"dim t-hide-sm"},"c":["Refreshes every minute \u00b7 filter by source, watchlist or notable"]}]},{"t":"div","a":{"class":"t-cmd"},"c":[{"t":"label","a":{"for":"newsSearch","class":"t-prompt"},"c":["TICKER \u203a"]},{"t":"input","a":{"id":"newsSearch","class":"t-input","type":"search","placeholder":"TICKER OR COMPANY NAME","autocomplete":"off"},"c":[]}]},{"t":"nav","a":{"class":"t-fbar","aria-label":"Main"},"c":[{"t":"span","a":{"class":"t-fbar-title"},"c":["Markets"]},{"t":"a","a":{"class":"t-fkey","href":"Dashboard.dc.html"},"c":["1) Markets"]},{"t":"a","a":{"class":"t-fkey","href":"Digest.dc.html"},"c":["2) Digest"]},{"t":"a","a":{"class":"t-fkey is-on","href":"#","aria-current":"page"},"c":["3) Headlines"]},{"t":"a","a":{"class":"t-fkey","href":"Main.dc.html"},"c":["4) Quotes"]},{"t":"a","a":{"class":"t-fkey","href":"IR.dc.html"},"c":["5) IR view"]},{"t":"a","a":{"class":"t-fkey","href":"Earnings.dc.html"},"c":["6) Earnings"]},{"t":"a","a":{"class":"t-fkey","href":"Macro.dc.html"},"c":["7) Macro"]},{"t":"a","a":{"class":"t-fkey","href":"IPO.dc.html"},"c":["8) IPOs"]},{"t":"a","a":{"class":"t-fkey","href":"Screener.dc.html"},"c":["9) Screener"]}]},{"t":"div","a":{"class":"t-sub"},"c":[{"t":"span","a":{},"c":["Headlines"]},{"t":"span","a":{"class":"dim"},"c":["{{todayLabel}}"]},{"t":"span","a":{"style":"flex: 1 1 auto"},"c":[]},{"t":"span","a":{"class":"t-tag"},"c":["{{liveTag}}"]}]}]},{"t":"main","a":{"style":"max-width: 1320px; margin: 0 auto; padding: 22px 24px 56px; box-sizing: border-box; display: flex; flex-direction: column; gap: 18px"},"c":[{"t":"section","a":{"aria-label":"Feed controls","style":"display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 14px"},"c":[{"t":"div","a":{"style":"display: flex; align-items: center; gap: 14px; flex-wrap: wrap"},"c":[{"t":"div","a":{"class":"f-kicker","aria-hidden":"true","style":"flex: 1 1 100%; margin-bottom: -6px"},"c":["NEWS \u00b7 market headlines as they land"]},{"t":"h1","a":{"style":"margin: 0; font-size: 26px; line-height: 1.2; font-weight: 600; color: #FFD89D"},"c":["Headlines"]},{"t":"span","a":{"style":"{{statusStyle}}"},"c":[{"t":"span","a":{"aria-hidden":"true","style":"{{dotStyle}}"},"c":[]},"{{statusText}}"]},{"t":"span","a":{"style":"font-size: 12.5px; color: #A87933"},"c":["{{feedNote}}"]}]},{"t":"div","a":{"style":"display: flex; align-items: center; gap: 8px; flex-wrap: wrap"},"c":[{"t":"button","a":{"type":"button","onclick":"{{toggleWatch}}","aria-pressed":"{{watchPressed}}","style":"{{watchStyle}}"},"c":["Watchlist only"]},{"t":"button","a":{"type":"button","onclick":"{{toggleNotable}}","aria-pressed":"{{notablePressed}}","style":"{{notableStyle}}"},"c":["Notable only"]},{"t":"button","a":{"type":"button","onclick":"{{toggleAllPR}}","aria-pressed":"{{allPRPressed}}","style":"{{allPRStyle}}"},"c":["All press releases"]},{"t":"button","a":{"type":"button","onclick":"{{togglePause}}","style":"height: 40px; padding: 0 16px; border-radius: 0; border: 1px solid #FFB84D; background: #FFB84D; color: #000000; text-shadow: none; font-family: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer"},"c":["{{pauseLabel}}"]}]}]},{"t":"div","a":{"role":"group","aria-label":"Source type","style":"display: flex; flex-wrap: wrap; gap: 4px; background: #050403; border: 1px solid #382811; border-radius: 0; padding: 3px; align-self: flex-start"},"c":[{"t":"sc-for","a":{"list":"{{tabs}}","as":"t","hint-placeholder-count":"5"},"c":[{"t":"button","a":{"type":"button","onclick":"{{t.pick}}","aria-pressed":"{{t.pressed}}","style":"{{t.btnStyle}}"},"c":["{{t.label}} ",{"t":"span","a":{"style":"font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: {{t.countColor}}"},"c":["{{t.count}}"]}]}]}]},{"t":"div","a":{"role":"group","aria-label":"Sources","style":"display: flex; flex-wrap: wrap; gap: 4px; align-items: center"},"c":[{"t":"span","a":{"style":"color: #A87933; font-size: 12px; letter-spacing: .1em; margin-right: 4px"},"c":["SOURCES"]},{"t":"sc-for","a":{"list":"{{sources}}","as":"sr","hint-placeholder-count":"8"},"c":[{"t":"button","a":{"type":"button","onclick":"{{sr.toggle}}","aria-pressed":"{{sr.pressed}}","style":"{{sr.btnStyle}}"},"c":["{{sr.label}} ",{"t":"span","a":{"style":"font-size: 12px; color: #A87933"},"c":["{{sr.n}}"]}]}]}]},{"t":"sc-if","a":{"value":"{{hasUnseen}}","hint-placeholder-val":"{{ false }}"},"c":[{"t":"button","a":{"type":"button","onclick":"{{markSeen}}","style":"align-self: flex-start; height: 40px; padding: 0 16px; border-radius: 0; border: 1px solid #8A6326; background: #261C0C; color: #FFFFFF; font-family: inherit; font-size: 13.5px; cursor: pointer"},"c":["{{unseenText}} \u00b7 mark as read"]}]},{"t":"div","a":{"style":"display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start"},"c":[{"t":"section","a":{"aria-label":"Headline feed","aria-live":"polite","style":"flex: 999 1 600px; min-width: 0; background: #0A0704; border: 1px solid #382811; border-radius: 0; overflow: hidden"},"c":[{"t":"sc-for","a":{"list":"{{items}}","as":"it","hint-placeholder-count":"12"},"c":[{"t":"a","a":{"href":"{{it.link}}","target":"_blank","rel":"noopener","style":"{{it.rowStyle}}"},"c":[{"t":"span","a":{"style":"font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: #A87933; width: 66px; flex: none; padding-top: 2px"},"c":["{{it.time}}"]},{"t":"span","a":{"style":"flex: 1 1 auto; min-width: 0"},"c":[{"t":"span","a":{"style":"display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 3px"},"c":[{"t":"span","a":{"style":"{{it.typeStyle}}"},"c":["{{it.type}}"]},{"t":"sc-for","a":{"list":"{{it.tickers}}","as":"tk","hint-placeholder-count":"1"},"c":[{"t":"span","a":{"style":"font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 600; color: #FFE9C7"},"c":["{{tk.t}}"]}]},{"t":"sc-if","a":{"value":"{{it.notable}}","hint-placeholder-val":"{{ false }}"},"c":[{"t":"span","a":{"style":"font-size: 12px; font-weight: 600; letter-spacing: 0.05em; color: #FFFFFF"},"c":["NOTABLE"]}]},{"t":"sc-if","a":{"value":"{{it.fresh}}","hint-placeholder-val":"{{ false }}"},"c":[{"t":"span","a":{"style":"font-size: 12px; font-weight: 600; letter-spacing: 0.05em; color: #4ADE80"},"c":["NEW"]}]}]},{"t":"span","a":{"style":"display: block; font-size: 15px; font-weight: 500; line-height: 1.4; color: #FFD89D"},"c":["{{it.h}}"]},{"t":"span","a":{"style":"display: block; font-size: 12.5px; color: #A87933; margin-top: 3px"},"c":["{{it.src}}"]}]}]}]},{"t":"sc-if","a":{"value":"{{empty}}","hint-placeholder-val":"{{ false }}"},"c":[{"t":"div","a":{"style":"padding: 28px; text-align: center; color: #C99442; font-size: 14px"},"c":["No headlines match these filters yet."]}]}]},{"t":"aside","a":{"style":"flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: 20px"},"c":[{"t":"section","a":{"class":"t-card","aria-label":"Most-mentioned tickers","style":"background: #0A0704; border: 1px solid #382811; border-radius: 0; padding: 18px"},"c":[{"t":"h2","a":{"style":"margin: 0 0 4px; font-size: 15px; font-weight: 600; color: #FFD89D"},"c":["Most-mentioned tickers"]},{"t":"div","a":{"style":"color: #A87933; font-size: 12.5px; margin-bottom: 6px"},"c":["Headlines tagged with each ticker, last 24 hours"]},{"t":"sc-for","a":{"list":"{{top}}","as":"ts","hint-placeholder-count":"5"},"c":[{"t":"div","a":{"style":"display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid #221909"},"c":[{"t":"span","a":{"style":"font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: #A87933; width: 18px; flex: none"},"c":["{{ts.rank}}"]},{"t":"span","a":{"style":"min-width: 0"},"c":[{"t":"span","a":{"style":"display: block; font-size: 14px; color: #FFD89D; line-height: 1.4"},"c":["{{ts.h}}"]},{"t":"span","a":{"style":"display: block; font-size: 12px; color: #A87933; margin-top: 2px"},"c":["{{ts.meta}}"]}]}]}]}]},{"t":"section","a":{"class":"t-card","aria-label":"Watchlist","style":"background: #0A0704; border: 1px solid #382811; border-radius: 0; padding: 18px"},"c":[{"t":"h2","a":{"style":"margin: 0 0 4px; font-size: 15px; font-weight: 600; color: #FFD89D"},"c":["Watchlist"]},{"t":"div","a":{"style":"color: #A87933; font-size: 12.5px; margin-bottom: 8px"},"c":["Headlines mentioning these tickers are flagged"]},{"t":"div","a":{"style":"display: flex; flex-wrap: wrap; gap: 6px"},"c":[{"t":"sc-for","a":{"list":"{{watch}}","as":"w","hint-placeholder-count":"6"},"c":[{"t":"span","a":{"style":"display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border-radius: 0; background: #0E0A05; border: 1px solid #3D2C13; font-family: 'IBM Plex Mono', monospace; font-size: 12.5px"},"c":["{{w.t}} ",{"t":"span","a":{"style":"color: #A87933"},"c":["{{w.c}}"]}]}]}]}]},{"t":"section","a":{"class":"t-card","aria-label":"Scheduled today","style":"background: #0A0704; border: 1px solid #382811; border-radius: 0; padding: 18px"},"c":[{"t":"h2","a":{"style":"margin: 0 0 6px; font-size: 15px; font-weight: 600; color: #FFD89D"},"c":["On the calendar"]},{"t":"sc-if","a":{"value":"{{noSched}}","hint-placeholder-val":"{{ false }}"},"c":[{"t":"div","a":{"style":"font-size: 13px; color: #A87933"},"c":["No major releases or S&P 500 earnings scheduled today."]}]},{"t":"sc-for","a":{"list":"{{sched}}","as":"sc","hint-placeholder-count":"4"},"c":[{"t":"div","a":{"style":"display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid #221909; font-size: 13.5px"},"c":[{"t":"span","a":{"style":"font-family: 'IBM Plex Mono', monospace; color: #FFE9C7; width: 66px; flex: none"},"c":["{{sc.t}}"]},{"t":"span","a":{},"c":["{{sc.e}}"]}]}]}]},{"t":"section","a":{"aria-label":"Sources","style":"font-size: 12.5px; color: #A87933; line-height: 1.6"},"c":["\nSources: {{sourceList}}. New items appear within about a minute while this page is open; the archive is saved hourly in market hours, twice a day on weekends. Headlines link to the original; full articles stay on the publisher's site.\n"]}]}]}]},{"t":"div","a":{"class":"t-crt","aria-hidden":"true"},"c":[]}]}];
class Component extends DCLogic {
  componentDidMount() {
    var self = this;
    this.opened = Date.now();
    /* English-only: hide headlines in other languages (same rules as the pipeline) */
    var EN = {}, FO = {};
    "the and of to in for on with at by from is are was were after new says say will its over as an has have that this his her their it be not but or up out more than into about how what why who when amid against could would may year q1 q2 q3 q4 reports announces announced announce launches shares stock stocks inc corp".split(" ").forEach(function (w) { EN[w] = 1; });
    "el la los las del y que para con por una un su se es al lo le les des du et pour dans une sur est qui der die das und mit für von den zu ist nicht auf ein eine im dem um da uma os não ao dos nas nos il di per che della degli sono gli en een het van voor och att som på är med av ett de em na pela pelo anuncia resultados trimestre lucro dividendo banco acima esperado anuncian empresa nuevo nueva primer segundo tercer cuarto ganancias".split(" ").forEach(function (w) { FO[w] = 1; });
    var isEn = function (h) {
      var text = h && h.title || '';
      var letters = text.match(/\p{L}/gu) || [];
      if (!letters.length) return true;
      var nonLatin = 0, accents = 0;
      letters.forEach(function (c) { var k = c.codePointAt(0); if (k > 0x24f) nonLatin++; else if (k >= 0xc0) accents++; });
      if (nonLatin / letters.length > 0.2 || accents / letters.length > 0.06) return false;
      var ext = 0; letters.forEach(function (c) { var k = c.codePointAt(0); if (k >= 0x100 && k <= 0x17f) ext++; });
      if (ext >= 2) return false;
      var words = text.toLowerCase().match(/[a-zà-ÿ']+/g) || [], en = 0, fo = 0;
      words.forEach(function (w) { if (EN[w]) en++; if (FO[w]) fo++; });
      if (fo >= 2 && fo > en) return false;
      if (words.length >= 5 && en === 0 && fo >= 1) return false;
      return true;
    };
    /* shareholder-lawsuit ads (any source) and Yahoo pieces that are not earnings recaps */
    var LAW = /securities (fraud|class action|litigation)|class action|class period|lead plaintiff|lost money|who lost|shareholder (alert|rights|class|investigation)|investors? (who|with|that|alert|are encouraged|should)|(encourages?|urges?|reminds?) (\w+ )?(investors|shareholders)|recover\w* (your |their )?(investment |investor )?losses|investigat\w* .{0,60}(on behalf|shareholders|investors)|on behalf of (\w+ )?(shareholders|investors)|law (firm|offices?)|attorneys?\b|fiduciary|pomerantz|rosen law|levi & korsinsky|bragar|faruqi|gross law|bronstein|kessler topaz|robbins (geller|llp)|schall|glancy|hagens berman|johnson fistel|block & leviton|portnoy|kirby mcinerney|halper sadeh|ademi|monteverde|rigrodsky|lowey|bernstein liebhard|\bdj?s law\b|deadline.{0,40}(plaintiff|lawsuit|class)/i, YEARN = /earnings|quarterly results|\bq[1-4]\b.{0,40}(results|revenue|earnings|profit|sales)|reports? .{0,30}(revenue|profit|results|loss)|\b(beats?|misses|tops)\b|guidance|\brevenue\b|\beps\b|(net|operating|quarterly|adjusted) (profit|income)/i, YADV = /reasons?\b|should you|buy,? sell|\bto buy\b|buy (now|the dip|and hold|before)|chance to buy|time to (buy|sell)|worth (buying|owning)|what needs to be true|better (buy|stock)|best (stocks?|etfs?)|top (stocks?|etfs?)|\betfs?\b|trim or add|millionaire|compelling|stock i.m buying|\bto sell\b|buy or sell|is it (a )?(buy|sell)|the case for/i;
    var isJunk = function (h) { var t = h && h.title || ''; return LAW.test(t) || (h.source === 'Yahoo Finance' && (!YEARN.test(t) || YADV.test(t))); };
    var keepItem = function (h) { return isEn(h) && !isJunk(h); };
    var pull = function () {
      if ((self.state || {}).paused) return;
      DC.load('/data/finance/headlines.json').then(function (j) {
        j.items = (j.items || []).filter(keepItem);
        var st = self.state || {};
        var known = st.known || {};
        var unseen = st.unseen || 0;
        if (st.items) j.items.forEach(function (h) { if (!known[h.link]) unseen++; });
        var k2 = Object.assign({}, known); j.items.forEach(function (h) { k2[h.link] = 1; });
        var inJ = {}; j.items.forEach(function (h) { inJ[h.link] = 1; });
        /* keep items the Worker added since the last hourly file */
        var keep = (st.items || []).filter(function (h) { return !inJ[h.link] && h.firstSeen && Date.now() - new Date(h.firstSeen).getTime() < 7200000; });
        var merged = keep.concat(j.items).sort(function (a, b) { return a.published < b.published ? 1 : -1; });
        self.setState({ data: j, items: merged, known: k2, unseen: unseen });
      }).catch(function () { self.setState({ err: true }); });
    };
    /* fresher items from the Worker (its own RSS fetch, ~1 min cache); merged under the hourly file's items */
    var pullLive = function () {
      if ((self.state || {}).paused || document.hidden) return;
      fetch('/api/live?part=news').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (lv) {
        var st = self.state || {};
        if (!st.items || !lv.items || !lv.items.length) return;
        lv.items = lv.items.filter(keepItem);
        var known = Object.assign({}, st.known || {});
        var unseen = st.unseen || 0;
        var add = lv.items.filter(function (h) { return !known[h.link]; });
        if (!add.length) return;
        add.forEach(function (h) { known[h.link] = 1; unseen++; });
        var items = add.concat(st.items).sort(function (a, b) { return a.published < b.published ? 1 : -1; }).slice(0, 500);
        self.setState({ items: items, known: known, unseen: unseen });
      }).catch(function () {});
    };
    pull();
    setTimeout(pullLive, 2500);
    this.timerLive = setInterval(pullLive, 60000);
    ['config', 'macro', 'earnings'].forEach(function (k) {
      DC.load('/data/finance/' + k + '.json').then(function (j) { var o = {}; o[k] = j; self.setState(o); }).catch(function () {});
    });
    this.timer = setInterval(pull, 60000);
  }
  componentWillUnmount() { clearInterval(this.timer); clearInterval(this.timerLive); try { document.title = 'Headlines · NSKN Terminal'; } catch (e) {} }
  componentDidUpdate() {
    var n = (this.state && this.state.unseen) || 0;
    try { document.title = (n ? '(' + n + ') ' : '') + 'Headlines · NSKN Terminal'; } catch (e) {}
  }
  renderVals() {
    var self = this;
    var st = this.state || {};
    // filters are remembered in this browser (nskn.fin.news); the watchlist is the one set on the dashboard
    var NP = st.np || PREFS.get('fin.news', {}) || {};
    var saveNP = function (patch) { var n = Object.assign({}, NP, patch); PREFS.set('fin.news', n); self.setState({ np: n }); };
    var paused = !!st.paused, watchOnly = !!NP.watchOnly, notableOnly = !!NP.notableOnly, hiddenSrc = NP.hidden || [];
    var tab = NP.tab || 'all';
    var watchList = PREFS.get('fin.watch', ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL']);
    var all = st.items || [];
    var now = Date.now();
    var typeMap = { all: null, pr: 'Press release', sec: 'SEC filing', pub: 'Publication' };
    var counts = { all: all.length, pr: 0, sec: 0, pub: 0 };
    all.forEach(function (it) { if (it.type === 'Press release') counts.pr++; else if (it.type === 'SEC filing') counts.sec++; else counts.pub++; });
    var tStyle = function (type) {
      var c = type === 'Press release' ? ['#261C0C', '#8A6326', '#FFFFFF'] : (type === 'SEC filing' ? ['#0E0A05', '#8A6326', '#FFE9C7'] : ['#1A1309', '#4A3517', '#FFB84D']);
      return 'font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 0; background: ' + c[0] + '; border: 1px solid ' + c[1] + '; color: ' + c[2] + ';';
    };
    var srcCount = {}; all.forEach(function (it) { if (it.source) srcCount[it.source] = (srcCount[it.source] || 0) + 1; });
    var srcList = Object.keys(srcCount).sort();
    // re-check "notable" with the current rule so items saved under the old, looser rule don't stay flagged
    var NOTE = /\b(acquires?|acquired|acquisition|merger|to buy|buyout|takeover|bankrupt(cy)?|chapter 11|guidance|outlook|forecast|recalls?|subpoena|sec charges|fda (approv|clear)\w*|fomc|rate (cut|hike|decision)s?|tariffs?|downgrades?d?|upgrades?d?|layoffs?|job cuts|ceo|cfo|resigns?|steps down|buyback|repurchase|stock split|ipo|trading halt|halts trading|outage|data breach|activist|13d|beats|misses|earnings)\b/i, SPAM = /lost money|who lost|class action|securities fraud|law firm|attorney|investigation on behalf|investors who|reminds investors|shareholder alert|deadline|recover losses|market to reach|market size|cagr|webinar/i;
    all.forEach(function (it) { it.notable = !SPAM.test(it.title || '') && !(it.type === 'Press release' && !(it.tickers || []).length) && NOTE.test(it.title || ''); });
    var allPR = !!NP.allPR;
    var items = all.filter(function (it) {
      if (typeMap[tab] && it.type !== typeMap[tab]) return false;
      // press releases that name no listed company (charity events, market-size reports) are hidden unless asked for
      if (!allPR && it.type === 'Press release' && (!(it.tickers || []).length || SPAM.test(it.title || ''))) return false;
      if (hiddenSrc.indexOf(it.source) >= 0) return false;
      if (notableOnly && !it.notable) return false;
      if (watchOnly && !(it.tickers || []).some(function (t) { return watchList.indexOf(t) >= 0; })) return false;
      return true;
    }).slice(0, 120).map(function (it) {
      var onWatch = (it.tickers || []).some(function (t) { return watchList.indexOf(t) >= 0; });
      var fresh = now - new Date(it.firstSeen).getTime() < 2 * 3600000;
      var pub = new Date(it.published);
      var sameDay = pub.toDateString() === new Date().toDateString();
      return {
        h: it.title, link: it.link, type: it.type, tickers: (it.tickers || []).map(function (t) { return { t: t, href: 'Main.dc.html?sym=' + t }; }), notable: it.notable, fresh: fresh,
        time: sameDay ? F.time(it.published) : F.day(it.published), src: it.source + ' · ' + F.ago(it.published),
        typeStyle: tStyle(it.type),
        rowStyle: 'display: flex; gap: 14px; padding: 14px 18px; border-bottom: 1px solid #221909; color: #FFB84D; ' + (fresh ? 'animation: arrive 4s ease-out; ' : '') + (onWatch ? 'background: #1A1309;' : '')
      };
    });
    var tabDefs = [['all', 'All'], ['pub', 'Publications'], ['pr', 'Press releases'], ['sec', 'SEC filings']];
    var btn = function (on) { return 'height: 36px; padding: 0 12px; border: none; border-radius: 0; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 500; ' + (on ? 'background: #FFB84D; color: #000000; text-shadow: none;' : 'background: transparent; color: #C99442;'); };
    var toggle = function (on) { return 'height: 40px; padding: 0 14px; border-radius: 0; cursor: pointer; font-family: inherit; font-size: 13.5px; ' + (on ? 'background: #261C0C; border: 1px solid #FFB84D; color: #FFD89D;' : 'background: #0E0A05; border: 1px solid #3D2C13; color: #C99442;'); };
    var unseen = st.unseen || 0;
    var day = now - 86400000;
    var mention = {};
    all.forEach(function (h) { if (new Date(h.published).getTime() >= day) (h.tickers || []).forEach(function (t) { mention[t] = (mention[t] || 0) + 1; }); });
    var top = Object.keys(mention).sort(function (a, b) { return mention[b] - mention[a]; }).slice(0, 6).map(function (t, i) {
      var latest = all.filter(function (h) { return (h.tickers || []).indexOf(t) >= 0; })[0];
      return { rank: i + 1, h: t + ' · ' + mention[t] + ' headline' + (mention[t] > 1 ? 's' : ''), meta: latest ? latest.title.slice(0, 90) : '' };
    });
    var watch = watchList.map(function (t) { return { t: t, c: all.filter(function (it) { return (it.tickers || []).indexOf(t) >= 0; }).length }; });
    var todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    var sched = ((st.macro || {}).calendar || []).filter(function (c) { return c.date === todayIso; }).map(function (c) {
      var past = c.at && new Date(c.at).getTime() <= Date.now();
      return { t: c.at ? (past ? 'Out ' : '') + F.time(new Date(c.at).getTime() / 1000) : 'Today', e: c.name };
    })
      .concat(((st.earnings || {}).upcoming || []).filter(function (x) { return x.date === todayIso; }).slice(0, 5).map(function (x) { return { t: x.when, e: x.name + ' (' + x.sym + ') earnings' }; }));
    var sources = [];
    var feeds = (st.config || {}).feeds || {};
    Object.keys(feeds).forEach(function (k) { sources = sources.concat(Object.keys(feeds[k])); });
    var D = st.data || {};
    return {
      liveTag: F.updated(D.updated),
      feedNote: st.err ? 'Headline data is not available yet. The first refresh runs within the hour.' : (D.updated ? 'Feed refreshed ' + F.ago(D.updated) + ' · this page checks for new items every minute' : 'Loading headlines…'),
      statusText: paused ? 'Paused' : 'Auto-refresh',
      statusStyle: 'display: inline-flex; align-items: center; gap: 8px; height: 28px; padding: 0 12px; border-radius: 0; font-size: 12.5px; font-weight: 600; ' + (paused ? 'background: #1A1309; border: 1px solid #4A3517; color: #C99442;' : 'background: #0D2616; border: 1px solid #1F6B3A; color: #4ADE80;'),
      dotStyle: 'width: 8px; height: 8px; border-radius: 0; background: ' + (paused ? '#664A1F' : '#4ADE80') + ';' + (paused ? '' : ' animation: pulse 1.6s infinite;'),
      pauseLabel: paused ? 'Resume' : 'Pause',
      togglePause: function () { self.setState({ paused: !paused }); },
      toggleWatch: function () { saveNP({ watchOnly: !watchOnly }); },
      toggleNotable: function () { saveNP({ notableOnly: !notableOnly }); },
      toggleAllPR: function () { saveNP({ allPR: !allPR }); }, allPRPressed: allPR ? 'true' : 'false', allPRStyle: toggle(allPR),
      sources: srcList.map(function (sname) {
        var on = hiddenSrc.indexOf(sname) < 0;
        return { label: sname, n: srcCount[sname], pressed: on ? 'true' : 'false', btnStyle: btn(on).replace('height: 36px', 'height: 32px'),
          toggle: function () { saveNP({ hidden: on ? hiddenSrc.concat([sname]) : hiddenSrc.filter(function (x) { return x !== sname; }) }); } };
      }),
      watchPressed: watchOnly ? 'true' : 'false', notablePressed: notableOnly ? 'true' : 'false',
      watchStyle: toggle(watchOnly), notableStyle: toggle(notableOnly),
      tabs: tabDefs.map(function (t) { return { label: t[1], count: counts[t[0]], countColor: t[0] === tab ? '#2A1D08' : '#C99442', pressed: t[0] === tab ? 'true' : 'false', pick: function () { saveNP({ tab: t[0] }); }, btnStyle: btn(t[0] === tab) }; }),
      hasUnseen: unseen > 0, unseenText: unseen + ' new since you opened this page', markSeen: function () { self.setState({ unseen: 0 }); },
      items: items, empty: !!st.items && items.length === 0, top: top, watch: watch, sched: sched, noSched: !sched.length,
      sourceList: sources.join(', ') || 'press wires, SEC EDGAR and financial publications'
    };
  }
}
