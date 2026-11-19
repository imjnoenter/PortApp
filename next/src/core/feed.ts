// The ledger retold as events: opened, added to, trimmed, closed, moved, dividends, cash in and out.
// Pure: no DOM, no state. The page phrases the events; this works out the numbers behind them.
import { contribAmounts, ledgerMoves, splitFactor } from './analytics.ts';
import type { DividendEvent, PriceIndex, RealizedSale, Splits } from './analytics.ts';
import { fifoKey } from './fifo.ts';
import type { Contribution, Tx } from './types.ts';

export type FeedKind = 'open' | 'add' | 'trim' | 'close' | 'move' | 'dividend' | 'deposit' | 'withdraw';

export interface FeedEvent {
  kind: FeedKind;
  /** Sort key: the ledger date (Bangkok) for trades, the ex-date for dividends, the entry date for cash. */
  date: string;
  time: string;
  ticker?: string;
  portfolio?: string;
  /** For a move: where the shares went. */
  to?: string;
  /** As recorded, not split-adjusted. */
  shares?: number;
  /** Average price across the fills folded into this event. */
  price?: number;
  value?: number;
  /** Share of everything held, before and after, in percent. Null when a price was missing. */
  wBefore?: number | null;
  wAfter?: number | null;
  /** Realized on this sale (trim) or over the whole holding (close), after fees on both sides. */
  pnl?: number;
  pnlPct?: number | null;
  holdDays?: number;
  /** After this buy, the biggest holding. */
  largest?: boolean;
  /** The first dividend this symbol has paid you. */
  first?: boolean;
  gross?: number;
  net?: number;
  thb?: number;
  usd?: number;
  note?: string;
}

const EPS = 1e-6;
const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;

/**
 * Every event for one view. `all` is true for the whole-account view: there, a holding is the symbol
 * across every portfolio, so selling one portfolio's shares while another still holds is a trim, and
 * a transfer between portfolios is a move that leaves the holding as it was.
 */
export function activityFeed(input: {
  txs: readonly Tx[]; sales: readonly RealizedSale[]; dividends: readonly DividendEvent[];
  contribs: readonly Contribution[]; idx: PriceIndex; splits?: Splits; fx: number; all: boolean;
}): FeedEvent[] {
  const { txs, sales, idx, splits, all } = input;
  const out: FeedEvent[] = [];

  // Sales in the order they happened, per (portfolio, symbol): a sell takes the next one off its queue.
  const queue = new Map<string, RealizedSale[]>();
  for (const s of [...sales].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) {
    const k = fifoKey(s.portfolio, s.ticker);
    (queue.get(k) ?? queue.set(k, []).get(k)!).push(s);
  }

  // Fills of one order arrive as several rows: fold same-day, same-symbol, same-side rows into one.
  const moves = ledgerMoves(txs, splits);
  const groups: (typeof moves)[] = [];
  for (const m of moves) {
    const last = groups[groups.length - 1]?.[0];
    if (last && last.day === m.day && last.t.ticker === m.t.ticker && last.t.type === m.t.type && last.t.portfolio === m.t.portfolio) groups[groups.length - 1].push(m);
    else groups.push([m]);
  }

  const held = new Map<string, number>();            // today's (split-adjusted) shares per symbol
  const lastPx = new Map<string, number>();          // last price seen per symbol, split-adjusted
  const cycle = new Map<string, { open: string; pnl: number; cost: number }>();
  const px = (sym: string, day: string) => idx.at(sym, day) ?? lastPx.get(sym) ?? null;
  /** Value of every holding on `day`, with `sym` at its trade price. Null if anything has no price. */
  const worth = (day: string, sym: string, symPx: number) => {
    let total = 0, ok = true;
    for (const [s, q] of held) {
      if (q <= EPS) continue;
      const p = s === sym ? symPx : px(s, day);
      if (p == null) ok = false; else total += q * p;
    }
    return ok ? total : null;
  };
  const weight = (day: string, sym: string, symPx: number) => {
    const total = worth(day, sym, symPx);
    return total ? (held.get(sym) || 0) * symPx / total * 100 : total == null ? null : 0;
  };

  // A transfer pair (Out from one portfolio, In to another) in the whole-account view is one move.
  let pendingOut: { g: typeof moves; day: string } | null = null;

  for (const g of groups) {
    const t0 = g[0].t, sym = t0.ticker, day = g[0].day;
    const shares = g.reduce((s, m) => s + m.t.shares, 0);
    const adj = g.reduce((s, m) => s + m.shares, 0);    // signed, today's shares
    const value = g.reduce((s, m) => s + (m.t.tradeValue ?? m.t.shares * m.t.price), 0);
    const price = shares ? value / shares : t0.price;
    const factor = splitFactor(splits, sym, day);
    const adjPx = price / factor;
    lastPx.set(sym, adjPx);
    const base = { date: t0.dateStr, time: t0.time, ticker: sym, portfolio: t0.portfolio, shares, price, value };

    if (t0.type === 'Transfer-Out' || t0.type === 'Transfer-In') {
      if (all) {
        if (t0.type === 'Transfer-Out') { pendingOut = { g, day }; continue; }
        const from = pendingOut && pendingOut.g[0].t.ticker === sym ? pendingOut.g[0].t.portfolio : undefined;
        pendingOut = null;
        out.push({ ...base, kind: 'move', portfolio: from, to: t0.portfolio });
        continue;
      }
      // In one portfolio's own view a transfer does change the holding.
      const before = weight(day, sym, adjPx);
      held.set(sym, Math.max(0, (held.get(sym) || 0) + adj));
      out.push({ ...base, kind: 'move', wBefore: before, wAfter: weight(day, sym, adjPx), ...(adj > 0 ? { to: t0.portfolio } : { portfolio: t0.portfolio }) });
      continue;
    }

    const prev = held.get(sym) || 0;
    const wBefore = prev > EPS ? weight(day, sym, adjPx) : 0;
    const next = Math.max(0, prev + adj);
    held.set(sym, next);
    const wAfter = next > EPS ? weight(day, sym, adjPx) : 0;

    if (t0.type === 'Buy') {
      if (prev <= EPS) cycle.set(sym, { open: t0.dateStr, pnl: 0, cost: 0 });
      // Became the biggest holding with this buy? Only claimed when every other holding had a price.
      const others = [...held].filter(([s, q]) => s !== sym && q > EPS);
      const vals = others.map(([s, q]) => { const p = px(s, day); return p == null ? null : q * p; });
      const top = vals.every(v => v != null) && others.length ? Math.max(...(vals as number[])) : null;
      const largest = top != null && next * adjPx > top && prev * adjPx <= top;
      out.push({ ...base, kind: prev <= EPS ? 'open' : 'add', wBefore, wAfter, largest });
      continue;
    }

    // A sale: realized from the matching FIFO sales, one per row folded into this event.
    let pnl = 0, cost = 0;
    for (const m of g) { const s = queue.get(fifoKey(m.t.portfolio, sym))?.shift(); if (s) { pnl += s.pnl; cost += s.cost; } }
    const c = cycle.get(sym);
    if (c) { c.pnl += pnl; c.cost += cost; }
    if (next <= EPS) {
      cycle.delete(sym);
      out.push({ ...base, kind: 'close', wBefore, wAfter: 0, pnl: c ? c.pnl : pnl, pnlPct: (c ? c.cost : cost) ? (c ? c.pnl / c.cost : pnl / cost) * 100 : null,
        holdDays: c ? Math.max(0, Math.round(dayNum(t0.dateStr) - dayNum(c.open))) : undefined });
    } else {
      out.push({ ...base, kind: 'trim', wBefore, wAfter, pnl, pnlPct: cost ? pnl / cost * 100 : null });
    }
  }

  // Dividends, oldest first so the first one per symbol can be marked.
  const seen = new Set<string>();
  for (const d of [...input.dividends].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) {
    out.push({ kind: 'dividend', date: d.date, time: '', ticker: d.ticker, shares: d.shares, gross: d.gross, net: d.net, first: !seen.has(d.ticker) });
    seen.add(d.ticker);
  }

  // Cash belongs to the whole account, so it shows only there.
  if (all) for (const c of input.contribs) {
    const a = contribAmounts(c, input.fx);
    out.push({ kind: a.thb >= 0 ? 'deposit' : 'withdraw', date: c.date, time: '', thb: a.thb, usd: a.usd, note: c.note });
  }

  // Newest first; within a day, keep the order things happened in, reversed.
  return out.map((e, i) => ({ e, i })).sort((a, b) => (b.e.date + b.e.time).localeCompare(a.e.date + a.e.time) || b.i - a.i).map(x => x.e);
}
