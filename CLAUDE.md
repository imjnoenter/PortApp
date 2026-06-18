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
buildModel(rows,cashCtx) → cash from cashCtx (registry), rows pre-sliced by rowsForView; see Multi-Portfolio.
                         { positions[], watchlist[], sgovPos, rawCash, rawFcd, rawUsd,
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
nwTimeFilter           → 'ALL'|'3M'|'6M'|'1Y' — independent range for Net Worth chart; `setNwRange(f)` slices nwData and re-renders
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
- `toggleCurrency` (triggered from settings gear dropdown) re-renders: stat cards, table, watchlist, donut, sector chart, tx panel, dividend breakdown, trade journal, risk panel, allocation list, gauge, holdings performance, net worth chart, industry donut

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
**Profile switch resets:** `txCache`, `historyCache`, `planCache`, `_journalTrades`, `benchmarkData`, `pnlData`, `shellBuilt`, `_allRows`, `_portfolioRegistry`, `_allTxCache`, `_lastQuotes`, `activePortfolio`.

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

## Multi-Portfolio
Two fixed portfolios — **Long-Term** and **Trade** — with a header toggle `[ All | Long-Term | Trade ]`. A symbol can be held in both (e.g. 5 ARM = 4 Long-Term + 1 Trade). Storage is generic (scales to N); there is no create/edit/delete-portfolio UI yet. Apps Script changes + the one-time `migratePortfolios()` are documented in `APPS_SCRIPT_CHANGES.md`.

**Sheet schema:** `Claude` and `transactions` have a `Portfolio` column (one row per portfolio×symbol / per tx). `Plan` has a `Portfolio` column appended **LAST** (`parsePlanTable` reads it positionally at `c[19]`). New `Portfolios` registry sheet (`id, Name, Color, Cash, CashReserves, FCD, USD`) holds per-portfolio cash — cash no longer lives in `Claude` row 1.

**Model flow:** one master parse; `currentModel`/`txCache` are rebuilt as the active-view slice on every toggle — so the ~20 render functions are unchanged.
```
activePortfolio        → 'ALL' | 'Long-Term' | 'Trade'  (localStorage 'portfolioView.v1')
_allRows               → full parseRows() output (every portfolio×symbol row)
_portfolioRegistry     → parsed Portfolios sheet [{id,name,color,cash,cashRes,fcd,usd}]
_allTxCache            → full minimal tx list incl Portfolio tag + Transfer rows; txCache = filtered slice
_lastQuotes            → cached quote map, re-attached on toggle (no refetch)
rowsForView(port)      → single port → filter; ALL → merge same-symbol rows (sum qty, sum cost, weighted avg)
cashCtxFor(port)       → single → registry row; ALL → summed cash/fcd/usd + Long-Term's reserve %
buildModel(rows,cashCtx) → cash comes from cashCtx (registry), not rows[0]
applyPortfolioView()   → rebuild currentModel+txCache from caches, re-render everything (NO network)
setPortfolioView(port) → toggle handler; renderModelViews + renderTxAnalytics + pnl/nw/benchmark recompute
filterTxForView / isTransfer → tx slicing; Transfer-Out/In skipped in realized-P&L fns
defaultPortFor(sym)    → active port, or (in ALL) the port holding most of sym, else Long-Term
modelForPort(port)/findPosIn(model,sym) → port-scoped model + lookup for the action modal
```
- **Transfers:** moving shares between ports = `Transfer-Out` + `Transfer-In` tx pair at carried avg cost (Apps Script `transferShares`). `computePnLTimeline`/`computeClosedTrades`/`sharesHeldAt` handle them with no realized P&L. Client helper `transferShares(sym,shares,from,to)` exists; no UI entry point yet.
- **Action modal:** has a portfolio dropdown (`actionModalPort`, `setActionPort`); operates on that port's model. Both Long-Term and Trade have the same 4 tabs (PLAN, TRANSACTION, EDIT, ALLOCATION) with full plan UI (target allocation, entry tranches, SL/TP).
- **Plans:** `planCache[portfolio][symbol]`. Use `getPlan(sym,port)` / `setPlan` / `deletePlan`; `hasSavedPlan(sym,port)`. Plan Watch + Plans panel iterate per-port in ALL (DOM IDs keyed `port__sym`).
- **Cash writes** (`updateCash`), holding writes (`addSymbol`/`updateSymbol`/`removeSymbol`), and plan writes (`savePlan`/`clearPlan`) all carry a `portfolio` param.
- **ALL-view target approximation:** only Long-Term carries target allocations; `getTargetDollar` uses ALL `investable`, so LT target dollars are slightly larger in ALL than in the LT-only view (accepted tradeoff).
- **Profile switch / pre-migration:** the 5 globals reset on profile switch; a stale `activePortfolio` not in the registry resets to ALL; missing `Portfolios` sheet → fallback single Long-Term registry seeded from old `Claude` row-1 cash, toggle hidden.

## Plan System
- `planCache` loaded from Plan sheet at `init()` via `loadAllPlansFromSheet()` (gated to `isFirstLoad`)
- `hasSavedPlan(sym)` → true when any of: entry tranche has price or cumPct > 0, TP tranche has price > 0, SL is set, or note is non-empty
- Tranche format in sheet: `entryPrice:dollarAmount:cumPct` (3 colon-separated fields). `parsePlanTable` extracts all three: `{ price, dollar, cumPct }`.
- TP (trim) tranche format: `price/pct` in columns TP1–TP3. **`t.pct` = % of `targetDollar` to SELL** (not % remaining). `shares = min(qtyRemaining, trimPct/100 * targetDollar / P)`. Capped at `qtyRemaining` to prevent oversell phantom P&L.
- SL warning badges in POSITIONS: 🔴 if price ≤ SL, ⚠ if within 5% above SL
- Action modal has 4 tabs: PLAN, TRANSACTION, EDIT, ALLOCATION
- `getTargetDollar(pos, model)` → target allocation × investable; `getCurrentPct(pos, model)` → currentValue / targetDollar × 100; `getTrancheDollar(idx, tranches, currPct, td)` → incremental dollar for tranche i (cumPct delta × td / 100)
- All displayed % values in the PLAN tab use `.toFixed(2)` (2 decimal places)

**Plan Watch card** (`id="planWatchCard"`, top of side panel, hidden when no alerts):
- `renderPlanWatch()` scans `planCache` + current prices, builds urgency-ranked alert list
- Urgency: SL hit=5, SL near=4, TP hit=3, TP near=2, entry hit=1, entry near=0.5
- **Hit alerts** (urgency ∈ {5,3,1}) render with row background tint, 4px left bar, solid badge, 13px symbol. **Near alerts** render with transparent background, 3px bar, tinted badge, 12px symbol.
- `HIT_URGENCIES = new Set([5, 3, 1])` — browser Notification API only fires for these; near alerts (4, 2, 0.5) appear in Plan Watch UI only.
- T-type alert badges ("T1 entry", "T1 near") are clickable links → open `https://imjnoenter.github.io/dimebuy/?sym=SYM&val=DOLLAR&price=TPRICE` in a new tab. Dollar is computed live via `getTrancheDollar()` at render time (not from stored value). Badge is only linkified when `dollar > 0`; clicking the badge stops row propagation so the row's action-modal click doesn't fire.
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
- Desktop (≥769px): 2-column grid (`1fr 380px`). Profile picture (`.brand-mark`) is 88×88px, matching the clock pill's outer height (72px canvas + 7+7px padding + border). Mobile: 42×42px. The `<img>` inside uses `width:100%;height:100%` to inherit from the container.
- **Mobile (≤700px):** Single column. Header wraps: row 1 = profile pic + name + portfolio toggle; row 2 = market clock (full width). The `.header-divider` is hidden. `env(safe-area-inset-*)` offsets applied to header, sticky mob-tab-bar, and fixed overlays for iPhone Dynamic Island / notch.
- **Main panel (left):** Stat cards → Positions (with 52W range column) → Holdings Performance → Benchmark → Transactions → Trade Journal (hidden when no closed trades)
- **Side panel (right):** Plan Watch (alerts only, hidden when none) → Allocation → Total Net Worth → Category Breakdown → Sector Breakdown → Industry Breakdown → P&L by Sector → Risk & Concentration → Calendar → Watchlist → Dividend Breakdown

## Settings Gear (`settings-gear-wrap` in `header-actions`)
Gear icon opens a dropdown with Language (EN/TH), Currency ($/฿), Theme (light/dark), and Tone (warm/cool) toggles. `toggleSettingsDropdown(event)` toggles the `.open` class; a document-level click listener closes it when clicking outside. i18n keys: `language_label`, `currency_label`, `theme_label`, `tone_label`. The controls use the same element IDs (`currencyBtn`, `themeBtn`, `toneBtn`) and toggle functions (`toggleCurrency`, `toggleTheme`, `toggleTone`) as before — just relocated from the old inline `header-tools` bar.

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

## Holdings Performance Panel (`id="holdingsPerf"`)
`buildHpBaseData()` computes per-symbol total gain for the All/Gainers/Losers tabs:
- **`totalCost`** = sum of all buy `tradeValue` from `txCache` (total capital ever deployed), NOT `p.costBasis`. This correctly handles partial sells — e.g. buying $1000, selling half, still holding half: denominator is $1000 not $500. Falls back to `p.costBasis` if no buy txs exist in cache (incomplete history guard).
- **`totalPnl`** = `unrealizedPnl` (current `p.pnl`) + `realizedPnl` (summed from `pnlData`)
- **`pnlPct`** = `totalPnl / totalCost × 100` — lifetime return on total deployed capital
- Tooltip (`showHpTip`) exposes `unrealizedPnl` and `realizedPnl` as separate rows alongside the total.
- `_hpTab` ∈ `'all'|'gainers'|'losers'|'dividends'`; `_hpShowDollar` toggles $ vs % bar mode.

## Known Limitations
- Live Yahoo Finance quotes blocked on GitHub Pages (CORS) — corsproxy.io used as fallback
- Dividend data estimated from Yahoo Finance, not actual payouts
- Apps Script `savePlan` sends full plan state every call (full row replacement, not merge)
- Yahoo Finance v7/quote and quoteSummary both require a crumb from Apps Script (server-side); browser requests to quoteSummary are blocked by CORS — always fetch metadata server-side via `fetchYahooMetadata()`
- `txCache` has no commission/tax fields (those are only in `txList`); fee estimates in `computeClosedTrades` use `|tradeValue - shares×price|`
