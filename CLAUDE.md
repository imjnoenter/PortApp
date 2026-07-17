# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The App
Single-file HTML portfolio tracker: `index.html` (no build step, no npm, no framework).
External dependencies via CDN:
- Chart.js 4.4.1
- Lightweight Charts 4.2.0 (TradingView — used for per-symbol price chart in modal)

Open directly in browser or host on GitHub Pages. See `PRODUCT.md` for brand personality, design principles, and anti-references.

## Running Locally
```
python -m http.server 8000
```
Open `http://localhost:8000`. No build step needed.

## File Structure
Everything is in `index.html` (single file, no build step):
- CSS (top `<style>` block)
- HTML shell built by `buildShell()` JS function
- All JavaScript inline at the bottom
- Fonts loaded via `<link rel="preconnect">` + `<link rel="stylesheet">` (not `@import`)

**Apps Script:** `apps_script.js` is the canonical source for the Google Apps Script backend. The user copies this file's contents into the Apps Script editor. **Always edit `apps_script.js` directly** — never just show code snippets for the user to manually integrate. (`apps-script.gs` is a stale older version; ignore it.)

**PWA:** `manifest.json` (install metadata) + `sw.js` (service worker). Cache-first for CDN assets (jsDelivr/unpkg/gstatic), network-first with stale-cache fallback for the app shell. Live data hosts (`docs.google.com`, `script.google.com`, Yahoo Finance, `corsproxy.io`) are always bypassed, never cached.

## Design Tokens
All new CSS should use tokens, not raw values.

**Spacing** (`--sp-1` through `--sp-9`): Use for structural spacing (padding, gap, margin on cards, panels, modals, grids). Leave micro-component spacing (badge padding, icon gaps, 2-3px nudges) as raw values.

**Z-index** (`--z-sticky` through `--z-tooltip`): Never use arbitrary z-index values; always use the scale defined in `:root`.

**Easing** (`--ease-out-quint`, `--ease-out-expo`): Use for animations, not `ease` or `linear`.

**Colors**: Never hard-code hex in CSS or inline JS styles. Use CSS custom properties (`var(--terracotta)`, `var(--sage)`, etc.) — they change across all 4 themes. Exception: Chart.js canvas config and `ctx.fillStyle` calls can't use CSS vars.

## Theming
4-theme system: warm light (default), warm dark, cool light, cool dark. Controlled by `data-theme="dark"` and `data-tone="cool"` attributes on `<html>`. All colors defined as CSS custom properties in `:root` with overrides in `[data-tone="cool"]`, `[data-theme="dark"]`, and `[data-theme="dark"][data-tone="cool"]` blocks.

## Accessibility
- `@media (prefers-reduced-motion: reduce)` blanket-kills all animation/transition durations
- `:focus-visible` outlines on all interactive elements (terracotta, 2px, offset 2px)
- Viewport sets `maximum-scale=1,user-scalable=no` to suppress iOS Safari's zoom-on-focus (Safari auto-zooms any focused input with `font-size < 16px` and never zooms back out on blur; app inputs are 12–13px). iOS Safari 10+ ignores these directives for pinch gestures, so pinch-to-zoom still works on iPhone; Android/Chrome honors them and pinch is disabled there. If the focus-zoom ever returns, the version-independent fix is `font-size: 16px` on `.tx-input` / `.tranche-input` / `.gc-input`.
- ARIA labels on tranche inputs in plan tab
- Modal overlays use `animation: overlayIn` + `modalIn` for smooth reveal

## Data Sources

**Google Sheets (read-only via gviz/tq JSON API):**
- Portfolio: `sheet=Claude` — columns: Symbol, Name, Sector, Industry, Category, Qty, Avg price, Target Allocation, Current price, Cash, Cash Reserves
- Transactions: `sheet=transactions`
- Plan data: `sheet=Plan` — columns: Symbol, SL, Note, T1…T13, TP1…TP3
- Price history cache: `sheet=History`
- Earnings calendar: `sheet=Calendar`
- Live quotes cache: `sheet=Quotes` — columns: Symbol, Price, Change, ChangePct, UpdatedAt (Unix seconds). Written by `refreshQuotes()` trigger every ~2 minutes during market hours (1-min trigger with skip-every-other-run). Only rows where Finnhub returned `price > 0` are written — absent rows mean Finnhub had no data for that symbol.

**Google Apps Script (write operations + quote refresh):**
- `RECORD_URL` = Apps Script web app (`doGet`)
- Actions: `addSymbol`, `updateSymbol`, `removeSymbol`, `updateCash`, `savePlan`, `clearPlan`, `fetchHistory`, `transferShares`, `fetchHoldings` (ETF data), `fetchStockSectors`, `backfillMetadata`, `backfillReturns`, `refreshReturns` (see Returns Pipeline below), `backfillCalendar`, `refreshCalendar` (see Calendar Pipeline below)
- All write calls go through `recordFetch(params)` which injects `_WRITE_KEY` automatically
- `addSymbol` fetches Name/Sector/Industry server-side via `fetchYahooMetadata()` (Yahoo quoteSummary + crumb) — no client-side metadata fetch needed. Also calls `refreshReturnsForSymbol_(sym)` synchronously (non-ETF only) and `refreshCalendarForSymbol_(sym)` synchronously (unconditionally) so the new symbol has Returns/Calendar data immediately instead of waiting for the next daily refresh.
- `getYahooCrumb()` returns `{ crumb, cookieStr }` — acquires Yahoo Finance session cookie + crumb; required for quoteSummary and v7/quote from Apps Script. **Property is `cookieStr`, not `cookie`.** **Only usable server-side** — a browser cannot attach the resulting session cookie to a cross-origin fetch, so this crumb flow cannot be replicated client-side (see Known Limitations).
- `backfillMetadataAction(ss,p)` (doGet action `backfillMetadata`) — **not a one-time function**; pinged by the client on every `init()` (see Returns Pipeline pattern below). Scans `Claude` for rows with a blank **Name only** (Sector/Industry blank alone doesn't trigger a re-fetch — some symbols legitimately never return an `industry` from Yahoo even on success), re-fetches via `fetchYahooMetadata()`, gated by a 10-min per-symbol cooldown in Script Properties (`lastAttempt:NAME:<sym>`) so repeated pings don't hammer Yahoo for a symbol that keeps failing.
- `refreshQuotes()` — time-triggered (1-min Apps Script trigger, but skip-every-other-run for effective ~2-min cadence to stay under UrlFetch daily quota). Market hours only via `isMarketOpenET_()` (Mon–Fri 9:30 AM–4:05 PM ET). Fetches portfolio symbols from Finnhub (split across two API keys via `fetchAll`), index symbols (`^GSPC`, `^IXIC`, `^RUT`) from Yahoo v7/quote with cached crumb (`getCachedCrumb_()`, 1-hour TTL). Writes to `Quotes` sheet atomically (single `setValues`, trims leftover rows). `KEY1`/`KEY2` are Finnhub API keys hardcoded at top of script. `fetchAll` is wrapped in try/catch to prevent uncaught exceptions from disabling the trigger. **Finnhub's `/quote` endpoint does not return volume** — the `Quotes` sheet has no Volume column; see Volume Fetching below for how Volume is actually sourced.

**Cooldown-gated webapp-triggered backfill pattern:** `backfillMetadata`/`backfillReturns` don't use Apps Script time-based triggers (`ScriptApp.newTrigger`) — that requires the `script.scriptapp` OAuth scope, which threw a hard `Exception: Specified permissions are not sufficient` when first attempted and needed a manual re-consent flow to fix. The webapp-ping pattern avoids this scope entirely: the client fires a fire-and-forget `recordFetch({action:...})` on every `init()`; the Apps Script action re-scans the sheet itself each time and self-gates via a Script Properties timestamp (per-symbol for gap-filling, global for the once-daily full refresh) so most pings are a single cheap property read, not a real fetch.

**Live quotes — two-path routing:**
- **Market hours (Mon–Fri 9:30–16:00 ET):** `fetchQuotes` reads from the `Quotes` sheet tab (written every ~2 min by Apps Script `refreshQuotes` via Finnhub). Symbols missing from the sheet (e.g. index symbols) fall back to a Yahoo browser call.
- **Extended hours (pre/post-market, Mon–Fri):** `fetchQuotes` uses Yahoo path (no sheet data during extended hours). Auto-refreshes every 5 min via `isExtendedHours()`.
- **Non-market hours:** Yahoo path only, manual refresh.
- **Yahoo path:** v7/quote batch for all symbols, v8/chart per-symbol as final fallback. **`v7/finance/quote` now requires a crumb and returns 401 without one** — confirmed via direct testing; since a browser can't attach the crumb's session cookie cross-origin, this batch path is effectively dead client-side for anything beyond what's already cached in `_staticQuoteCache`/the `Quotes` sheet. `v8/finance/chart` does **not** need a crumb and still works.
- Ticker mapping: `yahooTicker(s)` converts `.` → `-` (e.g. `BRK.B` → `BRK-B`)
- `_staticQuoteCache` — in-memory cache of 52W/earnings fields from the last Yahoo call; merged into sheet quotes so those fields persist across market-hours refreshes
- `_lastQuoteSource` — `{ type: 'sheet'|'yahoo', updatedAt? }` — drives the "prices Xs ago" freshness badge (`id="quotesFreshness"` in header)

## Volume Fetching
Stock **and** ETF Volume (Positions → Performance tab) is sourced from **CNBC's public quote endpoint**, not Yahoo or Finnhub — direct client fetch, no Apps Script, no CORS proxy, no API key:
- `fetchCnbcVolumes(symbols)` — batches all non-index (`^`-prefixed) symbols into one request: `https://quote.cnbc.com/quote-html-webservice/quote.htm?symbols=<pipe-separated, URL-encoded>&output=json`. Response key varies (`QuickQuoteResult.QuickQuote` or `FormattedQuoteResult.FormattedQuote`; a single symbol can come back as an object, not an array). Reads **`fullVolume`** (falls back to `volume`) — `fullVolume` matches Yahoo's `regularMarketVolume` exactly (verified); plain `volume` is regular-session-only and reads lower. Native dotted-ticker support (`BRK.B`) — no `yahooTicker()` conversion needed.
- `fetchQuotes(symbols)` is a thin wrapper around the original quote logic (renamed `_fetchQuotesBase`) that merges `fetchCnbcVolumes` results into `regularMarketVolume` on every returned entry, across all three quote paths (sheet/Yahoo/chart fallback) in one place. `attachQuotes()` itself is unchanged — it already read `q.regularMarketVolume`.
- Rides the existing quote refresh cadence (60s market hours / 5min extended / on load) — no separate timer, since it's one cheap batch request either way.
- **ETF volume is unified onto this same CNBC path** (not the Apps Script `fetchHoldingsAction` ETF data cache) — `fetchEtfData`'s apply loop no longer sets `p.volume`, so ETF volume is always as fresh as the last quote cycle instead of tied to the 24h ETF-data TTL. The other ETF-only fields (expense ratio, net assets, holdings, trailing returns) still come from the 24h-cached Apps Script path — those don't change intraday, so no reason to move them.
- Why CNBC and not a Yahoo `v7/quote` client-side fix: `v7/quote` needs a crumb (browser can't do this cross-origin); the `v8/chart` no-crumb alternative is single-symbol only (N requests for a whole portfolio) and Yahoo sends no CORS headers on it, requiring a proxy. **`corsproxy.io`'s free tier only allows `localhost` origins** — confirmed via a real Playwright/Chromium browser test (200 from `localhost`, 403 from a real public origin) — so anything routed through it works while testing locally and silently breaks once deployed. CNBC's endpoint is directly CORS-open from any origin and batch-capable, sidestepping both problems.

## Key Architecture
```
parseRows(table)       → raw rows from gviz JSON — reads: symbol, name, sector, industry, category, qty, avgPrice, target, price, cash, cashRes, fcd, usd
buildModel(rows,cashCtx) → cash from cashCtx (registry), rows pre-sliced by rowsForView; see Multi-Portfolio.
                         { positions[], watchlist[], sgovPos (always null — legacy field, see SGOV note),
                           rawCash, rawFcd, rawUsd, cashResPct, totalCash, totalCurrent, investable,
                           totalInvested, totalPnl, totalPnlPct }
fetchQuotes(symbols)   → thin wrapper (merges in CNBC volume, see Volume Fetching) around
                           _fetchQuotesBase(symbols): during market hours reads Quotes sheet via
                           fetchSheetQuotes(); symbols with price > 0 used directly, others fall
                           through to fetchYahooBatch(). Outside market hours calls fetchYahooBatch
                           (symbols) directly. Attaches dayChange, dayChangePct, preMarketPrice,
                           postMarketPrice, week52High, week52Low, volume to each position via
                           attachQuotes().
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
- `findPos(sym)` — finds a position in `currentModel` (positions + sgovPos, the latter always null)
- `recordFetch(params, needsResponse)` — authenticated Apps Script write call
- `nearestPrice(priceMap, dateStr)` — finds closest available price on or before a date
- `css(v)` — resolves a CSS custom property to its trimmed value (`getComputedStyle` on `<html>`). Use this instead of inlining `getComputedStyle(...).getPropertyValue(...).trim()`.

## Shared Render Helpers (avoid re-duplicating)
Several render paths were consolidated — extend the existing helper rather than copy-pasting a sibling:
- **Donuts:** `renderGroupedDonut(cfg, model)` backs the sector / industry / category donuts. `renderSectorDonut` / `renderIndustryDonut` / `renderCategoryDonut` are thin wrappers around the `SECTOR_DONUT` / `INDUSTRY_DONUT` / `CATEGORY_DONUT` configs (grouping field, element id, drilldown-state accessors, post-drill side effects). Drilldown/instance state stays in module-level vars (`sectorDrilldown`, `catDonutInst`, …) read by `setSectorFilter` / `setCategoryFilter` / `rerenderDonuts`. To add a donut, add a config — don't fork the renderer. **Exception:** `renderSectorDonut`/`renderIndustryDonut` branch to a wholly separate static-donut path for the ETF portfolio tab — see Multi-Portfolio.
- **Floating tooltips:** `ensureTip(id)` (lazily creates a body-level `.float-tip` div) + `positionTip(el, e, dx, dy)` (cursor-following, viewport-clamped) back both the weight-bar (`wbTip`) and holdings-perf (`hpTip`) tooltips. Per-tooltip style deltas live in `#wbTip` / `#hpTip` CSS rules.
- **Plan badges:** `planBadge(label, title, bg, color)` renders the pill markup shared by `trancheBadge` and `tpBadge`.

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
- **Category** values: `"Big Name"`, `"Wait for sell"`, `"Medium Cap"`, `"Small Cap"`, `"Growth"`, `"Dividend"`, `"Other"`
- **Industry** — free-form string from Yahoo Finance `assetProfile.industry`; ETFs use `"ETF"`; falls back to `'Other'` in charts
- **Market Cap** — a sheet formula column on `Claude` (computed sheet-side); `parseRows()` reads it directly via `cell(r, "Market Cap")` — no client or Apps Script fetch needed. Hidden entirely in the Performance table for the ETF portfolio view.
- **Cash/Cash Reserves** — per-portfolio, stored in the `Portfolios` registry sheet. Pre-migration fallback reads from `Claude` row 1.
- **SGOV / bond ETFs** = treated as **normal holdings**, not cash. There is no SGOV special-case: `buildModel` runs SGOV through the regular positions loop (so `totalCash = rawCash` only, `sgovPos` is always `null`), and its trades count in `computeClosedTrades` / `computePnLTimeline` like any position. Any bond ETF (BIL, TLT, BND, …) behaves identically with no extra code. Only cosmetic residue: `colorFor('SGOV')` still returns a fixed brown, and the quote-fetch list still re-appends SGOV last (both harmless). Portfolio value/invested totals are unchanged vs. the old cash-equivalent treatment — the SGOV amount just moved from the cash bucket to the invested bucket.
- Rows with no Qty and no AvgPrice → watchlist entries

## Returns Pipeline (Positions → Performance tab, 1M/3M/YTD/1Y/3Y/5Y)
- `sheet=Returns` — columns: `Symbol, 1M, 3M, YTD, 1Y, 3Y, 5Y, UpdatedAt` (Unix seconds). One row per non-ETF symbol; each period is a plain percentage (e.g. `12.5` = +12.5%).
- **FMP (Financial Modeling Prep) has been fully removed** — its free tier premium-walls certain symbols (returns an error instead of data), which left permanent gaps. All returns are now computed from a single Yahoo `v8/finance/chart` price series (`_computeReturnsFromChart_(result)` in `apps_script.js`) — no crumb needed. Each period is `(current - priceAt(targetDate)) / priceAt(targetDate)`, where `priceAt()` walks the daily series back to the nearest trading day at or before the target date (weekends/holidays resolve to the prior trading day's close automatically — verified: a Saturday/Sunday/holiday target both fall back to the same prior Friday close as a normal weekday target would).
- Three Apps Script entry points, all sharing `_computeReturnsFromChart_`:
  - `refreshReturnsForSymbol_(sym)` — single-symbol fetch, called synchronously from `addSymbolAction` at add-time.
  - `backfillReturnsAction` (doGet `backfillReturns`) — finds non-ETF `Claude` symbols **completely missing** from `Returns` (not stale ones — no `UpdatedAt` freshness check) and fetches just those, batched via `UrlFetchApp.fetchAll`. Per-symbol 10-min cooldown (`lastAttempt:RET:<sym>` in Script Properties) so a symbol that keeps failing (e.g. delisted/bad ticker) doesn't get hammered every ping — it just retries forever at that interval, silently.
  - `refreshReturnsAction` (doGet `refreshReturns`) — the only path that **overwrites existing rows** (keeps them from going stale forever). Gated by one **global** cooldown (`lastFullReturnsRefresh`, 24h) — most pings are a single cheap property check; once due, it batch-refreshes every non-ETF symbol's full row.
- Client: `fetchStockReturns()` reads the sheet into `_stockReturnsCache[sym] = {1M,3M,YTD,1Y,3Y,5Y}` (fractions, divided by 100 from the sheet's plain percentages). Called once per `init()`. All three doGet actions above are pinged fire-and-forget (`recordFetch({action:...})`, no awaited response) from the same spot in `init()` where quotes resolve — so they ride the normal 60s/5min auto-refresh cadence too.
- Rendering (`renderPerformanceTable`/`perfRow`): for each symbol, `source = _etfDataCache[sym]?.trailingReturns || _stockReturnsCache[sym]` — ETF trailing returns (a completely separate Apps Script pipeline, `fetchHoldingsAction`'s Yahoo `fundPerformance` module, still has its own working 3Y) take precedence when present. If a period is missing from `source`, `computePeriodReturns(sym, price)` (client-side, from `historyCache`) fills the gap — this is why stocks still show a 3Y estimate even though the Returns-sheet pipeline itself doesn't special-case 3Y differently from any other period.

## Calendar Pipeline (Upcoming Calendar panel — earnings date + ex-div date)
- `sheet=Calendar` — columns: `Symbol, EarningsDate, EarningsDateEnd, Time, ExDivDate, UpdatedAt` (dates as `yyyy-MM-dd` strings, `UpdatedAt` Unix seconds). One row per `Claude`-sheet symbol, **including ETFs and watchlist entries** — ETFs simply get a blank `EarningsDate`/`EarningsDateEnd`/`Time` since Yahoo has none for them, but still get `ExDivDate`.
- Data source is Yahoo `v7/finance/quote`'s `earningsTimestamp`/`earningsTimestampEnd`/`exDividendDate` fields, fetched **server-side only** (`_fetchYahooCalendarFields_` in `apps_script.js`) via the existing cached crumb (`getCachedCrumb_()`) — same endpoint the client used to call directly before it started requiring a crumb (see Known Limitations). Batched in chunks of 50 symbols/request via `UrlFetchApp.fetchAll`.
- `Time` (before/after market) isn't a separate Yahoo field — Yahoo only gives a single timestamp. `_calEarningsTime_` derives it from the timestamp's ET hour: before ~12:00 ET → "before market open", otherwise → "after market close" (earnings calls only ever happen in one of those two windows).
- Three Apps Script entry points, mirroring the Returns pipeline exactly:
  - `refreshCalendarForSymbol_(sym)` — single-symbol fetch, called synchronously from `addSymbolAction` at add-time (unconditionally, unlike Returns — ETFs still get an ex-div date).
  - `backfillCalendarAction` (doGet `backfillCalendar`) — finds `Claude` symbols with **no row at all** in `Calendar` and fetches just those. Per-symbol 10-min cooldown (`lastAttempt:CAL:<sym>` in Script Properties).
  - `refreshCalendarAction` (doGet `refreshCalendar`) — the only path that **overwrites existing rows**. Gated by one **global** cooldown (`lastFullCalendarRefresh`, 24h).
- Client: `readCalendarSheet()` reads the sheet directly via gviz (not through `_stockReturnsCache`-style in-memory cache) and is re-fetched by `loadCalendar()` on every `init()`. Both doGet actions are pinged fire-and-forget from the same spot as the Returns pings. `renderCalendarFromEvents` shows an earnings date range (e.g. "Aug 12–14") only when `EarningsDateEnd` differs from `EarningsDate` — most symbols have an exact single date.
- `p.nextEarnings`/`p.exDivDate`/`w.nextEarnings`/`w.exDivDate` (per-position/watchlist fields) were removed from `attachQuotes()` — they were dead assignments sourced from the client-side Yahoo `v7/quote` call, which nothing ever read and which is now blocked by the crumb requirement anyway. The Calendar panel has always used the separate `Calendar` sheet mechanism above, not these fields.

## Multi-Portfolio
Three portfolios — **Long-Term**, **Trade**, **ETF** — with a header toggle built from the `Portfolios` registry (`portToggleInnerHtml()`; hidden if only one portfolio registered). A symbol can be held in more than one (e.g. 5 ARM = 4 Long-Term + 1 Trade). Storage is generic (scales to N); there is no create/edit/delete-portfolio UI yet — portfolios are added by inserting a row in the `Portfolios` sheet directly. Apps Script changes + the one-time `migratePortfolios()` are documented in `APPS_SCRIPT_CHANGES.md`.
- **Portfolio visibility:** `getHiddenPorts()`/`setHiddenPorts()` (`localStorage` key `hiddenPortfolios.v1`) let a user hide a registered portfolio from the header toggle without deleting it; `renderPortVisToggles()` (Tweaks panel) renders the checkboxes.
- **ETF shares Long-Term's cash:** `cashCtxFor('ETF')` returns `_portRow(DEFAULT_PORT)` — the ETF view has no cash of its own, unlike Long-Term/Trade. `activePortfolio === 'ALL' || activePortfolio === 'ETF'` both resolve to `DEFAULT_PORT` wherever a single edit-target portfolio is needed (new symbol/plan edits), since ETF has no independent cash/plan context of its own outside its dedicated tab.
- **ETF-only UI:** Positions has an Overview/Performance sub-tab toggle (`_posTab`, `setPosTab()`) — Performance table (`renderPerformanceTable`/`perfRow`) shows expense ratio, net assets, trailing returns, and `topSector` (`hasEtf`/`isEtfView` flags, `index.html:6288-6292`). The **Top Holdings card** (`renderTopHoldings`, `id="topHoldingsCard"`, ETF tab only) blends each ETF's cached top ~20-25 constituent stocks (`_etfDataCache[sym].topHoldings`) weighted by ETF-share-of-portfolio into one ranked table, and lazily fetches each constituent's sector (`fetchStockSectors` Apps Script action → `_topHoldingSectors` cache) for its Sector column.
- **ETF-only Sector/Top Holding Breakdown donuts:** when `activePortfolio === 'ETF'`, `renderSectorDonut`/`renderIndustryDonut` branch to `renderEtfSectorDonut`/`renderEtfTopHoldingDonut` instead of the generic `renderGroupedDonut` path (Long-Term/Trade/ALL are unaffected). Both reuse the same blended top-holdings aggregation (`_blendedEtfHoldings`, mirrors the Top Holdings card's math) — Sector Breakdown groups it by each holding's looked-up sector, Top Holding Breakdown groups it by symbol directly. Both render via `_renderEtfStaticDonut` — **no click/drill-down** (an ETF fractionally belongs to multiple sectors/symbols here, unlike the generic donuts' one-value-per-position assumption, so click-to-filter has no clean meaning). The portion of each ETF's value outside its known top holdings is never charted — it's surfaced as a small text note below the chart (`#sectorDonutNote`/`#industryDonutNote`, cleared when leaving the ETF tab) instead of an "Other" slice, e.g. "Other/Unclassified: $6,000 (60.0%)".

**Sheet schema:** `Claude` and `transactions` have a `Portfolio` column (one row per portfolio×symbol / per tx). `Plan` has a `Portfolio` column appended **LAST** (`parsePlanTable` reads it positionally at `c[19]`). New `Portfolios` registry sheet (`id, Name, Color, Cash, CashReserves, FCD, USD`) holds per-portfolio cash — cash no longer lives in `Claude` row 1.

**Model flow:** one master parse; `currentModel`/`txCache` are rebuilt as the active-view slice on every toggle — so the ~20 render functions are unchanged.
```
activePortfolio        → 'ALL' | 'Long-Term' | 'Trade' | 'ETF'  (localStorage 'portfolioView.v1')
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
- `computeIRR(txs, holdingsValue)` → **money-weighted XIRR** (annualized), NOT a simple CAGR. Solved by bisection (Actual/365) over dated cash flows: Buy = −outflow, Sell = +inflow, net Dividend = +inflow, Transfer-Out = +inflow / Transfer-In = −outflow (both at carried cost, so they cancel in the ALL view), terminal = `holdingsValue` (today's holdings market value — the caller passes `model.totalCurrent - model.totalCash`). Folds realized P&L + dividends + unrealized gains in by construction; returns `null` on no flows / no sign change / zero time span. **Side effect:** stashes the breakdown ingredients in the module global `_irrDetail = { invested, proceeds, dividends, transfersNet, terminal, firstDateMs, years, rate }` (left `null` on the guard returns). Dividends use the same `historyCache.dividends` + `sharesHeldAt` + `withholdingRate` source/math as `computeDividends`, so the two always reconcile.
  - **IRR breakdown popover:** the "Annualised IRR" stat card has an inline ⓘ button (`toggleIrrBreakdown`) that renders a component summary of `_irrDetail`. The popover (`#irrBreakdown`) is created **lazily at `document.body` with `position: fixed`** and positioned via `getBoundingClientRect` — it must NOT live inside the card, because `.stat-card` has `container-type: inline-size` which traps descendant `z-index` in its own stacking context (an in-card popover renders *behind* sibling cards). Content reconciles to the "Total Return" card: `Total gain = terminal + proceeds + dividends + transfersNet − invested = unrealized + realized + dividends`. Closes on second-click / click-outside / Escape / scroll / any `renderStatCards` re-render.
- `computeDividends(txs)` → gross/net dividend totals

## TV Chart (Lightweight Charts)
Two instances: symbol detail modal (`sdTvChart`) and action modal PLAN tab (`actionTvChartEl`).
- Both builders share `createTvAreaChart(el, height, symColor, clrTrack, clrMuted)` (chart + area-series config) and `buildTvSeriesData(sym, priceMap)` (sorted `{time,value}` series with today's live price spliced onto the tail). The two differ only in height (260 vs 220) and what they draw on top (the symbol-detail one adds tranche/SL/avg price lines + range buttons).
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
- A `setInterval(..., 60_000)` loop calls `init()` directly when `isMarketOpen()`, or every 5 min when `isExtendedHours()` (throttled via `_lastExtRefresh`). Every `init()` re-parses the whole sheet — there's no lighter partial-refresh path.
- Benchmark skipped on auto-refresh once `benchmarkLoaded = true`
- Auto-refresh is suppressed while any modal is open (`.tx-overlay.open, .plan-overlay.open`)
- `isFirstLoad` flag gates: `loadAllPlansFromSheet()`, `refreshTxPanel()`, `buildShell()`
- Volume (`fetchCnbcVolumes`) and the three Returns-pipeline pings (`backfillMetadata`/`backfillReturns`/`refreshReturns`) all ride this same cadence — they fire every `init()`, not on a separate timer, and rely on their own cooldowns (not this loop) to avoid over-fetching.

## Finnhub / Quotes Sheet Contract
- Apps Script writes only rows where Finnhub returned `price > 0`. Symbols with no Finnhub data are absent.
- Index symbols (`^GSPC`, `^IXIC`, `^RUT`) are NOT supported by Finnhub free tier — they are fetched via Yahoo v7/quote (with crumb) inside the Apps Script and appended to the same Quotes sheet write.
- Client `fetchSheetQuotes()` checks `regularMarketPrice > 0` as a safety guard before using a row — symbols with null/zero prices fall to `missingFromSheet` and are fetched from Yahoo browser-side.
- `_staticQuoteCache` is populated from Yahoo calls and merged into sheet quotes: `out[s] = { ...stat, ...live }`. This preserves 52W range and earnings data across sheet-based refreshes.
- gviz cache lag: Google CDN caches the Quotes sheet read for ~5–30s. Worst-case quote age ≈ script period (~120s) + gviz lag.

## Apps Script Quota & Rate Limits
- **UrlFetch daily quota:** 20,000 calls/day (free) or 100,000 (Workspace). Each symbol in `fetchAll` counts as 1 call. With ~50 symbols + `getYahooCrumb` (2 calls) + 1 Yahoo index fetch = ~53 calls/run. At 200 runs/day (skip-every-other) = ~10,600 calls — well within limit.
- **Skip-every-other-run:** `quoteSkip` Script Property toggles `'0'`/`'1'` each trigger invocation. Effective ~2-min quote interval. No Apps Script trigger change needed (trigger stays at 1 min).
- **Crumb caching:** `getCachedCrumb_()` stores Yahoo crumb + cookie in Script Properties with 1-hour TTL. Saves ~400 UrlFetch calls/day vs fetching fresh every run.
- **Finnhub rate limit:** 60 calls/min per API key. ~25 symbols per key per burst is well within limit regardless of interval.
- **Error resilience:** `fetchAll` wrapped in try/catch — logs error and returns cleanly instead of crashing the trigger. Empty `rows` array skips sheet write to avoid overwriting good data with header-only.

## Holdings Performance Panel (`id="holdingsPerf"`)
`buildHpBaseData()` computes per-symbol total gain for the All/Gainers/Losers tabs:
- **`totalCost`** = sum of all buy `tradeValue` from `txCache` (total capital ever deployed), NOT `p.costBasis`. This correctly handles partial sells — e.g. buying $1000, selling half, still holding half: denominator is $1000 not $500. Falls back to `p.costBasis` if no buy txs exist in cache (incomplete history guard).
- **`totalPnl`** = `unrealizedPnl` (current `p.pnl`) + `realizedPnl` (summed from `pnlData`)
- **`pnlPct`** = `totalPnl / totalCost × 100` — lifetime return on total deployed capital
- Tooltip (`showHpTip`) exposes `unrealizedPnl` and `realizedPnl` as separate rows alongside the total.
- `_hpTab` ∈ `'all'|'gainers'|'losers'|'dividends'`; `_hpShowDollar` toggles $ vs % bar mode.

## Known Limitations
- **`corsproxy.io`'s free tier only serves `localhost` origins** — confirmed via a real browser test (works from `localhost`, 403 from any real public origin). Anything that depends on it will appear to work in local dev and silently break once deployed. Don't add new client-side Yahoo calls that assume this proxy still works generally; prefer a CORS-open direct source (see Volume Fetching for the pattern that replaced it) or route through Apps Script.
- **Yahoo `v7/finance/quote` and `quoteSummary` both require a crumb** and return 401/are blocked without one. A browser cannot attach the crumb's session cookie cross-origin, so neither endpoint can be fixed client-side — always fetch metadata server-side via `fetchYahooMetadata()` (Apps Script), or use a different Yahoo endpoint like `v8/finance/chart` that doesn't need a crumb.
- Dividend data estimated from Yahoo Finance, not actual payouts
- Apps Script `savePlan` sends full plan state every call (full row replacement, not merge)
- `txCache` has no commission/tax fields (those are only in `txList`); fee estimates in `computeClosedTrades` use `|tradeValue - shares×price|`
- The Returns sheet's per-symbol rows never go stale-check on their own — `backfillReturnsAction` only fills symbols missing entirely; only the once-a-day `refreshReturnsAction` actually recomputes existing rows. A symbol added between two runs of that global 24h cooldown will still have same-day-accurate data (via `refreshReturnsForSymbol_` at add-time), but nothing keeps existing rows fresher than once per day. The Calendar sheet has the identical characteristic (`backfillCalendarAction`/`refreshCalendarAction` mirror this exactly).
