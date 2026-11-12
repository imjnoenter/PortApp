// Live quotes.
//
// CNBC's public quote endpoint is the primary source: CORS-open from any origin, one batched request
// for the whole portfolio, and the only browser-reachable source of pre/post-market prices. The
// sheet's `Quotes` tab (Finnhub, written by Apps Script) only fills symbols CNBC didn't return.
import { session } from '../core/market.ts';
import type { Quote, Quotes } from '../core/types.ts';
import { fetchTable, num, str } from './gviz.ts';

export const INDEXES: Record<string, { cnbc: string; label: string }> = {
  '^GSPC': { cnbc: '.SPX', label: 'S&P 500' },
  '^IXIC': { cnbc: '.IXIC', label: 'Nasdaq' },
  '^RUT': { cnbc: '.RUT', label: 'Russell 2000' },
};

// Every number arrives as a string, thousands-separated, with "UNCH" for a flat change.
const n = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  if (v === 'UNCH') return 0;
  const x = Number(String(v).replace(/[,%]/g, ''));
  return isFinite(x) ? x : null;
};

export async function fetchCnbc(symbols: readonly string[]): Promise<Quotes> {
  const out: Quotes = {};
  if (!symbols.length) return out;
  const toCnbc = (s: string) => INDEXES[s]?.cnbc || s;
  const back = new Map(symbols.map(s => [toCnbc(s).toUpperCase(), s]));
  const extended = session() !== 'open';

  // Long URLs get rejected; 60 symbols a request is well inside the limit.
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += 60) chunks.push(symbols.slice(i, i + 60));
  await Promise.all(chunks.map(async chunk => {
    const url = 'https://quote.cnbc.com/quote-html-webservice/quote.htm?symbols='
      + chunk.map(s => encodeURIComponent(toCnbc(s))).join('|') + '&exthrs=1&output=json';
    const j = await (await fetch(url)).json();
    const res = j?.QuickQuoteResult?.QuickQuote ?? j?.FormattedQuoteResult?.FormattedQuote;
    for (const q of Array.isArray(res) ? res : res ? [res] : []) {
      const sym = back.get(String(q.symbol || '').toUpperCase());
      const price = n(q.last);
      if (!sym || !(price! > 0)) continue;
      const e = q.ExtendedMktQuote;
      // During the regular session the block still carries the last pre-market's leftover print.
      const ext = extended && e ? (e.type === 'PRE_MKT' ? 'PRE' : e.type === 'POST_MKT' ? 'POST' : null) : null;
      const extPrice = ext ? n(e.last) : null;
      out[sym] = {
        price, change: n(q.change), changePct: n(q.change_pct),
        volume: n(q.fullVolume) ?? n(q.volume),
        high52: n(q.FundamentalData?.yrhiprice), low52: n(q.FundamentalData?.yrloprice),
        ext: extPrice != null && extPrice > 0 ? ext : null, extPrice,
      };
    }
  }));
  return out;
}

/** The sheet's Quotes tab, or {} when it is missing or more than 3 minutes old. */
export async function fetchSheetQuotes(sheetId: string): Promise<Quotes> {
  try {
    const t = await fetchTable(sheetId, 'Quotes', true);
    const c = { sym: t.col('Symbol'), price: t.col('Price'), chg: t.col('Change'), pct: t.col('ChangePct'), at: t.col('UpdatedAt') };
    if (c.sym < 0 || c.price < 0 || !t.length) return {};
    const at = num(t.rows[0], c.at);
    if (!at || Date.now() / 1000 - at > 180) return {};
    const out: Quotes = {};
    for (const r of t.rows) {
      const sym = str(r, c.sym), price = num(r, c.price);
      if (!sym || !(price! > 0)) continue;
      out[sym] = { price, change: num(r, c.chg), changePct: num(r, c.pct), volume: null, high52: null, low52: null, ext: null, extPrice: null };
    }
    return out;
  } catch { return {}; }
}

export type PriceSource = 'auto' | 'cnbc' | 'sheet';

/**
 * Where prices come from.
 *  - auto:  CNBC first; the sheet only for what CNBC missed, and only while the market is open.
 *  - cnbc:  CNBC alone.
 *  - sheet: while the market is open, the sheet's own quotes win, and CNBC supplies what the sheet
 *           does not carry (volume, the 52-week range) and any symbol it lacks. Outside market
 *           hours the sheet has nothing fresh, so this behaves like CNBC.
 */
export async function fetchQuotes(symbols: readonly string[], sheetId: string, source: PriceSource = 'auto'): Promise<Quotes> {
  let quotes: Quotes = {};
  try { quotes = await fetchCnbc(symbols); } catch { /* fall back below */ }
  if (source === 'cnbc') return quotes;
  if (source === 'sheet') {
    if (session() !== 'open') return quotes;
    const sheet = await fetchSheetQuotes(sheetId);
    for (const s of symbols) {
      const q = sheet[s];
      if (q) quotes[s] = { ...quotes[s], ...q, volume: quotes[s]?.volume ?? null, high52: quotes[s]?.high52 ?? null, low52: quotes[s]?.low52 ?? null, ext: null, extPrice: null };
    }
    return quotes;
  }
  const missing = symbols.filter(s => !quotes[s] && !INDEXES[s]);
  if (missing.length && session() === 'open') {
    const sheet = await fetchSheetQuotes(sheetId);
    for (const s of missing) if (sheet[s]) quotes[s] = sheet[s] as Quote;
  }
  return quotes;
}

export const FUTURES = [{ sym: '@SP.1', label: 'S&P 500' }, { sym: '@ND.1', label: 'Nasdaq' }, { sym: '@DJ.1', label: 'Dow' }];

/** Index futures, which trade through the night on the same keyless endpoint. Unknown tickers are skipped. */
export async function fetchFutures(): Promise<{ label: string; changePct: number }[]> {
  const url = 'https://quote.cnbc.com/quote-html-webservice/quote.htm?symbols=' + FUTURES.map(f => encodeURIComponent(f.sym)).join('|') + '&output=json';
  const j = await (await fetch(url)).json();
  const res = j?.QuickQuoteResult?.QuickQuote ?? j?.FormattedQuoteResult?.FormattedQuote;
  const out: { label: string; changePct: number }[] = [];
  for (const q of Array.isArray(res) ? res : res ? [res] : []) {
    const f = FUTURES.find(x => x.sym === q.symbol), pct = n(q.change_pct);
    if (f && n(q.last) && pct != null) out.push({ label: f.label, changePct: pct });
  }
  return out;
}
