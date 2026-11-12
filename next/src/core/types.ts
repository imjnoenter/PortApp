// Shared data shapes. Everything in core/ is pure: no DOM, no network, no module state.

export type TxType = 'Buy' | 'Sell' | 'Transfer-In' | 'Transfer-Out' | 'Dividend' | (string & {});

/** One row of the `transactions` sheet. `dateStr`/`time` are the ledger's own (Thai, UTC+7). */
export interface Tx {
  row: number;            // sheet row number (header = 1)
  dateStr: string;        // yyyy-MM-dd
  time: string;           // HH:mm:ss or ''
  type: TxType;
  ticker: string;
  shares: number;
  price: number;
  tradeValue: number | null;
  portfolio: string;
  commissionFree: boolean;
  note: string;
}

/** One row of the holdings sheet (`Claude`): a (portfolio, symbol) pair. */
export interface HoldingRow {
  portfolio: string;
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  category: string | null;
  custom: string | null;
  myGroup: string | null;
  qty: number | null;
  avgPrice: number | null;
  target: number | null;   // fraction of the tab's investable total
  price: number | null;    // the sheet's own Current price: fallback when there is no live quote
  marketCap: number | null;
  /** Set when the ledger does not reconcile with qty, so avgPrice is the sheet's stored value. */
  basisFallback?: boolean;
}

/** One row of the `Portfolios` registry sheet. */
export interface PortfolioRow {
  id: string;
  name: string;
  color: string;
  cash: number;
  cashRes: number;   // reserve fraction; meaningful on Long-Term's row only
  fcd: number;
  usd: number;
  capPct: number;    // Trade: limit on the whole. Split portfolios: share of (whole − reserve)
}

export interface Quote {
  price: number | null;
  change: number | null;      // per share, regular session
  changePct: number | null;
  volume: number | null;
  high52: number | null;
  low52: number | null;
  ext: 'PRE' | 'POST' | null; // live extended-hours session, if any
  extPrice: number | null;
}
export type Quotes = Record<string, Quote>;

export interface Contribution {
  row: number;
  portfolio: string;
  date: string;
  type: string;
  amount: number;
  currency: string;
  note: string;
  thb: number | null;
  usd: number | null;
  rate: number | null;
}

export interface History {
  prices: Record<string, Record<string, number>>;     // sym → date → close
  dividends: Record<string, Record<string, number>>;  // sym → ex-date → per-share amount
}

export interface Position extends HoldingRow {
  qty: number;
  avgPrice: number;
  price: number;
  costBasis: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  weightPct: number;        // of the tab's total incl. cash
  stockWeightPct: number;   // of equity only
  investWeightPct: number;  // of investable, the base plan targets are stored against
  dayChange: number | null; // per share
  dayChangePct: number | null;
  ext: 'PRE' | 'POST' | null;
  extPrice: number | null;
  extPct: number | null;
  high52: number | null;
  low52: number | null;
  volume: number | null;
}

export interface WatchItem extends HoldingRow {
  dayChange: number | null;
  dayChangePct: number | null;
  high52: number | null;
  low52: number | null;
}

export interface Model {
  port: string;              // 'ALL' or a portfolio name
  positions: Position[];     // sorted by value, descending
  watchlist: WatchItem[];
  cash: number;              // ALL: the wallet. A tab: room left under its limit.
  fcd: number;
  usd: number;
  cashResPct: number;
  stockTotal: number;
  costTotal: number;
  totalCurrent: number;
  investable: number;
  totalInvested: number;
  totalPnl: number;
  totalPnlPct: number;       // unrealized over the cost of what is held
  dayChange: number | null;  // dollars today
  dayPct: number | null;
  limit: null | { pct: number; dollar: number; used: number; over: number; unfunded: number };
}
