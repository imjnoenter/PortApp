// Local mirrors of what the backend does for every save other than recording a trade.
//
// Each function returns new collections and mutates nothing, so the screen can show the result at
// once while the request is still on its way.
import { feesOn } from './fees.ts';
import { DEFAULT_PORT, fifoBasis, fifoWalk } from './fifo.ts';
import { DUST, setWallet } from './trade.ts';
import type { Ledger } from './trade.ts';
import type { Contribution, HoldingRow, Tx } from './types.ts';

export const blankRow = (portfolio: string, symbol: string, extra: Partial<HoldingRow> = {}): HoldingRow => ({
  portfolio, symbol, name: null, sector: null, industry: null, category: null, custom: null, myGroup: null,
  qty: null, avgPrice: null, target: null, price: null, marketCap: null, ...extra,
});

// ── Fingerprints ─────────────────────────────────────────────────────────────────────────────────
// An edit or delete names its row by number. The backend refuses it unless the row still carries
// this fingerprint, so a row that moved can never be overwritten by mistake.
export const txSig = (t: Pick<Tx, 'dateStr' | 'type' | 'ticker' | 'shares' | 'price'>) =>
  [t.dateStr, t.type.trim(), t.ticker.toUpperCase(), t.shares.toFixed(6), t.price.toFixed(6)].join('|');
export const contribSig = (c: Pick<Contribution, 'date' | 'portfolio' | 'type' | 'amount'>) =>
  [c.date, c.portfolio.trim(), c.type.trim(), (c.amount || 0).toFixed(6)].join('|');

// ── Editing or deleting a trade ──────────────────────────────────────────────────────────────────
const qtyDelta = (t: Tx) => t.type === 'Buy' || t.type === 'Transfer-In' ? t.shares : t.type === 'Sell' || t.type === 'Transfer-Out' ? -t.shares : 0;
/** Cash a trade moved: a buy spent value plus fees, a sale brought in value less fees. */
export function cashEffect(t: Tx) {
  if (t.type !== 'Buy' && t.type !== 'Sell') return 0;
  const tv = t.shares * t.price, fee = feesOn(tv, t.commissionFree).total;
  return t.type === 'Buy' ? -(tv + fee) : tv - fee;
}

/**
 * Replace a ledger row (`next`) or remove it (`next` null), and correct the holding and the USD
 * balance to match. `avg` is the FIFO average afterwards, or null when the ledger does not account
 * for the shares held, in which case the stored average is left alone.
 */
export function replaceTx(state: Ledger, old: Tx, next: Tx | null) {
  const txs = next
    ? state.txs.map(t => t.row === old.row ? next : t)
    : state.txs.filter(t => t.row !== old.row).map(t => t.row > old.row ? { ...t, row: t.row - 1 } : t);
  const mine = (r: HoldingRow) => r.symbol === old.ticker && r.portfolio === old.portfolio;
  const row = state.rows.find(mine);
  let qty = Math.max(0, (row?.qty || 0) + (next ? qtyDelta(next) : 0) - qtyDelta(old));
  if (qty < DUST) qty = 0;
  const basis = qty ? fifoBasis(fifoWalk(txs), old.portfolio, old.ticker, qty) : null;
  const avg = qty ? basis?.avg ?? null : 0;
  const rows = row
    ? state.rows.map(r => mine(r) ? { ...r, qty, avgPrice: avg ?? r.avgPrice, basisFallback: undefined } : r)
    : qty ? [...state.rows, blankRow(old.portfolio, old.ticker, { qty, avgPrice: avg ?? next?.price ?? 0 })] : [...state.rows];
  const wallet = state.registry.find(p => p.name === DEFAULT_PORT);
  const cashDelta = (next ? cashEffect(next) : 0) - cashEffect(old);
  const registry = wallet ? setWallet(state.registry, wallet.fcd, wallet.usd + cashDelta) : [...state.registry];
  return { rows, registry, txs, avg, cashDelta };
}

// ── Moving shares between portfolios ─────────────────────────────────────────────────────────────
/** No cash moves and nothing is realized: the shares cross at the cost they are carried at. */
export function applyTransfer(
  state: Pick<Ledger, 'rows' | 'txs'>, symbol: string, shares: number, from: string, to: string, now: { dateStr: string; time: string },
) {
  const src = state.rows.find(r => r.symbol === symbol && r.portfolio === from);
  const srcQty = src?.qty || 0;
  const price = fifoBasis(fifoWalk(state.txs), from, symbol, srcQty)?.avg ?? (src?.avgPrice || 0);
  const left = srcQty - shares;
  let rows = left <= 1e-6
    ? state.rows.filter(r => r !== src)
    : state.rows.map(r => r === src ? { ...r, qty: left } : r);
  const dst = rows.find(r => r.symbol === symbol && r.portfolio === to);
  if (dst) {
    const q0 = dst.qty || 0, nq = q0 + shares;
    rows = rows.map(r => r === dst ? { ...r, qty: nq, avgPrice: (q0 * (dst.avgPrice || 0) + shares * price) / nq } : r);
  } else {
    rows = [...rows, blankRow(to, symbol, {
      name: src?.name ?? null, sector: src?.sector ?? null, industry: src?.industry ?? null, category: src?.category ?? null,
      custom: src?.custom ?? null, myGroup: src?.myGroup ?? null, price: src?.price ?? null, marketCap: src?.marketCap ?? null,
      qty: shares, avgPrice: price,
    })];
  }
  let n = state.txs.reduce((m, t) => Math.max(m, t.row), 1);
  const leg = (type: string, portfolio: string): Tx => ({
    row: ++n, dateStr: now.dateStr, time: now.time, type, ticker: symbol, shares, price,
    tradeValue: shares * price, portfolio, commissionFree: true, note: '',
  });
  return { rows, txs: [...state.txs, leg('Transfer-Out', from), leg('Transfer-In', to)], price };
}

// ── Deposits and withdrawals ─────────────────────────────────────────────────────────────────────
export interface ContribInput { type: 'Deposit' | 'Withdraw'; date: string; thb: number; usd: number; note: string }

/** A deposit is recorded in the baht paid in, a withdrawal in the dollars taken out. Both keep both amounts. */
export const contribRow = (input: ContribInput, portfolio: string, row: number): Contribution => ({
  row, portfolio, date: input.date, type: input.type, note: input.note,
  amount: input.type === 'Withdraw' ? input.usd : input.thb, currency: input.type === 'Withdraw' ? 'USD' : 'THB',
  thb: input.thb, usd: input.usd, rate: input.usd ? input.thb / input.usd : null,
});

export const dropContrib = (list: readonly Contribution[], row: number) =>
  list.filter(c => c.row !== row).map(c => c.row > row ? { ...c, row: c.row - 1 } : c);

// ── Holdings sheet fields ────────────────────────────────────────────────────────────────────────
/** Set target fractions for one portfolio. A symbol with no row there is left out, as the backend does. */
export const setTargets = (rows: readonly HoldingRow[], portfolio: string, targets: Readonly<Record<string, number>>) =>
  rows.map(r => r.portfolio === portfolio && r.symbol in targets ? { ...r, target: targets[r.symbol] } : r);

export interface Details { category: string; custom: string; myGroup: string; qty?: number; avgPrice?: number }

/** Category belongs to the one row; Custom and My Group describe the symbol, so every row of it gets them. */
export function setDetails(rows: readonly HoldingRow[], portfolio: string, symbol: string, d: Details) {
  return rows.map(r => {
    if (r.symbol !== symbol) return r;
    const out = { ...r, custom: d.custom || null, myGroup: d.myGroup || null };
    if (r.portfolio !== portfolio) return out;
    out.category = d.category || null;
    if (d.qty != null) out.qty = d.qty;
    if (d.avgPrice != null) out.avgPrice = d.avgPrice;
    return out;
  });
}
