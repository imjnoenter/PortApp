// What needs attention now: prices that have reached, or are close to, a level a plan set, and
// holdings that have drifted from their target.
import type { Plan } from './plan.ts';
import { trancheDollars } from './plan.ts';

export type AlertKind = 'stop' | 'profit' | 'entry' | 'drift';
export interface PlanAlert {
  /** Stable for as long as the condition holds, so a notification fires once per event. */
  key: string;
  portfolio: string;
  symbol: string;
  kind: AlertKind;
  /** The level was reached, as opposed to being merely close. Only these notify. */
  hit: boolean;
  urgency: number;
  /** Which rung: 1-based entry or take-profit number. */
  step: number;
  level: number;
  /** Percent between the price and the level, signed from the level's side. */
  gap: number;
  /** For an entry, the dollars it buys. */
  dollars: number;
}

export const NEAR_STOP = 5, NEAR_PROFIT = 3, NEAR_ENTRY = 3;

export interface PlanContext { price: number | null; qty: number; currentValue: number; targetDollar: number }

/** Alerts for one plan. Stops and take-profits only matter while shares are held. */
export function planAlerts(portfolio: string, symbol: string, plan: Plan, c: PlanContext): PlanAlert[] {
  const out: PlanAlert[] = [];
  const price = c.price;
  if (!price || price <= 0) return out;
  const base = `${portfolio}:${symbol}:`;
  const add = (kind: AlertKind, tag: string, hit: boolean, urgency: number, step: number, level: number, gap: number, dollars = 0) =>
    out.push({ key: base + tag + (hit ? '_HIT' : '_NEAR'), portfolio, symbol, kind, hit, urgency, step, level, gap, dollars });

  if (c.qty > 0) {
    if (plan.sl) {
      const gap = (price / plan.sl - 1) * 100;
      if (gap <= 0) add('stop', 'SL', true, 5, 0, plan.sl, gap);
      else if (gap <= NEAR_STOP) add('stop', 'SL', false, 4, 0, plan.sl, gap);
    }
    plan.trims.forEach((t, i) => {
      if (!t.price) return;
      const gap = (price / t.price - 1) * 100;
      if (gap >= 0) add('profit', 'TP' + (i + 1), true, 3, i + 1, t.price, gap);
      else if (gap >= -NEAR_PROFIT) add('profit', 'TP' + (i + 1), false, 2, i + 1, t.price, gap);
    });
  }
  const currPct = c.targetDollar > 0 ? c.currentValue / c.targetDollar * 100 : 0;
  const dollars = trancheDollars(plan.tranches, currPct, c.targetDollar);
  plan.tranches.forEach((t, i) => {
    if (!t.price) return;
    const gap = (price / t.price - 1) * 100;
    if (gap <= 0) add('entry', 'T' + (i + 1), true, 1, i + 1, t.price, gap, dollars[i]);
    else if (gap <= NEAR_ENTRY) add('entry', 'T' + (i + 1), false, 0.5, i + 1, t.price, gap, dollars[i]);
  });
  return out;
}

/** A holding more than `band` percent away from its target value. A standing condition, never a notification. */
export function driftAlert(portfolio: string, symbol: string, currentValue: number, targetDollar: number, band: number): PlanAlert | null {
  if (!(targetDollar > 0) || !(band > 0)) return null;
  const gap = currentValue / targetDollar * 100 - 100;
  if (Math.abs(gap) < band) return null;
  return { key: `${portfolio}:${symbol}:DRIFT`, portfolio, symbol, kind: 'drift', hit: false, urgency: 0.25, step: 0, level: targetDollar, gap, dollars: Math.abs(currentValue - targetDollar) };
}
