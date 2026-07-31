// ============================================================================
//  PortApp Google Apps Script — Multi-Portfolio edition
//  Paste this ENTIRE file into your Apps Script project (replace existing code).
//
//  SETUP:
//   1. Set SHEET_ID below to the sheet you want this to operate on.
//      (To test on a COPY: set it to the copy's ID, run migratePortfolios(),
//       verify, then set it back to the real sheet and run it there.)
//   2. Run migratePortfolios() ONCE from the editor (Run ▸ migratePortfolios).
//   3. Deploy ▸ Manage deployments ▸ edit ▸ New version (so the web app serves this code).
// ============================================================================

const SHEET_ID = '11pdwfY3jAPSY18tbAbfeQUImx708l1dQCHXzHltiQPk';
const KEY1 = 'd8c4di9r01qidic6asngd8c4di9r01qidic6aso0';
const KEY2 = 'd8skl29r01qh5rerlg4gd8skl29r01qh5rerlg50';

const DEFAULT_PORT = 'Long-Term';

function doGet(e) {
  try {
    const expected = PropertiesService.getScriptProperties().getProperty('WRITE_KEY');
    const provided = e?.parameter?.key;
    if (!expected || provided !== expected) return jsonResp({ ok: false, error: 'unauthorized' });

    const p  = e.parameter;
    const ss = SpreadsheetApp.openById(SHEET_ID);

    switch (p.action) {
      case 'fetchHistory':   return fetchHistoryAction(ss, p);
      case 'updateCash':     return updateCashAction(ss, p);
      case 'addContribution': return addContributionAction(ss, p);
      case 'updateSymbol':   return updateSymbolAction(ss, p);
      case 'addSymbol':      return addSymbolAction(ss, p);
      case 'savePlan':       return savePlanAction(ss, p);
      case 'clearPlan':      return clearPlanAction(ss, p);
      case 'removeSymbol':   return removeSymbolAction(ss, p);
      case 'transferShares': return transferSharesAction(ss, p);
      case 'fetchHoldings':  return fetchHoldingsAction(p);
      case 'fetchOHLC':      return fetchOHLCAction(p);
      case 'fetchStockSectors': return fetchStockSectorsAction(p);
      case 'backfillMetadata': return backfillMetadataAction(ss, p);
      case 'backfillReturns':  return backfillReturnsAction(ss, p);
      case 'refreshReturns':   return refreshReturnsAction(ss, p);
      case 'backfillCalendar': return backfillCalendarAction(ss, p);
      case 'refreshCalendar':  return refreshCalendarAction(ss, p);
      case 'refreshGics':      return refreshGicsAction(ss, p);
      case 'delete':         return deleteTxnAction(ss, p);
      case 'update':         return updateTxnAction(ss, p);
      case '':
      case undefined:
      case null:             return appendTxnAction(ss, p);
      default:               return jsonResp({ ok: false, error: 'Unknown action: ' + p.action });
    }
  } catch (err) {
    return jsonResp({ ok: false, error: String(err && err.message || err) });
  }
}

// ============================================================================
//  ONE-TIME MIGRATION — run once from the editor.  Idempotent.
// ============================================================================
function migratePortfolios() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  if (ss.getSheetByName('Portfolios')) { Logger.log('Already migrated.'); return; }

  // (a) Append "Portfolio" column to Claude / transactions / Plan; stamp existing rows "Long-Term".
  ['Claude', 'transactions', 'Plan'].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastColumn() === 0) return;
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (head.indexOf('Portfolio') === -1) {
      const col = sh.getLastColumn() + 1;
      sh.getRange(1, col).setValue('Portfolio');
      const n = sh.getLastRow() - 1;
      if (n > 0) sh.getRange(2, col, n, 1).setValue(DEFAULT_PORT);
    }
  });

  // (b) Read old cash from Claude row 2 (the first data row).
  const cl     = ss.getSheetByName('Claude');
  const clHead = cl.getRange(1, 1, 1, cl.getLastColumn()).getValues()[0];
  const cell   = label => { const i = clHead.indexOf(label); return i === -1 ? '' : cl.getRange(2, i + 1).getValue(); };
  const oldFcd  = Number(cell('FCD')) || 0;
  const oldUsd  = Number(cell('USD')) || 0;
  const oldRes  = Number(cell('Cash Reserves')) || 0;
  const oldCash = (Number(cell('Cash')) || 0) || (oldFcd + oldUsd);

  // (c) Create the Portfolios registry sheet.
  const p = ss.insertSheet('Portfolios');
  p.getRange(1, 1, 1, 7).setValues([['id','Name','Color','Cash','CashReserves','FCD','USD']]);
  p.getRange(1, 1, 1, 7).setFontWeight('bold');
  p.getRange(2, 1, 2, 7).setValues([
    ['Long-Term', 'Long-Term', '#4ade80', oldCash, oldRes, oldFcd, oldUsd],
    ['Trade',     'Trade',     '#f87171', 0,       0,      0,      0],
  ]);

  // (d) Clear old cash cells in Claude row 2 (cash now lives only in Portfolios).
  ['Cash','Cash Reserves','FCD','USD'].forEach(label => {
    const i = clHead.indexOf(label);
    if (i !== -1) cl.getRange(2, i + 1).clearContent();
  });

  Logger.log('Migration complete. Portfolios: Long-Term (cash %s / res %s / FCD %s / USD %s) + Trade.',
             oldCash, oldRes, oldFcd, oldUsd);
}

// ============================================================================
//  ADD ETF PORTFOLIO — run once from the editor after migratePortfolios().
// ============================================================================
function addEtfPortfolio() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var p  = ss.getSheetByName('Portfolios');
  if (!p) { Logger.log('Portfolios sheet not found — run migratePortfolios() first.'); return; }

  var names = p.getRange(2, 2, p.getLastRow() - 1, 1).getValues().map(function(r) { return r[0]; });
  if (names.indexOf('ETF') !== -1) { Logger.log('ETF portfolio already exists.'); return; }

  p.appendRow(['ETF', 'ETF', '#5B8DEF', 0, 0, 0, 0]);
  Logger.log('ETF portfolio added.');
}

// ── Diagnostics (unchanged) ──────────────────────────────────────────────────
function diagYahooIndices() {
  var c = getYahooCrumb();
  Logger.log('crumb=' + c.crumb + '  cookieLen=' + (c.cookieStr && c.cookieStr.length));
  var symEnc = '%5EGSPC,%5EIXIC,%5ERUT';
  var url1 = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + symEnc + '&crumb=' + encodeURIComponent(c.crumb);
  var r1 = UrlFetchApp.fetch(url1, { headers: { Cookie: c.cookieStr, Accept: 'application/json' }, muteHttpExceptions: true });
  Logger.log('WITH crumb -> code=' + r1.getResponseCode());
  Logger.log('WITH crumb -> body=' + r1.getContentText().substring(0, 800));
  var url2 = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + symEnc;
  var r2 = UrlFetchApp.fetch(url2, { muteHttpExceptions: true });
  Logger.log('NO crumb   -> code=' + r2.getResponseCode());
  Logger.log('NO crumb   -> body=' + r2.getContentText().substring(0, 800));
}

function diagCrumb() {
  var c = getYahooCrumb();
  Logger.log(JSON.stringify(c));
}

// ── Cached Yahoo crumb (reused for 1 hour to save UrlFetch quota) ────────────
function getCachedCrumb_() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('yahooCrumb');
  const cachedAt = parseInt(props.getProperty('yahooCrumbAt') || '0');
  if (cached && Date.now() / 1000 - cachedAt < 3600) {
    return JSON.parse(cached);
  }
  const yc = getYahooCrumb();
  props.setProperty('yahooCrumb', JSON.stringify(yc));
  props.setProperty('yahooCrumbAt', String(Math.floor(Date.now() / 1000)));
  return yc;
}

// ── Finnhub quote refresh (called by 1-min time trigger) ─────────────────────
function refreshQuotes() {
    const props = PropertiesService.getScriptProperties();
    const skip = props.getProperty('quoteSkip') === '1';
    props.setProperty('quoteSkip', skip ? '0' : '1');
    if (skip) return;

    if (!isMarketOpenET_()) return;

    const ss           = SpreadsheetApp.openById(SHEET_ID);
    const claudeData   = ss.getSheetByName('Claude').getDataRange().getValues();
    const portSymbols  = [...new Set(claudeData.slice(1)
      .map(r => String(r[0]).trim())
      .filter(s => s && s !== 'Symbol'))];
    const indexSymbols = ['^GSPC', '^IXIC', '^RUT'];

    if (!portSymbols.length) return;

    const mid   = Math.ceil(portSymbols.length / 2);
    const half1 = portSymbols.slice(0, mid);
    const half2 = portSymbols.slice(mid);
    const requests = [
      ...half1.map(s => ({ url: `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${KEY1}`,
  muteHttpExceptions: true })),
      ...half2.map(s => ({ url: `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${KEY2}`,
  muteHttpExceptions: true })),
    ];

    let responses;
    try {
      responses = UrlFetchApp.fetchAll(requests);
    } catch (e) {
      Logger.log('Finnhub fetchAll error: ' + e);
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const rows = [...half1, ...half2].map((sym, i) => {
      try {
        const d = JSON.parse(responses[i].getContentText());
        if (!(d.c > 0)) return null;
        const chg    = d.d  != null ? d.d  : (d.c && d.pc ? +(d.c - d.pc).toFixed(4) : '');
        const chgPct = d.dp != null ? d.dp : (d.c && d.pc ? +((d.c - d.pc) / d.pc * 100).toFixed(4) : '');
        return [sym, d.c, chg, chgPct, nowSec];
      } catch { return null; }
    }).filter(Boolean);

    try {
      const yc     = getCachedCrumb_();
      const syms   = indexSymbols.map(s => encodeURIComponent(s)).join(',');
      const idxUrl =
  `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${syms}&crumb=${encodeURIComponent(yc.crumb)}`;
      const idxRes = UrlFetchApp.fetch(idxUrl, { muteHttpExceptions: true, headers: { Cookie: yc.cookieStr } });
      (JSON.parse(idxRes.getContentText())?.quoteResponse?.result || []).forEach(q => {
        if (q.regularMarketPrice > 0)
          rows.push([q.symbol, q.regularMarketPrice, q.regularMarketChange ?? '', q.regularMarketChangePercent ?? '',
  nowSec]);
      });
    } catch (e) { Logger.log('Index fetch error: ' + e); }

    if (!rows.length) { Logger.log('No quote data returned — skipping sheet write'); return; }

    let qs = ss.getSheetByName('Quotes');
    if (!qs) qs = ss.insertSheet('Quotes');
    const allRows = [['Symbol', 'Price', 'Change', 'ChangePct', 'UpdatedAt'], ...rows];
    qs.getRange(1, 1, allRows.length, 5).setValues(allRows);
    const prevLast = qs.getLastRow();
    if (prevLast > allRows.length) qs.deleteRows(allRows.length + 1, prevLast - allRows.length);
}

// Sole source for stock trailing returns (FMP removed — its free tier walls off symbols like
// CLPT behind a premium paywall). Computes each period as one reference-price-vs-current
// comparison from a single Yahoo chart price series: (current - priceAt(target date)) / priceAt(...).
// priceAt() walks the series back to the most recent trading day at or before the target date, so
// weekends/holidays just resolve to the prior trading day's close.
function _computeReturnsFromChart_(result) {
  const ts     = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!ts?.length || !closes?.length) return null;

  const series = [];
  for (let i = 0; i < ts.length; i++) if (closes[i] != null) series.push({ t: ts[i] * 1000, c: closes[i] });
  if (!series.length) return null;

  const current = result.meta?.regularMarketPrice ?? series[series.length - 1].c;
  const priceAt = targetMs => {
    let best = null;
    for (const pt of series) { if (pt.t <= targetMs) best = pt.c; else break; }
    return best;
  };
  const pctFrom = targetMs => {
    const p = priceAt(targetMs);
    return (p != null && p > 0) ? ((current - p) / p) * 100 : '';
  };

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const startOfYear = new Date(new Date().getUTCFullYear(), 0, 1).getTime();
  return {
    '1M': pctFrom(now - 30 * day),
    '3M': pctFrom(now - 91 * day),
    ytd:  pctFrom(startOfYear),
    '1Y': pctFrom(now - 365 * day),
    '3Y': pctFrom(now - 3 * 365 * day),
    '5Y': pctFrom(now - 5 * 365 * day),
  };
}

function _yahooChartUrl_(sym) {
  return 'https://query1.finance.yahoo.com/v8/finance/chart/'
    + encodeURIComponent(sym.replace(/\./g, '-')) + '?range=5y&interval=1d';
}

function _fetchYahooChartReturns_(sym) {
  try {
    const resp = UrlFetchApp.fetch(_yahooChartUrl_(sym), { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (resp.getResponseCode() !== 200) return null;
    const result = JSON.parse(resp.getContentText())?.chart?.result?.[0];
    return _computeReturnsFromChart_(result);
  } catch (err) { return null; }
}

// Full OHLC series for the Heikin Ashi chart toggle (see index.html fetchYahooOHLC). v8/finance/chart
// needs no crumb, so this can run server-side and return browser-readable JSON — the client's direct
// Yahoo/corsproxy fetch is production-dead (see Known Limitations in CLAUDE.md).
function _fetchYahooOHLCMap_(sym, range) {
  try {
    // NB: 'max' is deliberately absent — Yahoo silently downgrades range=max&interval=1d to
    // quarterly bars (dataGranularity '3mo'). '10y' is the deepest range that stays daily.
    const r = ({ '3mo': 1, '6mo': 1, '1y': 1, '2y': 1, '5y': 1, '10y': 1 })[range] ? range : '2y';
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
      + encodeURIComponent(sym.replace(/\./g, '-')) + '?range=' + r + '&interval=1d';
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (resp.getResponseCode() !== 200) return null;
    const result = JSON.parse(resp.getContentText())?.chart?.result?.[0];
    if (!result?.timestamp) return null;
    const q = result.indicators?.quote?.[0] || {};
    const open = q.open || [], high = q.high || [], low = q.low || [], close = q.close || [];
    const out = {};
    result.timestamp.forEach((ts, i) => {
      if (open[i] != null && high[i] != null && low[i] != null && close[i] != null) {
        out[new Date(ts * 1000).toISOString().slice(0, 10)] = { o: open[i], h: high[i], l: low[i], c: close[i] };
      }
    });
    return Object.keys(out).length ? out : null;
  } catch (err) { return null; }
}

function fetchOHLCAction(p) {
  const sym = String(p.symbol || '').trim();
  if (!sym) return jsonResp({ ok: false, error: 'no symbol' });
  const range = String(p.range || '2y');
  const ohlc = _fetchYahooOHLCMap_(sym, range);
  return jsonResp({ ok: true, ohlc: ohlc || {} });
}

const RETURNS_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Webapp pings this every init() (see index.html), but a single global Script Properties timestamp
// gates the actual work to once per day — most pings just do one cheap property read and return.
// When the cooldown has elapsed, every non-ETF Claude symbol gets its returns recomputed and the
// whole Returns sheet is overwritten fresh (not just missing rows — see backfillReturnsAction for that).
function refreshReturnsAction(ss, p) {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('lastFullReturnsRefresh'));
  if (last && (Date.now() - last) < RETURNS_REFRESH_COOLDOWN_MS) {
    return jsonResp({ ok: true, skipped: true });
  }

  const claudeData = ss.getSheetByName('Claude').getDataRange().getValues();
  const headers = claudeData[0].map(h => String(h).trim());
  const sectorCol = headers.indexOf('Sector');
  const syms = [...new Set(claudeData.slice(1)
    .filter(r => {
      const sym = String(r[0]).trim();
      const sector = sectorCol >= 0 ? String(r[sectorCol]).trim() : '';
      return sym && sym !== 'Symbol' && sector !== 'ETF';
    })
    .map(r => String(r[0]).trim()))];
  if (!syms.length) return jsonResp({ ok: true, updated: 0 });

  const reqs = syms.map(sym => ({ url: _yahooChartUrl_(sym), muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } }));

  let resps;
  try { resps = UrlFetchApp.fetchAll(reqs); }
  catch (e) { return jsonResp({ ok: false, error: 'fetchAll failed: ' + e }); }

  const nowSec = Math.floor(Date.now() / 1000);
  const rows = [];
  for (let i = 0; i < syms.length; i++) {
    if (resps[i].getResponseCode() !== 200) continue;
    let result;
    try { result = JSON.parse(resps[i].getContentText())?.chart?.result?.[0]; } catch { continue; }
    const d = _computeReturnsFromChart_(result);
    if (!d) continue;
    rows.push([
      syms[i],
      d['1M'] ?? '', d['3M'] ?? '', d.ytd ?? '',
      d['1Y'] ?? '', d['3Y'] ?? '', d['5Y'] ?? '',
      nowSec
    ]);
  }

  if (!rows.length) return jsonResp({ ok: true, updated: 0 });

  let sh = ss.getSheetByName('Returns');
  if (!sh) sh = ss.insertSheet('Returns');
  const allRows = [['Symbol', '1M', '3M', 'YTD', '1Y', '3Y', '5Y', 'UpdatedAt'], ...rows];
  sh.getRange(1, 1, allRows.length, 8).setValues(allRows);
  const prevLast = sh.getLastRow();
  if (prevLast > allRows.length) sh.deleteRows(allRows.length + 1, prevLast - allRows.length);

  props.setProperty('lastFullReturnsRefresh', String(Date.now()));
  return jsonResp({ ok: true, updated: rows.length, checked: syms.length });
}

// Fetch trailing returns for ONE symbol and upsert into the Returns sheet — bridges the gap
// between adding a holding and the next daily refreshReturnsAction() run.
function refreshReturnsForSymbol_(sym) {
  const d = _fetchYahooChartReturns_(sym);
  if (!d) return;
  const row = [sym, d['1M'] ?? '', d['3M'] ?? '', d.ytd ?? '', d['1Y'] ?? '', d['3Y'] ?? '', d['5Y'] ?? '', Math.floor(Date.now() / 1000)];

  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName('Returns');
  if (!sh) { sh = ss.insertSheet('Returns'); sh.appendRow(['Symbol', '1M', '3M', 'YTD', '1Y', '3Y', '5Y', 'UpdatedAt']); }

  const symCol = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().flat();
  const rowIdx = symCol.findIndex(v => String(v).trim() === sym);
  if (rowIdx > 0) sh.getRange(rowIdx + 1, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

/* ── Calendar (earnings date + ex-div date) ───────────────────────────────── */

// Batched Yahoo v7/quote fetch (crumb required, server-side only) — mirrors the index-quote
// fetch in refreshQuotes(). Chunked at 50 symbols/request to stay safely under URL length limits.
function _fetchYahooCalendarFields_(symbols) {
  if (!symbols.length) return {};
  const yc = getCachedCrumb_();
  const CHUNK = 50;
  const chunks = [];
  for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK));
  const yahooToOrig = {};
  const reqs = chunks.map(chunk => {
    const ySyms = chunk.map(s => { const y = s.replace(/\./g, '-'); yahooToOrig[y] = s; return y; });
    return {
      url: 'https://query1.finance.yahoo.com/v7/finance/quote?symbols='
        + ySyms.map(encodeURIComponent).join(',') + '&crumb=' + encodeURIComponent(yc.crumb),
      muteHttpExceptions: true,
      headers: { Cookie: yc.cookieStr, Accept: 'application/json' }
    };
  });

  let resps;
  try { resps = UrlFetchApp.fetchAll(reqs); } catch (e) { Logger.log('Calendar quote fetchAll error: ' + e); return {}; }

  const out = {};
  resps.forEach(r => {
    try {
      const results = JSON.parse(r.getContentText())?.quoteResponse?.result || [];
      results.forEach(q => {
        const origSym = yahooToOrig[q.symbol] || q.symbol;
        out[origSym] = {
          earningsTimestamp:    q.earningsTimestamp    ?? null,
          earningsTimestampEnd: q.earningsTimestampEnd ?? null,
          exDividendDate:       q.exDividendDate        ?? null,
        };
      });
    } catch (e) {}
  });
  return out;
}

function _calFmtDate_(ts) {
  return ts ? Utilities.formatDate(new Date(ts * 1000), 'America/New_York', 'yyyy-MM-dd') : '';
}

// Yahoo doesn't label BMO/AMC directly — earnings calls run ~7-9am ET (before open) or ~4-5pm ET
// (after close), so the timestamp's ET hour reliably distinguishes the two.
function _calEarningsTime_(ts) {
  if (!ts) return '';
  const hour = parseInt(Utilities.formatDate(new Date(ts * 1000), 'America/New_York', 'H'), 10);
  return hour < 12 ? 'before market open' : 'after market close';
}

function _calRow_(sym, d) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (!d) return [sym, '', '', '', '', nowSec];
  return [sym, _calFmtDate_(d.earningsTimestamp), _calFmtDate_(d.earningsTimestampEnd),
          _calEarningsTime_(d.earningsTimestamp), _calFmtDate_(d.exDividendDate), nowSec];
}

function _claudeSymbols_(ss) {
  const claudeData = ss.getSheetByName('Claude').getDataRange().getValues();
  return [...new Set(claudeData.slice(1)
    .map(r => String(r[0]).trim())
    .filter(s => s && s !== 'Symbol'))];
}

const CALENDAR_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const CALENDAR_SHEET_HEADER = ['Symbol', 'EarningsDate', 'EarningsDateEnd', 'Time', 'ExDivDate', 'UpdatedAt'];

// Pinged every init(); global cooldown gates the actual work to once/day (mirrors refreshReturnsAction).
// Overwrites every row (all Claude-sheet symbols, incl. ETFs and watchlist entries) — ETFs simply get
// a blank EarningsDate since Yahoo has none for them, but still get ExDivDate.
function refreshCalendarAction(ss, p) {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('lastFullCalendarRefresh'));
  if (last && (Date.now() - last) < CALENDAR_REFRESH_COOLDOWN_MS) return jsonResp({ ok: true, skipped: true });

  const syms = _claudeSymbols_(ss);
  if (!syms.length) return jsonResp({ ok: true, updated: 0 });

  const data = _fetchYahooCalendarFields_(syms);
  const rows = syms.map(sym => _calRow_(sym, data[sym]));

  let sh = ss.getSheetByName('Calendar');
  if (!sh) sh = ss.insertSheet('Calendar');
  const allRows = [CALENDAR_SHEET_HEADER, ...rows];
  sh.getRange(1, 1, allRows.length, CALENDAR_SHEET_HEADER.length).setValues(allRows);
  const prevLast = sh.getLastRow();
  if (prevLast > allRows.length) sh.deleteRows(allRows.length + 1, prevLast - allRows.length);

  props.setProperty('lastFullCalendarRefresh', String(Date.now()));
  return jsonResp({ ok: true, updated: rows.length });
}

// Finds Claude-sheet symbols with NO row at all in Calendar and fetches just those — bridges
// gaps left when refreshCalendarForSymbol_() failed at add-time. Mirrors backfillReturnsAction.
function backfillCalendarAction(ss, p) {
  const claudeSyms = _claudeSymbols_(ss);
  if (!claudeSyms.length) return jsonResp({ ok: true, checked: 0, updated: 0, skipped: 0 });

  let sh = ss.getSheetByName('Calendar');
  if (!sh) { sh = ss.insertSheet('Calendar'); sh.appendRow(CALENDAR_SHEET_HEADER); }
  const existing = new Set(
    sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 0), 1).getValues().flat().map(v => String(v).trim())
  );

  const allMissing = claudeSyms.filter(s => !existing.has(s));
  if (!allMissing.length) return jsonResp({ ok: true, checked: 0, updated: 0, skipped: 0 });

  const missing = allMissing.filter(sym => !_backfillCooldownActive_('lastAttempt:CAL:' + sym));
  const skipped = allMissing.length - missing.length;
  if (!missing.length) return jsonResp({ ok: true, checked: allMissing.length, updated: 0, skipped });

  const data = _fetchYahooCalendarFields_(missing);
  if (!Object.keys(data).length) {
    missing.forEach(sym => _setBackfillCooldown_('lastAttempt:CAL:' + sym));
    return jsonResp({ ok: false, error: 'fetch failed', checked: allMissing.length, updated: 0, skipped });
  }

  const rows = missing.map(sym => {
    if (!data[sym]) _setBackfillCooldown_('lastAttempt:CAL:' + sym);
    return _calRow_(sym, data[sym]);
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, CALENDAR_SHEET_HEADER.length).setValues(rows);

  return jsonResp({ ok: true, checked: allMissing.length, updated: rows.length, skipped });
}

// Fetch calendar data for ONE symbol and upsert into the Calendar sheet — bridges the gap
// between adding a holding and the next daily refreshCalendarAction() run.
function refreshCalendarForSymbol_(sym) {
  const data = _fetchYahooCalendarFields_([sym]);
  const row  = _calRow_(sym, data[sym]);

  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName('Calendar');
  if (!sh) { sh = ss.insertSheet('Calendar'); sh.appendRow(CALENDAR_SHEET_HEADER); }

  const symCol  = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().flat();
  const rowIdx  = symCol.findIndex(v => String(v).trim() === sym);
  if (rowIdx > 0) sh.getRange(rowIdx + 1, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

/* ── GICS sector/sub-industry (external published dataset) ─────────────────── */

const GICS_MAP_URL = 'https://raw.githubusercontent.com/imjnoenter/gics-data/main/gics.json';

// No CacheService — the file is ~1,500 UPPERCASE dot-notation tickers and may exceed the
// 100KB per-key cache limit. Call frequency is low (per-add + weekly), so a fresh fetch each
// time is cheap enough. Returns {} on any failure so callers can treat a miss like "no GICS data".
function _fetchGicsMap_() {
  try {
    const resp = UrlFetchApp.fetch(GICS_MAP_URL, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (resp.getResponseCode() !== 200) return {};
    return JSON.parse(resp.getContentText()) || {};
  } catch (err) { return {}; }
}

const GICS_REFRESH_COOLDOWN_MS = 7 * 24 * 3600 * 1000;

// Pinged every init() (see index.html); a global Script Properties timestamp gates the actual
// work to once a week — most pings are a single cheap property read. When due, every Claude
// symbol present in the GICS map gets its Sector/Industry overwritten (GICS always wins).
function refreshGicsAction(ss, p) {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('lastFullGicsRefresh'));
  if (last && (Date.now() - last) < GICS_REFRESH_COOLDOWN_MS) return jsonResp({ ok: true, skipped: true });

  const sh = ss.getSheetByName('Claude');
  if (!sh) return jsonResp({ ok: false, error: 'Claude sheet not found' });
  const headers = readHeaders(sh);
  const symCol      = findColIdx(headers, 'Symbol');
  const sectorCol   = findColIdx(headers, 'Sector');
  const industryCol = findColIdx(headers, 'Industry');
  if (!symCol || (!sectorCol && !industryCol)) return jsonResp({ ok: true, updated: 0 });

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return jsonResp({ ok: true, updated: 0 });

  const map = _fetchGicsMap_();
  if (!Object.keys(map).length) return jsonResp({ ok: false, error: 'GICS map fetch failed', updated: 0 });

  const n = lastRow - 1;
  const syms = sh.getRange(2, symCol, n, 1).getValues().flat().map(v => normSym(v).toUpperCase());
  const sectorVals   = sectorCol   > 0 ? sh.getRange(2, sectorCol,   n, 1).getValues() : null;
  const industryVals = industryCol > 0 ? sh.getRange(2, industryCol, n, 1).getValues() : null;

  let updated = 0;
  for (let i = 0; i < n; i++) {
    const g = map[syms[i]];
    if (!g) continue;
    if (sectorVals   && g.sector)      sectorVals[i][0]   = g.sector;
    if (industryVals && g.subIndustry) industryVals[i][0] = g.subIndustry;
    updated++;
  }

  if (updated) {
    if (sectorVals)   sh.getRange(2, sectorCol,   n, 1).setValues(sectorVals);
    if (industryVals) sh.getRange(2, industryCol, n, 1).setValues(industryVals);
  }

  props.setProperty('lastFullGicsRefresh', String(Date.now()));
  return jsonResp({ ok: true, updated });
}

function isMarketOpenET_() {
  const now  = new Date();
  const day  = parseInt(Utilities.formatDate(now, 'America/New_York', 'u'));
  const hhmm = Utilities.formatDate(now, 'America/New_York', 'HHmm');
  return day >= 1 && day <= 5 && hhmm >= '0930' && hhmm < '1605';
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function jsonResp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function readHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function findColIdx(headers, name) {
  let c = headers.indexOf(name);
  if (c < 0) {
    const lower = String(name).toLowerCase();
    c = headers.findIndex(h => String(h || '').toLowerCase() === lower);
  }
  return c + 1; // 1-based; 0 = not found
}

function normSym(x) { return String(x == null ? '' : x).trim(); }

// Find a Claude row by BOTH symbol and portfolio. Returns 1-based row, or -1.
function findClaudeRow(sh, headers, sym, portfolio) {
  const symCol  = findColIdx(headers, 'Symbol');
  const portCol = findColIdx(headers, 'Portfolio');
  const lastRow = sh.getLastRow();
  if (lastRow < 2 || !symCol) return -1;
  const n     = lastRow - 1;
  const syms  = sh.getRange(2, symCol, n, 1).getValues().flat().map(normSym);
  const ports = portCol > 0
    ? sh.getRange(2, portCol, n, 1).getValues().flat().map(x => normSym(x) || DEFAULT_PORT)
    : new Array(n).fill(DEFAULT_PORT);
  const want = normSym(portfolio) || DEFAULT_PORT;
  for (let i = 0; i < n; i++) if (syms[i] === sym && ports[i] === want) return i + 2;
  return -1;
}

/* ── Cash (now in the Portfolios sheet) ───────────────────────────────────── */

function updateCashAction(ss, p) {
  const sh = ss.getSheetByName('Portfolios');
  if (!sh) return jsonResp({ ok: false, error: 'Portfolios sheet not found — run migratePortfolios()' });
  const headers = readHeaders(sh);
  const nameCol    = findColIdx(headers, 'Name');
  const fcdCol     = findColIdx(headers, 'FCD');
  const usdCol     = findColIdx(headers, 'USD');
  const cashCol    = findColIdx(headers, 'Cash');
  const cashResCol = findColIdx(headers, 'CashReserves');
  const port    = normSym(p.portfolio) || DEFAULT_PORT;
  const lastRow = sh.getLastRow();
  const names   = sh.getRange(2, nameCol, lastRow - 1, 1).getValues().flat().map(normSym);
  const ri      = names.indexOf(port);
  if (ri < 0) return jsonResp({ ok: false, error: 'Portfolio not found: ' + port });
  const row = ri + 2;
  const fcd = Number(p.fcd) || 0, usd = Number(p.usd) || 0;
  if (fcdCol  > 0) sh.getRange(row, fcdCol).setValue(fcd);
  if (usdCol  > 0) sh.getRange(row, usdCol).setValue(usd);
  if (cashCol > 0) sh.getRange(row, cashCol).setValue(fcd + usd); // keep Cash = FCD + USD
  if (cashResCol > 0 && p.cashRes !== undefined && p.cashRes !== '')
    sh.getRange(row, cashResCol).setValue(Number(p.cashRes) || 0);
  return jsonResp({ ok: true });
}

function addContributionAction(ss, p) {
  let sh = ss.getSheetByName('Contributions');
  if (!sh) {
    sh = ss.insertSheet('Contributions');
    sh.appendRow(['Portfolio', 'Date', 'Type', 'Amount', 'Currency', 'Note']);
  }
  sh.appendRow([p.portfolio || '', p.date || '', p.type || '', Number(p.amount) || 0, p.currency || '', p.note || '']);
  return jsonResp({ ok: true });
}

/* ── Claude sheet ─────────────────────────────────────────────────────────── */

function addSymbolAction(ss, p) {
  const sym  = normSym(p.symbol);
  const port = normSym(p.portfolio) || DEFAULT_PORT;
  if (!sym) return jsonResp({ ok: false, error: 'symbol required' });

  const sh = ss.getSheetByName('Claude');
  if (!sh) return jsonResp({ ok: false, error: 'Claude sheet not found' });
  const headers = readHeaders(sh);
  const symCol  = findColIdx(headers, 'Symbol');
  if (!symCol) return jsonResp({ ok: false, error: 'Symbol column not found' });

  if (findClaudeRow(sh, headers, sym, port) > 0)
    return jsonResp({ ok: false, error: 'Already exists: ' + sym + ' in ' + port });

  const gicsMap = _fetchGicsMap_();
  const gics = gicsMap[sym.toUpperCase()];
  if (gics) {
    if (gics.sector)      p.sector   = gics.sector;
    if (gics.subIndustry) p.industry = gics.subIndustry;
  }

  const meta = fetchYahooMetadata(sym);
  if (!p.name     && meta?.name)     p.name     = meta.name;
  if (!p.sector   && meta?.sector)   p.sector   = meta.sector;
  if (!p.industry && meta?.industry) p.industry = meta.industry;
  if (meta?.holdingsCount != null)   p.holdingsCount = meta.holdingsCount;

  const newRow = new Array(headers.length).fill('');
  const setH = (name, val) => { const c = findColIdx(headers, name); if (c > 0) newRow[c - 1] = val; };

  setH('Symbol', sym);
  setH('Portfolio', port);
  if (p.name     !== undefined && p.name     !== '') setH('Name',              p.name);
  if (p.sector   !== undefined && p.sector   !== '') setH('Sector',            p.sector);
  if (p.industry !== undefined && p.industry !== '') setH('Industry',          p.industry);
  if (p.qty      !== undefined && p.qty      !== '') setH('Qty',               Number(p.qty));
  if (p.avgPrice !== undefined && p.avgPrice !== '') setH('Avg price',         Number(p.avgPrice));
  if (p.target   !== undefined && p.target   !== '') setH('Target Allocation', Number(p.target));
  if (p.category !== undefined && p.category !== '') setH('Category',          p.category);

  sh.appendRow(newRow);

  const newRowIdx  = sh.getLastRow();
  const prevRowIdx = newRowIdx - 1;
  if (prevRowIdx >= 2) {
    ['Current price', 'Market Cap'].forEach(colName => {
      const colIdx = findColIdx(headers, colName);
      if (colIdx <= 0) return;
      const src = sh.getRange(prevRowIdx, colIdx);
      if (src.getFormula()) src.copyTo(sh.getRange(newRowIdx, colIdx), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
    });
  }

  if (String(p.sector || '').trim() !== 'ETF') {
    try { refreshReturnsForSymbol_(sym); } catch (e) { Logger.log('refreshReturnsForSymbol_ failed: ' + e); }
  }
  try { refreshCalendarForSymbol_(sym); } catch (e) { Logger.log('refreshCalendarForSymbol_ failed: ' + e); }

  return jsonResp({ status: 'ok', symbol: sym });
}

function updateSymbolAction(ss, p) {
  const sym  = normSym(p.symbol);
  const port = normSym(p.portfolio) || DEFAULT_PORT;
  if (!sym) return jsonResp({ ok: false, error: 'symbol required' });

  const sh = ss.getSheetByName('Claude');
  if (!sh) return jsonResp({ ok: false, error: 'Claude sheet not found' });
  const headers = readHeaders(sh);
  const symCol  = findColIdx(headers, 'Symbol');
  if (!symCol) return jsonResp({ ok: false, error: 'Symbol column not found' });

  let row = findClaudeRow(sh, headers, sym, port);
  if (row < 0) {
    const newRow = new Array(headers.length).fill('');
    const setH = (name, val) => { const c = findColIdx(headers, name); if (c > 0) newRow[c - 1] = val; };
    setH('Symbol', sym);
    setH('Portfolio', port);
    if (p.name     !== undefined && p.name     !== '') setH('Name',     p.name);
    if (p.sector   !== undefined && p.sector   !== '') setH('Sector',   p.sector);
    if (p.industry !== undefined && p.industry !== '') setH('Industry', p.industry);
    sh.appendRow(newRow);
    const newRowIdx  = sh.getLastRow();
    const prevRowIdx = newRowIdx - 1;
    if (prevRowIdx >= 2) {
      ['Current price', 'Market Cap'].forEach(colName => {
        const colIdx = findColIdx(headers, colName);
        if (colIdx <= 0) return;
        const src = sh.getRange(prevRowIdx, colIdx);
        if (src.getFormula()) src.copyTo(sh.getRange(newRowIdx, colIdx), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
      });
    }
    row = newRowIdx;
  }

  let categoryCol = findColIdx(headers, 'Category');
  if (!categoryCol && p.category !== undefined) {
    categoryCol = sh.getLastColumn() + 1;
    sh.getRange(1, categoryCol).setValue('Category');
    headers.push('Category');
  }

  if (p.qty      !== undefined) sh.getRange(row, findColIdx(headers, 'Qty')).setValue(Number(p.qty));
  if (p.avgPrice !== undefined) sh.getRange(row, findColIdx(headers, 'Avg price')).setValue(Number(p.avgPrice));
  if (p.target   !== undefined) sh.getRange(row, findColIdx(headers, 'Target Allocation')).setValue(Number(p.target));
  if (p.category !== undefined && categoryCol > 0) sh.getRange(row, categoryCol).setValue(p.category);

  // Custom / My Group / Sector / Industry are symbol-level tags, not per-portfolio — when the
  // user edits them, propagate to every row for this symbol across ALL portfolios, not just the
  // resolved `row`. Empty strings are written intentionally (clearing a tag), so gate on
  // `!== undefined`, not truthiness. Sector/Industry are core columns expected to already exist
  // in the header row (unlike Custom/My Group, which are optional tag columns) — don't auto-create
  // them; a missing Sector/Industry header means a malformed sheet, not a first-time tag.
  if (p.custom !== undefined || p.myGroup !== undefined || p.sector !== undefined || p.industry !== undefined) {
    let customCol = findColIdx(headers, 'Custom');
    if (!customCol && p.custom !== undefined) {
      customCol = sh.getLastColumn() + 1;
      sh.getRange(1, customCol).setValue('Custom');
      headers.push('Custom');
    }
    let myGroupCol = findColIdx(headers, 'My Group');
    if (!myGroupCol && p.myGroup !== undefined) {
      myGroupCol = sh.getLastColumn() + 1;
      sh.getRange(1, myGroupCol).setValue('My Group');
      headers.push('My Group');
    }
    const sectorCol   = findColIdx(headers, 'Sector');
    const industryCol = findColIdx(headers, 'Industry');

    const lastRow = sh.getLastRow();
    if ((customCol > 0 || myGroupCol > 0 || sectorCol > 0 || industryCol > 0) && lastRow >= 2) {
      const syms = sh.getRange(2, symCol, lastRow - 1, 1).getValues().flat();
      syms.forEach((raw, i) => {
        if (normSym(raw) !== sym) return;
        const r = i + 2;
        if (customCol   > 0 && p.custom   !== undefined) sh.getRange(r, customCol).setValue(p.custom);
        if (myGroupCol  > 0 && p.myGroup  !== undefined) sh.getRange(r, myGroupCol).setValue(p.myGroup);
        if (sectorCol   > 0 && p.sector   !== undefined) sh.getRange(r, sectorCol).setValue(p.sector);
        if (industryCol > 0 && p.industry !== undefined) sh.getRange(r, industryCol).setValue(p.industry);
      });
    }
  }

  return jsonResp({ ok: true });
}

function removeSymbolAction(ss, p) {
  const sym  = normSym(p.symbol);
  const port = normSym(p.portfolio) || DEFAULT_PORT;
  if (!sym) return jsonResp({ ok: false, error: 'symbol required' });
  const sh = ss.getSheetByName('Claude');
  if (!sh) return jsonResp({ ok: false, error: 'Claude sheet not found' });
  const headers = readHeaders(sh);
  const row = findClaudeRow(sh, headers, sym, port);
  if (row < 0) return jsonResp({ ok: false, error: 'Not found: ' + sym + ' in ' + port });
  sh.deleteRow(row);
  // Also remove any Plan row for this symbol+portfolio so no orphan plan is left behind
  const planSheet = ss.getSheetByName('Plan');
  if (planSheet) {
    const pr = findPlanRow(planSheet, sym, port);
    if (pr >= 0) planSheet.deleteRow(pr + 2);
  }
  // If the symbol has no remaining rows in Claude under any portfolio, it's fully closed —
  // remove its Calendar row too so no stale earnings/ex-div data lingers.
  const symCol  = findColIdx(headers, 'Symbol');
  const lastRow = sh.getLastRow();
  const remaining = (symCol && lastRow >= 2)
    ? sh.getRange(2, symCol, lastRow - 1, 1).getValues().flat().map(normSym)
    : [];
  if (!remaining.includes(sym)) {
    const calSheet = ss.getSheetByName('Calendar');
    if (calSheet) {
      const calSyms = calSheet.getRange(1, 1, Math.max(calSheet.getLastRow(), 1), 1).getValues().flat();
      const calRow = calSyms.findIndex(v => normSym(v) === sym);
      if (calRow > 0) calSheet.deleteRow(calRow + 1);
    }
  }
  return jsonResp({ status: 'ok' });
}

/* ── Transfer shares between portfolios (no cash change, no realized P&L) ──── */

function appendTransferTxn(sheet, type, ticker, shares, price, portfolio) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Date','Time','Type','Ticker','Shares','Price_Per_Share','Trade_Value','Com','Tax','Trade_Value+Fee','Commission_Free','Portfolio']);
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
  }
  const row  = sheet.getLastRow() + 1;
  const date = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const time = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'HH:mm:ss');
  sheet.getRange(row, 1, 1, 7).setValues([[date, time, type, ticker, Number(shares), Number(price), Number(shares) * Number(price)]]);
  sheet.getRange(row, 8, 1, 3).setValues([[0, 0, 0]]); // no fees on a transfer
  sheet.getRange(row, 11).setValue(true);
  sheet.getRange(row, 12).setValue(portfolio || DEFAULT_PORT);
}

function transferSharesAction(ss, p) {
  const sym  = normSym(p.symbol);
  const from = normSym(p.fromPortfolio) || DEFAULT_PORT;
  const to   = normSym(p.toPortfolio)   || DEFAULT_PORT;
  const sh_  = Number(p.shares) || 0;
  const px   = Number(p.price)  || 0;
  if (!sym || sh_ <= 0 || from === to) return jsonResp({ ok: false, error: 'bad transfer args' });

  const sh = ss.getSheetByName('Claude');
  if (!sh) return jsonResp({ ok: false, error: 'Claude sheet not found' });
  const headers = readHeaders(sh);
  const qtyCol  = findColIdx(headers, 'Qty');
  const avgCol  = findColIdx(headers, 'Avg price');
  const symCol  = findColIdx(headers, 'Symbol');
  const portCol = findColIdx(headers, 'Portfolio');

  // 1. Decrement / remove source row
  const fromRow = findClaudeRow(sh, headers, sym, from);
  if (fromRow > 0) {
    const q0 = Number(sh.getRange(fromRow, qtyCol).getValue()) || 0;
    const nq = q0 - sh_;
    if (nq <= 1e-6) sh.deleteRow(fromRow);
    else sh.getRange(fromRow, qtyCol).setValue(nq);
  }

  // 2. Increment / create destination row (re-find — indices may have shifted after a delete)
  const toRow = findClaudeRow(sh, headers, sym, to);
  if (toRow > 0) {
    const q0 = Number(sh.getRange(toRow, qtyCol).getValue()) || 0;
    const a0 = Number(sh.getRange(toRow, avgCol).getValue()) || 0;
    const nq = q0 + sh_;
    const na = nq > 0 ? (q0 * a0 + sh_ * px) / nq : px;
    sh.getRange(toRow, qtyCol).setValue(nq);
    sh.getRange(toRow, avgCol).setValue(na);
  } else {
    const anyRow = findClaudeRow(sh, headers, sym, from); // may be -1 if source was deleted
    const newRow = new Array(headers.length).fill('');
    if (anyRow > 0) {
      const src = sh.getRange(anyRow, 1, 1, headers.length).getValues()[0];
      ['Name','Sector','Industry','Category'].forEach(c => { const i = findColIdx(headers, c); if (i > 0) newRow[i - 1] = src[i - 1]; });
    }
    newRow[symCol - 1] = sym;
    newRow[qtyCol - 1] = sh_;
    newRow[avgCol - 1] = px;
    if (portCol > 0) newRow[portCol - 1] = to;
    sh.appendRow(newRow);
  }

  // 3. Write the Transfer-Out / Transfer-In pair
  const tx = getTxnSheet(ss);
  appendTransferTxn(tx, 'Transfer-Out', sym, sh_, px, from);
  appendTransferTxn(tx, 'Transfer-In',  sym, sh_, px, to);
  return jsonResp({ ok: true });
}

/* ── Plan sheet ───────────────────────────────────────────────────────────── */

const PLAN_HDR =
['Symbol','SL','Note','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','T13','TP1','TP2','TP3','Portfolio'];

function getOrCreatePlanSheet(ss) {
  const existed = !!ss.getSheetByName('Plan');
  const planSheet = ss.getSheetByName('Plan') || ss.insertSheet('Plan');
  const existingHdr = planSheet.getLastRow() > 0
    ? planSheet.getRange(1, 1, 1, PLAN_HDR.length).getValues()[0] : [];
  let headerChanged = false;
  if (existingHdr[0] !== 'Symbol') {
    if (planSheet.getLastRow() > 0) planSheet.insertRowsBefore(1, 1);
    planSheet.getRange(1, 1, 1, PLAN_HDR.length).setValues([PLAN_HDR]).setFontWeight('bold');
    headerChanged = true;
  } else if (existingHdr[PLAN_HDR.length - 1] !== 'Portfolio') {
    planSheet.getRange(1, 1, 1, PLAN_HDR.length).setValues([PLAN_HDR]).setFontWeight('bold');
    headerChanged = true;
  }
  if (!existed || headerChanged) {
    planSheet.getRange(1, 17, planSheet.getMaxRows(), 3).setNumberFormat('@');
    planSheet.getRange(1, 4,  planSheet.getMaxRows(), 13).setNumberFormat('@');
  }
  return planSheet;
}

function findPlanRow(planSheet, sym, port) {
  const lastRow = planSheet.getLastRow();
  if (lastRow < 2) return -1;
  const want = normSym(port) || DEFAULT_PORT;
  const data = planSheet.getRange(2, 1, lastRow - 1, PLAN_HDR.length).getValues();
  for (let r = data.length - 1; r >= 0; r--) {
    const rowPort = normSym(data[r][19]) || DEFAULT_PORT; // col 20 = Portfolio
    if (String(data[r][0]).trim() === sym && rowPort === want) return r;
  }
  return -1;
}

function savePlanAction(ss, p) {
  const planSheet = getOrCreatePlanSheet(ss);
  const sym  = normSym(p.symbol);
  const port = normSym(p.portfolio) || DEFAULT_PORT;
  if (!sym) return jsonResp({ ok: false, error: 'symbol required' });

  const slParsed = parseFloat(p.sl);
  const slVal    = (p.sl != null && p.sl !== '' && Number.isFinite(slParsed)) ? slParsed : '';
  const noteVal  = p.note || '';
  const trancheStr = p.tranches || '';
  const trancheArr = trancheStr ? trancheStr.split(',') : [];

  const isEmpty = !trancheStr && slVal === '' && !noteVal && !p.tp1 && !p.tp2 && !p.tp3;
  if (isEmpty) {
    const r = findPlanRow(planSheet, sym, port);
    if (r >= 0) planSheet.deleteRow(r + 2);
    return jsonResp({ ok: true });
  }

  const rowVals = new Array(PLAN_HDR.length).fill('');
  rowVals[0] = sym;
  rowVals[1] = slVal;
  rowVals[2] = noteVal;
  for (let i = 0; i < Math.min(trancheArr.length, 13); i++) rowVals[3 + i] = trancheArr[i];
  rowVals[16] = p.tp1 || '';
  rowVals[17] = p.tp2 || '';
  rowVals[18] = p.tp3 || '';
  rowVals[19] = port; // Portfolio (last column)

  const ri = findPlanRow(planSheet, sym, port);
  const targetRow = ri >= 0 ? ri + 2 : planSheet.getLastRow() + 1;
  planSheet.getRange(targetRow, 4, 1, 16).setNumberFormat('@'); // T1..TP3 text
  planSheet.getRange(targetRow, 1, 1, PLAN_HDR.length).setValues([rowVals]);
  return jsonResp({ ok: true });
}

function clearPlanAction(ss, p) {
  const planSheet = ss.getSheetByName('Plan');
  if (!planSheet) return jsonResp({ ok: true });
  const sym  = normSym(p.symbol);
  const port = normSym(p.portfolio) || DEFAULT_PORT;
  if (!sym) return jsonResp({ ok: false, error: 'symbol required' });
  const r = findPlanRow(planSheet, sym, port);
  if (r >= 0) planSheet.deleteRow(r + 2);
  return jsonResp({ ok: true });
}

/* ── transactions sheet ───────────────────────────────────────────────────── */

function getTxnSheet(ss) {
  const sh = ss.getSheetByName('transactions');
  if (!sh) throw new Error('transactions sheet not found');
  return sh;
}

function writeTxnRow(sheet, row, p) {
  sheet.getRange(row, 1, 1, 7).setValues([[
    p.date, p.time, p.type, p.ticker,
    Number(p.shares), Number(p.price), Number(p.tradeValue)
  ]]);
  sheet.getRange(row, 11).setValue(p.commissionFree === 'TRUE');
  sheet.getRange(row, 12).setValue(p.portfolio || DEFAULT_PORT); // Portfolio
  sheet.getRange(row, 8, 1, 3).setFormulas([[
    `=IF(K${row}=TRUE,0,G${row}*0.15%)`,
    `=H${row}*7%`,
    `=IF(C${row}="Buy",G${row}+H${row}+I${row},G${row}-H${row}-I${row})`
  ]]);
}

function deleteTxnAction(ss, p) {
  const sheet = getTxnSheet(ss);
  const row = parseInt(p.row, 10);
  if (!Number.isFinite(row) || row < 2 || row > sheet.getLastRow()) return jsonResp({ ok: false, error: 'invalid row' });
  sheet.deleteRow(row);
  return jsonResp({ ok: true });
}

function updateTxnAction(ss, p) {
  const sheet = getTxnSheet(ss);
  const row = parseInt(p.row, 10);
  if (!Number.isFinite(row) || row < 2 || row > sheet.getLastRow()) return jsonResp({ ok: false, error: 'invalid row' });
  writeTxnRow(sheet, row, p);
  return jsonResp({ ok: true });
}

// The client records a transaction with a no-cors GET, which the browser/network layer will
// silently re-send if the connection drops — and this is the only additive write in the app
// (holdings/cash writes send absolute values, so they self-heal). Guard it on the transaction's
// own content: Date+Time carries seconds and is frozen when the modal opens, so a re-send has an
// identical key while a genuine repeat trade (modal reopened) never does. The lock serializes the
// getLastRow()/write pair, which would otherwise let two concurrent appends target the same row.
function appendTxnAction(ss, p) {
  const key   = 'txdup:' + [p.date, p.time, p.type, p.ticker, p.shares, p.price,
                            p.portfolio || DEFAULT_PORT].join('|');
  const cache = CacheService.getScriptCache();
  const lock  = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return jsonResp({ ok: false, error: 'busy' });
  try {
    if (cache.get(key)) return jsonResp({ ok: true, duplicate: true });
    const sheet = getTxnSheet(ss);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Date','Time','Type','Ticker','Shares',
        'Price_Per_Share','Trade_Value','Com','Tax','Trade_Value+Fee','Commission_Free','Portfolio']);
      sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
    }
    const row = sheet.getLastRow() + 1;
    writeTxnRow(sheet, row, p);
    SpreadsheetApp.flush();   // commit before releasing, so the next holder sees the new lastRow
    cache.put(key, '1', 600); // 10 min — long enough to cover any retry window
    return jsonResp({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

/* ── history fetch (unchanged) ────────────────────────────────────────────── */

function fetchHistoryAction(ss, p) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  if (!p)  p  = {};

  const histSheet = ss.getSheetByName('History');
  if (!histSheet) return jsonResp({ error: 'History sheet not found' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return jsonResp({ status: 'locked', rows: 0 });

  try {
    if (histSheet.getLastRow() === 0) {
      histSheet.appendRow(['Date', 'Ticker', 'Close', 'Dividend']);
      histSheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    }

    const tickers  = (p.tickers || '').split(',').map(t => t.trim()).filter(Boolean);
    const fromDate = p.from || '2020-01-01';

    const lastSaved = {};
    const existing  = new Set();
    const lastRow   = histSheet.getLastRow();

    if (lastRow > 1) {
      const data = histSheet.getRange(2, 1, lastRow - 1, 4).getValues();
      const cleanRows = [];
      for (const [rawDate, ticker, close, div] of data) {
        if (!ticker) continue;
        const d = rawDate instanceof Date
          ? Utilities.formatDate(rawDate, 'UTC', 'yyyy-MM-dd')
          : String(rawDate).slice(0, 10);
        const rowType = (close !== '' && close != null) ? 'c' : 'd';
        const key = ticker + ':' + d + ':' + rowType;
        if (!existing.has(key)) {
          existing.add(key);
          cleanRows.push([rawDate, ticker, close, div]);
          if (!lastSaved[ticker] || d > lastSaved[ticker]) lastSaved[ticker] = d;
        }
      }
      if (cleanRows.length < lastRow - 1) {
        Logger.log('Removing ' + (lastRow - 1 - cleanRows.length) + ' duplicate rows');
        histSheet.deleteRows(2, lastRow - 1);
        if (cleanRows.length > 0) histSheet.getRange(2, 1, cleanRows.length, 4).setValues(cleanRows);
      }
    }

    const todayStr = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
    const nowSec   = Math.floor(Date.now() / 1000);

    const fetchTargets = [];
    for (const ticker of tickers) {
      if (lastSaved[ticker] && lastSaved[ticker] >= todayStr) { Logger.log(ticker + ' already up to date'); continue; }
      const startDate = lastSaved[ticker]
        ? new Date(new Date(lastSaved[ticker]).getTime() + 86400000)
        : new Date(fromDate);
      const p1 = Math.floor(startDate.getTime() / 1000);
      if (p1 >= nowSec) continue;
      fetchTargets.push({
        ticker,
        request: {
          url: 'https://query1.finance.yahoo.com/v8/finance/chart/'
            + encodeURIComponent(ticker.replace(/\./g, '-'))
            + '?period1=' + p1 + '&period2=' + nowSec + '&interval=1d&events=div',
          muteHttpExceptions: true,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          }
        }
      });
    }

    const newRows = [];
    if (fetchTargets.length > 0) {
      let responses;
      try { responses = UrlFetchApp.fetchAll(fetchTargets.map(t => t.request)); }
      catch (err) { Logger.log('fetchAll error: ' + err); responses = []; }

      for (let i = 0; i < responses.length; i++) {
        const ticker = fetchTargets[i].ticker;
        try {
          const code = responses[i].getResponseCode();
          if (code !== 200) { Logger.log(ticker + ' HTTP ' + code); continue; }
          const result = JSON.parse(responses[i].getContentText())?.chart?.result?.[0];
          if (!result) { Logger.log(ticker + ' => no result'); continue; }

          const ts     = result.timestamp || [];
          const closes = result.indicators?.quote?.[0]?.close || [];
          const divs   = result.events?.dividends || {};

          for (let j = 0; j < ts.length; j++) {
            if (closes[j] == null) continue;
            const d   = Utilities.formatDate(new Date(ts[j] * 1000), 'UTC', 'yyyy-MM-dd');
            const key = ticker + ':' + d + ':c';
            if (!existing.has(key)) { newRows.push([d, ticker, closes[j], '']); existing.add(key); }
          }
          for (const div of Object.values(divs)) {
            if (!div || !div.date) continue;
            const d   = Utilities.formatDate(new Date(div.date * 1000), 'UTC', 'yyyy-MM-dd');
            const key = ticker + ':' + d + ':d';
            if (!existing.has(key)) { newRows.push([d, ticker, '', div.amount]); existing.add(key); }
          }
        } catch (err) { Logger.log('Parse exception for ' + ticker + ': ' + err); }
      }
    }

    if (newRows.length > 0) {
      newRows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : 1)));
      histSheet.getRange(histSheet.getLastRow() + 1, 1, newRows.length, 4).setValues(newRows);
    }

    return jsonResp({ status: 'ok', rows: newRows.length });
  } finally {
    lock.releaseLock();
  }
}

function getYahooCrumb() {
  const hdrs = { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' };
  const r1 = UrlFetchApp.fetch('https://fc.yahoo.com/', { muteHttpExceptions: true, headers: hdrs });
  const raw = r1.getAllHeaders()['Set-Cookie'];
  const cookieStr = raw ? (Array.isArray(raw) ? raw : [raw]).map(c => c.split(';')[0]).join('; ') : '';
  const r2 = UrlFetchApp.fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    muteHttpExceptions: true, headers: { ...hdrs, 'Cookie': cookieStr }
  });
  if (r2.getResponseCode() !== 200) throw new Error('crumb HTTP ' + r2.getResponseCode());
  return { crumb: r2.getContentText().trim(), cookieStr };
}

function fetchYahooMetadata(sym) {
  try {
    const { crumb, cookieStr } = getYahooCrumb();
    const ySym = sym.replace(/\./g, '-');
    const url  = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/'
      + encodeURIComponent(ySym) + '?modules=assetProfile,quoteType,defaultKeyStatistics&crumb=' + encodeURIComponent(crumb);
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Cookie': cookieStr }
    });
    if (resp.getResponseCode() !== 200) return null;
    const result = JSON.parse(resp.getContentText())?.quoteSummary?.result?.[0];
    if (!result) return null;
    const profile  = result.assetProfile || {};
    const qt       = result.quoteType    || {};
    const stats    = result.defaultKeyStatistics || {};
    const isEquity = qt.quoteType === 'EQUITY';
    return {
      name:           qt.longName || qt.shortName || '',
      sector:         isEquity ? (profile.sector   || '') : 'ETF',
      industry:       isEquity ? (profile.industry || '') : '',
      holdingsCount:  stats.holdings?.raw ?? null
    };
  } catch (err) {
    Logger.log('fetchYahooMetadata failed for ' + sym + ': ' + err);
    return null;
  }
}

const ETF_SECTOR_NAMES = {
  realestate: 'Real Estate',
  consumer_cyclical: 'Consumer Cyclical',
  basic_materials: 'Basic Materials',
  consumer_defensive: 'Consumer Defensive',
  technology: 'Technology',
  communication_services: 'Communication Services',
  financial_services: 'Financial Services',
  utilities: 'Utilities',
  industrials: 'Industrials',
  energy: 'Energy',
  healthcare: 'Healthcare',
};

function fetchHoldingsAction(p) {
  const num = (x) => x == null ? null : typeof x === 'number' ? x : typeof x === 'object' && typeof x.raw === 'number' ? x.raw : null;
  const raw = (p.symbols || '').toString();
  const syms = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 30);
  if (!syms.length) return jsonResp({ ok: false, error: 'symbols required' });

  let crumb, cookieStr;
  try { ({ crumb, cookieStr } = getYahooCrumb()); }
  catch (err) { return jsonResp({ ok: false, error: 'crumb failed: ' + err }); }

  const fetchOpts = { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Cookie': cookieStr } };

  // 1. quoteSummary for volume, averages, yield, net assets, ytd return
  const summaryReqs = syms.map(sym => ({
    ...fetchOpts,
    url: 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/'
      + encodeURIComponent(sym.replace(/\./g, '-')) + '?modules=defaultKeyStatistics,fundProfile,summaryDetail,fundPerformance,topHoldings&crumb=' + encodeURIComponent(crumb)
  }));
  // 2. v7/quote for expense ratio (annualReportExpenseRatio) — not in quoteSummary
  const v7Req = [{
    ...fetchOpts,
    url: 'https://query1.finance.yahoo.com/v7/finance/quote?symbols='
      + syms.map(s => encodeURIComponent(s.replace(/\./g, '-'))).join(',') + '&crumb=' + encodeURIComponent(crumb)
  }];

  let summaryResps, v7Resp;
  try { const all = UrlFetchApp.fetchAll([...summaryReqs, ...v7Req]); summaryResps = all.slice(0, syms.length); v7Resp = all[syms.length]; }
  catch (err) { return jsonResp({ ok: false, error: 'fetchAll failed: ' + err }); }

  // Parse v7/quote for expense ratio + ytdReturn (same fields ETFbuilder uses)
  const v7Data = {};
  try {
    if (v7Resp.getResponseCode() === 200) {
      const items = JSON.parse(v7Resp.getContentText())?.quoteResponse?.result || [];
      items.forEach(q => {
        v7Data[q.symbol.replace(/-/g, '.')] = {
          expenseRatio: q.annualReportExpenseRatio ?? null,
          ytdReturn: q.ytdReturn != null ? q.ytdReturn / 100 : null,
        };
      });
    }
  } catch {}

  const results = {};
  for (let i = 0; i < syms.length; i++) {
    const sym = syms[i];
    if (summaryResps[i].getResponseCode() !== 200) { results[sym] = null; continue; }
    try {
      const r = JSON.parse(summaryResps[i].getContentText())?.quoteSummary?.result?.[0];
      if (!r) { results[sym] = null; continue; }
      const stats   = r.defaultKeyStatistics || {};
      const profile = r.fundProfile || {};
      const detail  = r.summaryDetail || {};
      const fees    = profile.feesExpensesInvestment || {};
      const trailing = r.fundPerformance?.trailingReturns || {};
      const topH = (r.topHoldings?.holdings || []).map(h => ({
        symbol: (h.symbol || '').replace(/-/g, '.'),
        name:   h.holdingName || '',
        weight: num(h.holdingPercent) || 0
      })).filter(h => h.symbol && h.weight > 0);
      let topSector = null, topSectorW = 0;
      for (const sw of (r.topHoldings?.sectorWeightings || [])) {
        for (const k in sw) {
          const w = num(sw[k]) || 0;
          if (w > topSectorW) { topSectorW = w; topSector = ETF_SECTOR_NAMES[k] || null; }
        }
      }
      results[sym] = {
        holdingsCount:        null,
        topSector,
        netAssets:            num(detail.totalAssets) ?? num(stats.totalAssets),
        ytdReturn:            (v7Data[sym]?.ytdReturn) ?? num(stats.ytdReturn),
        expenseRatio:         num(fees.netExpenseRatio) ?? num(stats.annualReportExpenseRatio) ?? (v7Data[sym]?.expenseRatio ?? null),
        volume:               num(detail.regularMarketVolume) ?? num(detail.volume),
        fiftyDayAverage:      num(detail.fiftyDayAverage),
        twoHundredDayAverage: num(detail.twoHundredDayAverage),
        dividendYield:        num(detail.trailingAnnualDividendYield) ?? num(detail.yield),
        trailingReturns: {
          '1M':  num(trailing.oneMonth),
          '3M':  num(trailing.threeMonth),
          '1Y':  num(trailing.oneYear),
          '3Y':  num(trailing.threeYear),
          '5Y':  num(trailing.fiveYear),
        },
        topHoldings: topH.length ? topH : null,
      };
    } catch { results[sym] = null; }
  }

  // 3. stockanalysis.com for holdings count + top holdings list
  for (const sym of syms) {
    if (!results[sym]) continue;
    try {
      const saUrl = 'https://stockanalysis.com/etf/' + sym.toLowerCase() + '/holdings/';
      const resp = UrlFetchApp.fetch(saUrl, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
      if (resp.getResponseCode() !== 200) continue;
      const html = resp.getContentText();
      let count = null;
      let m = html.match(/total of ([\d,]+) individual holdings/i);
      if (m) count = parseInt(m[1].replace(/,/g, ''));
      if (!count) { m = html.match(/Showing \d+ of ([\d,]+) holdings/i); if (m) count = parseInt(m[1].replace(/,/g, '')); }
      if (count) results[sym].holdingsCount = count;

      // Parse individual stock holdings from the table
      const saHoldings = [];
      const trBlocks = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      for (const tr of trBlocks) {
        if (saHoldings.length >= 20) break;
        const linkMatch = tr.match(/href="\/stocks\/([^"\/]+)\/"/i);
        if (!linkMatch) continue;
        const wtMatch = tr.match(/>(\d+\.\d+)%</);
        if (!wtMatch) continue;
        const tds = [];
        const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let tdm;
        while ((tdm = tdRe.exec(tr))) tds.push(tdm[1].replace(/<[^>]+>/g, '').trim());
        const ticker = linkMatch[1].toUpperCase().replace(/-/g, '.');
        saHoldings.push({
          symbol: ticker,
          name: tds[2] || ticker,
          weight: parseFloat(wtMatch[1]) / 100
        });
      }
      if (saHoldings.length > (results[sym].topHoldings?.length || 0)) {
        results[sym].topHoldings = saHoldings;
      }
    } catch {}
  }

  return jsonResp({ ok: true, etfData: results });
}

function fetchStockSectorsAction(p) {
  const raw = (p.symbols || '').toString();
  const syms = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 30);
  if (!syms.length) return jsonResp({ ok: false, error: 'symbols required' });

  const fetchOpts = { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } };
  const reqs = syms.map(sym => ({
    ...fetchOpts,
    url: 'https://stockanalysis.com/stocks/' + sym.toLowerCase().replace(/\./g, '-') + '/'
  }));

  let resps;
  try { resps = UrlFetchApp.fetchAll(reqs); }
  catch (err) { return jsonResp({ ok: false, error: 'fetchAll failed: ' + err }); }

  const sectors = {};
  for (let i = 0; i < syms.length; i++) {
    if (resps[i].getResponseCode() !== 200) continue;
    try {
      const html = resps[i].getContentText();
      let sector = '';
      let industry = '';
      const sectorMatch = html.match(/href="\/stocks\/sector\/([^/"]+)\/"[^>]*>([^<]+)<\/a>/);
      if (sectorMatch) sector = sectorMatch[2].trim();
      const industryMatch = html.match(/href="\/stocks\/sector\/[^/"]+\/([^/"]+)\/"[^>]*>([^<]+)<\/a>/);
      if (industryMatch) industry = industryMatch[2].trim();
      if (sector || industry) sectors[syms[i]] = { sector, industry };
    } catch {}
  }

  return jsonResp({ ok: true, sectors });
}

// Webapp pings these two actions on every init() (see index.html). Each rescans the sheet for
// gaps itself and self-gates via a per-symbol Script Properties cooldown, so repeated pings from
// auto-refresh don't hammer Yahoo/FMP for a symbol that just failed.
const BACKFILL_COOLDOWN_MS = 10 * 60 * 1000;

function _backfillCooldownActive_(key) {
  const last = Number(PropertiesService.getScriptProperties().getProperty(key));
  return last && (Date.now() - last) < BACKFILL_COOLDOWN_MS;
}
function _setBackfillCooldown_(key) {
  PropertiesService.getScriptProperties().setProperty(key, String(Date.now()));
}

// Finds Claude-sheet rows with a blank Name (Sector/Industry are best-effort — some symbols
// legitimately never return an industry, so only Name blank counts as "needs a re-fetch").
function backfillMetadataAction(ss, p) {
  const sh      = ss.getSheetByName('Claude');
  const headers = readHeaders(sh);

  const symCol      = findColIdx(headers, 'Symbol');
  const nameCol     = findColIdx(headers, 'Name');
  const sectorCol   = findColIdx(headers, 'Sector');
  const industryCol = findColIdx(headers, 'Industry');
  if (!symCol || !nameCol) return jsonResp({ ok: true, checked: 0, updated: 0, skipped: 0 });

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return jsonResp({ ok: true, checked: 0, updated: 0, skipped: 0 });

  const symCol_  = sh.getRange(2, symCol,  lastRow - 1, 1).getValues().flat();
  const nameCol_ = sh.getRange(2, nameCol, lastRow - 1, 1).getValues().flat();

  const rowsBySymbol = {}; // symbol -> [1-based sheet rows] where Name is blank
  symCol_.forEach((raw, i) => {
    const sym = normSym(raw);
    if (!sym || String(nameCol_[i] || '').trim()) return;
    (rowsBySymbol[sym] || (rowsBySymbol[sym] = [])).push(i + 2);
  });

  const allBlank = Object.keys(rowsBySymbol);
  if (!allBlank.length) return jsonResp({ ok: true, checked: 0, updated: 0, skipped: 0 });

  const symbols = allBlank.filter(sym => !_backfillCooldownActive_('lastAttempt:NAME:' + sym));
  const skipped = allBlank.length - symbols.length;
  if (!symbols.length) return jsonResp({ ok: true, checked: allBlank.length, updated: 0, skipped });

  let crumb, cookieStr;
  try { ({ crumb, cookieStr } = getYahooCrumb()); }
  catch (err) {
    symbols.forEach(sym => _setBackfillCooldown_('lastAttempt:NAME:' + sym));
    return jsonResp({ ok: false, error: 'crumb failed: ' + err, checked: allBlank.length, updated: 0, skipped });
  }

  const fetchOpts = { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Cookie': cookieStr } };
  const requests = symbols.map(sym => ({
    ...fetchOpts,
    url: 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/'
      + encodeURIComponent(sym.replace(/\./g, '-')) + '?modules=assetProfile,quoteType&crumb=' + encodeURIComponent(crumb)
  }));

  let responses;
  try { responses = UrlFetchApp.fetchAll(requests); }
  catch (err) {
    symbols.forEach(sym => _setBackfillCooldown_('lastAttempt:NAME:' + sym));
    return jsonResp({ ok: false, error: 'fetchAll failed: ' + err, checked: allBlank.length, updated: 0, skipped });
  }

  let updated = 0;
  for (let i = 0; i < symbols.length; i++) {
    const sym  = symbols[i];
    const rows = rowsBySymbol[sym];
    const code = responses[i].getResponseCode();
    if (code !== 200) { _setBackfillCooldown_('lastAttempt:NAME:' + sym); continue; }
    try {
      const result = JSON.parse(responses[i].getContentText())?.quoteSummary?.result?.[0];
      const profile  = result?.assetProfile || {};
      const qt       = result?.quoteType    || {};
      const isEquity = qt.quoteType === 'EQUITY';
      const nameVal   = qt.longName || qt.shortName || '';
      const sectorVal = isEquity ? (profile.sector   || '') : 'ETF';
      const indVal    = isEquity ? (profile.industry || '') : '';
      if (!nameVal) { _setBackfillCooldown_('lastAttempt:NAME:' + sym); continue; }
      rows.forEach(row => {
        sh.getRange(row, nameCol).setValue(nameVal);
        if (sectorCol > 0 && sectorVal) {
          const curSector = String(sh.getRange(row, sectorCol).getValue() || '').trim();
          if (!curSector) sh.getRange(row, sectorCol).setValue(sectorVal);
        }
        if (industryCol > 0 && indVal) {
          const curIndustry = String(sh.getRange(row, industryCol).getValue() || '').trim();
          if (!curIndustry) sh.getRange(row, industryCol).setValue(indVal);
        }
      });
      updated++;
    } catch (err) { _setBackfillCooldown_('lastAttempt:NAME:' + sym); }
  }
  return jsonResp({ ok: true, checked: allBlank.length, updated, skipped });
}

// Finds Claude-sheet symbols (non-ETF) missing from the Returns sheet and fetches just those —
// bridges gaps left when refreshReturnsForSymbol_() failed at add-time.
function backfillReturnsAction(ss, p) {
  const claudeData = ss.getSheetByName('Claude').getDataRange().getValues();
  const headers = claudeData[0].map(h => String(h).trim());
  const sectorCol = headers.indexOf('Sector');
  const claudeSyms = [...new Set(claudeData.slice(1)
    .filter(r => {
      const sym = String(r[0]).trim();
      const sector = sectorCol >= 0 ? String(r[sectorCol]).trim() : '';
      return sym && sym !== 'Symbol' && sector !== 'ETF';
    })
    .map(r => String(r[0]).trim()))];
  if (!claudeSyms.length) return jsonResp({ ok: true, checked: 0, updated: 0, skipped: 0 });

  let sh = ss.getSheetByName('Returns');
  if (!sh) { sh = ss.insertSheet('Returns'); sh.appendRow(['Symbol', '1M', '3M', 'YTD', '1Y', '3Y', '5Y', 'UpdatedAt']); }
  const existing = new Set(
    sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 0), 1).getValues().flat().map(v => String(v).trim())
  );

  const allMissing = claudeSyms.filter(s => !existing.has(s));
  if (!allMissing.length) return jsonResp({ ok: true, checked: 0, updated: 0, skipped: 0 });

  const missing = allMissing.filter(sym => !_backfillCooldownActive_('lastAttempt:RET:' + sym));
  const skipped = allMissing.length - missing.length;
  if (!missing.length) return jsonResp({ ok: true, checked: allMissing.length, updated: 0, skipped });

  const reqs = missing.map(sym => ({ url: _yahooChartUrl_(sym), muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } }));

  let resps;
  try { resps = UrlFetchApp.fetchAll(reqs); }
  catch (e) {
    missing.forEach(sym => _setBackfillCooldown_('lastAttempt:RET:' + sym));
    return jsonResp({ ok: false, error: 'fetchAll failed: ' + e, checked: allMissing.length, updated: 0, skipped });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const rows = [];
  for (let i = 0; i < missing.length; i++) {
    const sym = missing[i];
    let d = null;
    if (resps[i].getResponseCode() === 200) {
      let result;
      try { result = JSON.parse(resps[i].getContentText())?.chart?.result?.[0]; } catch {}
      if (result) d = _computeReturnsFromChart_(result);
    }
    if (!d) { _setBackfillCooldown_('lastAttempt:RET:' + sym); continue; }
    rows.push([
      sym,
      d['1M'] ?? '', d['3M'] ?? '', d.ytd ?? '',
      d['1Y'] ?? '', d['3Y'] ?? '', d['5Y'] ?? '',
      nowSec
    ]);
  }
  rows.forEach(row => sh.appendRow(row));
  return jsonResp({ ok: true, checked: allMissing.length, updated: rows.length, skipped });
}

function authorize() {
  UrlFetchApp.fetch('https://www.google.com');
}
