// A plan for one (portfolio, symbol): a ladder of entry prices, a stop loss and up to three trims.
//
// The sheet stores an entry as `price:dollars:cumPct` and a trim as `price/pct`. `cumPct` is how
// full the position should be once that entry is bought, as a percentage of its target value.
import { fifoKey } from './fifo.ts';

export interface Tranche { price: number | null; cumPct: number }
/** `pct` is the share of the TARGET value to sell at `price`, not of what is held. */
export interface Trim { price: number | null; pct: number }
export interface Plan { sl: number | null; note: string; tranches: Tranche[]; trims: Trim[] }
export type Plans = Record<string, Plan>;

export const planKey = fifoKey;
export const MAX_TRANCHES = 13;
export const MAX_TRIMS = 3;

const blank = (t: Tranche) => t.price == null && !(t.cumPct > 0);

export function parseTranche(v: unknown): Tranche {
  if (v == null || v === '') return { price: null, cumPct: 0 };
  const parts = String(v).split(':');
  const price = parseFloat(parts[0]);
  return { price: Number.isFinite(price) ? price : null, cumPct: parseFloat(parts[parts.length - 1]) || 0 };
}

/** Accepts `70/50`, and `70:50:00`, which is what Sheets makes of it when the cell is not text. */
export function parseTrim(v: string): Trim | null {
  const parts = v.split(/[:/]/);
  const price = parseFloat(parts[0]), pct = parseFloat(parts[1]);
  return Number.isFinite(price) && price > 0 ? { price, pct: Number.isFinite(pct) ? pct : 0 } : null;
}

/** Trailing empty entries go. One in the middle stays: it is a rung that has been bought. */
export function cleanPlan(p: Plan): Plan {
  const tranches = p.tranches.slice(0, MAX_TRANCHES);
  while (tranches.length && blank(tranches[tranches.length - 1])) tranches.pop();
  return {
    sl: p.sl != null && p.sl > 0 ? p.sl : null, note: p.note.trim(), tranches,
    trims: p.trims.filter(t => t.price != null && t.price > 0).slice(0, MAX_TRIMS),
  };
}

export const planIsEmpty = (p: Plan) => p.sl == null && !p.note && !p.trims.length && p.tranches.every(blank);

/** Dollars each entry buys: the step from where the position stands (or the rung before) up to its cumPct. */
export function trancheDollars(tranches: readonly Tranche[], currPct: number, targetDollar: number): number[] {
  return tranches.map((t, i) => {
    const prev = i === 0 ? currPct : Math.max(currPct, tranches[i - 1].cumPct ?? currPct);
    return Math.max(0, ((t.cumPct ?? 0) - prev) / 100 * targetDollar);
  });
}

/** The plan as the strings the sheet stores. */
export function planStrings(plan: Plan, currPct: number, targetDollar: number) {
  const dollars = trancheDollars(plan.tranches, currPct, targetDollar);
  const tp = (i: number) => { const t = plan.trims[i]; return t?.price ? `${t.price}/${t.pct || 0}` : ''; };
  return {
    tranches: plan.tranches.map((t, i) => blank(t) ? '' : `${t.price ?? ''}:${dollars[i].toFixed(2)}:${t.cumPct ?? 0}`).join(','),
    tp1: tp(0), tp2: tp(1), tp3: tp(2),
  };
}

/** The first entry, in ladder order, the price has not yet fallen to. */
export function nextTranche(plan: Plan, price: number | null) {
  if (!price || price <= 0) return null;
  const index = plan.tranches.findIndex(t => t.price != null && t.price < price);
  return index < 0 ? null : { index, tranche: plan.tranches[index] };
}
