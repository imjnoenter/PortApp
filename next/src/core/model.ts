// Holdings → the model every view renders from.
//
// One wallet, several portfolios. Nothing here reads a global: a `Book` carries the four inputs and
// every function is a pure derivation of it, so a quote tick is just "build again with new quotes".
import { DEFAULT_PORT, fifoBasis } from './fifo.ts';
import type { FifoResult } from './fifo.ts';
import type { HoldingRow, Model, PortfolioRow, Position, Quotes, WatchItem } from './types.ts';

export const CAP_PORT = 'Trade';
export const ETF_PORT = 'ETF';
export const ALL = 'ALL';

export interface Book {
  rows: readonly HoldingRow[];
  registry: readonly PortfolioRow[];
  quotes: Quotes;
  fifo: FifoResult | null;   // null until the ledger has loaded
}

/** Live quote when there is one, else the sheet's own price. */
export function livePrice(book: Book, r: HoldingRow): number | null {
  const q = book.quotes[r.symbol]?.price;
  return q != null && q > 0 ? q : r.price;
}
const rowValue = (book: Book, r: HoldingRow) => (r.qty || 0) * (livePrice(book, r) || 0);

export function walletOf(registry: readonly PortfolioRow[]) {
  let cash = 0, fcd = 0, usd = 0;
  for (const p of registry) { cash += p.cash || 0; fcd += p.fcd || 0; usd += p.usd || 0; }
  return { cash, fcd, usd };
}

/** ETF has no limit of its own: it is one pool with Long-Term. */
export const limitPort = (port: string) => port === ETF_PORT ? DEFAULT_PORT : port;
export const poolPorts = (port: string) => limitPort(port) === DEFAULT_PORT ? [DEFAULT_PORT, ETF_PORT] : [limitPort(port)];

export interface Limits {
  whole: number;        // every stock in every portfolio + the wallet
  wallet: { cash: number; fcd: number; usd: number };
  reservePct: number;
  reserve: number;      // dollars held back before any tab sees cash
  spendable: number;
  stockByPort: Map<string, number>;
  shares: Map<string, number>;   // split portfolios → share of (whole − reserve)
  pctOf(port: string): number;
  dollarOf(port: string): number;
  poolStock(port: string): number;
}

/**
 * Three kinds of limit, told apart by which registry row they sit on:
 *  - reserve %  = CashReserves on Long-Term's row, a share of the whole
 *  - Trade      = CapPct × the whole (a risk limit that overlaps every other row)
 *  - the rest   = CapPct is its split of (whole − reserve); a single blank row takes the remainder
 */
export function computeLimits(book: Book): Limits {
  const wallet = walletOf(book.registry);
  const stockByPort = new Map<string, number>();
  let stocks = 0;
  for (const r of book.rows) {
    const v = rowValue(book, r);
    if (!v) continue;
    stocks += v;
    stockByPort.set(r.portfolio, (stockByPort.get(r.portfolio) || 0) + v);
  }
  const whole = stocks + wallet.cash;
  const reservePct = book.registry.find(p => p.name === DEFAULT_PORT)?.cashRes || 0;
  const reserve = reservePct * whole;
  const spendable = Math.max(0, wallet.cash - reserve);

  const split = book.registry.filter(p => p.name !== CAP_PORT && p.name !== ETF_PORT);
  const shares = new Map<string, number>();
  const blanks = split.filter(p => !(p.capPct > 0));
  const set = split.reduce((s, p) => s + (p.capPct > 0 ? p.capPct : 0), 0);
  for (const p of split) shares.set(p.name, p.capPct > 0 ? p.capPct : (blanks.length === 1 ? Math.max(0, 1 - set) : 0));

  const tradePct = book.registry.find(p => p.name === CAP_PORT)?.capPct || 0;
  const pctOf = (port: string) => {
    const lp = limitPort(port);
    return lp === CAP_PORT ? tradePct : (shares.get(lp) || 0);
  };
  return {
    whole, wallet, reservePct, reserve, spendable, stockByPort, shares, pctOf,
    dollarOf: port => limitPort(port) === CAP_PORT ? pctOf(port) * whole : pctOf(port) * (whole - reserve),
    poolStock: port => poolPorts(port).reduce((s, p) => s + (stockByPort.get(p) || 0), 0),
  };
}

function withBasis(book: Book, r: HoldingRow): HoldingRow {
  if (!((r.qty || 0) > 0)) return r;
  const b = fifoBasis(book.fifo, r.portfolio, r.symbol, r.qty || 0);
  if (b) return { ...r, avgPrice: b.avg };
  return book.fifo ? { ...r, basisFallback: true } : r;
}

const META = ['name', 'sector', 'industry', 'category', 'custom', 'myGroup', 'price', 'marketCap'] as const;

/** The rows one view shows. A single portfolio filters; ALL merges same-symbol rows across portfolios. */
export function rowsForView(book: Book, port: string): HoldingRow[] {
  // Descriptive fields are per symbol, not per row: fill a blank from any sibling row.
  const meta = new Map<string, HoldingRow>();
  for (const r of book.rows) {
    const m = meta.get(r.symbol);
    if (!m) { meta.set(r.symbol, { ...r }); continue; }
    for (const k of META) if (m[k] == null && r[k] != null) (m as any)[k] = r[k];
  }
  const fill = (r: HoldingRow): HoldingRow => {
    const m = meta.get(r.symbol)!;
    const out = { ...r };
    for (const k of ['name', 'sector', 'industry', 'price', 'marketCap'] as const) if (out[k] == null) (out as any)[k] = m[k];
    return out;
  };

  if (port !== ALL) return book.rows.filter(r => r.portfolio === port).map(r => fill(withBasis(book, r)));

  const merged = new Map<string, HoldingRow & { _cost: number }>();
  for (const raw of book.rows) {
    const r = withBasis(book, raw);
    const qty = r.qty || 0, cost = qty * (r.avgPrice || 0);
    const m = merged.get(r.symbol);
    if (!m) { merged.set(r.symbol, { ...fill(r), portfolio: ALL, qty: qty || null, _cost: cost }); continue; }
    m.qty = (m.qty || 0) + qty || null;
    m._cost += cost;
    if (r.basisFallback) m.basisFallback = true;
    // Long-Term's target wins; otherwise the first row that has one.
    if (r.target != null && (raw.portfolio === DEFAULT_PORT || m.target == null)) m.target = r.target;
    for (const k of ['category', 'custom', 'myGroup'] as const) if (m[k] == null) m[k] = r[k];
  }
  return [...merged.values()].map(({ _cost, ...m }) => ({ ...m, avgPrice: (m.qty || 0) > 0 ? _cost / (m.qty as number) : m.avgPrice }));
}

/** A tab's cash: the room left under its limit, never more than the wallet can actually fund. */
const tabRoom = (limits: Limits, port: string) => limits.dollarOf(port) - limits.poolStock(port);
const tabCash = (limits: Limits, port: string) => Math.min(Math.max(tabRoom(limits, port), 0), limits.spendable);

/**
 * Each symbol's target as a fraction of the whole account's investable total.
 *
 * A target is stored as a share of its own portfolio, so the same 10% means different dollars in
 * different tabs. Here every row's target is turned into the dollars it asks for (its fraction of
 * its own tab's stocks plus cash), the dollars are added up per symbol, and the sum is divided by
 * what the combined view can invest. A symbol held in two portfolios gets both asks.
 *
 * The tabs' cash overlaps (Trade's limit sits on top of the others, and Long-Term shares a pool
 * with ETF), so these can add up to more than 100% even when each portfolio is within its own.
 */
export function combinedTargets(book: Book, limits: Limits, investable: number): Map<string, number> {
  const out = new Map<string, number>();
  if (!(investable > 0)) return out;
  const base = new Map<string, number>();
  for (const r of book.rows) {
    if (!((r.target || 0) > 0)) continue;
    let b = base.get(r.portfolio);
    if (b == null) base.set(r.portfolio, b = (limits.stockByPort.get(r.portfolio) || 0) + tabCash(limits, r.portfolio));
    out.set(r.symbol, (out.get(r.symbol) || 0) + r.target! * b / investable);
  }
  return out;
}

export function buildModel(book: Book, port: string, limits: Limits = computeLimits(book)): Model {
  const positions: Position[] = [];
  const watchlist: WatchItem[] = [];
  let stockTotal = 0, costTotal = 0, dayDollar = 0, quotedValue = 0, anyQuoted = false;

  for (const r of rowsForView(book, port)) {
    const q = book.quotes[r.symbol];
    const price = livePrice(book, r);
    const qty = r.qty || 0, avg = r.avgPrice || 0;
    const day = { dayChange: q?.change ?? null, dayChangePct: q?.changePct ?? null, high52: q?.high52 ?? null, low52: q?.low52 ?? null };
    if (qty > 0 && avg > 0 && price != null) {
      const costBasis = qty * avg, currentValue = qty * price, pnl = currentValue - costBasis;
      const extPrice = q?.ext ? q.extPrice : null;
      positions.push({
        ...r, ...day, qty, avgPrice: avg, price, costBasis, currentValue, pnl,
        pnlPct: costBasis ? pnl / costBasis * 100 : 0,
        weightPct: 0, stockWeightPct: 0, investWeightPct: 0,
        ext: extPrice != null ? q!.ext : null, extPrice,
        extPct: extPrice != null && price > 0 ? (extPrice - price) / price * 100 : null,
        volume: q?.volume ?? null,
      });
      stockTotal += currentValue; costTotal += costBasis;
      if (day.dayChange != null) { dayDollar += day.dayChange * qty; quotedValue += currentValue; anyQuoted = true; }
    } else if (price != null || (!(qty > 0) && !(avg > 0))) {
      watchlist.push({ ...r, ...day, price });
    }
  }

  let cash: number, fcd = 0, usd = 0, cashResPct = 0, limit: Model['limit'] = null;
  if (port === ALL) {
    ({ cash, fcd, usd } = limits.wallet);
    cashResPct = limits.reservePct;
  } else {
    const dollar = limits.dollarOf(port);
    const used = limits.poolStock(port);
    const room = tabRoom(limits, port);
    cash = tabCash(limits, port);
    limit = { pct: limits.pctOf(port), dollar, used, over: Math.max(0, -room), unfunded: Math.max(0, room - limits.spendable) };
  }

  const totalCurrent = stockTotal + cash;
  const investable = totalCurrent * (1 - cashResPct);
  for (const p of positions) {
    p.weightPct = totalCurrent ? p.currentValue / totalCurrent * 100 : 0;
    p.stockWeightPct = stockTotal ? p.currentValue / stockTotal * 100 : 0;
    p.investWeightPct = investable ? p.currentValue / investable * 100 : 0;
  }
  positions.sort((a, b) => b.currentValue - a.currentValue);
  if (port === ALL) {
    // In the combined view a target means its share of the whole account, not of one portfolio.
    const targets = combinedTargets(book, limits, investable);
    for (const p of positions) p.target = targets.get(p.symbol) ?? null;
    for (const w of watchlist) w.target = targets.get(w.symbol) ?? null;
  }

  // Headroom is not capital deployed: a tab's invested total excludes its cash.
  const totalInvested = costTotal + (port === ALL ? cash : 0);
  const totalPnl = stockTotal - costTotal;
  return {
    port, positions, watchlist, cash, fcd, usd, cashResPct,
    stockTotal, costTotal, totalCurrent, investable, totalInvested, totalPnl,
    totalPnlPct: costTotal ? totalPnl / costTotal * 100 : 0,
    dayChange: anyQuoted ? dayDollar : null,
    dayPct: anyQuoted && quotedValue ? dayDollar / quotedValue * 100 : null,
    limit,
  };
}

/** Dollars a position's target allocation asks for. */
export const targetDollar = (p: { target: number | null }, m: Model) => (p.target || 0) * m.investable;
