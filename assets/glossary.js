/* "Plain English": a button on every market and sports page that lists the jargon actually on the screen, each
   with a one-line meaning. It only reads the page (the page renderer owns the markup), so it can't break anything. */
(function () {
  if (typeof document === 'undefined') return;
  var T = [
    // markets
    ['EPS', /\bEPS\b/, 'Earnings per share: a company\'s profit divided by its shares. The number analysts forecast each quarter.'],
    ['Consensus estimate', /\bconsensus\b/i, 'The average forecast of the analysts who cover a company. "Beat" or "miss" is measured against it.'],
    ['Surprise', /\bsurprise\b/i, 'How far the reported number landed from the consensus estimate, in percent.'],
    ['13F', /\b13F\b/, 'A quarterly SEC filing in which every investment manager with over $100M in US stocks lists its holdings. It shows who owns a stock, 45 days after the quarter ends.'],
    ['13D / 13G', /\b13[DG]\b/, 'Filings required when an investor passes 5% of a company. 13D means they may push for change (activists); 13G is a passive holder.'],
    ['Form 4', /\bForm 4\b/i, 'Filed within two business days whenever an executive, director or 10% owner buys or sells the company\'s stock.'],
    ['8-K', /\b8-K\b/, 'A filing for a major event between quarterly reports: earnings, a CEO change, a deal, a restatement.'],
    ['10b5-1', /10b5-1/, 'A pre-arranged trading plan. Insider sales under one were scheduled in advance, so they say less about the insider\'s view.'],
    ['Basis point (bp)', /\bbps?\b|basis point/i, 'One hundredth of a percentage point. A yield moving from 4.00% to 4.25% is up 25 bp.'],
    ['10-year yield', /\b10Y\b|10-year|10 Year/i, 'The interest rate on 10-year US Treasury debt. It sets the tone for mortgage rates and how stocks are valued.'],
    ['Yield curve', /yield curve|\b2s10s\b|10Y.{0,4}2Y/i, 'Treasury rates plotted from short to long maturities. When short rates sit above long ones (inverted), recessions have often followed.'],
    ['VIX', /\bVIX\b/, 'The market\'s expected volatility for the S&P 500 over the next month, priced from options. Often called the fear gauge; around 12-20 is calm.'],
    ['Breadth', /\bbreadth\b|advancers|decliners/i, 'How many stocks rose versus fell. An index up on poor breadth is being carried by a few big names.'],
    ['P/E', /\bP\/E\b/, 'Price-to-earnings: the share price divided by a year of earnings per share. How many dollars investors pay for each dollar of profit.'],
    ['Market cap', /market cap/i, 'Share price times shares outstanding: what the stock market says the whole company is worth.'],
    ['Beta', /\bbeta\b/i, 'How much a stock tends to move with the market. 1.0 moves in step; 1.5 swings about half again as much.'],
    ['Dividend yield', /dividend yield/i, 'A year of dividends divided by the share price.'],
    ['52-week range', /52-week|52W/i, 'The lowest and highest prices of the past year.'],
    ['Futures', /\bfutures?\b/i, 'Contracts that trade nearly around the clock, so they show where the market is heading before the opening bell.'],
    ['SPAC', /\bSPACs?\b|Acquisition Corp/i, 'A blank-check company that lists on the exchange first and looks for a private business to merge with afterward.'],
    ['Lockup', /lock-?up/i, 'The period after an IPO, usually 180 days, when insiders are barred from selling. Its end can add supply and pressure the price.'],
    ['FOMC', /\bFOMC\b/, 'The Federal Reserve committee that sets the federal funds rate, meeting eight times a year.'],
    ['Fed funds rate', /fed funds/i, 'The overnight rate banks charge each other, set by the Fed. Most other borrowing costs key off it.'],
    ['CPI', /\bCPI\b/, 'Consumer Price Index: the price of a basket of everyday goods and services. Its year-over-year change is headline inflation.'],
    ['Core PCE', /core PCE|PCEPILFE/i, 'The Fed\'s preferred inflation measure, leaving out food and energy because they swing.'],
    ['Nonfarm payrolls', /payrolls/i, 'Jobs added or lost in the month, from the monthly jobs report.'],
    ['Jobless claims', /jobless claims/i, 'New unemployment filings each week. The quickest read on layoffs.'],
    ['Sahm rule', /Sahm/i, 'A recession signal: it triggers when the 3-month average unemployment rate rises half a point above its low of the past year.'],
    ['High-yield spread', /high-yield|HY spread|BAMLH0A0HYM2/i, 'The extra interest riskier companies pay over Treasuries. It widens when lenders get nervous.'],
    ['Passive vs. active', /index fund|passive|active manager/i, 'Index funds own a stock because it is in an index; active managers chose it. A shift between them changes who you would pitch.'],
    ['Russell 2000', /Russell 2000|RUSSELL 2K|\bRUT\b/, 'An index of about 2,000 smaller US companies; the usual yardstick for small caps.'],
    ['Russell reconstitution', /reconstitution/i, 'The annual June reshuffle of the Russell indexes. Stocks moving in or out get large forced buying or selling by index funds.'],
    ['Prediction market', /Kalshi|prediction market/i, 'A regulated exchange where people trade yes/no contracts on events. A price of 30¢ means the crowd sees about a 30% chance.'],
    ['YoY', /\bYoY\b|year over year|year-over-year/i, 'Year over year: compared with the same period a year earlier.'],
    ['Delayed quote', /delayed/i, 'Free market data runs about 15 minutes behind the exchange.'],
    // sports
    ['House model', /house model|\bhouse\b/i, 'This site\'s own team ratings, solved from game results with a home edge removed. It projects every game before it starts.'],
    ['Rating', /\brating\b/i, 'How many points (goals, runs) better or worse than an average team a side would be on a neutral field.'],
    ['Home edge', /home edge/i, 'The average advantage of playing at home, taken out of results and added back to projections.'],
    ['σ (sigma)', /σ|sigma/i, 'How widely real margins scatter around the projection. It turns a projected margin into a win probability.'],
    ['Brier score', /Brier/i, 'A grade for probability forecasts: 0 is perfect, 0.25 is what a coin flip earns. Lower is better.'],
    ['Log loss', /log loss/i, 'Another grade for probability forecasts that punishes confident misses hard. Lower is better.'],
    ['Calibration', /calibrat/i, 'Whether forecasts mean what they say: of all the 70% picks, about 70% should win.'],
    ['Expected wins', /margin predicts|Pythagorean/i, 'The wins a team\'s scoring margin would usually produce. Teams far above it have been lucky in close games.'],
    ['Strength of schedule', /schedule strength|strength of schedule|\bSOS\b/i, 'The average rating of the opponents a team has played, or has left to play.'],
    ['Rest edge', /rest days|days of rest|rest edge|rest advantage/i, 'The measured advantage of having more days off than the opponent.'],
    ['Expected goals (xG)', /expected goals|\bxG\b/i, 'Hockey: how many goals a team\'s chances would usually produce, based on shot location and type. Steadier than actual goals.'],
    ['Playoff odds', /playoff odds|simulations/i, 'The share of 10,000 simulated rest-of-seasons in which a team makes the playoffs.'],
    ['Back-to-back', /back-to-back/i, 'Games on consecutive days, which tired teams tend to lose more than their ratings say.']
  ];
  var btn, panel, list, open = false;
  function textOfPage() {
    var m = document.querySelector('main') || document.body;
    return (m.innerText || '') + ' ' + (document.title || '');
  }
  function render() {
    var txt = textOfPage();
    var hits = T.filter(function (t) { return t[1].test(txt); });
    list.innerHTML = hits.length ? hits.map(function (t) { return '<div class="gl-i"><dt>' + t[0] + '</dt><dd>' + t[2] + '</dd></div>'; }).join('')
      : '<p class="gl-none">No jargon on this screen.</p>';
    panel.querySelector('.gl-n').textContent = hits.length + ' term' + (hits.length === 1 ? '' : 's') + ' on this page';
  }
  function setOpen(v) {
    open = v; panel.hidden = !v; btn.setAttribute('aria-expanded', String(v));
    if (v) { render(); panel.querySelector('.gl-x').focus(); } else btn.focus();
  }
  function init() {
    if (document.querySelector('.gl-btn')) return;
    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'gl-btn'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'glPanel');
    btn.innerHTML = '<span aria-hidden="true">?</span> Plain English';
    panel = document.createElement('div');
    panel.id = 'glPanel'; panel.className = 'gl-panel'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Plain-English meanings of the terms on this page');
    panel.innerHTML = '<div class="gl-h"><span><b>Plain English</b> <span class="gl-n"></span></span><button type="button" class="gl-x" aria-label="Close">✕</button></div><dl class="gl-l"></dl>';
    list = panel.querySelector('.gl-l');
    document.body.appendChild(panel); document.body.appendChild(btn);
    btn.addEventListener('click', function () { setOpen(!open); });
    panel.querySelector('.gl-x').addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) { if (open && e.key === 'Escape') setOpen(false); });
  }
  var css = document.createElement('style');
  css.textContent =
    '.gl-btn{position:fixed;right:14px;bottom:46px;z-index:61;display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 14px;border:1px solid currentColor;background:rgba(0,0,0,.88);color:var(--hi,#fff);font:600 12.5px "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.06em;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.5)}' +
    '.gl-btn span{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--a,#fff);color:#000;text-shadow:none}' +
    '.gl-btn:hover{background:#000;border-color:var(--a,#fff)}' +
    '.gl-btn:focus-visible,.gl-x:focus-visible{outline:2px solid #fff;outline-offset:2px}' +
    '.gl-panel{position:fixed;right:14px;bottom:94px;z-index:62;width:min(440px,calc(100vw - 28px));max-height:min(62vh,560px);overflow:auto;background:#050505;border:1px solid var(--a,#888);box-shadow:0 18px 50px rgba(0,0,0,.7);font:13px/1.55 "IBM Plex Mono",ui-monospace,monospace;color:var(--hi,#eee);text-shadow:none}' +
    '.gl-h{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 12px;background:#0d0d0d;border-bottom:1px solid var(--line,#333)}' +
    '.gl-h b{color:var(--a,#fff);letter-spacing:.08em}.gl-n{color:var(--dim,#aaa);font-size:12px;margin-left:6px}' +
    '.gl-x{min-width:40px;min-height:36px;border:0;background:transparent;color:var(--hi,#fff);cursor:pointer;font:inherit}' +
    '.gl-l{margin:0;padding:6px 12px 12px}.gl-i{padding:8px 0;border-bottom:1px solid var(--line,#222)}.gl-i dt{color:var(--wh,#fff);font-weight:600}.gl-i dd{margin:2px 0 0;color:var(--dim,#bbb)}' +
    '.gl-none{color:var(--dim,#aaa)}' +
    '@media (max-width:760px){.gl-btn{bottom:50px;right:10px;min-height:38px;padding:0 10px}.gl-panel{right:10px;bottom:96px}}' +
    '@media print{.gl-btn,.gl-panel{display:none}}';
  document.head.appendChild(css);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);
})();
