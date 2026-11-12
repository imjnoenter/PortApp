import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feesOn } from './fees.ts';
import { fifoWalk, fifoBasis, fifoAfterTrade, fifoKey } from './fifo.ts';
import { buildModel, computeLimits, rowsForView, targetDollar } from './model.ts';
import type { Book } from './model.ts';
import { PriceIndex, benchmark, cashFlow, computeDividends, computeIRR, monthlyReturns, realizedSales, realizedTotals, returnSeries, dailyBars } from './analytics.ts';
import { session, txMarketDate, weekStart } from './market.ts';
import { squarify } from './treemap.ts';
import { driftAlert, planAlerts } from './alerts.ts';
import { blendedHoldings, trueExposure } from './etf.ts';
import { betas, closedTrades, concentration, correlation, groupPnl, holdingsPerf, stopCover, stressTest } from './insights.ts';
import { addDays } from './market.ts';
import { applyTransfer, contribRow, contribSig, dropContrib, replaceTx, setDetails, setTargets, txSig } from './edits.ts';
import { cleanPlan, nextTranche, parseTranche, parseTrim, planIsEmpty, planStrings, trancheDollars } from './plan.ts';
import { allocChanges, allocEqual, allocFillRest, allocGroups, allocMatchCurrent, allocReset, allocRoom, allocScale, allocSet, allocTotal } from './alloc.ts';
import type { AllocRow } from './alloc.ts';
import { applyTrade, newPins, pinRows, pinTxs, pinWallet, tradeEffect } from './trade.ts';
import type { TradeInput } from './trade.ts';
import type { HoldingRow, PortfolioRow, Tx } from './types.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

let rowN = 1;
const tx = (dateStr: string, type: string, ticker: string, shares: number, price: number, portfolio = 'Long-Term', extra: Partial<Tx> = {}): Tx =>
  ({ row: ++rowN, dateStr, time: '', type, ticker, shares, price, tradeValue: shares * price, portfolio, commissionFree: false, note: '', ...extra });

const row = (portfolio: string, symbol: string, qty: number | null, avgPrice: number | null, price: number | null, extra: Partial<HoldingRow> = {}): HoldingRow =>
  ({ portfolio, symbol, name: null, sector: null, industry: null, category: null, custom: null, myGroup: null, qty, avgPrice, target: null, price, marketCap: null, ...extra });

const port = (name: string, extra: Partial<PortfolioRow> = {}): PortfolioRow =>
  ({ id: name, name, color: '', cash: 0, cashRes: 0, fcd: 0, usd: 0, capPct: 0, ...extra });

test('fees: VAT is still owed on a waived commission', () => {
  near(feesOn(1000).total, 1.5 + 0.105);
  const free = feesOn(1000, true);
  assert.equal(free.comm, 0);
  near(free.tax, 0.105);
});

test('fifo: same-day buys compress, sells retire oldest first', () => {
  const r = fifoWalk([
    tx('2026-01-02', 'Buy', 'A', 1, 100),
    tx('2026-01-02', 'Buy', 'A', 1, 110),   // same day → one lot @105
    tx('2026-01-05', 'Buy', 'A', 2, 130),
    tx('2026-01-09', 'Sell', 'A', 3, 150),  // retires 2@105 + 1@130
  ]);
  const b = fifoBasis(r, 'Long-Term', 'A', 1)!;
  near(b.qty, 1); near(b.avg, 130);
  near(r.sells[0].costOut, 2 * 105 + 130);
  // a rolling average would have said (100+110+260)/4 = 117.5 for the remainder
});

test('fifo: lots never cross portfolios', () => {
  const r = fifoWalk([
    tx('2026-01-02', 'Buy', 'A', 1, 100, 'Long-Term'),
    tx('2026-01-03', 'Buy', 'A', 1, 200, 'Trade'),
    tx('2026-01-04', 'Sell', 'A', 1, 250, 'Trade'),
  ]);
  near(r.sells[0].costOut, 200);
  near(fifoBasis(r, 'Long-Term', 'A', 1)!.avg, 100);
  assert.equal(fifoBasis(r, 'Trade', 'A', 0), null);
});

test('fifo: a transfer carries its lots and realizes nothing', () => {
  const r = fifoWalk([
    tx('2026-01-02', 'Buy', 'A', 2, 100, 'Long-Term'),
    tx('2026-01-03', 'Buy', 'A', 2, 140, 'Long-Term'),
    tx('2026-02-01', 'Transfer-Out', 'A', 3, 120, 'Long-Term'),
    tx('2026-02-01', 'Transfer-In', 'A', 3, 120, 'Trade'),
  ]);
  assert.equal(r.sells.length, 0);
  near(fifoBasis(r, 'Trade', 'A', 3)!.cost, 2 * 100 + 140);
  near(fifoBasis(r, 'Long-Term', 'A', 1)!.avg, 140);
});

test('fifo: an incomplete ledger is not trusted', () => {
  const r = fifoWalk([tx('2026-01-02', 'Buy', 'A', 1, 100)]);
  assert.equal(fifoBasis(r, 'Long-Term', 'A', 5), null);          // sheet says 5, ledger says 1
  assert.ok(fifoBasis(r, 'Long-Term', 'A', 1.005));               // within 1%: rounding
  assert.ok(r.books.has(fifoKey('Long-Term', 'A')));
});

test('fifo: previewing a trade', () => {
  const r = fifoWalk([tx('2026-01-02', 'Buy', 'A', 1, 100), tx('2026-01-05', 'Buy', 'A', 1, 200)]);
  const b = fifoBasis(r, 'Long-Term', 'A', 2);
  near(fifoAfterTrade(b, 'Sell', 1, 300, '2026-01-09')!.avg, 200);
  near(fifoAfterTrade(b, 'Buy', 2, 300, '2026-01-09')!.avg, 225);
});

test('realized P&L is net of fees on both legs', () => {
  const r = fifoWalk([tx('2026-01-02', 'Buy', 'A', 10, 100), tx('2026-01-09', 'Sell', 'A', 10, 110)]);
  const tot = realizedTotals(realizedSales(r, 'ALL'));
  const fIn = feesOn(1000).total, fOut = feesOn(1100).total;
  near(tot.pnl, 100 - fIn - fOut);
  near(tot.cost, 1000 + fIn);
  assert.equal(realizedSales(r, 'Trade').length, 0);
});

const book = (rows: HoldingRow[], registry: PortfolioRow[], extra: Partial<Book> = {}): Book => ({ rows, registry, quotes: {}, fifo: null, ...extra });

test('limits: reserve, Trade overlap, split shares and the LT+ETF pool', () => {
  const b = book(
    [row('Long-Term', 'A', 10, 50, 100), row('ETF', 'VOO', 1, 400, 500), row('Growth', 'G', 5, 100, 100), row('Trade', 'T', 2, 100, 250)],
    [port('Long-Term', { cash: 2500, cashRes: 0.1 }), port('Growth', { capPct: 0.3 }), port('Trade', { capPct: 0.2 }), port('ETF')],
  );
  const L = computeLimits(b);
  near(L.whole, 1000 + 500 + 500 + 500 + 2500);   // 5000
  near(L.reserve, 500);
  near(L.spendable, 2000);
  near(L.shares.get('Long-Term')!, 0.7);          // the single blank row takes the remainder
  near(L.dollarOf('Trade'), 1000);
  near(L.dollarOf('Growth'), 0.3 * 4500);
  near(L.dollarOf('ETF'), L.dollarOf('Long-Term'));
  near(L.poolStock('ETF'), 1500);

  const growth = buildModel(b, 'Growth', L);
  near(growth.cash, 1350 - 500);
  near(growth.totalInvested, 500);                 // headroom is not capital deployed
  const lt = buildModel(b, 'Long-Term', L);
  near(lt.limit!.dollar, 3150);
  near(lt.cash, 3150 - 1500);
  near(lt.limit!.unfunded, 0);
  const all = buildModel(b, 'ALL', L);
  near(all.totalCurrent, 5000);
  near(all.investable, 4500);
});

test('limits: over the cap floors cash at zero', () => {
  const b = book([row('Trade', 'T', 10, 100, 100)], [port('Long-Term', { cash: 1000 }), port('Trade', { capPct: 0.25 })]);
  const m = buildModel(b, 'Trade');
  near(m.limit!.dollar, 500); near(m.limit!.over, 500); near(m.cash, 0);
});

test('ALL merges a symbol held in two portfolios; quotes override the sheet price', () => {
  const fifo = fifoWalk([tx('2026-01-02', 'Buy', 'A', 4, 100, 'Long-Term'), tx('2026-01-03', 'Buy', 'A', 1, 200, 'Trade')]);
  const b = book(
    [row('Long-Term', 'A', 4, 999, 150, { target: 0.2, name: 'Alpha' }), row('Trade', 'A', 1, 999, null), row('Long-Term', 'W', null, null, 10)],
    [port('Long-Term', { cash: 100 }), port('Trade')],
    { fifo, quotes: { A: { price: 160, change: 2, changePct: 1.27, volume: null, high52: 200, low52: 90, ext: null, extPrice: null } } },
  );
  const rows = rowsForView(b, 'ALL');
  const a = rows.find(r => r.symbol === 'A')!;
  near(a.qty!, 5); near(a.avgPrice!, (400 + 200) / 5);   // ledger basis, not the sheet's 999
  assert.equal(rowsForView(b, 'Trade')[0].name, 'Alpha'); // metadata filled from the sibling row

  const m = buildModel(b, 'ALL');
  assert.equal(m.positions.length, 1);
  assert.equal(m.watchlist.length, 1);
  near(m.positions[0].currentValue, 800);
  near(m.dayChange!, 10);
  near(m.totalPnlPct, (800 - 600) / 600 * 100);
});

test('market clock and ledger dates', () => {
  assert.equal(session(new Date('2026-11-10T15:00:00Z')), 'open');    // Tue 10:00 ET
  assert.equal(session(new Date('2026-11-10T13:00:00Z')), 'pre');
  assert.equal(session(new Date('2026-11-10T22:00:00Z')), 'post');
  assert.equal(session(new Date('2026-11-14T15:00:00Z')), 'closed');  // Saturday
  assert.equal(txMarketDate('2026-10-17', '03:10:00'), '2026-10-16'); // Thai small hours = previous US session
  assert.equal(txMarketDate('2026-10-17', ''), '2026-10-17');
  assert.equal(weekStart('2026-11-08'), '2026-11-02');                // Sunday belongs to the week before
});

function flatHistory(days: number, syms: Record<string, (i: number) => number>) {
  const prices: Record<string, Record<string, number>> = {};
  const dates: string[] = [];
  for (let i = 0, d = new Date(Date.UTC(2026, 0, 1)); dates.length < days; i++, d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() % 6 === 0) continue;
    dates.push(d.toISOString().slice(0, 10));
  }
  for (const s in syms) { prices[s] = {}; dates.forEach((d, i) => prices[s][d] = syms[s](i)); }
  return { prices, dates };
}

test('time-weighted returns ignore deposits', () => {
  const { prices, dates } = flatHistory(60, { SPY: i => 100 + i, A: i => 50 * 1.01 ** i });
  const idx = new PriceIndex(prices);
  near(idx.at('A', '2026-01-03')!, prices.A['2026-01-02']);  // Saturday → Friday's close
  const txs = [tx(dates[0], 'Buy', 'A', 10, 50), tx(dates[30], 'Buy', 'A', 100, prices.A[dates[30]])];
  const s = returnSeries(txs, idx)!;
  assert.equal(s.rp.length, 59);
  for (const r of s.rp) near(r, 0.01, 1e-9);                 // the 10× top-up never shows as a return
  const m = monthlyReturns(s)!;
  assert.equal(m.years[0].year, 2026);
  near(m.years[0].yearTotal!, 1.01 ** 59 - 1, 1e-9);
  const bars = dailyBars(s, 30, 0.5, '2026-12-31');
  assert.equal(bars.length, 30);
  assert.ok(bars[29].today);
});

test('IRR: one buy, doubled in a year', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const irr = computeIRR([tx('2025-01-01', 'Buy', 'A', 1, 100)], { gross: 0, net: 0, byTicker: new Map(), events: [] }, 200, now)!;
  near(irr.rate, 100, 1e-4);
});

test('dividends pay on the shares held on the ex-date', () => {
  const txs = [tx('2026-01-02', 'Buy', 'A', 10, 100), tx('2026-03-01', 'Sell', 'A', 4, 100)];
  const d = computeDividends(txs, { prices: {}, dividends: { A: { '2026-02-01': 1, '2026-04-01': 1, '2025-12-01': 1 } } });
  near(d.gross, 10 + 6);
  near(d.net, 16 * 0.85);
});

test('cash flow: weekly net and runway', () => {
  const txs = [
    tx('2026-10-05', 'Buy', 'A', 1, 1000),
    tx('2026-10-27', 'Buy', 'A', 1, 400),
    tx('2026-11-03', 'Sell', 'A', 1, 500),
  ];
  const cf = cashFlow(txs, [{ row: 2, portfolio: 'Long-Term', date: '2026-10-20', type: 'Deposit', amount: 3300, currency: 'THB', note: '', thb: 3300, usd: 100, rate: 33 }], 33, 700, '2026-11-11')!;
  assert.equal(cf.weeks.length, 12);
  assert.ok(cf.weeks[11].current);
  assert.equal(cf.avgWeeks, 5);                                // first trade's week … last complete week
  // The $100 deposit is reported, but it is not part of the net.
  const net = (500 - feesOn(500).total) - (1000 + feesOn(1000).total) - (400 + feesOn(400).total);
  near(cf.weeks.reduce((s, w) => s + w.deposited, 0), 100);
  near(cf.weeks.reduce((s, w) => s + w.net, 0), net);
  near(cf.avgNet!, net / 5);
  near(cf.runway!, 700 / (-net / 5));
  assert.deepEqual(cf.months.map(m => m.key), ['2026-10', '2026-11']);
});

test('squarify fills the box in proportion to value', () => {
  const vals = [50, 20, 12, 8, 6, 3, 1, 0];
  const rects = squarify(vals, v => v, 400, 300);
  assert.equal(rects.length, 7);                               // the zero is dropped
  near(rects.reduce((s, r) => s + r.w * r.h, 0), 400 * 300, 1e-3);
  for (const r of rects) {
    near(r.w * r.h, r.item / 100 * 400 * 300, 1e-3);
    assert.ok(r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= 400 + 1e-6 && r.y + r.h <= 300 + 1e-6);
  }
  assert.deepEqual(squarify([], v => v, 400, 300), []);
  assert.deepEqual(squarify(vals, v => v, 0, 300), []);
});

const trade = (extra: Partial<TradeInput> = {}): TradeInput =>
  ({ type: 'Buy', symbol: 'AAA', portfolio: 'Long-Term', shares: 10, price: 100, commissionFree: false, cashSource: 'USD', dateStr: '2026-03-02', time: '21:30:00', note: '', ...extra });

test('trade: a buy averages in and pays value plus fees from the chosen balance', () => {
  const fx = tradeEffect(trade(), row('Long-Term', 'AAA', 10, 50, 100), null, port('Long-Term', { fcd: 500, usd: 2000 }));
  near(fx.newQty, 20); near(fx.newAvg, 75);
  near(fx.amount, 1000 + 1000 * 0.0015 * 1.07);
  near(fx.usd, 2000 - fx.amount); near(fx.fcd, 500);
  const fcd = tradeEffect(trade({ cashSource: 'FCD', commissionFree: true }), null, null, port('Long-Term', { fcd: 500, usd: 2000 }));
  near(fcd.fcd, 500 - 1000 - 1000 * 0.0015 * 0.07); near(fcd.usd, 2000); near(fcd.newAvg, 100);
});

test('trade: a sell retires the oldest lot, and selling out zeroes the holding', () => {
  const txs = [tx('2026-01-05', 'Buy', 'AAA', 10, 50), tx('2026-02-05', 'Buy', 'AAA', 10, 150)];
  const basis = fifoBasis(fifoWalk(txs), 'Long-Term', 'AAA', 20);
  const half = tradeEffect(trade({ type: 'Sell' }), row('Long-Term', 'AAA', 20, 100, 200), basis, port('Long-Term', { usd: 0 }));
  near(half.newQty, 10); near(half.newAvg, 150); assert.equal(half.sellAll, false);
  near(half.usd, 1000 - 1000 * 0.0015 * 1.07);
  const all = tradeEffect(trade({ type: 'Sell', shares: 20 }), row('Long-Term', 'AAA', 20, 100, 200), basis, null);
  assert.equal(all.sellAll, true); assert.equal(all.newQty, 0); assert.equal(all.newAvg, 0);
});

test('trade: applying one adds the ledger row, moves the wallet and leaves the inputs alone', () => {
  const state = { rows: [row('Long-Term', 'AAA', 10, 50, 100)], registry: [port('Long-Term', { fcd: 0, usd: 5000, cash: 5000 }), port('Trade')], txs: [tx('2026-01-05', 'Buy', 'AAA', 10, 50)] };
  const input = trade({ symbol: 'NEW', portfolio: 'Trade' });
  const fx = tradeEffect(input, null, null, state.registry[0]);
  const next = applyTrade(state, input, fx);
  assert.equal(state.rows.length, 1); assert.equal(state.txs.length, 1); assert.equal(state.registry[0].usd, 5000);
  assert.equal(next.rows.length, 2); near(next.rows[1].qty!, 10); assert.equal(next.rows[1].portfolio, 'Trade');
  assert.equal(next.txs.length, 2); assert.equal(next.tx.row, state.txs[0].row + 1);
  near(next.registry[0].usd, 5000 - fx.amount); near(next.registry[0].cash, next.registry[0].usd);
  assert.equal(next.registry[1].usd, 0);
});

test('pins: a stale read is overridden until the sheet agrees or the pin expires', () => {
  const pins = newPins();
  pins.rows.set('Long-Term|AAA', { portfolio: 'Long-Term', symbol: 'AAA', qty: 20, avgPrice: 75, price: 100, until: 1000 });
  pins.rows.set('Trade|NEW', { portfolio: 'Trade', symbol: 'NEW', qty: 5, avgPrice: 10, price: 10, until: 1000 });
  pins.cash = { fcd: 0, usd: 900, until: 1000 };
  const stale = [row('Long-Term', 'AAA', 10, 50, 100)];
  const held = pinRows(stale, pins, 500);
  near(held[0].qty!, 20); assert.equal(held.length, 2); assert.equal(stale.length, 1); assert.equal(pins.rows.size, 2);
  near(pinWallet([port('Long-Term', { usd: 2000 })], pins, 500)[0].usd, 900);

  const fresh = pinRows([row('Long-Term', 'AAA', 20, 75, 100)], pins, 600);
  assert.equal(fresh.length, 2); assert.equal(pins.rows.size, 1);           // AAA agreed, NEW still pinned
  near(pinWallet([port('Long-Term', { usd: 900 })], pins, 600)[0].usd, 900); assert.equal(pins.cash, null);
  assert.equal(pinRows(stale, pins, 2000).length, 1); assert.equal(pins.rows.size, 0);   // expired
});

test('pins: a just-recorded trade stays in the ledger until a read includes it', () => {
  const old = tx('2026-01-05', 'Buy', 'AAA', 10, 100);
  const mine = { ...tx('2026-03-02', 'Buy', 'AAA', 10, 100), row: old.row + 1 };
  const pins = newPins();
  pins.txs.push({ tx: mine, afterRow: old.row, until: 1000 });
  const stale = pinTxs([old], pins, 500);
  assert.equal(stale.length, 2); assert.equal(pins.txs.length, 1);
  // An identical trade that was already there before is not mistaken for the new one.
  const twin = { ...mine, row: old.row };
  assert.equal(pinTxs([twin], pins, 500).length, 2);
  const fresh = pinTxs([old, { ...mine, row: old.row + 3 }], pins, 600);
  assert.equal(fresh.length, 2); assert.equal(pins.txs.length, 0);
});

test('edits: deleting a buy gives back its shares and its cash, and renumbers the rows below', () => {
  const a = tx('2026-01-05', 'Buy', 'AAA', 10, 50), b = tx('2026-02-05', 'Buy', 'AAA', 10, 150), c = tx('2026-02-06', 'Buy', 'BBB', 1, 10);
  const state = { rows: [row('Long-Term', 'AAA', 20, 100, 200), row('Long-Term', 'BBB', 1, 10, 10)], registry: [port('Long-Term', { fcd: 5, usd: 100, cash: 105 })], txs: [a, b, c] };
  const r = replaceTx(state, b, null);
  near(r.rows[0].qty!, 10); near(r.rows[0].avgPrice!, 50); near(r.avg!, 50);
  near(r.registry[0].usd, 100 + 1500 + 1500 * 0.0015 * 1.07); near(r.registry[0].fcd, 5);
  assert.deepEqual(r.txs.map(t => t.row), [a.row, b.row]);
  assert.equal(state.txs.length, 3); near(state.rows[0].qty!, 20);
});

test('edits: changing a trade moves the holding and cash by the difference only', () => {
  const a = tx('2026-01-05', 'Buy', 'AAA', 10, 50);
  const state = { rows: [row('Long-Term', 'AAA', 10, 50, 60)], registry: [port('Long-Term', { usd: 1000 })], txs: [a] };
  const r = replaceTx(state, a, { ...a, shares: 12, price: 40, tradeValue: 480 });
  near(r.rows[0].qty!, 12); near(r.rows[0].avgPrice!, 40);
  near(r.cashDelta, (500 - 480) * (1 + 0.0015 * 1.07)); near(r.registry[0].usd, 1000 + r.cashDelta);
  // A holding the ledger cannot account for keeps its stored average.
  const odd = replaceTx({ ...state, rows: [row('Long-Term', 'AAA', 500, 7, 60)] }, a, { ...a, shares: 12 });
  near(odd.rows[0].qty!, 502); near(odd.rows[0].avgPrice!, 7); assert.equal(odd.avg, null);
  assert.equal(txSig(a), '2026-01-05|Buy|AAA|10.000000|50.000000');
});

test('edits: a transfer carries cost across and realizes nothing', () => {
  const state = { rows: [row('Long-Term', 'AAA', 10, 99, 200, { name: 'Alpha' })], txs: [tx('2026-01-05', 'Buy', 'AAA', 10, 50)] };
  const part = applyTransfer(state, 'AAA', 4, 'Long-Term', 'Trade', { dateStr: '2026-03-02', time: '10:00:00' });
  near(part.price, 50); near(part.rows[0].qty!, 6);
  assert.equal(part.rows[1].portfolio, 'Trade'); near(part.rows[1].qty!, 4); near(part.rows[1].avgPrice!, 50); assert.equal(part.rows[1].name, 'Alpha');
  assert.deepEqual(part.txs.slice(1).map(t => t.type), ['Transfer-Out', 'Transfer-In']);
  const walked = fifoWalk(part.txs);
  assert.equal(walked.sells.length, 0);
  near(fifoBasis(walked, 'Trade', 'AAA', 4)!.avg, 50); near(fifoBasis(walked, 'Long-Term', 'AAA', 6)!.avg, 50);
  const all = applyTransfer(state, 'AAA', 10, 'Long-Term', 'Trade', { dateStr: '2026-03-02', time: '10:00:00' });
  assert.equal(all.rows.length, 1); assert.equal(all.rows[0].portfolio, 'Trade');
});

test('edits: deposits, targets and tags', () => {
  const dep = contribRow({ type: 'Deposit', date: '2026-03-02', thb: 35000, usd: 1000, note: '' }, 'Long-Term', 5);
  assert.equal(dep.currency, 'THB'); near(dep.amount, 35000); near(dep.rate!, 35);
  const out = contribRow({ type: 'Withdraw', date: '2026-03-03', thb: 3500, usd: 100, note: '' }, 'Long-Term', 6);
  assert.equal(out.currency, 'USD'); near(out.amount, 100);
  assert.equal(contribSig(dep), '2026-03-02|Long-Term|Deposit|35000.000000');
  assert.deepEqual(dropContrib([dep, out], 5).map(c => c.row), [5]);

  const rows = [row('Long-Term', 'AAA', 10, 50, 60), row('Trade', 'AAA', 1, 50, 60), row('Long-Term', 'BBB', 1, 1, 1)];
  const t2 = setTargets(rows, 'Long-Term', { AAA: 0.2, ZZZ: 0.5 });
  near(t2[0].target!, 0.2); assert.equal(t2[1].target, null); assert.equal(t2.length, 3);
  const d = setDetails(rows, 'Long-Term', 'AAA', { category: 'Growth', custom: 'AI', myGroup: '', qty: 12 });
  assert.equal(d[0].category, 'Growth'); near(d[0].qty!, 12); near(d[0].avgPrice!, 50);
  assert.equal(d[1].category, null); assert.equal(d[1].custom, 'AI'); near(d[1].qty!, 1); assert.equal(d[2].custom, null);
});

test('plan: the sheet format round-trips and each entry buys its step toward the target', () => {
  assert.deepEqual(parseTranche('150:500.00:50'), { price: 150, cumPct: 50 });
  assert.deepEqual(parseTranche(''), { price: null, cumPct: 0 });
  assert.deepEqual(parseTrim('70/50'), { price: 70, pct: 50 });
  assert.deepEqual(parseTrim('70:50:00'), { price: 70, pct: 50 });
  assert.equal(parseTrim(''), null);
  const plan = cleanPlan({ sl: 80, note: ' hold ', trims: [{ price: null, pct: 10 }, { price: 200, pct: 25 }],
    tranches: [{ price: 100, cumPct: 50 }, { price: null, cumPct: 0 }, { price: 90, cumPct: 100 }, { price: null, cumPct: 0 }] });
  assert.equal(plan.tranches.length, 3); assert.equal(plan.trims.length, 1); assert.equal(plan.note, 'hold');
  // Already 30% full, $10,000 target. A cleared rung has been bought, so the one after it starts from where the position stands.
  assert.deepEqual(trancheDollars(plan.tranches, 30, 10000), [2000, 0, 7000]);
  const s = planStrings(plan, 30, 10000);
  assert.equal(s.tranches, '100:2000.00:50,,90:7000.00:100'); assert.equal(s.tp1, '200/25'); assert.equal(s.tp2, '');
  assert.equal(nextTranche(plan, 95)!.index, 2); assert.equal(nextTranche(plan, 85), null);
  assert.equal(planIsEmpty(plan), false); assert.equal(planIsEmpty(cleanPlan({ sl: null, note: '', tranches: [{ price: null, cumPct: 0 }], trims: [] })), true);
});

const pos = (symbol: string, qty: number, avg: number, price: number, extra: Partial<HoldingRow> = {}) => row('Long-Term', symbol, qty, avg, price, extra);
const modelOf = (rows: HoldingRow[], cash = 0) => buildModel({ rows, registry: [port('Long-Term', { usd: cash, cash })], quotes: {}, fifo: null }, 'ALL');

test('alerts: a plan level reached, one merely close, and nothing while far away', () => {
  const plan = cleanPlan({ sl: 90, note: '', trims: [{ price: 130, pct: 25 }], tranches: [{ price: 95, cumPct: 50 }, { price: 80, cumPct: 100 }] });
  const at = (price: number, qty = 10) => planAlerts('Long-Term', 'AAA', plan, { price, qty, currentValue: qty * price, targetDollar: 4000 }).map(a => a.key.split(':')[2]);
  assert.deepEqual(at(110), []);
  assert.deepEqual(at(131), ['TP1_HIT']);
  assert.deepEqual(at(127), ['TP1_NEAR']);
  assert.deepEqual(at(94), ['SL_NEAR', 'T1_HIT']);
  assert.deepEqual(at(89), ['SL_HIT', 'T1_HIT']);
  // Stops and take-profits need shares; an entry does not.
  assert.deepEqual(at(89, 0), ['T1_HIT']);
  const entry = planAlerts('Long-Term', 'AAA', plan, { price: 94, qty: 10, currentValue: 940, targetDollar: 4000 }).find(a => a.kind === 'entry')!;
  near(entry.dollars, (50 - 23.5) / 100 * 4000);
  assert.equal(driftAlert('Long-Term', 'AAA', 1100, 1000, 25), null);
  near(driftAlert('Long-Term', 'AAA', 1400, 1000, 25)!.gap, 40);
  assert.equal(driftAlert('Long-Term', 'AAA', 1400, 1000, 0), null);
});

test('insights: concentration, stop cover and a market shock', () => {
  const m = modelOf([pos('AAA', 10, 50, 60, { sector: 'Tech' }), pos('BBB', 10, 30, 40, { sector: 'Tech' })], 1000);
  const c = concentration(m);
  assert.equal(c.largest!.symbol, 'AAA'); near(c.largest!.pct, 60); near(c.hhi, 60 * 60 + 40 * 40); near(c.cashPct, 50);
  assert.equal(c.sectors, 1); near(c.topSector!.pct, 100);
  const cover = stopCover(m, p => p.symbol === 'AAA' ? { sl: 54, note: '', tranches: [], trims: [] } : undefined);
  near(cover.coveredPct, 60); near(cover.maxLoss, 60); near(cover.unprotected, 400);
  const [down] = stressTest(m, new Map([['AAA', 2]]), [-10]);
  near(down.dollars, -600 * 0.2 - 400 * 0.1); near(down.pct, down.dollars / 2000 * 100);
  assert.equal(down.worst[0].symbol, 'AAA');
  const groups = groupPnl(m, 'sector');
  assert.equal(groups.length, 1); near(groups[0].pnl, 200); near(groups[0].pct!, 25);
});

test('insights: correlation needs shared history, and beta comes from it', () => {
  const prices: Record<string, Record<string, number>> = { AAA: {}, BBB: {}, SPY: {}, NEW: {} };
  let a = 100, s = 100, d = '2026-01-01';
  for (let i = 0; i < 60; i++) {
    const r = Math.sin(i) * 0.01;
    s *= 1 + r; a *= 1 + 2 * r;
    prices.SPY[d] = s; prices.AAA[d] = a; prices.BBB[d] = 200 - s;
    if (i > 50) prices.NEW[d] = 10 + i;
    d = addDays(d, 1);
  }
  const m = modelOf([pos('AAA', 1, 1, 1), pos('BBB', 1, 1, 1), pos('NEW', 1, 1, 1)]);
  const c = correlation(m, prices)!;
  const i = c.symbols.indexOf('AAA'), j = c.symbols.indexOf('BBB'), k = c.symbols.indexOf('NEW');
  assert.equal(c.r[i][i], 1); assert.ok(c.r[i][j]! < -0.9); assert.equal(c.r[i][k], null);
  const b = betas(['AAA', 'NEW'], prices, d);
  near(b.get('AAA')!, 2, 0.05); assert.equal(b.has('NEW'), false);
});

test('insights: result per holding and the journal of closed trades', () => {
  const txs = [tx('2026-01-05', 'Buy', 'AAA', 10, 50), tx('2026-02-05', 'Sell', 'AAA', 4, 70), tx('2026-03-05', 'Sell', 'AAA', 6, 80), tx('2026-03-06', 'Buy', 'BBB', 5, 20)];
  const sales = realizedSales(fifoWalk(txs), 'ALL');
  const trades = closedTrades(txs, sales);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].openDate, '2026-01-05'); assert.equal(trades[0].closeDate, '2026-03-05'); assert.equal(trades[0].holdDays, 59);
  near(trades[0].shares, 10); near(trades[0].avgExit, 76); near(trades[0].pnl, sales[0].pnl + sales[1].pnl);
  const m = modelOf([pos('BBB', 5, 20, 30)]);
  const perf = holdingsPerf(m, txs, sales, { gross: 0, net: 3, byTicker: new Map([['BBB', { gross: 4, net: 3 }]]), events: [] });
  const bbb = perf.find(h => h.symbol === 'BBB')!, aaa = perf.find(h => h.symbol === 'AAA')!;
  near(bbb.unrealized, 50); near(bbb.total, 53); near(bbb.deployed, 100); near(bbb.pct!, 53);
  assert.equal(aaa.held, false); near(aaa.deployed, 500); near(aaa.realized, trades[0].pnl);
});

test('etf: a stock held directly and inside a fund shows its real weight', () => {
  const m = modelOf([pos('FUND', 10, 100, 100, { industry: 'ETF' }), pos('AAA', 1, 100, 100)], 0);
  const etf = { FUND: { holdingsCount: 500, topSector: null, netAssets: null, expenseRatio: 0.0003, dividendYield: null, trailingReturns: null,
    topHoldings: [{ symbol: 'AAA', name: 'Alpha', weight: 0.1 }, { symbol: 'ZZZ', name: 'Zed', weight: 0.05 }] } };
  const blend = blendedHoldings(m, etf);
  near(blend.fundValue, 1000); near(blend.rows[0].value, 100); near(blend.unseen, 850);
  const x = trueExposure(m, etf)!;
  const a = x.rows.find(r => r.symbol === 'AAA')!;
  near(a.direct, 100 / 1100 * 100); near(a.viaEtf, 100 / 1100 * 100); assert.equal(a.hidden, true);
  assert.equal(trueExposure(modelOf([pos('AAA', 1, 100, 100)]), {}), null);
});

const arow = (symbol: string, now: number, target: number, extra: Partial<AllocRow> = {}): AllocRow =>
  ({ symbol, name: null, now, saved: target, target, locked: false, category: null, custom: null, myGroup: null, ...extra });

test('targets: a row stops at the room left, and a locked row never moves', () => {
  const rows = [arow('A', 30, 40), arow('B', 20, 30), arow('C', 10, 20, { locked: true })];
  near(allocTotal(rows), 90); near(allocRoom(rows, 'A'), 50);
  near(allocSet(rows, 'A', 80)[0].target, 50);
  assert.equal(allocSet(rows, 'C', 5), rows);
  near(allocSet(rows, 'B', -4)[1].target, 0);
  assert.deepEqual(allocChanges(allocSet(rows, 'A', 45)), { A: 0.45 });
});

test('targets: the tools move only what is unlocked and never pass 100', () => {
  const rows = [arow('A', 60, 40), arow('B', 60, 30), arow('C', 10, 20, { locked: true })];
  const match = allocMatchCurrent(rows);
  near(match[0].target, 40); near(match[1].target, 40); near(match[2].target, 20); near(allocTotal(match), 100);
  const equal = allocEqual([...rows, arow('D', 0, 0)]);
  near(equal[0].target, 40); near(equal[1].target, 40); near(equal[3].target, 0);
  const fill = allocFillRest(rows);
  near(fill[0].target, 80 * 4 / 7, 0.01); near(allocTotal(fill), 100, 0.02);
  near(allocReset(allocSet(rows, 'A', 10))[0].target, 40);
});

test('targets: scaling a group keeps its proportions and leaves locked members alone', () => {
  const rows = [arow('A', 0, 20, { category: 'X' }), arow('B', 0, 10, { category: 'X' }), arow('C', 0, 10, { category: 'X', locked: true }), arow('D', 0, 30, { category: 'Y' })];
  const g = allocGroups(rows, 'category');
  assert.deepEqual(g.map(x => x.key), ['X', 'Y']); near(g[0].target, 40); assert.equal(g[0].locked, false);
  const half = allocScale(rows, g[0].members, 25);
  near(half[0].target, 10); near(half[1].target, 5); near(half[2].target, 10); near(half[3].target, 30);
  // Asking for more than the room gives the room.
  near(allocTotal(allocScale(rows, g[0].members, 95)), 100);
  const zero = allocScale([arow('A', 0, 0), arow('B', 0, 0)], ['A', 'B'], 30);
  near(zero[0].target, 15); near(zero[1].target, 15);
});

test('targets in the combined view are shares of the whole account', () => {
  // Long-Term holds $6,000 of stock, Growth $2,000; $2,000 of cash, split 75 / 25 between them.
  const book: Book = {
    rows: [
      row('Long-Term', 'AAA', 60, 50, 100, { target: 0.5 }), row('Growth', 'AAA', 10, 50, 100, { target: 0.25 }),
      row('Growth', 'BBB', 10, 50, 100, { target: 0.5 }), row('Growth', 'WWW', null, null, 10, { target: 0.1 }),
    ],
    registry: [port('Long-Term', { usd: 2000, cash: 2000, capPct: 0.75 }), port('Growth', { capPct: 0.25 })], quotes: {}, fifo: null,
  };
  const lt = buildModel(book, 'Long-Term'), gr = buildModel(book, 'Growth'), all = buildModel(book, 'ALL');
  near(lt.investable, 7500); near(gr.investable, 2500); near(all.investable, 10000);
  near(lt.positions[0].target!, 0.5);                           // a portfolio tab is untouched
  const aaa = all.positions.find(p => p.symbol === 'AAA')!, bbb = all.positions.find(p => p.symbol === 'BBB')!;
  near(aaa.target!, (0.5 * 7500 + 0.25 * 2500) / 10000);       // both portfolios' asks, added
  near(bbb.target!, 0.5 * 2500 / 10000);
  near(all.watchlist.find(w => w.symbol === 'WWW')!.target!, 0.1 * 2500 / 10000);
  near(targetDollar(aaa, all), 0.5 * 7500 + 0.25 * 2500);      // the dollars are the same either way
});

test('benchmark: every line starts from the same close and compounds from there', () => {
  const { prices, dates } = flatHistory(60, { SPY: i => 100 * 1.002 ** i, QQQ: i => 200 * 1.003 ** i, A: i => 50 * 1.01 ** i });
  const idx = new PriceIndex(prices);
  const s = returnSeries([tx(dates[0], 'Buy', 'A', 10, 50), tx(dates[30], 'Buy', 'A', 100, prices.A[dates[30]])], idx)!;
  assert.equal(s.start, dates[0]);

  const all = benchmark(s, 0, { idx, sym: 'QQQ' });
  assert.equal(all.dates.length, 60); assert.equal(all.dates[0], dates[0]); assert.equal(all.dates[59], dates[59]);
  assert.equal(new Set(all.dates).size, 60);                      // no date twice
  for (const line of [all.portfolio, all.spy, all.other!]) { assert.equal(line.length, 60); assert.equal(line[0], 0); }
  near(all.portfolio[59], (1.01 ** 59 - 1) * 100, 1e-6);          // the top-up on day 30 moves nothing
  near(all.spy[59], (1.002 ** 59 - 1) * 100, 1e-6);
  near(all.other![59], (1.003 ** 59 - 1) * 100, 1e-6);

  const last10 = benchmark(s, 10, { idx, sym: 'QQQ' });
  assert.equal(last10.dates.length, 11); assert.equal(last10.dates[0], dates[49]);
  near(last10.portfolio[10], (1.01 ** 10 - 1) * 100, 1e-6);
  near(last10.other![10], (1.003 ** 10 - 1) * 100, 1e-6);

  // A yardstick whose history starts inside the window is left out, and says from when it could be drawn.
  const late = new PriceIndex({ QQQ: Object.fromEntries(dates.slice(20).map(d => [d, prices.QQQ[d]])) });
  const cut = benchmark(s, 0, { idx: late, sym: 'QQQ' });
  assert.equal(cut.other, null); assert.equal(cut.otherFrom, dates[20]);
  assert.ok(benchmark(s, 10, { idx: late, sym: 'QQQ' }).other);
  const none = benchmark(s, 0, null);
  assert.equal(none.other, null); assert.equal(none.otherFrom, null);
});
