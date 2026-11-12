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

/**
 * The ledger's Date/Time are Thai (UTC+7) and the US session runs past Thai midnight, so a
 * "17 Oct 03:10" buy belongs to 16 Oct's session. A row with no time keeps its date.
 */
export function txMarketDate(dateStr: string, time: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time || '');
  if (!m) return dateStr;
  const [y, mo, d] = dateStr.split('-').map(Number);
  return ET_DATE.format(new Date(Date.UTC(y, mo - 1, d, Number(m[1]) - 7, Number(m[2]), Number(m[3] || 0))));
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
