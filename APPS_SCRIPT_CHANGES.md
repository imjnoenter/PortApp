# Apps Script changes for Multi-Portfolio (exact drop-ins for your script)

Your script is **standalone** (`SpreadsheetApp.openById(SHEET_ID)`). 

> **Testing on a copy:** change `SHEET_ID` at the top to the **copy's** sheet ID first, run `migratePortfolios()`,
> verify, then change it back (or use a separate script copy). Order: run `migratePortfolios()` → it's safe to
> re-run (idempotent) → then the action edits below make writes portfolio-aware.

Apply these edits. Functions not listed (`fetchHistoryAction`, `getYahooCrumb`, `fetchYahooMetadata`,
`backfillMetadata`, `isMarketOpenET_`, `jsonResp`, `readHeaders`, `findColIdx`, `normSym`) are unchanged.

---

## 1. Add a constant + helper (near the top, after `normSym`)

```javascript
const DEFAULT_PORT = 'Long-Term';

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
```

## 2. `doGet` — add the transfer case

```javascript
        case 'removeSymbol':  return removeSymbolAction(ss, p);
        case 'transferShares': return transferSharesAction(ss, p);   // ← ADD
        case 'delete':        return deleteTxnAction(ss, p);
```

## 3. Replace `updateCashAction` (cash now lives in the `Portfolios` sheet)

```javascript
function updateCashAction(ss, p) {
  const sh = ss.getSheetByName('Portfolios');
  if (!sh) return jsonResp({ ok: false, error: 'Portfolios sheet not found — run migratePortfolios()' });
  const headers = readHeaders(sh);
  const nameCol = findColIdx(headers, 'Name');
  const fcdCol  = findColIdx(headers, 'FCD');
  const usdCol  = findColIdx(headers, 'USD');
  const cashCol = findColIdx(headers, 'Cash');
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
  return jsonResp({ ok: true });
}
```

## 4. Replace `addSymbolAction` (tag the new row with Portfolio; allow same symbol in another port)

```javascript
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

  const meta = fetchYahooMetadata(sym);
  if (!p.name     && meta?.name)     p.name     = meta.name;
  if (!p.sector   && meta?.sector)   p.sector   = meta.sector;
  if (!p.industry && meta?.industry) p.industry = meta.industry;

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
  return jsonResp({ status: 'ok', symbol: sym });
}
```

## 5. Replace `updateSymbolAction` (match by symbol + portfolio)

```javascript
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

  return jsonResp({ ok: true });
}
```

## 6. Replace `removeSymbolAction` (match by symbol + portfolio)

```javascript
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
  return jsonResp({ status: 'ok' });
}
```

## 7. Plan sheet — Portfolio appended LAST

Replace `PLAN_HDR`, `findPlanRow`, `savePlanAction`, `clearPlanAction`:

```javascript
const PLAN_HDR =
['Symbol','SL','Note','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','T13','TP1','TP2','TP3','Portfolio'];

function findPlanRow(planSheet, sym, port) {
  const lastRow = planSheet.getLastRow();
  if (lastRow < 2) return -1;
  const want = normSym(port) || DEFAULT_PORT;
  const data = planSheet.getRange(2, 1, lastRow - 1, PLAN_HDR.length).getValues();
  for (let r = data.length - 1; r >= 0; r--) {
    const rowPort = normSym(data[r][19]) || DEFAULT_PORT;   // col 20 = Portfolio
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
  rowVals[19] = port;   // ← Portfolio (last column)

  const ri = findPlanRow(planSheet, sym, port);
  const targetRow = ri >= 0 ? ri + 2 : planSheet.getLastRow() + 1;
  planSheet.getRange(targetRow, 4, 1, 16).setNumberFormat('@'); // T1..TP3 text format
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
```

> `getOrCreatePlanSheet` is unchanged — it already rewrites the header when the last column isn't what it
> expects, so with the new `PLAN_HDR` it will add the `Portfolio` header automatically.

## 8. transactions — write the Portfolio column (col 12)

Replace `writeTxnRow` and `appendTxnAction`:

```javascript
function writeTxnRow(sheet, row, p) {
  sheet.getRange(row, 1, 1, 7).setValues([[
    p.date, p.time, p.type, p.ticker,
    Number(p.shares), Number(p.price), Number(p.tradeValue)
  ]]);
  sheet.getRange(row, 11).setValue(p.commissionFree === 'TRUE');
  sheet.getRange(row, 12).setValue(p.portfolio || DEFAULT_PORT);   // ← Portfolio
  sheet.getRange(row, 8, 1, 3).setFormulas([[
    `=IF(K${row}=TRUE,0,G${row}*0.15%)`,
    `=H${row}*7%`,
    `=IF(C${row}="Buy",G${row}+H${row}+I${row},G${row}-H${row}-I${row})`
  ]]);
}

function appendTxnAction(ss, p) {
  const sheet = getTxnSheet(ss);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Date','Time','Type','Ticker','Shares',
      'Price_Per_Share','Trade_Value','Com','Tax','Trade_Value+Fee','Commission_Free','Portfolio']);
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
  }
  const row = sheet.getLastRow() + 1;
  writeTxnRow(sheet, row, p);
  return jsonResp({ ok: true });
}
```

(`updateTxnAction` is unchanged — it calls `writeTxnRow`, which now writes Portfolio.)

## 9. New: `transferSharesAction` + helper

```javascript
function appendTransferTxn(sheet, type, ticker, shares, price, portfolio) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Date','Time','Type','Ticker','Shares',
      'Price_Per_Share','Trade_Value','Com','Tax','Trade_Value+Fee','Commission_Free','Portfolio']);
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
    // copy Name/Sector/Industry/Category from any existing row for this symbol
    const anyRow = findClaudeRow(sh, headers, sym, from); // may be -1 if source was deleted
    const newRow = new Array(headers.length).fill('');
    if (anyRow > 0) {
      const src = sh.getRange(anyRow, 1, 1, headers.length).getValues()[0];
      ['Name','Sector','Industry','Category'].forEach(c => { const i = findColIdx(headers, c); if (i > 0) newRow[i-1] = src[i-1]; });
    }
    newRow[symCol - 1] = sym;
    newRow[qtyCol - 1] = sh_;
    newRow[avgCol - 1] = px;
    if (portCol > 0) newRow[portCol - 1] = to;
    sh.appendRow(newRow);
  }

  // 3. Write the Transfer-Out / Transfer-In pair (no cash change, no fees)
  const tx = getTxnSheet(ss);
  appendTransferTxn(tx, 'Transfer-Out', sym, sh_, px, from);
  appendTransferTxn(tx, 'Transfer-In',  sym, sh_, px, to);
  return jsonResp({ ok: true });
}
```

## 10. One-time migration — `migratePortfolios()`

```javascript
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
      if (n > 0) sh.getRange(2, col, n, 1).setValue('Long-Term');
    }
  });

  // (b) Read old cash from Claude row 2 (the first data row).
  const cl     = ss.getSheetByName('Claude');
  const clHead = cl.getRange(1, 1, 1, cl.getLastColumn()).getValues()[0];
  const cell   = label => { const i = clHead.indexOf(label); return i === -1 ? '' : cl.getRange(2, i + 1).getValue(); };
  const oldFcd = Number(cell('FCD')) || 0;
  const oldUsd = Number(cell('USD')) || 0;
  const oldRes = Number(cell('Cash Reserves')) || 0;
  const oldCash = (Number(cell('Cash')) || 0) || (oldFcd + oldUsd);

  // (c) Create the Portfolios registry sheet.
  const p = ss.insertSheet('Portfolios');
  p.getRange(1, 1, 1, 7).setValues([['id','Name','Color','Cash','CashReserves','FCD','USD']]);
  p.getRange(2, 1, 2, 7).setValues([
    ['Long-Term', 'Long-Term', '#4ade80', oldCash, oldRes, oldFcd, oldUsd],
    ['Trade',     'Trade',     '#f87171', 0,       0,      0,      0],
  ]);

  // (d) Clear old cash cells in Claude row 2 (cash now lives only in Portfolios).
  ['Cash','Cash Reserves','FCD','USD'].forEach(label => {
    const i = clHead.indexOf(label);
    if (i !== -1) cl.getRange(2, i + 1).clearContent();
  });

  Logger.log('Migration complete.');
}
```

## 11. (Optional) dedupe symbols in `refreshQuotes`

Same symbol can now appear in two portfolios. To avoid duplicate Finnhub fetches / Quotes rows, dedupe:

```javascript
const portSymbols = [...new Set(claudeData.slice(1)
  .map(r => String(r[0]).trim())
  .filter(s => s && s !== 'Symbol'))];
```

---

## Test sequence (on the copy)
1. Set `SHEET_ID` = copy's ID. Save.
2. Run `migratePortfolios()` → check the copy: `Portfolio` columns added; `Portfolios` sheet with Long-Term
   (your old cash) + Trade; Claude row-2 cash cells cleared. Re-run → "Already migrated." (no-op).
3. Apply edits 1–9, **Deploy → Manage deployments → edit → new version** (so the web app serves the new code).
4. In the app, add a throwaway profile pointing `sheetId` + `recordUrl` at the copy. The toggle appears.
   Buy into Trade, move shares, edit a plan in each port — verify isolation.
5. When happy: set `SHEET_ID` back to the real sheet, run `migratePortfolios()` on it, redeploy.
