/* Token Radar — the whole dashboard: board, detail, live view, method and sandbox.
   Reads window.RADAR from ../data.js. No network, no fetch, no framework. */
'use strict';

var D = window.RADAR;
var M = D.model;

/* --------------------------------------------------------------- helpers */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function sig(v) {
  var a = Math.abs(v);
  if (a >= 100) return String(Math.round(v));
  if (a >= 10) return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 100) / 100);
}

function fmtUSD(n) {
  if (n == null) return 'n/a';
  if (n >= 1e9) return '$' + sig(n / 1e9) + 'B';
  if (n >= 1e6) return '$' + sig(n / 1e6) + 'M';
  if (n >= 1e3) return '$' + sig(n / 1e3) + 'K';
  return '$' + Math.round(n);
}

function fmtPct(n) {
  if (n == null) return 'n/a';
  var sign = n > 0 ? '+' : '';
  return sign + sig(n) + '%';
}

function pctClass(n) {
  if (n == null) return 'flat';
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
}

function fmtAge(days) {
  if (days == null) return 'unknown';
  if (days < 30) return days + 'd';
  if (days < 365) return Math.round(days / 30.4) + 'mo';
  return (Math.round((days / 365) * 10) / 10) + 'y';
}

function chainsLabel(chains) {
  if (!chains || chains.length === 0) return 'chain unreported';
  if (chains.length <= 2) return chains.join(', ');
  return chains.slice(0, 2).join(', ') + ' +' + (chains.length - 2);
}

/* Split a farm-step string ("Action. Cost: X. Time: Y.") into its parts. */
function parseStep(s) {
  var ci = s.lastIndexOf(' Cost: ');
  if (ci < 0) return { text: s, cost: '', time: '' };
  var text = s.slice(0, ci);
  var rest = s.slice(ci + 7);
  var ti = rest.lastIndexOf('. Time: ');
  if (ti < 0) return { text: text, cost: rest.replace(/\.$/, ''), time: '' };
  return { text: text, cost: rest.slice(0, ti), time: rest.slice(ti + 8).replace(/\.$/, '') };
}

/* --------------------------------------------------------------- state */

var state = {
  view: 'board', // board | live | method
  detail: null, // slug, or null
  q: '',
  category: 'all',
  chain: 'all',
  watchlistOnly: false,
  sort: 'implied', // implied | tvl | growth | age | name
  sortDir: -1, // -1 desc, 1 asc (name defaults asc)
  sandbox: { multiple: null, growthWeight: M.growth_weight, maturityFloor: M.maturity_floor, maturityDays: M.maturity_days },
};

function sandboxDirty() {
  var s = state.sandbox;
  return s.multiple !== null || s.growthWeight !== M.growth_weight || s.maturityFloor !== M.maturity_floor || s.maturityDays !== M.maturity_days;
}

/* The factors behind one row's implied value, honouring the sandbox. */
function factors(row) {
  var s = state.sandbox;
  if (!sandboxDirty()) {
    return { multiple: row.multiple, growthMult: row.growth_multiplier, maturityMult: row.maturity_multiplier, breadthMult: row.breadth_multiplier, implied: row.implied_value_usd };
  }
  var multiple = s.multiple !== null ? s.multiple : row.multiple;
  var growthPct = clamp(row.change_7d == null ? 0 : row.change_7d, M.growth_floor, M.growth_cap);
  var growthMult = 1 + (growthPct / 100) * s.growthWeight;
  var age = row.age_days == null ? M.unknown_age_days : row.age_days;
  var maturityMult = s.maturityFloor + (1 - s.maturityFloor) * (Math.min(Math.max(age, 0), s.maturityDays) / s.maturityDays);
  var implied = Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturityMult * row.breadth_multiplier));
  return { multiple: multiple, growthMult: growthMult, maturityMult: maturityMult, breadthMult: row.breadth_multiplier, implied: implied };
}

/* Read the initial state from the URL, so screenshots are deterministic. */
(function initFromURL() {
  var p = new URLSearchParams(window.location.search);
  if (p.get('detail')) state.detail = p.get('detail');
  if (p.get('category')) state.category = p.get('category');
  if (p.get('chain')) state.chain = p.get('chain');
  if (p.get('watchlist') === '1') state.watchlistOnly = true;
  if (p.get('sort')) state.sort = p.get('sort');
  if (p.get('q')) state.q = p.get('q');
  if (p.get('view') === 'live' || p.get('view') === 'method') state.view = p.get('view');
  if (state.sort === 'name') state.sortDir = 1;
})();

/* --------------------------------------------------------------- filtering */

function categories() {
  var seen = {};
  D.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
  return Object.keys(seen).sort();
}

function chains() {
  var seen = {};
  D.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
  return Object.keys(seen).sort();
}

function visibleRows() {
  var q = state.q.trim().toLowerCase();
  var rows = D.rows.filter(function (r) {
    if (state.watchlistOnly && !r.watchlist) return false;
    if (state.category !== 'all' && r.category !== state.category) return false;
    if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
    if (q) {
      var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
  var dir = state.sortDir;
  var key = state.sort;
  rows.sort(function (a, b) {
    var va, vb;
    if (key === 'implied') { va = factors(a).implied; vb = factors(b).implied; }
    else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
    else if (key === 'growth') { va = a.change_7d == null ? -Infinity : a.change_7d; vb = b.change_7d == null ? -Infinity : b.change_7d; }
    else if (key === 'age') { va = a.age_days == null ? -1 : a.age_days; vb = b.age_days == null ? -1 : b.age_days; }
    else { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.slug < b.slug ? -1 : 1;
  });
  return rows;
}

/* --------------------------------------------------------------- chrome */

function topbarHTML() {
  return '<div class="topbar"><div class="brand"><span class="dot"></span>Token Radar <small>pre-token protocol board</small></div>' +
    '<div class="meta">Snapshot <b>' + esc(D.as_of) + '</b> &middot; DefiLlama protocol index &middot; model <b>' + esc(D.model_version) + '</b></div></div>';
}

function heroHTML() {
  var combined = D.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
  return '<section class="hero"><div>' +
    '<h1><em>' + D.watchlist_size + ' watchlist protocols</em>, ranked by implied value — plus every early pre-token protocol below the floor.</h1>' +
    '<p>The watchlist is the floor: every protocol with at least <b>' + fmtUSD(D.floor_usd) + '</b> of TVL and no token on record, plus <b>' + D.early_size + ' early protocols</b> below it. Implied value is this entry&rsquo;s model, from each protocol&rsquo;s own figures — not a promise, and not a prediction that a token is issued.</p></div>' +
    '<div class="stats">' +
    '<div class="stat"><div class="v gold">' + D.watchlist_size + ' / ' + D.watchlist_size + '</div><div class="k">watchlist covered</div></div>' +
    '<div class="stat"><div class="v">' + D.board_size + '</div><div class="k">pre-token rows ranked</div></div>' +
    '<div class="stat"><div class="v">' + fmtUSD(combined) + '</div><div class="k">combined implied value</div></div>' +
    '<div class="stat"><div class="v">' + D.live_size + '</div><div class="k">live-token protocols set aside</div></div>' +
    '</div></section>';
}

function methodStripHTML() {
  var mult = D.multiples;
  var cats = Object.keys(mult.by_category).length;
  return '<section class="method"><h2>How the ranking works</h2>' +
    '<div class="formula">implied value <span class="op">=</span> TVL <span class="op">&times;</span> <span class="fn">market multiple</span> <span class="op">&times;</span> growth <span class="op">&times;</span> maturity <span class="op">&times;</span> breadth</div>' +
    '<p>The <b>market multiple</b> is measured from this same snapshot: the median market-cap-to-TVL ratio of <b>' + mult.global_samples + ' trading tokens</b> is <b>' + sig(mult.global) + '&times;</b>' +
    (cats > 0 ? ', and ' + cats + ' categories with at least ' + M.category_min_samples + ' trading tokens use their own median' : '') +
    '. Growth is the 7-day TVL change, clamped to ' + M.growth_floor + '%…+' + M.growth_cap + '%. Maturity rewards time running with no token, up to ' + M.maturity_days + ' days. ' +
    'Every factor is shown per protocol in its detail view, and the <b>Method &amp; sandbox</b> tab re-runs the model with your own constants.</p></section>';
}

function tabsHTML() {
  function tab(view, label, n) {
    return '<button class="tab" role="tab" aria-selected="' + (state.view === view) + '" data-view="' + view + '">' + label + (n != null ? '<span class="n">' + n + '</span>' : '') + '</button>';
  }
  return '<div class="tabs" role="tablist">' + tab('board', 'Board', D.board_size) + tab('live', 'Live tokens', D.live_size) + tab('method', 'Method &amp; sandbox', null) + '</div>';
}

function footerHTML() {
  return '<footer><p>Source: ' + esc(D.source) + '. Figures are the snapshot&rsquo;s frozen fetch of ' + esc(D.as_of) + '; nothing here is live data.</p>' +
    '<p>&ldquo;Records no token&rdquo; means the snapshot&rsquo;s record carries no token — a protocol may still have one its record does not carry. Implied values are this entry&rsquo;s own model, never a claim by make.fun or DefiLlama, and farm steps are general guidance, not financial advice.</p></footer>';
}

/* --------------------------------------------------------------- board */

function controlsHTML() {
  var catOpts = '<option value="all">All categories</option>' + categories().map(function (c) {
    return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  var chainOpts = '<option value="all">All chains</option>' + chains().map(function (c) {
    return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  var sortOpts = [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7d growth'], ['age', 'Age'], ['name', 'Name']].map(function (o) {
    return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
  }).join('');
  return '<div class="controls">' +
    '<div class="field"><label for="q">Search</label><input id="q" type="search" placeholder="Name, slug, category or chain" value="' + esc(state.q) + '"></div>' +
    '<div class="field"><label for="cat">Category</label><select id="cat">' + catOpts + '</select></div>' +
    '<div class="field"><label for="chain">Chain</label><select id="chain">' + chainOpts + '</select></div>' +
    '<div class="field"><label for="sort">Sort by</label><select id="sort">' + sortOpts + '</select></div>' +
    '<label class="check"><input id="watchonly" type="checkbox"' + (state.watchlistOnly ? ' checked' : '') + '> Watchlist only</label>' +
    '<div class="showing" id="showing"></div></div>';
}

function boardTableHTML(rows) {
  if (rows.length === 0) return '<div class="board-card"><div class="empty">No protocols match these filters. Loosen the search or clear a filter.</div></div>';
  var maxImp = rows.reduce(function (m, r) { return Math.max(m, factors(r).implied); }, 1);
  var dirty = sandboxDirty();
  var head = '<thead><tr><th class="num">Rank</th><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th class="num hide-m">Age</th><th class="num">Implied value' + (dirty ? ' (sandbox)' : '') + '</th></tr></thead>';
  var body = rows.map(function (r, i) {
    var f = factors(r);
    var pct = Math.max(2, Math.round((f.implied / maxImp) * 100));
    return '<tr class="row" data-slug="' + esc(r.slug) + '" tabindex="0">' +
      '<td class="num rank">' + (dirty ? (i + 1) : r.rank) + '</td>' +
      '<td><div class="proto"><span class="nm">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="badge watch">Watchlist</span>' : '') +
      '<div class="sub">' + esc(r.category || 'Uncategorised') + ' on ' + esc(chainsLabel(r.chains)) + '</div></div></td>' +
      '<td class="num">' + fmtUSD(r.tvl_usd) + '</td>' +
      '<td class="num ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
      '<td class="num hide-m">' + fmtAge(r.age_days) + '</td>' +
      '<td class="num"><span class="imp">' + fmtUSD(f.implied) + '</span><div class="bar"><i style="width:' + pct + '%"></i></div></td></tr>';
  }).join('');
  return '<div class="board-card"><table>' + head + '<tbody>' + body + '</tbody></table></div>';
}

function boardViewHTML() {
  var rows = visibleRows();
  var banner = sandboxDirty()
    ? '<p class="note"><b>Sandbox active.</b> Implied values and ranks below are recomputed with your constants — not the submitted board. Reset them in the Method &amp; sandbox tab.</p>'
    : '';
  return controlsHTML() + banner + boardTableHTML(rows) +
    '<p class="note">Select a row for its model breakdown and farm plan. Ranks are the model&rsquo;s claim, strongest implied value first; the board may be re-sorted without changing the submitted ranks.</p>';
}

/* --------------------------------------------------------------- detail */

function detailViewHTML(row) {
  var f = factors(row);
  var dirty = sandboxDirty();
  var multWhy = row.multiple_kind === 'category'
    ? 'Median of ' + row.multiple_samples + ' trading ' + (row.category || '') + ' tokens in this snapshot'
    : 'Global median of ' + row.multiple_samples + ' trading tokens — fewer than ' + M.category_min_samples + ' trading tokens in this category';
  var growthWhy = row.change_7d == null ? 'No 7-day change reported; treated as 0%' : 'Reported ' + fmtPct(row.change_7d) + ', clamped to ' + M.growth_floor + '%…+' + M.growth_cap + '%';
  var ageWhy = row.age_days == null ? 'No listing date reported; ' + M.unknown_age_days + ' days assumed' : 'Listed ' + esc(row.listed_at || '') + ', ' + row.age_days + ' days before the snapshot';
  var steps = row.farm_steps.map(function (s) {
    var p = parseStep(s);
    return '<li><div>' + esc(p.text) + '</div><div class="costtime">Cost: <b>' + esc(p.cost) + '</b> &middot; Time: <b>' + esc(p.time) + '</b></div></li>';
  }).join('');
  return '<button class="back" id="backbtn">&larr; Back to the board</button>' +
    '<div class="detail"><div class="card">' +
    '<h2>' + esc(row.name) + (row.watchlist ? '<span class="badge watch">Watchlist</span>' : '') + '</h2>' +
    '<p class="sub">' + esc(row.category || 'Uncategorised') + ' &middot; ' + esc(row.chains.join(', ') || 'chain unreported') + ' &middot; slug <code>' + esc(row.slug) + '</code></p>' +
    '<div class="kv">' +
    '<div><div class="k">Implied value' + (dirty ? ' (sandbox)' : '') + '</div><div class="v big">' + fmtUSD(f.implied) + '</div></div>' +
    '<div><div class="k">Submitted rank</div><div class="v">#' + row.rank + ' of ' + D.board_size + '</div></div>' +
    '<div><div class="k">TVL</div><div class="v">' + fmtUSD(row.tvl_usd) + '</div></div>' +
    '<div><div class="k">7-day TVL change</div><div class="v ' + pctClass(row.change_7d) + '">' + fmtPct(row.change_7d) + '</div></div>' +
    '<div><div class="k">Age at snapshot</div><div class="v">' + fmtAge(row.age_days) + '</div></div>' +
    '<div><div class="k">Token status</div><div class="v">Records no token</div></div>' +
    '</div>' +
    '<h3 style="margin-top:18px">How the value is built</h3>' +
    '<table class="breakdown"><tbody>' +
    '<tr><td>TVL<span class="why">The snapshot&rsquo;s figure, whole dollars</span></td><td>' + fmtUSD(row.tvl_usd) + '</td></tr>' +
    '<tr><td>Market multiple &times;' + sig(f.multiple) + '<span class="why">' + esc(multWhy) + '</span></td><td>' + sig(f.multiple) + '&times;</td></tr>' +
    '<tr><td>Growth &times;' + sig(f.growthMult) + '<span class="why">' + esc(growthWhy) + '</span></td><td>' + sig(f.growthMult) + '&times;</td></tr>' +
    '<tr><td>Maturity &times;' + sig(f.maturityMult) + '<span class="why">' + esc(ageWhy) + '</span></td><td>' + sig(f.maturityMult) + '&times;</td></tr>' +
    '<tr><td>Breadth &times;' + sig(f.breadthMult) + '<span class="why">' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ' counted, +' + (M.breadth_step * 100) + '% per extra chain up to ' + M.breadth_cap_chains + '</span></td><td>' + sig(f.breadthMult) + '&times;</td></tr>' +
    '<tr><td><b>Implied value</b></td><td><b>' + fmtUSD(f.implied) + '</b></td></tr>' +
    '</tbody></table>' +
    '<p class="note">The model says what a token <b>would be worth if the record stayed as it is</b>. It does not predict whether or when a token is issued.</p>' +
    '</div>' +
    '<div class="card"><h3>Farm plan</h3><ol class="steps">' + steps + '</ol>' +
    '<p class="note">Costs are typical figures for ' + esc(row.chains[0] || 'the chain') + ' at the snapshot date. Nothing here claims this protocol runs a points program or an airdrop — the steps use the protocol itself, which is what any future distribution would measure.</p></div></div>';
}

/* --------------------------------------------------------------- live */

function liveViewHTML() {
  var rows = D.live.map(function (p) {
    var ratio = p.mcap_usd != null && p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : null;
    return '<tr><td><div class="proto"><span class="nm">' + esc(p.name) + '</span><span class="badge live">Trading</span><div class="sub">' + esc(p.category || 'Uncategorised') + ' on ' + esc(chainsLabel(p.chains)) + '</div></div></td>' +
      '<td class="num">' + fmtUSD(p.tvl_usd) + '</td><td class="num">' + fmtUSD(p.mcap_usd) + '</td>' +
      '<td class="num ' + pctClass(p.change_7d) + '">' + fmtPct(p.change_7d) + '</td>' +
      '<td class="num">' + (ratio == null ? 'n/a' : sig(ratio) + '&times;') + '</td></tr>';
  }).join('');
  return '<p class="note" style="margin-top:16px">These protocols <b>already record a token</b>, so the board does not rank them — the market has already priced them. Their market-cap-to-TVL ratios are exactly what the model measures its multiples from: the global median of ' + D.multiples.global_samples + ' such tokens is <b>' + sig(D.multiples.global) + '&times;</b>.</p>' +
    '<div class="board-card"><table><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">7d</th><th class="num">Mcap / TVL</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

/* --------------------------------------------------------------- method */

function methodViewHTML() {
  var mult = D.multiples;
  var catRows = Object.keys(mult.by_category).sort().map(function (c) {
    return '<tr><td>' + esc(c) + '</td><td class="num">' + mult.category_samples[c] + '</td><td class="num">' + sig(mult.by_category[c]) + '&times;</td></tr>';
  }).join('');
  var s = state.sandbox;
  return '<div class="prose">' +
    '<h2>The model, in full</h2>' +
    '<p><b>Implied value = TVL &times; market multiple &times; growth &times; maturity &times; breadth.</b> One function scores every protocol; no name is ever special-cased. The constants are these: growth weight <code>' + M.growth_weight + '</code>, growth clamp <code>' + M.growth_floor + '%…+' + M.growth_cap + '%</code>, maturity floor <code>' + M.maturity_floor + '</code> rising to <code>1.0</code> over <code>' + M.maturity_days + '</code> days, unknown age <code>' + M.unknown_age_days + '</code> days, breadth <code>+' + (M.breadth_step * 100) + '%</code> per extra chain up to <code>' + M.breadth_cap_chains + '</code>, multiples clamped to <code>' + M.multiple_floor + '&times;…​' + M.multiple_cap + '&times;</code>.</p>' +
    '<h3>Where the multiple comes from</h3>' +
    '<p>For every protocol in the snapshot that records a trading token with a market cap, the model divides market cap by TVL and takes the <b>median</b> — the middle value, so one outlier cannot move it. Categories with at least ' + M.category_min_samples + ' trading tokens get their own median; the rest use the global median. Centralised exchanges are left out: exchange tokens are not DeFi multiples.</p>' +
    '<table><thead><tr><th>Category</th><th class="num">Trading tokens</th><th class="num">Median multiple</th></tr></thead><tbody>' +
    '<tr><td><b>All categories (global)</b></td><td class="num">' + mult.global_samples + '</td><td class="num"><b>' + sig(mult.global) + '&times;</b></td></tr>' + catRows + '</tbody></table>' +
    '<h3>The board&rsquo;s coverage</h3>' +
    '<p>The snapshot holds <b>' + D.scanned + '</b> protocols at or above $5M of TVL. The board ranks <b>' + D.board_size + '</b> of them: all <b>' + D.watchlist_size + '</b> watchlist slugs, plus <b>' + D.early_size + '</b> early pre-token protocols below the $50M floor. Excluded from ranking: protocols that record a token (shown in Live tokens), and wrapped, staked or bridged products of a token that already trades — the house&rsquo;s own watchlist rule, applied to every row by category, by name and by exchange prefix, so WBTC, staked-ETH products and USDT0 never appear as launches. A protocol below the floor is no worse a subject than one on it — the floor is where the house&rsquo;s reading started, not where this radar stops.</p>' +
    '<h3>How farm plans are written</h3>' +
    '<p>Each plan is derived from the protocol&rsquo;s own record: its category picks the core action, its first chain picks the gas estimate, its TVL picks the capital, and its age picks the hold. Costs are typical figures for the chain, and every step states its cost and time. No plan claims a points program exists — the steps use the protocol itself.</p>' +
    '<h3>Model sandbox</h3>' +
    '<p>Change the constants and the board re-scores live, in this page. The submitted board always uses the stated constants above.</p></div>' +
    '<div class="sandbox">' +
    '<div class="field"><label for="sb-mult">Flat multiple override (×)</label><input id="sb-mult" type="number" min="0.01" max="5" step="0.01" placeholder="measured: ' + sig(mult.global) + '" value="' + (s.multiple == null ? '' : s.multiple) + '"></div>' +
    '<div class="field"><label for="sb-growth">Growth weight</label><input id="sb-growth" type="number" min="0" max="2" step="0.1" value="' + s.growthWeight + '"></div>' +
    '<div class="field"><label for="sb-floor">Maturity floor</label><input id="sb-floor" type="number" min="0" max="1" step="0.05" value="' + s.maturityFloor + '"></div>' +
    '<div class="field"><label for="sb-days">Maturity span (days)</label><input id="sb-days" type="number" min="30" max="3650" step="30" value="' + s.maturityDays + '"></div>' +
    '<p class="hint" id="sandbox-hint">' + (sandboxDirty() ? '<b>Sandbox active.</b> The board is re-scored with your constants. <button class="tab" id="sb-reset" type="button">Reset to the submitted model</button>' : 'The board currently uses the submitted model.') + '</p>' +
    '</div>';
}

/* --------------------------------------------------------------- render */

function render() {
  var app = document.getElementById('app');
  var html = '<div class="wrap">' + topbarHTML();
  if (!state.detail) html += heroHTML() + methodStripHTML();
  html += tabsHTML();
  if (state.detail) {
    var row = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === state.detail) { row = D.rows[i]; break; }
    html += row ? detailViewHTML(row) : '<p class="note">No board row has that slug.</p>';
  } else if (state.view === 'live') {
    html += liveViewHTML();
  } else if (state.view === 'method') {
    html += methodViewHTML();
  } else {
    html += boardViewHTML();
  }
  html += footerHTML() + '</div>';
  app.innerHTML = html;
  app.setAttribute('aria-busy', 'false');
  bind();
  var showing = document.getElementById('showing');
  if (showing && !state.detail && state.view === 'board') {
    showing.innerHTML = '<b>' + visibleRows().length + '</b> of ' + D.board_size + ' rows shown';
  }
}

function bind() {
  var tabs = document.querySelectorAll('[data-view]');
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { state.view = t.getAttribute('data-view'); state.detail = null; render(); });
  });
  var back = document.getElementById('backbtn');
  if (back) back.addEventListener('click', function () { state.detail = null; render(); });
  var q = document.getElementById('q');
  if (q) q.addEventListener('input', function () { state.q = q.value; render(); var nq = document.getElementById('q'); nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); });
  var cat = document.getElementById('cat');
  if (cat) cat.addEventListener('change', function () { state.category = cat.value; render(); });
  var chain = document.getElementById('chain');
  if (chain) chain.addEventListener('change', function () { state.chain = chain.value; render(); });
  var sort = document.getElementById('sort');
  if (sort) sort.addEventListener('change', function () { state.sort = sort.value; state.sortDir = sort.value === 'name' ? 1 : -1; render(); });
  var wo = document.getElementById('watchonly');
  if (wo) wo.addEventListener('change', function () { state.watchlistOnly = wo.checked; render(); });
  document.querySelectorAll('tr.row').forEach(function (tr) {
    function open() { state.detail = tr.getAttribute('data-slug'); render(); window.scrollTo(0, 0); }
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
  var sbMult = document.getElementById('sb-mult');
  if (sbMult) sbMult.addEventListener('change', function () {
    var v = parseFloat(sbMult.value);
    state.sandbox.multiple = sbMult.value.trim() === '' || !isFinite(v) || v <= 0 ? null : v;
    render();
  });
  var sbGrowth = document.getElementById('sb-growth');
  if (sbGrowth) sbGrowth.addEventListener('change', function () { var v = parseFloat(sbGrowth.value); if (isFinite(v)) state.sandbox.growthWeight = clamp(v, 0, 2); render(); });
  var sbFloor = document.getElementById('sb-floor');
  if (sbFloor) sbFloor.addEventListener('change', function () { var v = parseFloat(sbFloor.value); if (isFinite(v)) state.sandbox.maturityFloor = clamp(v, 0, 1); render(); });
  var sbDays = document.getElementById('sb-days');
  if (sbDays) sbDays.addEventListener('change', function () { var v = parseInt(sbDays.value, 10); if (isFinite(v)) state.sandbox.maturityDays = clamp(v, 30, 3650); render(); });
  var sbReset = document.getElementById('sb-reset');
  if (sbReset) sbReset.addEventListener('click', function () {
    state.sandbox = { multiple: null, growthWeight: M.growth_weight, maturityFloor: M.maturity_floor, maturityDays: M.maturity_days };
    render();
  });
}

render();
