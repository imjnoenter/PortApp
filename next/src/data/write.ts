// Writes go to the account's own Apps Script web app as GET requests.
//
// The request is `no-cors`, so the reply cannot be read: a resolved fetch means the request left
// this device, and a rejected one means it did not. Every action sent from here is therefore one
// that is safe to send twice: absolute values, or an append the backend dedupes on its content.
import { contribSig, txSig } from '../core/edits.ts';
import type { Details } from '../core/edits.ts';
import type { Plan, planStrings } from '../core/plan.ts';
import type { TradeInput } from '../core/trade.ts';
import type { Contribution, Tx } from '../core/types.ts';
import type { Profile } from './config.ts';

export type Params = Record<string, string>;

/** Rejects only when the request could not be sent at all (offline, blocked, DNS). */
export async function send(profile: Profile, params: Params): Promise<void> {
  if (!profile.recordUrl || !profile.writeKey) throw new Error('This account is read-only');
  const q = new URLSearchParams(params);
  q.set('key', profile.writeKey);
  await fetch(`${profile.recordUrl}?${q}`, { mode: 'no-cors' });
}

/** A new ledger row. No `action`: appending is the backend's default. */
export const appendTradeParams = (t: TradeInput): Params => ({
  date: t.dateStr, time: t.time, type: t.type, ticker: t.symbol,
  shares: String(t.shares), price: String(t.price), tradeValue: (t.shares * t.price).toFixed(4),
  commissionFree: t.commissionFree ? 'TRUE' : 'FALSE', portfolio: t.portfolio, note: t.note,
});

export const holdingParams = (portfolio: string, symbol: string, qty: number, avgPrice: number): Params => qty > 0
  ? { action: 'updateSymbol', symbol, portfolio, qty: qty.toFixed(6), avgPrice: avgPrice.toFixed(6) }
  : { action: 'updateSymbol', symbol, portfolio, qty: '0', avgPrice: '0' };

export const walletParams = (portfolio: string, fcd: number, usd: number): Params =>
  ({ action: 'updateCash', portfolio, fcd: fcd.toFixed(4), usd: usd.toFixed(4) });

/** Now on the ledger's clock (Bangkok), in the two shapes the sheet stores. */
export function ledgerNow(now = new Date()) {
  return {
    dateStr: now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
    time: now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false }),
  };
}

// ── Everything other than a trade ────────────────────────────────────────────────────────────────
const txFields = (t: Tx): Params => ({
  date: t.dateStr, time: t.time, type: t.type, ticker: t.ticker, shares: String(t.shares), price: String(t.price),
  tradeValue: (t.shares * t.price).toFixed(4), commissionFree: t.commissionFree ? 'TRUE' : 'FALSE',
  portfolio: t.portfolio, note: t.note,
});
/** `old` proves which row is meant: the backend refuses if that row no longer looks like it. */
export const txUpdateParams = (old: Tx, next: Tx): Params => ({ action: 'update', row: String(old.row), expect: txSig(old), ...txFields(next) });
export const txNoteParams = (old: Tx, note: string): Params => ({ action: 'updateNote', row: String(old.row), expect: txSig(old), note });
export const txDeleteParams = (old: Tx): Params => ({ action: 'delete', row: String(old.row), expect: txSig(old) });

const contribFields = (c: Contribution): Params => ({
  portfolio: c.portfolio, date: c.date, type: c.type, amount: String(c.amount), currency: c.currency, note: c.note,
  amountTHB: String(c.thb ?? 0), amountUSD: String(c.usd ?? 0), rate: String(c.rate ?? ''),
});
export const contribAddParams = (c: Contribution): Params => ({ action: 'addContribution', ...contribFields(c) });
export const contribUpdateParams = (old: Contribution, next: Contribution): Params =>
  ({ action: 'updateContribution', row: String(old.row), expect: contribSig(old), ...contribFields(next) });
export const contribDeleteParams = (old: Contribution): Params => ({ action: 'deleteContribution', row: String(old.row), expect: contribSig(old) });

export const planParams = (portfolio: string, symbol: string, plan: Plan, s: ReturnType<typeof planStrings>): Params =>
  ({ action: 'savePlan', symbol, portfolio, tranches: s.tranches, sl: plan.sl == null ? '' : String(plan.sl), note: plan.note, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3 });
export const planClearParams = (portfolio: string, symbol: string): Params => ({ action: 'clearPlan', symbol, portfolio });

export const targetParams = (portfolio: string, symbol: string, target: number): Params =>
  ({ action: 'updateSymbol', symbol, portfolio, target: String(+target.toFixed(6)) });
export const targetsParams = (portfolio: string, targets: Readonly<Record<string, number>>): Params =>
  ({ action: 'updateTargets', portfolio, targets: Object.entries(targets).map(([s, v]) => `${s}:${+v.toFixed(6)}`).join(',') });

export const transferParams = (symbol: string, shares: number, from: string, to: string, price: number): Params =>
  ({ action: 'transferShares', symbol, shares: shares.toFixed(6), fromPortfolio: from, toPortfolio: to, price: price.toFixed(6) });

export const addSymbolParams = (portfolio: string, symbol: string): Params => ({ action: 'addSymbol', symbol, portfolio });
export const removeSymbolParams = (portfolio: string, symbol: string): Params => ({ action: 'removeSymbol', symbol, portfolio });
export const avgParams = (portfolio: string, symbol: string, avgPrice: number): Params =>
  ({ action: 'updateSymbol', symbol, portfolio, avgPrice: avgPrice.toFixed(6) });
export function detailsParams(portfolio: string, symbol: string, d: Details): Params {
  const p: Params = { action: 'updateSymbol', symbol, portfolio, category: d.category, custom: d.custom, myGroup: d.myGroup };
  if (d.qty != null) p.qty = d.qty.toFixed(6);
  if (d.avgPrice != null) p.avgPrice = d.avgPrice.toFixed(6);
  return p;
}

export const reserveParams = (portfolio: string, fraction: number): Params => ({ action: 'updateCash', portfolio, cashRes: String(+fraction.toFixed(6)) });
export const capParams = (portfolio: string, fraction: number): Params => ({ action: 'updateCash', portfolio, capPct: String(+fraction.toFixed(6)) });

/**
 * A request whose answer is needed (fund data, candles). Reads only: a write must never come
 * through here, because when the answer cannot be read the caller cannot tell whether it ran.
 */
export async function ask<T>(profile: Profile, params: Params): Promise<T> {
  if (!profile.recordUrl || !profile.writeKey) throw new Error('This account has no script URL');
  const q = new URLSearchParams(params);
  q.set('key', profile.writeKey);
  const res = await fetch(`${profile.recordUrl}?${q}`);
  if (!res.ok) throw new Error(`The script answered ${res.status}`);
  const json = await res.json();
  if (json?.ok === false) throw new Error(json.error || 'The script refused the request');
  return json as T;
}
