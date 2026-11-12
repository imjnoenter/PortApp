// Looking through ETFs to the stocks inside them.
//
// Only each fund's published top holdings are known (about 20), so every figure here covers part of
// the fund and says how much it could not see.
import type { Model, Position } from './types.ts';

export interface EtfHolding { symbol: string; name: string; weight: number }   // weight is a fraction of the fund
export interface EtfInfo {
  holdingsCount: number | null;
  topSector: string | null;
  netAssets: number | null;
  ytdReturn?: number | null;
  expenseRatio: number | null;
  dividendYield: number | null;
  trailingReturns: Partial<Record<'1M' | '3M' | '1Y' | '3Y' | '5Y', number | null>> | null;
  topHoldings: EtfHolding[] | null;
}
export type EtfData = Record<string, EtfInfo | null>;

export const isEtf = (p: Pick<Position, 'symbol' | 'industry' | 'portfolio'>, etf: EtfData) =>
  p.industry === 'ETF' || p.portfolio === 'ETF' || !!etf[p.symbol];

export interface Blended { symbol: string; name: string; value: number; via: string[] }

/** Every stock held through the funds, in dollars: fund value times the stock's weight in it, summed over funds. */
export function blendedHoldings(m: Model, etf: EtfData) {
  const by = new Map<string, Blended>();
  let fundValue = 0, seen = 0;
  for (const p of m.positions) {
    const top = etf[p.symbol]?.topHoldings;
    if (!top?.length) continue;
    fundValue += p.currentValue;
    for (const h of top) {
      const v = p.currentValue * h.weight;
      seen += v;
      let b = by.get(h.symbol);
      if (!b) by.set(h.symbol, b = { symbol: h.symbol, name: h.name, value: 0, via: [] });
      b.value += v; b.via.push(p.symbol);
    }
  }
  return { rows: [...by.values()].sort((a, b) => b.value - a.value), fundValue, seen, unseen: Math.max(0, fundValue - seen) };
}

export interface Exposure { symbol: string; direct: number; viaEtf: number; total: number; hidden: boolean }

/**
 * Real weight of each stock in the account: what is held directly plus what the funds hold of it.
 * Percentages are of the tab's whole value. `hidden` marks a stock whose fund share adds at least
 * half again to what is held directly.
 */
export function trueExposure(m: Model, etf: EtfData): { rows: Exposure[]; unseenPct: number } | null {
  const blend = blendedHoldings(m, etf);
  if (!blend.rows.length || !m.totalCurrent) return null;
  const by = new Map<string, Exposure>();
  const get = (symbol: string) => {
    let e = by.get(symbol);
    if (!e) by.set(symbol, e = { symbol, direct: 0, viaEtf: 0, total: 0, hidden: false });
    return e;
  };
  for (const p of m.positions) if (!etf[p.symbol]?.topHoldings?.length) get(p.symbol).direct = p.currentValue / m.totalCurrent * 100;
  for (const b of blend.rows) get(b.symbol).viaEtf = b.value / m.totalCurrent * 100;
  for (const e of by.values()) { e.total = e.direct + e.viaEtf; e.hidden = e.direct > 0 && e.viaEtf >= e.direct * 0.5; }
  return { rows: [...by.values()].filter(e => e.viaEtf > 0).sort((a, b) => b.total - a.total), unseenPct: blend.unseen / m.totalCurrent * 100 };
}
