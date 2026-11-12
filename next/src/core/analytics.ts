// Everything computed from the ledger + price history. None of it depends on live quotes except
// where a caller passes today's figure in, so a quote tick recomputes almost nothing here.
import { feesOn } from './fees.ts';
import { addDays, txMarketDate, weekStart } from './market.ts';
import type { FifoResult } from './fifo.ts';
import type { Contribution, History, Tx } from './types.ts';

// ───────────────────────── price lookup ─────────────────────────

/** Sorted per-symbol closes with an "on or before" lookup: one sort up front, binary search after. */
export class PriceIndex {
  private m = new Map<string, { d: string[]; v: number[] }>();
  readonly allDates: string[];

  constructor(prices: History['prices']) {
    const all = new Set<string>();
    for (const sym in prices) {
      const d = Object.keys(prices[sym]).sort();
      this.m.set(sym, { d, v: d.map(k => prices[sym][k]) });
      for (const k of d) all.add(k);
    }
    this.allDates = [...all].sort();
  }
  has(sym: string) { return this.m.has(sym); }
  /** The earliest day there is a close for. */
  first(sym: string): string | null { return this.m.get(sym)?.d[0] ?? null; }
  days(sym: string) { return this.m.get(sym)?.d.length || 0; }

  /** Close on the nearest trading day at or before `date`. */
  at(sym: string, date: string): number | null {
    const s = this.m.get(sym);
    if (!s) return null;
    let lo = 0, hi = s.d.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s.d[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans < 0 ? null : s.v[ans];
  }
}

// ───────────────────────── dividends ─────────────────────────

const WITHHOLDING: Record<string, number> = { NVO: 0.27, NOVO: 0.27 };
export const withholdingRate = (sym: string) => WITHHOLDING[sym] ?? 0.15;

const shareDelta = (t: Tx) => t.type === 'Buy' || t.type === 'Transfer-In' ? t.shares : t.type === 'Sell' || t.type === 'Transfer-Out' ? -t.shares : 0;

function byTicker(txs: readonly Tx[]) {
  const m = new Map<string, Tx[]>();
  for (const t of txs) { let a = m.get(t.ticker); if (!a) m.set(t.ticker, a = []); a.push(t); }
  for (const a of m.values()) a.sort((x, y) => x.dateStr < y.dateStr ? -1 : x.dateStr > y.dateStr ? 1 : 0);
  return m;
}

export interface DividendEvent { date: string; ticker: string; shares: number; gross: number; net: number }
export interface Dividends { gross: number; net: number; byTicker: Map<string, { gross: number; net: number }>; events: DividendEvent[] }

/** Estimated from price-history ex-dates × the shares held that day; not the broker's actual payouts. */
export function computeDividends(txs: readonly Tx[], history: History): Dividends {
  const out: Dividends = { gross: 0, net: 0, byTicker: new Map(), events: [] };
  const grouped = byTicker(txs);
  for (const sym in history.dividends) {
    const list = grouped.get(sym);
    if (!list) continue;
    const rate = withholdingRate(sym);
    const dates = Object.keys(history.dividends[sym]).sort();
    let i = 0, held = 0, g = 0;
    for (const d of dates) {
      while (i < list.length && list[i].dateStr <= d) held = Math.max(0, held + shareDelta(list[i++]));
      if (held <= 1e-9) continue;
      const gross = held * history.dividends[sym][d];
      g += gross;
      out.events.push({ date: d, ticker: sym, shares: held, gross, net: gross * (1 - rate) });
    }
    if (g > 0) { out.byTicker.set(sym, { gross: g, net: g * (1 - rate) }); out.gross += g; out.net += g * (1 - rate); }
  }
  out.events.sort((a, b) => a.date < b.date ? 1 : -1);
  return out;
}

// ───────────────────────── realized P&L ─────────────────────────

export interface RealizedSale { date: string; ticker: string; portfolio: string; shares: number; price: number; pnl: number; cost: number; fee: number }

/** Realized P&L per sale, net of fees on both legs. `cost` is the capital those shares tied up. */
export function realizedSales(fifo: FifoResult | null, port: string): RealizedSale[] {
  if (!fifo) return [];
  return fifo.sells
    .filter(s => port === 'ALL' || s.portfolio === port)
    .map(s => ({
      date: s.dateStr, ticker: s.ticker, portfolio: s.portfolio, shares: s.shares, price: s.price,
      pnl: (s.shares * s.price - s.feeOut) - (s.costOut + s.feeIn),
      cost: s.costOut + s.feeIn,
      fee: s.feeIn + s.feeOut,
    }));
}

export function realizedTotals(sales: readonly RealizedSale[]) {
  let pnl = 0, cost = 0, fee = 0;
  for (const s of sales) { pnl += s.pnl; cost += s.cost; fee += s.fee; }
  return { pnl, cost, fee, pct: cost ? pnl / cost * 100 : null };
}

// ───────────────────────── IRR ─────────────────────────

export interface Irr { rate: number; invested: number; proceeds: number; dividends: number; transfersNet: number; terminal: number; years: number }

/** Money-weighted return (XIRR, Actual/365), solved by bisection. Null when there is nothing to solve. */
export function computeIRR(txs: readonly Tx[], dividends: Dividends, holdingsValue: number, now = new Date()): Irr | null {
  const flows: { t: number; v: number }[] = [];
  let invested = 0, proceeds = 0, transfersNet = 0;
  const ms = (d: string) => Date.parse(d + 'T00:00:00Z');
  for (const t of txs) {
    const tv = t.tradeValue != null ? t.tradeValue : t.shares * t.price;
    if (!tv || !t.dateStr) continue;
    if (t.type === 'Buy') { flows.push({ t: ms(t.dateStr), v: -tv }); invested += tv; }
    else if (t.type === 'Sell') { flows.push({ t: ms(t.dateStr), v: tv }); proceeds += tv; }
    else if (t.type === 'Transfer-Out') { flows.push({ t: ms(t.dateStr), v: tv }); transfersNet += tv; }
    else if (t.type === 'Transfer-In') { flows.push({ t: ms(t.dateStr), v: -tv }); transfersNet -= tv; }
  }
  if (!flows.length) return null;
  for (const e of dividends.events) flows.push({ t: ms(e.date), v: e.net });
  const end = now.getTime();
  if (holdingsValue > 0) flows.push({ t: end, v: holdingsValue });

  const t0 = Math.min(...flows.map(f => f.t));
  const years = (end - t0) / (365 * 864e5);
  if (!(years > 0)) return null;
  const npv = (r: number) => flows.reduce((s, f) => s + f.v / Math.pow(1 + r, (f.t - t0) / (365 * 864e5)), 0);
  let lo = -0.9999, hi = 100, flo = npv(lo), fhi = npv(hi);
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, f = npv(mid);
    if (flo * f <= 0) { hi = mid; fhi = f; } else { lo = mid; flo = f; }
    if (hi - lo < 1e-9) break;
  }
  return { rate: (lo + hi) / 2 * 100, invested, proceeds, dividends: dividends.net, transfersNet, terminal: holdingsValue, years };
}

// ───────────────────────── time-weighted returns ─────────────────────────

export interface ReturnSeries {
  rp: number[]; rs: number[]; dts: string[];
  /** The day the first return is measured from: the close everything after it is compared with. */
  start: string;
}

/**
 * Daily time-weighted returns for the portfolio (rp) and SPY (rs). Each day's external cash flow is
 * stripped out, `(V_end − flow) / V_prev − 1`, so a deposit never reads as a gain.
 */
export function returnSeries(txs: readonly Tx[], idx: PriceIndex): ReturnSeries | null {
  if (!idx.has('SPY')) return null;
  const trades = txs.filter(t => (t.type === 'Buy' || t.type === 'Sell') && t.dateStr)
    .sort((a, b) => a.dateStr < b.dateStr ? -1 : a.dateStr > b.dateStr ? 1 : 0);
  const first = trades.find(t => t.type === 'Buy');
  if (!first) return null;
  const days = idx.allDates.filter(d => d >= first.dateStr);
  if (days.length < 25) return null;

  const held = new Map<string, number>();
  const out: ReturnSeries = { rp: [], rs: [], dts: [], start: '' };
  let ti = 0, flow = 0, prevVal = 0, prevSpy = 0, prevDay = '';
  for (const day of days) {
    while (ti < trades.length && trades[ti].dateStr <= day) {
      const t = trades[ti++], amt = t.shares * t.price, dir = t.type === 'Buy' ? 1 : -1;
      held.set(t.ticker, Math.max(0, (held.get(t.ticker) || 0) + dir * t.shares));
      flow += dir * amt;
    }
    let val = 0, any = false;
    for (const [sym, q] of held) {
      if (q <= 1e-9) continue;
      any = true;
      val += q * (idx.at(sym, day) || 0);
    }
    const spy = idx.at('SPY', day);
    // A day that can't be valued carries its flow forward rather than booking it as a return later.
    if ((any && val <= 0) || !spy) continue;
    if (prevVal > 0 && prevSpy > 0) {
      if (!out.dts.length) out.start = prevDay;
      out.rp.push((val - flow) / prevVal - 1);
      out.rs.push(spy / prevSpy - 1);
      out.dts.push(day);
    }
    prevVal = val; prevSpy = spy; prevDay = day; flow = 0;
  }
  return out.rp.length >= 20 ? out : null;
}

export interface MonthlyReturns {
  years: { year: number; months: (number | null)[]; yearTotal: number | null }[];  // newest first
  avgMonths: (number | null)[];
  avgYear: number | null;
}

/** Year × month grid from the daily series. Year total compounds; the Avg row is an arithmetic mean. */
export function monthlyReturns(s: ReturnSeries | null): MonthlyReturns | null {
  if (!s) return null;
  const byMonth = new Map<string, number>();
  s.dts.forEach((d, i) => { const k = d.slice(0, 7); byMonth.set(k, (byMonth.get(k) ?? 1) * (1 + s.rp[i])); });
  const first = Number(s.dts[0].slice(0, 4)), last = Number(s.dts[s.dts.length - 1].slice(0, 4));
  const years: MonthlyReturns['years'] = [];
  for (let y = last; y >= first; y--) {
    const months = Array.from({ length: 12 }, (_, m) => {
      const v = byMonth.get(`${y}-${String(m + 1).padStart(2, '0')}`);
      return v == null ? null : v - 1;
    });
    const have = months.filter((m): m is number => m != null);
    years.push({ year: y, months, yearTotal: have.length ? have.reduce((a, m) => a * (1 + m), 1) - 1 : null });
  }
  const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  return {
    years,
    avgMonths: Array.from({ length: 12 }, (_, m) => mean(years.map(y => y.months[m]).filter((v): v is number => v != null))),
    avgYear: mean(years.map(y => y.yearTotal).filter((v): v is number => v != null)),
  };
}

export interface DayBar { r: number; d: string; today?: boolean }

/**
 * The last n trading days in percent, ending on today's live move. A history entry already dated
 * today (the close can land in the History sheet after 16:00 ET) is dropped so the final bar is
 * always the same number as the headline day change.
 */
export function dailyBars(s: ReturnSeries | null, n: number, dayPct: number | null, today: string): DayBar[] {
  const hist: DayBar[] = [];
  if (s) for (let i = 0; i < s.dts.length; i++) if (s.dts[i] < today) hist.push({ r: s.rp[i] * 100, d: s.dts[i] });
  if (dayPct == null) return hist.slice(-n);
  return [...hist.slice(-(n - 1)), { r: dayPct, d: today, today: true }];
}

export const RISK_FREE_RATE = 0.045;

export interface RiskStats { volAnn: number; maxDD: number; sharpe: number | null; beta: number | null; alpha: number | null; days: number }

export function riskStats(s: ReturnSeries | null): RiskStats | null {
  if (!s) return null;
  const n = s.rp.length;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const mp = mean(s.rp), msp = mean(s.rs);
  let vp = 0, vs = 0, cov = 0, idx = 1, peak = 1, maxDD = 0;
  for (let i = 0; i < n; i++) {
    vp += (s.rp[i] - mp) ** 2; vs += (s.rs[i] - msp) ** 2; cov += (s.rp[i] - mp) * (s.rs[i] - msp);
    idx *= 1 + s.rp[i];
    if (idx > peak) peak = idx;
    maxDD = Math.max(maxDD, 1 - idx / peak);
  }
  const vol = Math.sqrt(vp / (n - 1)) * Math.sqrt(252);
  const annP = mp * 252, annS = msp * 252;
  const beta = vs > 0 ? cov / vs : null;
  return {
    volAnn: vol * 100, maxDD: maxDD * 100, days: n,
    sharpe: vol > 0 ? (annP - RISK_FREE_RATE) / vol : null,
    beta,
    alpha: beta == null ? null : (annP - RISK_FREE_RATE - beta * (annS - RISK_FREE_RATE)) * 100,
  };
}

// ───────────────────────── contributions ─────────────────────────

/** A contribution's signed amounts in both currencies (withdrawals negative). */
export function contribAmounts(c: Contribution, fx: number) {
  const dir = /^deposit/i.test(c.type.trim()) ? 1 : -1;
  let thb = c.thb, usd = c.usd;
  if (thb == null || usd == null) {
    const rate = c.rate && c.rate > 0 ? c.rate : fx;
    // Rows from before the dual-currency columns: a deposit was always entered in baht.
    if (dir === 1 || c.currency.toUpperCase() === 'THB') { thb = Math.abs(c.amount); usd = thb / rate; }
    else { usd = Math.abs(c.amount); thb = usd * rate; }
  }
  return { thb: dir * Math.abs(thb), usd: dir * Math.abs(usd) };
}

export const netContributedTHB = (cs: readonly Contribution[], fx: number) => cs.reduce((s, c) => s + contribAmounts(c, fx).thb, 0);

// ───────────────────────── cash flow ─────────────────────────

export interface FlowBucket { key: string; bought: number; sold: number; deposited: number; net: number; current?: boolean }
export interface CashFlow {
  weeks: FlowBucket[];    // oldest first, last 12
  months: FlowBucket[];   // oldest first, up to 12
  avgNet: number | null;  // per week, over the last 8 complete weeks
  avgWeeks: number;
  runway: number | null;  // weeks of spendable cash at that pace; null when not drawing down
}

/**
 * Money in and out of the wallet. Account-wide by nature: there is one wallet and contributions
 * belong to the whole account. Trades bucket by US market date, so a Saturday 03:00 Thai buy is
 * Friday's. Sale proceeds are recomputed (trade value − fee): the sheet's Trade_Value+Fee column
 * adds the fee on both sides.
 */
export function cashFlow(txs: readonly Tx[], contribs: readonly Contribution[], fx: number, spendable: number, today: string): CashFlow | null {
  const weeks = new Map<string, FlowBucket>(), months = new Map<string, FlowBucket>();
  const bucket = (m: Map<string, FlowBucket>, key: string) => {
    let b = m.get(key);
    if (!b) m.set(key, b = { key, bought: 0, sold: 0, deposited: 0, net: 0 });
    return b;
  };
  let firstTrade: string | null = null;
  for (const t of txs) {
    if (t.type !== 'Buy' && t.type !== 'Sell') continue;
    const tv = t.tradeValue != null ? t.tradeValue : t.shares * t.price;
    const fee = feesOn(tv, t.commissionFree).total;
    const d = txMarketDate(t.dateStr, t.time);
    if (!firstTrade || d < firstTrade) firstTrade = d;
    for (const b of [bucket(weeks, weekStart(d)), bucket(months, d.slice(0, 7))]) {
      if (t.type === 'Buy') b.bought += tv + fee; else b.sold += tv - fee;
    }
  }
  if (!firstTrade) return null;
  for (const c of contribs) {
    if (!c.date) continue;
    const { usd } = contribAmounts(c, fx);
    bucket(weeks, weekStart(c.date)).deposited += usd;
    bucket(months, c.date.slice(0, 7)).deposited += usd;
  }

  const thisWeek = weekStart(today), firstWeek = weekStart(firstTrade);
  // Net is what trading did to cash: sales less purchases. A deposit is new money, not a result,
  // so it is reported in its own column and never counted here, or in the weekly average and the
  // runway that come from it.
  const done = (b: FlowBucket, current: boolean): FlowBucket => ({ ...b, net: b.sold - b.bought, current });
  const weekRows: FlowBucket[] = [];
  for (let i = 11; i >= 0; i--) { const k = addDays(thisWeek, -7 * i); weekRows.push(done(bucket(weeks, k), i === 0)); }

  const monthRows: FlowBucket[] = [];
  const [ty, tm] = today.split('-').map(Number);
  for (let i = 11; i >= 0; i--) {
    const dt = new Date(Date.UTC(ty, tm - 1 - i, 1)), k = dt.toISOString().slice(0, 7);
    if (k >= firstTrade.slice(0, 7)) monthRows.push(done(bucket(months, k), i === 0));
  }

  // The running week is excluded, and the window never reaches back before the first trade's week.
  const complete: FlowBucket[] = [];
  for (let i = 1; i <= 8; i++) { const k = addDays(thisWeek, -7 * i); if (k >= firstWeek) complete.push(done(bucket(weeks, k), false)); }
  const avgNet = complete.length ? complete.reduce((s, b) => s + b.net, 0) / complete.length : null;
  return {
    weeks: weekRows, months: monthRows, avgNet, avgWeeks: complete.length,
    runway: avgNet != null && avgNet < 0 ? spendable / -avgNet : null,
  };
}

// ───────────────────────── against the market ─────────────────────────

export interface Benchmark {
  /** One more date than there are returns: the first is the close every line starts from, at zero. */
  dates: string[];
  /** Cumulative percent since that close. All the same length as `dates`. */
  portfolio: number[];
  spy: number[];
  /** A second yardstick, or null when its prices do not reach back to the first date. */
  other: number[] | null;
  /** When `other` is null for want of history: the first day it does have, if any. */
  otherFrom: string | null;
}

/**
 * The portfolio's growth beside the market's, over the last `days` trading days (0 for all of it).
 *
 * All lines start from the same close and are compounded the same way, so the gap between them at
 * any date is the difference in return since the start. The portfolio's line is time-weighted:
 * money added or taken out does not move it. None of the three counts dividends.
 *
 * The second yardstick is drawn only when it covers the whole window. A line that began later
 * would have to start at zero on a different day from the others, and the gap between them would
 * then mean nothing.
 */
export function benchmark(s: ReturnSeries, days: number, other?: { idx: PriceIndex; sym: string } | null): Benchmark {
  const n = s.rp.length, from = days > 0 ? Math.max(0, n - days) : 0;
  const base = from > 0 ? s.dts[from - 1] : s.start;
  const dates = [base], portfolio = [0], spy = [0];
  let a = 1, b = 1;
  for (let i = from; i < n; i++) {
    a *= 1 + s.rp[i]; b *= 1 + s.rs[i];
    dates.push(s.dts[i]); portfolio.push((a - 1) * 100); spy.push((b - 1) * 100);
  }
  let line: number[] | null = null, otherFrom: string | null = null;
  if (other) {
    const first = other.idx.first(other.sym), p0 = first && first <= base ? other.idx.at(other.sym, base) : null;
    if (p0) line = dates.map(d => (other.idx.at(other.sym, d)! / p0 - 1) * 100);
    else otherFrom = first;
  }
  return { dates, portfolio, spy, other: line, otherFrom };
}
