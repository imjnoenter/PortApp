// One reader per sheet tab. Each returns plain typed data and knows nothing about the others.
import { DEFAULT_PORT } from '../core/fifo.ts';
import { cleanPlan, parseTranche, parseTrim, planKey } from '../core/plan.ts';
import type { Plans } from '../core/plan.ts';
import type { Contribution, History, HoldingRow, PortfolioRow, Tx } from '../core/types.ts';
import { bool, date, fetchTable, num, raw, str, time } from './gviz.ts';

export async function loadHoldings(sheetId: string, fresh = false): Promise<HoldingRow[]> {
  const t = await fetchTable(sheetId, 'Claude', fresh);
  const c = {
    portfolio: t.col('Portfolio'), symbol: t.col('Symbol'), name: t.col('Name'), sector: t.col('Sector'),
    industry: t.col('Industry'), category: t.col('Category'), custom: t.col('Custom'), myGroup: t.col('My Group'),
    qty: t.col('Qty'), avg: t.col('Avg price'), target: t.col('Target Allocation'), price: t.col('Current price'),
    cap: t.col('Market Cap'),
  };
  if (c.symbol < 0) throw new Error('The "Claude" tab has no Symbol column');
  const out: HoldingRow[] = [];
  for (const r of t.rows) {
    const symbol = str(r, c.symbol)?.toUpperCase();
    if (!symbol) continue;
    out.push({
      portfolio: str(r, c.portfolio) || DEFAULT_PORT, symbol,
      name: str(r, c.name), sector: str(r, c.sector), industry: str(r, c.industry),
      category: str(r, c.category), custom: str(r, c.custom), myGroup: str(r, c.myGroup),
      qty: num(r, c.qty), avgPrice: num(r, c.avg), target: num(r, c.target), price: num(r, c.price),
      marketCap: num(r, c.cap),
    });
  }
  return out;
}

/** The `Portfolios` registry. A sheet that predates it gets a single Long-Term portfolio. */
export async function loadRegistry(sheetId: string, fresh = false): Promise<PortfolioRow[]> {
  try {
    const t = await fetchTable(sheetId, 'Portfolios', fresh);
    const c = {
      id: t.col('id'), name: t.col('Name'), color: t.col('Color'), cash: t.col('Cash'),
      res: t.col('CashReserves'), fcd: t.col('FCD'), usd: t.col('USD'), cap: t.col('CapPct'),
    };
    const out: PortfolioRow[] = [];
    for (const r of t.rows) {
      const name = str(r, c.name);
      if (!name) continue;
      out.push({
        id: str(r, c.id) || name, name, color: str(r, c.color) || '',
        cash: num(r, c.cash) || 0, cashRes: num(r, c.res) || 0, fcd: num(r, c.fcd) || 0,
        usd: num(r, c.usd) || 0, capPct: num(r, c.cap) || 0,
      });
    }
    if (out.length) return out;
  } catch { /* fall through */ }
  return [{ id: 'long-term', name: DEFAULT_PORT, color: '', cash: 0, cashRes: 0, fcd: 0, usd: 0, capPct: 0 }];
}

export async function loadTransactions(sheetId: string, fresh = false): Promise<Tx[]> {
  const t = await fetchTable(sheetId, 'transactions', fresh);
  const c = {
    date: t.col('Date'), time: t.col('Time'), type: t.col('Type'), ticker: t.col('Ticker'), shares: t.col('Shares'),
    price: t.col('Price_Per_Share'), tv: t.col('Trade_Value'), port: t.col('Portfolio'),
    // Two spellings exist in the wild; reading only one silently makes every trade commissioned.
    free: t.col('Commission_Free', 'No Commission'), note: t.col('Note'),
  };
  const out: Tx[] = [];
  t.rows.forEach((r, i) => {
    const dateStr = date(r, c.date), ticker = str(r, c.ticker)?.toUpperCase();
    if (!dateStr || !ticker) return;
    out.push({
      row: i + 2, dateStr, time: time(r, c.time), type: str(r, c.type) || 'Buy', ticker,
      shares: num(r, c.shares) || 0, price: num(r, c.price) || 0, tradeValue: num(r, c.tv),
      portfolio: str(r, c.port) || DEFAULT_PORT, commissionFree: bool(r, c.free), note: str(r, c.note) || '',
    });
  });
  return out;
}

export async function loadHistory(sheetId: string): Promise<History> {
  const t = await fetchTable(sheetId, 'History');
  const c = { date: t.col('Date'), sym: t.col('Ticker', 'Symbol'), close: t.col('Close'), div: t.col('Dividend') };
  const h: History = { prices: {}, dividends: {} };
  for (const r of t.rows) {
    const d = date(r, c.date), sym = str(r, c.sym);
    if (!d || !sym) continue;
    const close = num(r, c.close), div = num(r, c.div);
    if (close != null && close > 0) (h.prices[sym] ||= {})[d] = close;
    if (div != null && div > 0) (h.dividends[sym] ||= {})[d] = div;
  }
  return h;
}

/** Positional on purpose: the header row can come back as data when gviz can't type the columns. */
export async function loadContributions(sheetId: string, fresh = false): Promise<Contribution[]> {
  try {
    const t = await fetchTable(sheetId, 'Contributions', fresh);
    const offset = raw(t.rows[0] || [], 0) === 'Portfolio' ? 1 : 2;
    const out: Contribution[] = [];
    t.rows.forEach((r, i) => {
      const portfolio = str(r, 0);
      if (!portfolio || portfolio === 'Portfolio') return;
      out.push({
        row: i + offset, portfolio, date: date(r, 1) || '', type: str(r, 2) || '', amount: num(r, 3) || 0,
        currency: (str(r, 4) || '').toUpperCase(), note: str(r, 5) || '',
        thb: num(r, 6), usd: num(r, 7), rate: num(r, 8),
      });
    });
    return out;
  } catch { return []; }   // the tab is optional
}

export async function loadFxRate(): Promise<number | null> {
  try {
    const j = await (await fetch('https://open.er-api.com/v6/latest/USD')).json();
    const r = j?.rates?.THB;
    return typeof r === 'number' && r > 0 ? r : null;
  } catch { return null; }
}

// ── GICS overlay: official sector / sub-industry for S&P 1500 names, from a static file ──

export type GicsMap = Record<string, { sector?: string; subIndustry?: string }>;
const GICS_KEY = 'gicsMap.v1', GICS_TTL = 7 * 864e5;

export async function loadGics(): Promise<GicsMap> {
  try {
    const c = JSON.parse(localStorage.getItem(GICS_KEY) || 'null');
    if (c?.data && Date.now() - c.ts < GICS_TTL) return c.data;
  } catch { /* refetch */ }
  try {
    const data = await (await fetch('https://raw.githubusercontent.com/imjnoenter/gics-data/main/gics.json')).json();
    try { localStorage.setItem(GICS_KEY, JSON.stringify({ ts: Date.now(), data })); } catch { /* quota */ }
    return data;
  } catch { return {}; }
}

const YAHOO_TO_GICS: Record<string, string> = {
  'Technology': 'Information Technology', 'Financial Services': 'Financials', 'Healthcare': 'Health Care',
  'Consumer Cyclical': 'Consumer Discretionary', 'Consumer Defensive': 'Consumer Staples', 'Basic Materials': 'Materials',
};

export function applyGics(rows: readonly HoldingRow[], gics: GicsMap): HoldingRow[] {
  return rows.map(r => {
    const g = gics[r.symbol];
    const sector = g?.sector || (r.sector ? YAHOO_TO_GICS[r.sector] || r.sector : null);
    const industry = g?.subIndustry || r.industry;
    return sector === r.sector && industry === r.industry ? r : { ...r, sector, industry };
  });
}

/** The `Plan` tab, read by position: its header can come back as data, and Portfolio is the last column. */
export async function loadPlans(sheetId: string, fresh = false): Promise<Plans> {
  try {
    const t = await fetchTable(sheetId, 'Plan', fresh);
    const out: Plans = {};
    for (const r of t.rows) {
      const sym = str(r, 0);
      if (!sym || sym === 'Symbol') continue;
      const tranches = [];
      for (let i = 3; i <= 15; i++) tranches.push(parseTranche(raw(r, i)));
      const trims = [16, 17, 18].map(i => {
        const cell = r[i];
        if (!cell || (cell.v == null && !cell.f)) return null;
        // Sheets turns "70:50" into a duration; the formatted text still holds what was typed.
        return parseTrim(typeof cell.v === 'number' ? cell.f || '' : String(cell.v ?? ''));
      }).filter(x => x != null);
      out[planKey(str(r, 19) || DEFAULT_PORT, sym.toUpperCase())] = cleanPlan({ sl: num(r, 1), note: str(r, 2) || '', tranches, trims });
    }
    return out;
  } catch { return {}; }   // the tab is optional
}

export type Period = '1M' | '3M' | 'YTD' | '1Y' | '3Y' | '5Y';
export const PERIODS: Period[] = ['1M', '3M', 'YTD', '1Y', '3Y', '5Y'];
/** Trailing returns per symbol, in percent, from the `Returns` tab the backend refreshes daily. */
export type Returns = Record<string, Partial<Record<Period, number | null>>>;

export async function loadReturns(sheetId: string): Promise<Returns> {
  try {
    const t = await fetchTable(sheetId, 'Returns');
    const sym = t.col('Symbol'), cols = PERIODS.map(p => t.col(p));
    const out: Returns = {};
    for (const r of t.rows) {
      const s = str(r, sym);
      if (s && s !== 'Symbol') out[s] = Object.fromEntries(PERIODS.map((p, i) => [p, num(r, cols[i])]));
    }
    return out;
  } catch { return {}; }
}

export interface CalEvent { symbol: string; earnings: string | null; earningsEnd: string | null; time: string; exDiv: string | null }

export async function loadCalendar(sheetId: string): Promise<CalEvent[]> {
  try {
    const t = await fetchTable(sheetId, 'Calendar');
    const c = { sym: t.col('Symbol'), e: t.col('EarningsDate'), end: t.col('EarningsDateEnd'), time: t.col('Time'), x: t.col('ExDivDate') };
    const out: CalEvent[] = [];
    for (const r of t.rows) {
      const symbol = str(r, c.sym);
      if (!symbol || symbol === 'Symbol') continue;
      out.push({ symbol, earnings: date(r, c.e), earningsEnd: date(r, c.end), time: str(r, c.time) || '', exDiv: date(r, c.x) });
    }
    return out;
  } catch { return []; }
}
