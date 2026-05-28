# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The App
Single-file HTML portfolio tracker: `index.html` (no build step, no npm, no framework).
External dependencies via CDN:
- Chart.js 4.4.1
- Lightweight Charts 4.2.0 (TradingView — used for per-symbol price chart in modal)

Open directly in browser or host on GitHub Pages.

## Working Style
- Use **Opus** (model:opus via Plan agent) for planning/architecture decisions only.
- Use **Sonnet** (default) for all coding and implementation.

## Running Locally
```
python -m http.server 8000
```
Open `http://localhost:8000`. No build step needed.

## File Structure
Everything is in `index.html`:
- CSS (top `<style>` block)
- HTML shell built by `buildShell()` JS function
- All JavaScript inline at the bottom

## Data Sources

**Google Sheets (read-only via gviz/tq JSON API):**
- Portfolio: `sheet=Claude` — columns: Symbol, Name, Sector, Industry, Category, Qty, Avg price, Target Allocation, Current price, Cash, Cash Reserves
- Transactions: `sheet=transactions`
- Plan data: `sheet=Plan` — columns: Symbol, SL, Note, T1…T13, TP1…TP3
- Price history cache: `sheet=History`
- Earnings calendar: `sheet=Calendar`
- Live quotes cache: `sheet=Quotes` — columns: Symbol, Price, Change, ChangePct, UpdatedAt (Unix seconds). Written by `refreshQuotes()` trigger every minute during market hours. Only rows where Finnhub returned `price > 0` are written — absent rows mean Finnhub had no data for that symbol.

**Google Apps Script (write operations + quote refresh):**
- `RECORD_URL` = Apps Script web app (`doGet`)
- Actions: `addSymbol`, `updateSymbol`, `removeSymbol`, `updateCash`, `savePlan`, `clearPlan`, `fetchHistory`
- All write calls go through `recordFetch(params)` which injects `_WRITE_KEY` automatically
- `addSymbol` fetches Name/Sector/Industry server-side via `fetchYahooMetadata()` (Yahoo quoteSummary + crumb) — no client-side metadata fetch needed
- `getYahooCrumb()` returns `{ crumb, cookieStr }` — acquires Yahoo Finance session cookie + crumb; required for quoteSummary and v7/quote from Apps Script. **Property is `cookieStr`, not `cookie`.**
- `backfillMetadata()` — one-time function (run from Apps Script editor) to populate Name/Sector/Industry for existing symbols
- `refreshQuotes()` — time-triggered (every 1 min, market hours only via `isMarketOpenET_()`). Fetches portfolio symbols from Finnhub (split across two API keys via `fetchAll`), index symbols (`^GSPC`, `^IXIC`, `^RUT`) from Yahoo v7/quote with crumb. Writes to `Quotes` sheet atomically (single `setValues`, trims leftover rows). `KEY1`/`KEY2` are Finnhub API keys hardcoded at top of script.

**Live quotes — two-path routing:**
- **Market hours (Mon–Fri 9:30–16:00 ET):** `fetchQuotes` reads from the `Quotes` sheet tab (written every minute by Apps Script `refreshQuotes` via Finnhub). Symbols missing from the sheet (e.g. index symbols) fall back to a Yahoo browser call. Non-market hours always use Yahoo.
- **Yahoo path:** v7/quote batch for all symbols, v8/chart per-symbol as final fallback. CORS via corsproxy.io fallback. Pre/post-market prices included.
- Ticker mapping: `yahooTicker(s)` converts `.` → `-` (e.g. `BRK.B` → `BRK-B`)
- `_staticQuoteCache` — in-memory cache of 52W/earnings fields from the last Yahoo call; merged into sheet quotes so those fields persist across market-hours refreshes
- `_lastQuoteSource` — `{ type: 'sheet'|'yahoo', updatedAt? }` — drives the "prices Xs ago" freshness badge (`id="quotesFreshness"` in header)

## Key Architecture
```
parseRows(table)       → raw rows from gviz JSON — reads: symbol, name, sector, industry, category, qty, avgPrice, target, price, cash, cashRes, fcd, usd
buildModel(rows)       → { positions[], watchlist[], sgovPos, rawCash, rawFcd, rawUsd,
                           sgovValue, cashResPct, totalCash, totalCurrent, investable,
                           totalInvested, totalPnl, totalPnlPct }
fetchQuotes(symbols)   → during market hours reads Quotes sheet via fetchSheetQuotes(); symbols
                           with price > 0 used directly, others fall through to fetchYahooBatch().
                           Outside market hours calls fetchYahooBatch(symbols) directly.
                           Attaches dayChange, dayChangePct, preMarketPrice, postMarketPrice,
                           week52High, week52Low to each position via attachQuotes().
fetchSheetQuotes()     → reads Quotes sheet gviz; returns null if stale (>3 min by UpdatedAt) or missing columns
fetchYahooBatch(syms)  → Yahoo v7/quote batch; populates _staticQuoteCache with 52W/earnings fields
currentModel           → global reference used by all render functions
planCache              → { sym: { tranches[], sl, note, trimTranches[] } } — loaded from Plan sheet at startup
historyCache           → { prices: { sym: { dateStr: close } }, dividends: { sym: { dateStr: amount } } }
                         In-memory only (not localStorage). Populated from History sheet at init().
                         Yahoo Finance data is lazily merged in when TV chart ranges lack coverage.
txCache                → minimal tx objects from fetchTransactions(): { dateStr, type, ticker, shares, price, tradeValue }
                         Used for all P&L computations (computePnLTimeline, computeNetWorth, computeClosedTrades, IRR)
txList                 → rich tx objects from fetchTxList(): { date, time, type, ticker, shares, price, tradeValue, com, tax, total }
                         Used only for the Transactions panel display (renderTxPanel)
nwData                 → { labels, netWorthLine, netInvestedLine } — Net Worth chart data, in-memory only
_journalTrades         → array of closed-trade records from computeClosedTrades(), used by renderTradeJournal
_planAlertSigs         → Set of alert keys already fired — prevents duplicate browser notifications
```

## Key Utility Functions
- `t(key)` — i18n lookup (EN/TH), falls back to EN then key itself
- `fmtCurr(n)` — formats number to display currency (USD or THB based on `currency` global)
- `fmtUSD(n)` — always formats as USD regardless of currency toggle; use for per-share stock prices and plan tab values
- `colorFor(sym)` — stable color from PALETTE for a given symbol
- `findPos(sym)` — finds a position in `currentModel` (positions + sgovPos)
- `recordFetch(params, needsResponse)` — authenticated Apps Script write call
- `nearestPrice(priceMap, dateStr)` — finds closest available price on or before a date

## Currency Toggle Rule
- Portfolio values (current value, P&L, dividends, allocation amounts) → `fmtCurr(n)`
- Per-share stock prices and all plan tab content → `fmtUSD(n)` (plan tab prices are inherently USD)
- `toggleCurrency` re-renders: stat cards, table, watchlist, donut, sector chart, tx panel, dividend breakdown, trade journal, risk panel, allocation list, gauge, holdings performance, net worth chart, industry donut

## Multi-User / Auth
No URLs or secrets are in the source code. Each user sets up their own device once via the setup modal. Config is stored in `localStorage` under key `portfolioConfig.v1`.

**Config structure (multi-profile):**
```javascript
{
  profiles: [{ id, profileName, sheetId, recordUrl, writeKey, geminiKey? }],
  activeProfileId: 'p1'
}
```
- `_activeProfile()` returns the active profile object
- `_buildUrls(profile)` derives all sheet/script URLs from `sheetId` and `recordUrl`
- Old single-profile format is auto-migrated on first load

**Config fields per profile:**
- `profileName` — display name
- `sheetId` — Google Sheet ID
- `recordUrl` — Apps Script web app URL (`doGet` endpoint)
- `writeKey` — must match `WRITE_KEY` in Apps Script → Script Properties
- `geminiKey` — optional Google Gemini API key (enables AI chat button on symbols)

**Setup flow:** First visit → setup modal → `_saveCfg()` → `init()`.
**Switch account:** Tweaks panel → Account → "Switch account" (clears localStorage, reloads).
**Emergency reset:** Open `index.html#reset` — clears config and reloads.
**Profile switch resets:** `txCache`, `historyCache`, `planCache`, `_journalTrades`, `benchmarkData`, `pnlData`, `shellBuilt`.

**Apps Script auth guard** (must be added to each user's `doGet`):
```javascript
function doGet(e) {
  const expected = PropertiesService.getScriptProperties().getProperty('WRITE_KEY');
  const provided  = e?.parameter?.key;
  if (!expected || provided !== expected)
    return ContentService.createTextOutput('{"ok":false,"error":"unauthorized"}')
      .setMimeType(ContentService.MimeType.JSON);
  // ... existing dispatch logic ...
}
```

## Sheet Schema
- **Category** values: `"Big Value"`, `"Medium Value"`, `"Growth"`, `"Dividend"`, `"Other"`
- **Industry** — free-form string from Yahoo Finance `assetProfile.industry`; ETFs use `"ETF"`; falls back to `'Other'` in charts
- **Cash/Cash Reserves** stored only in row 1 of the Claude sheet
- **SGOV** = Treasury ETF, treated as cash-equivalent (separate rendering path in `buildModel`; excluded from `computeClosedTrades` and `computePnLTimeline`)
- Rows with no Qty and no AvgPrice → watchlist entries

## Plan System
- `planCache` loaded from Plan sheet at `init()` via `loadAllPlansFromSheet()` (gated to `isFirstLoad`)
- `hasSavedPlan(sym)` → true when any of: entry tranche has price or cumPct > 0, TP tranche has price > 0, SL is set, or note is non-empty
- Tranche format in sheet: `entryPrice:cumPct` (colon-separated; middle fields ignored in parsing)
- TP (trim) tranche format: `price/pct` in columns TP1–TP3
- SL warning badges in POSITIONS: 🔴 if price ≤ SL, ⚠ if within 5% above SL
- Action modal has 4 tabs: PLAN, TRANSACTION, EDIT, ALLOCATION

**Plan Watch card** (`id="planWatchCard"`, top of side panel, hidden when no alerts):
- `renderPlanWatch()` scans `planCache` + current prices, builds urgency-ranked alert list
- Urgency: SL hit=5, SL near=4, TP hit=3, TP near=2, entry hit=1, entry near=0.5
- `_planAlertInitDone` / `_planAlertSigs` prevent duplicate browser Notification API calls
- Called from: `fetchQuotes().then(...)`, after `renderPlansPanel()`, on plan save/clear

## Transaction Flow
- `postTransactionUpdates(ticker, shares, price, txType)` → upserts Qty/AvgCost, adjusts cash, handles Sell All deletion
- `calcFees(tv)` = 0.15% commission + 7% VAT on commission (skipped when "No commission" checkbox is checked)
- Cash selector: FCD or USD

## Computed Analytics (txCache-based)
All functions below operate on `txCache` (minimal fields). They are called inside the `TRANSACTION_URL` async IIFE in `init()`.

- `computePnLTimeline(txs)` → `[{ date, ticker, pnl }]` — realized P&L per sell event (rolling avg cost)
- `computeRealizedPnlTotal(txs)` → sum of all realized P&L
- `computeNetWorth(txs)` → `{ labels, netWorthLine, netInvestedLine }` — daily portfolio value vs net capital deployed; requires `historyCache.prices`
- `computeClosedTrades(txs)` → closed-trade records `{ ticker, openDate, closeDate, holdDays, avgEntry, avgExit, shares, grossPnl, fees, netPnl, netPnlPct }`. `shares` = total cycle quantity (all partial sells summed). `netPnlPct` = `netPnl / (avgEntry × totalSoldQty)`. Handles re-opens (resets tracking after each full close).
- `computeIRR(txs, totalCurrent, totalInvested)` → annualized CAGR since first buy
- `computeDividends(txs)` → gross/net dividend totals

## TV Chart (Lightweight Charts)
Two instances: symbol detail modal (`sdTvChart`) and action modal PLAN tab (`actionTvChartEl`).
- Data source: `historyCache.prices[sym]` merged with Yahoo Finance 2Y fetch
- Yahoo fetch triggers lazily when range buttons can't be satisfied by cached data (`dates[0] > fromStr`)
- Fetched Yahoo data is merged back into `historyCache` for the session (in-memory only, not persisted to sheet)
- `window._sdTvSym/Chart/Series/PriceMap` are the globals that `sdSetRange` operates on

## Layout
- Desktop: 2-column grid (`1fr 380px`)
- **Main panel (left):** Stat cards → Positions (with 52W range column) → Holdings Performance → Benchmark → Transactions → Trade Journal (hidden when no closed trades)
- **Side panel (right):** Plan Watch (alerts only, hidden when none) → Allocation → Total Net Worth → Category Breakdown → Sector Breakdown → Industry Breakdown → P&L by Sector → Risk & Concentration → Calendar → Watchlist → Dividend Breakdown

## Risk & Concentration Panel (`id="riskPanel"`)
`renderRiskPanel(model)` — pure, idempotent, no state. Four sections:
1. **Concentration** — largest position, top-3 stock weight, HHI (uses `stockWeightPct` not `weightPct`), cash %
2. **Sector** — top sector name + %, count of sectors held
3. **Stop-Loss coverage** — % of equity with SL set (from `planCache`), max loss to SL, unprotected exposure
4. **52W range stress** — avg distance from 52W high, count of positions within 10% of 52W low (shows `—` until quotes load)

Called from: sync render block (after `renderSectorBar`), `fetchQuotes().then(...)`, `toggleCurrency`.

## Auto-Refresh
- Every 60s when `isMarketOpen()` (Mon–Fri, 9:30AM–4:00PM ET, regular market hours only)
- Benchmark skipped on auto-refresh once `benchmarkLoaded = true`
- Auto-refresh is suppressed while any modal is open
- `isFirstLoad` flag gates: `loadAllPlansFromSheet()`, `refreshTxPanel()`, `buildShell()`

## Finnhub / Quotes Sheet Contract
- Apps Script writes only rows where Finnhub returned `price > 0`. Symbols with no Finnhub data are absent.
- Index symbols (`^GSPC`, `^IXIC`, `^RUT`) are NOT supported by Finnhub free tier — they are fetched via Yahoo v7/quote (with crumb) inside the Apps Script and appended to the same Quotes sheet write.
- Client `fetchSheetQuotes()` checks `regularMarketPrice > 0` as a safety guard before using a row — symbols with null/zero prices fall to `missingFromSheet` and are fetched from Yahoo browser-side.
- `_staticQuoteCache` is populated from Yahoo calls and merged into sheet quotes: `out[s] = { ...stat, ...live }`. This preserves 52W range and earnings data across sheet-based refreshes.
- gviz cache lag: Google CDN caches the Quotes sheet read for ~5–30s. Worst-case quote age ≈ script period (60s) + gviz lag.

## Known Limitations
- Live Yahoo Finance quotes blocked on GitHub Pages (CORS) — corsproxy.io used as fallback
- Dividend data estimated from Yahoo Finance, not actual payouts
- Apps Script `savePlan` sends full plan state every call (full row replacement, not merge)
- Yahoo Finance v7/quote and quoteSummary both require a crumb from Apps Script (server-side); browser requests to quoteSummary are blocked by CORS — always fetch metadata server-side via `fetchYahooMetadata()`
- `txCache` has no commission/tax fields (those are only in `txList`); fee estimates in `computeClosedTrades` use `|tradeValue - shares×price|`
