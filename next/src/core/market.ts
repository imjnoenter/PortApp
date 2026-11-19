// US market clock. Everything takes `now` so it can be tested.

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
});
const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

function etClock(now: Date) {
  const parts = Object.fromEntries(ET.formatToParts(now).map(p => [p.type, p.value]));
  const weekday = !['Sat', 'Sun'].includes(parts.weekday);
  return { weekday, min: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}

export type Session = 'open' | 'pre' | 'post' | 'closed';

/** Regular session 09:30–16:00 ET; extended 04:00–09:30 and 16:00–20:00. Holidays are not known. */
export function session(now = new Date()): Session {
  const { weekday, min } = etClock(now);
  if (!weekday) return 'closed';
  if (min >= 570 && min < 960) return 'open';
  if (min >= 240 && min < 570) return 'pre';
  if (min >= 960 && min < 1200) return 'post';
  return 'closed';
}

/** 20:00 to 04:00 ET on a trading night: no stock trades, but index futures do. */
export function isOvernight(now = new Date()): boolean {
  const { weekday, min } = etClock(now);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now);
  // Sunday evening counts (futures reopen); Friday evening and Saturday do not.
  if (min >= 1200) return day !== 'Fri' && day !== 'Sat';
  return min < 240 && weekday;
}

/** Today's date on the US market calendar, yyyy-MM-dd. */
export const etToday = (now = new Date()) => ET_DATE.format(now);

/** A ledger Date/Time (Thai, UTC+7) as the instant it names, or null when there is no time. */
function ledgerInstant(dateStr: string, time: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time || '');
  if (!m) return null;
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, Number(m[1]) - 7, Number(m[2]), Number(m[3] || 0)));
}

/**
 * The trade's own date, as the broker and the exchange record it. The ledger's Date/Time are
 * Thai and the US day runs past Thai midnight, so a "17 Oct 03:10" buy is a 16 Oct trade. Pre-market
 * and after-hours trades carry that New York day's date; the overnight session (from 20:00 New York)
 * trades for the next day. This is the date that decides a dividend, and where a chart flag goes.
 * A row with no time keeps its date.
 */
export function tradeDate(dateStr: string, time: string): string {
  const at = ledgerInstant(dateStr, time);
  if (!at) return dateStr;
  const day = ET_DATE.format(at);
  return etClock(at).min >= 1200 ? addDays(day, 1) : day;
}

/**
 * The US session a trade's shares are first held through. Before 16:00 New York that is the same
 * New York day; a trade made after the close (after-hours, or overnight) is not in that day's
 * closing value, so it belongs to the next one. This decides which day's return a trade is part of;
 * for its date as the broker records it, see tradeDate. The result can be a weekend or a holiday: whoever
 * walks a list of trading days takes the first one on or after it. A row with no time keeps its date.
 */
export function sessionDay(dateStr: string, time: string): string {
  const at = ledgerInstant(dateStr, time);
  if (!at) return dateStr;
  const day = ET_DATE.format(at);
  return etClock(at).min >= 960 ? addDays(day, 1) : day;
}

/** The trading day a trade made right now would carry: tradeDate's rule applied to the clock. */
export function tradeToday(now = new Date()): string {
  const day = ET_DATE.format(now);
  return etClock(now).min >= 1200 ? addDays(day, 1) : day;
}

/** Monday of the week containing dateStr. */
export function weekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
