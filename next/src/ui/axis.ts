// Scales for the charts: round numbers up the side, dates along the bottom.
import { monthName } from '../core/format.ts';

/** About `want` round values between lo and hi: steps of 1, 2, 2.5 or 5 times a power of ten. */
export function ticks(lo: number, hi: number, want = 5): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / want, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 2.25 ? 2 : n < 3.5 ? 2.5 : n < 7.5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/** A value on an axis: no more decimals than the step between ticks needs. */
export function tickLabel(v: number, list: readonly number[], prefix = '') {
  const step = list.length > 1 ? Math.abs(list[1] - list[0]) : Math.abs(v) || 1;
  const dp = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return prefix + v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/**
 * Dates to print under a series, as positions into it: the first trading day of each month, thinned
 * until at most `max` are left. A span of a few weeks falls back to evenly spaced days.
 */
export function dateTicks(days: readonly string[], max = 6): { i: number; label: string }[] {
  const n = days.length;
  if (n < 2) return [];
  let marks: number[] = [];
  for (let i = 1; i < n; i++) if (days[i].slice(0, 7) !== days[i - 1].slice(0, 7)) marks.push(i);
  const monthly = marks.length >= 2;
  if (!monthly) { marks = []; for (let k = 0; k < 5; k++) marks.push(Math.round(k * (n - 1) / 4)); }
  while (marks.length > max) marks = marks.filter((_, k) => k % 2 === 0);
  const years = days[0].slice(0, 4) !== days[n - 1].slice(0, 4);
  // The year is printed on the first label and again wherever it changes, even after thinning.
  return marks.map((i, k) => {
    const [y, m, d] = days[i].split('-').map(Number);
    const turned = k === 0 || days[marks[k - 1]].slice(0, 4) !== days[i].slice(0, 4);
    return { i, label: monthly ? monthName(m - 1) + (years && turned ? ` ’${String(y).slice(2)}` : '') : `${d} ${monthName(m - 1)}` };
  });
}
