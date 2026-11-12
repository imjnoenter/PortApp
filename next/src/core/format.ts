// Number formatting. Pure; the UI binds currency and FX rate once and passes a `Money` around.

const USD2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const DASH = '—';
const ok = (n: unknown): n is number => typeof n === 'number' && isFinite(n);

/** Always dollars: per-share prices are inherently USD, whatever the display currency. */
export const usd = (n: number | null | undefined) => ok(n) ? USD2.format(n) : DASH;
export const baht = (n: number | null | undefined) => ok(n) ? (n < 0 ? '-' : '') + '฿' + INT.format(Math.abs(Math.round(n))) : DASH;

export interface Money {
  (n: number | null | undefined): string;
  /** With an explicit + on gains. */
  signed(n: number | null | undefined): string;
  compact(n: number | null | undefined): string;
}

/** Portfolio values follow the display currency. */
export function moneyFormatter(currency: 'USD' | 'THB', fx: number): Money {
  const base = (n: number | null | undefined) => !ok(n) ? DASH : currency === 'THB' ? baht(n * fx) : usd(n);
  const f = base as Money;
  f.signed = n => !ok(n) ? DASH : (n > 0 ? '+' : '') + base(n);
  f.compact = n => {
    if (!ok(n)) return DASH;
    const v = currency === 'THB' ? n * fx : n, a = Math.abs(v), s = currency === 'THB' ? '฿' : '$';
    const u = a >= 1e12 ? [1e12, 'T'] as const : a >= 1e9 ? [1e9, 'B'] as const : a >= 1e6 ? [1e6, 'M'] as const : a >= 1e4 ? [1e3, 'K'] as const : null;
    return u ? (v < 0 ? '-' : '') + s + (a / u[0]).toFixed(a / u[0] >= 100 ? 0 : 1) + u[1] : base(n);
  };
  return f;
}

export const pct = (n: number | null | undefined, dp = 2) => ok(n) ? n.toFixed(dp) + '%' : DASH;
export const signedPct = (n: number | null | undefined, dp = 2) => ok(n) ? (n > 0 ? '+' : '') + n.toFixed(dp) + '%' : DASH;

/** Share counts: up to 6 decimals, trailing zeros dropped. */
export const qty = (n: number | null | undefined) => ok(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 6 }) : DASH;

export function compactNum(n: number | null | undefined) {
  if (!ok(n)) return DASH;
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-06' → '6 Nov 2026' (or '6 Nov' when short). */
export function date(dateStr: string | null | undefined, short = false) {
  if (!dateStr) return DASH;
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${short ? '' : ' ' + y}`;
}
export const monthName = (i: number) => MONTHS[i];

export const sign = (n: number | null | undefined) => !ok(n) || Math.abs(n) < 1e-9 ? 'flat' : n > 0 ? 'gain' : 'loss';

export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

/** A stable colour per label: the same symbol is the same colour on every chart, whatever its rank. */
export function colorFor(key: string): string {
  if (key === 'Cash' || key === 'SGOV') return '#8a93a6';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0x7fffffff;
  return PALETTE[h % PALETTE.length];
}
