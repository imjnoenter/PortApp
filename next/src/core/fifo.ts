// Compressed FIFO cost basis, the method the broker uses.
//
// Lots are per (portfolio, symbol): a sell in one portfolio can never retire a lot from another.
// Same-day BUYS compress into one weighted-average lot; SELLS then retire lots oldest-first across
// days. Transfers move real lot slices between portfolios, so total cost is preserved.
//
// A lot's unitCost is shares × price only. The buy-side fee rides along as unitBuyFee so realized
// P&L can be netted on both legs, but it is deliberately NOT folded into unitCost: unitCost becomes
// the displayed average price, which is a price, not a price-plus-fee.
import { feesOn } from './fees.ts';
import type { Tx } from './types.ts';

export const DEFAULT_PORT = 'Long-Term';
const EPS = 1e-12;

/** [shares, unitCost, date, unitBuyFee] */
export type Lot = [number, number, string, number];

export type FifoTx = Pick<Tx, 'dateStr' | 'type' | 'ticker' | 'shares' | 'price' | 'tradeValue' | 'portfolio' | 'commissionFree'>;

export interface FifoSell {
  dateStr: string; ticker: string; portfolio: string;
  shares: number; price: number; tradeValue: number;
  costOut: number;  // FIFO cost of the shares retired
  feeIn: number;    // buy-side fee those shares carried
  feeOut: number;   // this sale's own fee
}
export interface FifoResult { books: Map<string, Lot[]>; sells: FifoSell[] }

export const fifoKey = (port: string | null | undefined, sym: string) => (port || DEFAULT_PORT) + '\u0000' + sym;

const tvOf = (t: FifoTx, shares = t.shares || 0) => t.tradeValue != null ? t.tradeValue : shares * (t.price || 0);

function retire(L: Lot[], qty: number) {
  let rem = qty, cost = 0, fee = 0;
  while (rem > EPS && L.length) {
    const take = Math.min(rem, L[0][0]);
    cost += take * L[0][1];
    fee += take * (L[0][3] || 0);
    L[0][0] -= take;
    rem -= take;
    if (L[0][0] <= EPS) L.shift();
  }
  return { cost, fee };
}

/** Like retire, but hands back the slices themselves so a transfer carries real cost and fee. */
function detach(L: Lot[], qty: number): Lot[] {
  let rem = qty;
  const out: Lot[] = [];
  while (rem > EPS && L.length) {
    const take = Math.min(rem, L[0][0]);
    out.push([take, L[0][1], L[0][2], L[0][3] || 0]);
    L[0][0] -= take;
    rem -= take;
    if (L[0][0] <= EPS) L.shift();
  }
  return out;
}

export function fifoWalk(txs: readonly FifoTx[]): FifoResult {
  const books = new Map<string, Lot[]>();
  const sells: FifoSell[] = [];
  const lotsOf = (k: string) => { let L = books.get(k); if (!L) { L = []; books.set(k, L); } return L; };

  const byDate = new Map<string, FifoTx[]>();
  for (const t of txs) {
    if (!t || !t.ticker || !t.dateStr || t.type === 'Dividend') continue;
    let g = byDate.get(t.dateStr);
    if (!g) byDate.set(t.dateStr, g = []);
    g.push(t);
  }
  const dates = [...byDate.keys()].sort();

  for (const d of dates) {
    const group = byDate.get(d)!;
    const pick = (ty: string) => group.filter(t => t.type === ty);

    // 1. compress the day's buys per key into one lot
    const buyAgg = new Map<string, { q: number; c: number; f: number }>();
    for (const t of pick('Buy')) {
      const k = fifoKey(t.portfolio, t.ticker);
      const a = buyAgg.get(k) || { q: 0, c: 0, f: 0 };
      const tv = tvOf(t);
      a.q += t.shares || 0; a.c += tv; a.f += feesOn(tv, t.commissionFree).total;
      buyAgg.set(k, a);
    }
    for (const [k, a] of buyAgg) if (a.q > EPS) lotsOf(k).push([a.q, a.c / a.q, d, a.f / a.q]);

    // 2. transfers out: stash the real slices for the matching leg
    const moved = new Map<string, Lot[]>();
    const moveKey = (t: FifoTx) => t.ticker + '\u0000' + (t.shares || 0).toFixed(7);
    for (const t of pick('Transfer-Out')) {
      const slices = detach(lotsOf(fifoKey(t.portfolio, t.ticker)), t.shares || 0);
      moved.set(moveKey(t), (moved.get(moveKey(t)) || []).concat(slices));
    }
    // 3. transfers in: receive those slices (fallback: one lot at the carried price)
    for (const t of pick('Transfer-In')) {
      const slices = moved.get(moveKey(t));
      const L = lotsOf(fifoKey(t.portfolio, t.ticker));
      if (slices?.length) { for (const s of slices) L.push([s[0], s[1], d, s[3] || 0]); moved.delete(moveKey(t)); }
      else if ((t.shares || 0) > EPS) L.push([t.shares, t.price || 0, d, 0]);
    }

    // 4. sells retire oldest-first
    for (const t of pick('Sell')) {
      const L = lotsOf(fifoKey(t.portfolio, t.ticker));
      const held = L.reduce((s, l) => s + l[0], 0);
      const sold = Math.min(t.shares || 0, held);
      const { cost, fee } = retire(L, sold);
      const tv = tvOf(t, sold);
      sells.push({
        dateStr: d, ticker: t.ticker, portfolio: t.portfolio || DEFAULT_PORT,
        shares: sold, price: t.price || 0, tradeValue: tv,
        costOut: cost, feeIn: fee, feeOut: feesOn(tv, t.commissionFree).total,
      });
    }
  }
  return { books, sells };
}

/** A gap over 1% between the ledger's share count and the holding's means the history is incomplete. */
export const FIFO_QTY_TOLERANCE = 0.01;

export interface Basis { qty: number; cost: number; avg: number; lots: Lot[] }

/** Ledger-derived basis for one holding, or null when the ledger can't be trusted for it. */
export function fifoBasis(res: FifoResult | null, port: string, sym: string, sheetQty: number): Basis | null {
  const L = res?.books.get(fifoKey(port, sym));
  if (!L?.length) return null;
  const qty = L.reduce((s, l) => s + l[0], 0);
  const cost = L.reduce((s, l) => s + l[0] * l[1], 0);
  if (!(qty > 1e-9)) return null;
  if (sheetQty > 0 && Math.abs(qty - sheetQty) / sheetQty > FIFO_QTY_TOLERANCE) return null;
  return { qty, cost, avg: cost / qty, lots: L };
}

/** Apply a hypothetical trade to the current lots, for previews and the write path. */
export function fifoAfterTrade(basis: Basis | null, type: 'Buy' | 'Sell', shares: number, price: number, dateStr: string) {
  if (!basis) return null;
  const L = basis.lots.map(l => [l[0], l[1], l[2]] as [number, number, string]);
  if (type === 'Buy') {
    const i = L.findIndex(l => l[2] === dateStr);
    if (i >= 0) {
      const q = L[i][0] + shares, c = L[i][0] * L[i][1] + shares * price;
      L[i] = [q, c / q, dateStr];
    } else L.push([shares, price, dateStr]);
  } else {
    let rem = shares;
    while (rem > EPS && L.length) {
      const take = Math.min(rem, L[0][0]);
      L[0][0] -= take; rem -= take;
      if (L[0][0] <= EPS) L.shift();
    }
  }
  const qty = L.reduce((s, l) => s + l[0], 0);
  const cost = L.reduce((s, l) => s + l[0] * l[1], 0);
  return { qty, avg: qty > 1e-9 ? cost / qty : 0 };
}

export const isTransfer = (t: { type?: string }) => {
  const ty = (t.type || '').toLowerCase();
  return ty === 'transfer-out' || ty === 'transfer-in';
};
