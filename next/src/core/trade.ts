// What recording a trade does to the holding, the wallet and the ledger.
//
// The sheet writes are ABSOLUTE values worked out here (new qty, new average, new balances), so
// sending one twice is harmless. Only the ledger append is additive, and the backend dedupes it.
import { feesOn } from './fees.ts';
import type { Fees } from './fees.ts';
import { DEFAULT_PORT, fifoAfterTrade } from './fifo.ts';
import type { Basis } from './fifo.ts';
import type { HoldingRow, PortfolioRow, Tx } from './types.ts';

export type CashSource = 'FCD' | 'USD';

export interface TradeInput {
  type: 'Buy' | 'Sell';
  symbol: string;
  portfolio: string;
  shares: number;
  price: number;
  commissionFree: boolean;
  cashSource: CashSource;
  dateStr: string;   // yyyy-MM-dd, Thai calendar like the rest of the ledger
  time: string;      // HH:mm:ss
  note: string;
}

export interface TradeEffect {
  tradeValue: number;
  fees: Fees;
  /** Cash leaving the wallet on a buy, arriving on a sell. Always positive. */
  amount: number;
  oldQty: number;
  oldAvg: number;
  newQty: number;
  newAvg: number;
  /** The sale emptied the holding: the row stays, zeroed, as a watchlist entry. */
  sellAll: boolean;
  fcd: number;
  usd: number;
}

/** Below this many shares a holding counts as fully sold. */
export const DUST = 1e-4;

export function tradeEffect(
  input: Pick<TradeInput, 'type' | 'shares' | 'price' | 'commissionFree' | 'cashSource' | 'dateStr'>,
  row: Pick<HoldingRow, 'qty' | 'avgPrice'> | null | undefined,
  basis: Basis | null,
  wallet: Pick<PortfolioRow, 'fcd' | 'usd'> | null | undefined,
): TradeEffect {
  const { type, shares, price } = input;
  const oldQty = row?.qty || 0;
  const oldAvg = basis?.avg ?? (row?.avgPrice || 0);
  const fifo = fifoAfterTrade(basis, type, shares, price, input.dateStr);

  let newQty: number, newAvg: number, sellAll = false;
  if (type === 'Buy') {
    newQty = oldQty + shares;
    // FIFO and a weighted average agree on a buy, so the fallback is exact.
    newAvg = fifo ? fifo.avg : (oldQty * oldAvg + shares * price) / newQty;
  } else {
    newQty = Math.max(0, oldQty - shares);
    // Only FIFO moves the average on a sell. Without a reconciled ledger it stays put.
    newAvg = fifo ? fifo.avg : oldAvg;
    if (newQty < DUST) { newQty = 0; newAvg = 0; sellAll = true; }
  }

  const tradeValue = shares * price;
  const fees = feesOn(tradeValue, input.commissionFree);
  const amount = type === 'Buy' ? tradeValue + fees.total : tradeValue - fees.total;
  const delta = type === 'Buy' ? -amount : amount;
  let fcd = wallet?.fcd || 0, usd = wallet?.usd || 0;
  if (input.cashSource === 'FCD') fcd += delta; else usd += delta;

  return { tradeValue, fees, amount, oldQty, oldAvg, newQty, newAvg, sellAll, fcd, usd };
}

export interface Ledger { rows: readonly HoldingRow[]; registry: readonly PortfolioRow[]; txs: readonly Tx[] }

/** The same three collections with the trade applied. Nothing passed in is mutated. */
export function applyTrade(state: Ledger, input: TradeInput, fx: TradeEffect) {
  const mine = (r: HoldingRow) => r.symbol === input.symbol && r.portfolio === input.portfolio;
  let rows: HoldingRow[];
  if (state.rows.some(mine)) {
    rows = state.rows.map(r => mine(r) ? { ...r, qty: fx.newQty, avgPrice: fx.newAvg, basisFallback: undefined } : r);
  } else {
    // Name, sector and the rest are filled in by the sheet; they arrive with the next read.
    rows = [...state.rows, {
      portfolio: input.portfolio, symbol: input.symbol, name: null, sector: null, industry: null,
      category: null, custom: null, myGroup: null, qty: fx.newQty, avgPrice: fx.newAvg,
      target: null, price: input.price, marketCap: null,
    }];
  }
  const registry = setWallet(state.registry, fx.fcd, fx.usd);
  const tx: Tx = {
    row: state.txs.reduce((m, t) => Math.max(m, t.row), 1) + 1,
    dateStr: input.dateStr, time: input.time, type: input.type, ticker: input.symbol,
    shares: input.shares, price: input.price, tradeValue: fx.tradeValue,
    portfolio: input.portfolio, commissionFree: input.commissionFree, note: input.note,
  };
  return { rows, registry, txs: [...state.txs, tx], tx };
}

/** The one shared wallet lives on Long-Term's row. Cash is kept equal to FCD + USD. */
export function setWallet(registry: readonly PortfolioRow[], fcd: number, usd: number): PortfolioRow[] {
  return registry.map(p => p.name === DEFAULT_PORT ? { ...p, fcd, usd, cash: fcd + usd } : p);
}

// ── Pins ─────────────────────────────────────────────────────────────────────────────────────────
// Google can serve a copy of the sheet from before a write for up to half a minute after it lands.
// A refresh in that window would put the old quantity back, and the NEXT trade, computed from it,
// would then overwrite the good value. So what a save wrote is held over incoming reads until a
// read agrees with it, or the pin expires.
export const PIN_MS = 120_000;

export interface RowPin { portfolio: string; symbol: string; qty: number; avgPrice: number; price: number | null; until: number }
export interface CashPin { fcd: number; usd: number; until: number }
export interface TxPin { tx: Tx; afterRow: number; until: number }
export interface Pins { rows: Map<string, RowPin>; cash: CashPin | null; txs: TxPin[] }

export const newPins = (): Pins => ({ rows: new Map(), cash: null, txs: [] });
const near = (a: number | null | undefined, b: number, tol = 1e-5) => Math.abs((a || 0) - b) < tol;

/** Re-apply holding pins to a fresh read. Pins the read already agrees with, and expired ones, are dropped. */
export function pinRows(rows: readonly HoldingRow[], pins: Pins, now: number): HoldingRow[] {
  let out = rows as HoldingRow[];
  for (const [key, pin] of pins.rows) {
    if (now > pin.until) { pins.rows.delete(key); continue; }
    const i = out.findIndex(r => r.symbol === pin.symbol && r.portfolio === pin.portfolio);
    if (i >= 0 && near(out[i].qty, pin.qty) && near(out[i].avgPrice, pin.avgPrice)) { pins.rows.delete(key); continue; }
    if (out === rows) out = [...rows];
    if (i >= 0) out[i] = { ...out[i], qty: pin.qty, avgPrice: pin.avgPrice };
    else out.push({
      portfolio: pin.portfolio, symbol: pin.symbol, name: null, sector: null, industry: null,
      category: null, custom: null, myGroup: null, qty: pin.qty, avgPrice: pin.avgPrice,
      target: null, price: pin.price, marketCap: null,
    });
  }
  return out;
}

export function pinWallet(registry: readonly PortfolioRow[], pins: Pins, now: number): PortfolioRow[] {
  const pin = pins.cash;
  if (!pin) return registry as PortfolioRow[];
  const w = registry.find(p => p.name === DEFAULT_PORT);
  if (now > pin.until || !w || (near(w.fcd, pin.fcd, 1e-3) && near(w.usd, pin.usd, 1e-3))) { pins.cash = null; return registry as PortfolioRow[]; }
  return setWallet(registry, pin.fcd, pin.usd);
}

/** Keep a just-recorded trade in the ledger until a read of the sheet includes it. */
export function pinTxs(txs: readonly Tx[], pins: Pins, now: number): Tx[] {
  const claimed = new Set<Tx>();
  const missing: Tx[] = [];
  pins.txs = pins.txs.filter(pin => {
    if (now > pin.until) return false;
    const { tx } = pin;
    // An appended row always lands below every row that existed when the trade was recorded.
    const hit = txs.find(t => !claimed.has(t) && t.row > pin.afterRow && t.dateStr === tx.dateStr && t.type === tx.type
      && t.ticker === tx.ticker && t.portfolio === tx.portfolio && near(t.shares, tx.shares, 1e-6) && near(t.price, tx.price, 1e-6));
    if (hit) { claimed.add(hit); return false; }
    missing.push(tx);
    return true;
  });
  if (!missing.length) return txs as Tx[];
  let row = txs.reduce((m, t) => Math.max(m, t.row), 1);
  return [...txs, ...missing.map(tx => ({ ...tx, row: ++row }))];
}
