// Analysis built on the model, the ledger and price history: risk, correlation, stress, income,
// per-holding performance and the journal of closed trades. All pure; all safe to call with thin data.
import { withholdingRate } from './analytics.ts';
import type { Dividends, PriceIndex, RealizedSale } from './analytics.ts';
import { fifoKey } from './fifo.ts';
import { addDays } from './market.ts';
import type { Plan } from './plan.ts';
import type { History, Model, Position, Tx } from './types.ts';

// ───────────────────────── concentration ─────────────────────────

export interface Concentration {
  largest: { symbol: string; pct: number } | null;
  top3: number;
  /** Herfindahl index of equity weights, 0 to 10,000. Above 2,500 is concentrated. */
  hhi: number;
  cashPct: number;
  sectors: number;
  topSector: { name: string; pct: number } | null;
}

export function concentration(m: Model): Concentration {
  const bySector = new Map<string, number>();
  let hhi = 0;
  for (const p of m.positions) {
    hhi += p.stockWeightPct ** 2;
    const s = p.sector || 'Other';
    bySector.set(s, (bySector.get(s) || 0) + p.stockWeightPct);
  }
  const top = [...bySector].sort((a, b) => b[1] - a[1])[0];
  return {
    largest: m.positions[0] ? { symbol: m.positions[0].symbol, pct: m.positions[0].stockWeightPct } : null,
    top3: m.positions.slice(0, 3).reduce((s, p) => s + p.stockWeightPct, 0),
    hhi, cashPct: m.totalCurrent ? m.cash / m.totalCurrent * 100 : 0,
    sectors: bySector.size, topSector: top ? { name: top[0], pct: top[1] } : null,
  };
}

// ───────────────────────── stop-loss cover and 52-week stress ─────────────────────────

export interface StopCover { coveredPct: number; maxLoss: number; unprotected: number; hit: string[] }

/** How much of the equity has a stop under it, and what reaching every stop would cost. */
export function stopCover(m: Model, planOf: (p: Position) => Plan | undefined): StopCover {
  let covered = 0, maxLoss = 0;
  const hit: string[] = [];
  for (const p of m.positions) {
    const sl = planOf(p)?.sl;
    if (!sl) continue;
    covered += p.currentValue;
    if (p.price > sl) maxLoss += (p.price - sl) * p.qty; else hit.push(p.symbol);
  }
  return { coveredPct: m.stockTotal ? covered / m.stockTotal * 100 : 0, maxLoss, unprotected: m.stockTotal - covered, hit };
}

/** Average distance below the 52-week high, and how many holdings sit within 10% of their low. */
export function rangeStress(m: Model) {
  let sum = 0, n = 0, nearLow = 0;
  for (const p of m.positions) {
    if (p.high52 && p.price) { sum += (p.price / p.high52 - 1) * 100; n++; }
    if (p.low52 && p.price && p.price / p.low52 - 1 <= 0.10) nearLow++;
  }
  return n ? { fromHigh: sum / n, nearLow, counted: n } : null;
}

// ───────────────────────── correlation and beta ─────────────────────────

/** Daily returns keyed by date, from one symbol's closes. */
function dailyReturns(prices: Record<string, number> | undefined, since = ''): Map<string, number> {
  const out = new Map<string, number>();
  if (!prices) return out;
  const days = Object.keys(prices).sort();
  for (let i = 1; i < days.length; i++) {
    if (days[i] < since) continue;
    const a = prices[days[i - 1]], b = prices[days[i]];
    if (a > 0 && b > 0) out.set(days[i], b / a - 1);
  }
  return out;
}

function pair(a: Map<string, number>, b: Map<string, number>) {
  const xs: number[] = [], ys: number[] = [];
  for (const [d, x] of a) { const y = b.get(d); if (y != null) { xs.push(x); ys.push(y); } }
  return { xs, ys };
}
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

export const MIN_OVERLAP = 30;

export interface Correlation { symbols: string[]; r: (number | null)[][] }

/** Pearson correlation of daily returns for the largest holdings. A pair with too little shared history is null. */
export function correlation(m: Model, prices: History['prices'], top = 10): Correlation | null {
  const symbols = m.positions.filter(p => prices[p.symbol]).slice(0, top).map(p => p.symbol);
  if (symbols.length < 2) return null;
  const rets = symbols.map(s => dailyReturns(prices[s]));
  const r = symbols.map((_, i) => symbols.map((_, j) => {
    if (i === j) return 1;
    const { xs, ys } = pair(rets[i], rets[j]);
    if (xs.length < MIN_OVERLAP) return null;
    const mx = mean(xs), my = mean(ys);
    let cov = 0, vx = 0, vy = 0;
    for (let k = 0; k < xs.length; k++) { cov += (xs[k] - mx) * (ys[k] - my); vx += (xs[k] - mx) ** 2; vy += (ys[k] - my) ** 2; }
    return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : null;
  }));
  return { symbols, r };
}

/** Each holding's beta against SPY over about the last year. Missing when history is too short. */
export function betas(symbols: readonly string[], prices: History['prices'], today: string): Map<string, number> {
  const since = addDays(today, -370);
  const spy = dailyReturns(prices.SPY, since);
  const out = new Map<string, number>();
  for (const s of symbols) {
    const { xs, ys } = pair(dailyReturns(prices[s], since), spy);
    if (xs.length < MIN_OVERLAP) continue;
    const mx = mean(xs), my = mean(ys);
    let cov = 0, vy = 0;
    for (let k = 0; k < xs.length; k++) { cov += (xs[k] - mx) * (ys[k] - my); vy += (ys[k] - my) ** 2; }
    if (vy > 0) out.set(s, cov / vy);
  }
  return out;
}

export interface Shock { market: number; dollars: number; pct: number; worst: { symbol: string; dollars: number }[] }

/** What a market move would do, each holding moving by its own beta. Unknown beta counts as 1; cash does not move. */
export function stressTest(m: Model, beta: ReadonlyMap<string, number>, moves: readonly number[] = [-10, -20, -30, 10]): Shock[] {
  return moves.map(market => {
    const rows = m.positions.map(p => ({ symbol: p.symbol, dollars: p.currentValue * Math.max(-1, (beta.get(p.symbol) ?? 1) * market / 100) }));
    const dollars = rows.reduce((s, r) => s + r.dollars, 0);
    return {
      market, dollars, pct: m.totalCurrent ? dollars / m.totalCurrent * 100 : 0,
      worst: rows.sort((a, b) => market < 0 ? a.dollars - b.dollars : b.dollars - a.dollars).slice(0, 3),
    };
  });
}

// ───────────────────────── income ─────────────────────────

export interface ForwardIncome { gross: number; net: number; payers: { symbol: string; net: number }[]; fwdYield: number; yieldOnCost: number }

/** A year of income at the trailing-12-month rate on the shares held now, after withholding. */
export function forwardIncome(m: Model, dividends: History['dividends'], today: string): ForwardIncome | null {
  const since = addDays(today, -365);
  let gross = 0, net = 0;
  const payers: ForwardIncome['payers'] = [];
  for (const p of m.positions) {
    const d = dividends[p.symbol];
    if (!d) continue;
    let perShare = 0;
    for (const day in d) if (day > since && day <= today) perShare += d[day];
    if (!(perShare > 0)) continue;
    const g = perShare * p.qty, n = g * (1 - withholdingRate(p.symbol));
    gross += g; net += n;
    payers.push({ symbol: p.symbol, net: n });
  }
  if (!payers.length) return null;
  payers.sort((a, b) => b.net - a.net);
  return { gross, net, payers, fwdYield: m.stockTotal ? net / m.stockTotal * 100 : 0, yieldOnCost: m.costTotal ? net / m.costTotal * 100 : 0 };
}

// ───────────────────────── profit by group and by holding ─────────────────────────

export interface GroupPnl { name: string; value: number; cost: number; pnl: number; pct: number | null }

export function groupPnl(m: Model, field: 'sector' | 'industry' | 'category' | 'custom' | 'myGroup'): GroupPnl[] {
  const by = new Map<string, GroupPnl>();
  for (const p of m.positions) {
    const name = p[field] || 'Other';
    let g = by.get(name);
    if (!g) by.set(name, g = { name, value: 0, cost: 0, pnl: 0, pct: null });
    g.value += p.currentValue; g.cost += p.costBasis; g.pnl += p.pnl;
  }
  for (const g of by.values()) g.pct = g.cost ? g.pnl / g.cost * 100 : null;
  return [...by.values()].sort((a, b) => b.pnl - a.pnl);
}

export interface HoldingPerf {
  symbol: string; held: boolean;
  unrealized: number; realized: number; dividends: number; total: number;
  /** Every dollar ever put into the symbol, so a half-sold position is still measured on all of it. */
  deployed: number;
  pct: number | null;
}

/** Lifetime result per symbol: what it is up now, what was banked on sales, and the income it paid. */
export function holdingsPerf(m: Model, txs: readonly Tx[], sales: readonly RealizedSale[], dividends: Dividends): HoldingPerf[] {
  const by = new Map<string, HoldingPerf>();
  const get = (symbol: string) => {
    let h = by.get(symbol);
    if (!h) by.set(symbol, h = { symbol, held: false, unrealized: 0, realized: 0, dividends: 0, total: 0, deployed: 0, pct: null });
    return h;
  };
  const cost = new Map<string, number>();
  for (const p of m.positions) { const h = get(p.symbol); h.held = true; h.unrealized = p.pnl; cost.set(p.symbol, p.costBasis); }
  for (const s of sales) get(s.ticker).realized += s.pnl;
  for (const [sym, d] of dividends.byTicker) get(sym).dividends += d.net;
  for (const t of txs) if (t.type === 'Buy') get(t.ticker).deployed += t.tradeValue ?? t.shares * t.price;
  for (const h of by.values()) {
    if (!h.deployed) h.deployed = cost.get(h.symbol) || 0;
    h.total = h.unrealized + h.realized + h.dividends;
    h.pct = h.deployed ? h.total / h.deployed * 100 : null;
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

// ───────────────────────── closed trades ─────────────────────────

export interface ClosedTrade {
  ticker: string; portfolio: string; openDate: string; closeDate: string; holdDays: number;
  shares: number; avgEntry: number; avgExit: number; pnl: number; pct: number | null;
}

const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;

/**
 * One record per round trip: from the first buy of a position to the sale that empties it. Partial
 * sales along the way are summed into it. A position still open is not listed.
 */
export function closedTrades(txs: readonly Tx[], sales: readonly RealizedSale[]): ClosedTrade[] {
  const queue = new Map<string, RealizedSale[]>();
  for (const s of [...sales].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) {
    const k = fifoKey(s.portfolio, s.ticker);
    let q = queue.get(k);
    if (!q) queue.set(k, q = []);
    q.push(s);
  }
  interface Open { qty: number; openDate: string; shares: number; cost: number; proceeds: number; pnl: number }
  const open = new Map<string, Open>();
  const out: ClosedTrade[] = [];
  const sorted = [...txs].sort((a, b) => a.dateStr < b.dateStr ? -1 : a.dateStr > b.dateStr ? 1 : a.row - b.row);
  for (const t of sorted) {
    const k = fifoKey(t.portfolio, t.ticker);
    let o = open.get(k);
    if (t.type === 'Buy' || t.type === 'Transfer-In') {
      if (!o) open.set(k, o = { qty: 0, openDate: t.dateStr, shares: 0, cost: 0, proceeds: 0, pnl: 0 });
      o.qty += t.shares;
    } else if ((t.type === 'Sell' || t.type === 'Transfer-Out') && o) {
      o.qty -= t.shares;
      if (t.type === 'Sell') {
        const s = queue.get(k)?.shift();
        if (s) { o.shares += s.shares; o.cost += s.cost; o.proceeds += s.shares * s.price; o.pnl += s.pnl; }
      }
      if (o.qty <= 1e-6) {
        open.delete(k);
        if (o.shares > 0) out.push({
          ticker: t.ticker, portfolio: t.portfolio, openDate: o.openDate, closeDate: t.dateStr,
          holdDays: Math.max(0, Math.round(dayNum(t.dateStr) - dayNum(o.openDate))), shares: o.shares,
          avgEntry: o.cost / o.shares, avgExit: o.proceeds / o.shares, pnl: o.pnl, pct: o.cost ? o.pnl / o.cost * 100 : null,
        });
      }
    }
  }
  return out.sort((a, b) => a.closeDate < b.closeDate ? 1 : a.closeDate > b.closeDate ? -1 : 0);
}

// ───────────────────────── value over time ─────────────────────────

export interface WorthSeries { dates: string[]; value: number[]; invested: number[] }

/** Market value of the holdings each trading day, beside the net money put into them (buys less sales). */
export function worthSeries(txs: readonly Tx[], idx: PriceIndex): WorthSeries | null {
  const trades = txs.filter(t => t.type === 'Buy' || t.type === 'Sell').sort((a, b) => a.dateStr < b.dateStr ? -1 : a.dateStr > b.dateStr ? 1 : 0);
  if (!trades.length) return null;
  const days = idx.allDates.filter(d => d >= trades[0].dateStr);
  if (days.length < 5) return null;
  const held = new Map<string, number>();
  const out: WorthSeries = { dates: [], value: [], invested: [] };
  let ti = 0, invested = 0;
  for (const day of days) {
    while (ti < trades.length && trades[ti].dateStr <= day) {
      const t = trades[ti++], dir = t.type === 'Buy' ? 1 : -1;
      held.set(t.ticker, Math.max(0, (held.get(t.ticker) || 0) + dir * t.shares));
      invested += dir * t.shares * t.price;
    }
    let val = 0;
    for (const [sym, q] of held) if (q > 1e-9) val += q * (idx.at(sym, day) || 0);
    out.dates.push(day); out.value.push(val); out.invested.push(invested);
  }
  return out;
}
