/** Text from a number box. NaN when it is not a number; an empty box is NaN too. */
export const parseNum = (s: string) => { const n = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : NaN; };
/** A number as short text for an input: no trailing zeros. */
export const numText = (n: number | null | undefined, dp = 6) => n == null || !Number.isFinite(n) ? '' : String(+n.toFixed(dp));
export const isTicker = (s: string) => /^[A-Z0-9.^-]+$/.test(s);
