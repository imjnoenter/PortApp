// The one store. Raw data in, everything else derived.
//
// Sheet data and quotes are `$state.raw` (replaced wholesale, never mutated), and each `$derived`
// only re-runs when one of its own inputs is replaced. So a quote tick rebuilds the model and
// nothing that hangs off the ledger: FIFO, the return series, dividends and cash flow stay cached.
import { PriceIndex, cashFlow, computeDividends, computeIRR, monthlyReturns, netContributedTHB, realizedSales, realizedTotals, returnSeries, riskStats } from '../core/analytics.ts';
import { DEFAULT_PORT, fifoBasis, fifoWalk } from '../core/fifo.ts';
import { moneyFormatter } from '../core/format.ts';
import { etToday, session } from '../core/market.ts';
import { ALL, buildModel, computeLimits } from '../core/model.ts';
import type { Book } from '../core/model.ts';
import { driftAlert, planAlerts } from '../core/alerts.ts';
import type { PlanAlert } from '../core/alerts.ts';
import type { EtfData } from '../core/etf.ts';
import { betas, closedTrades, concentration, correlation, forwardIncome, holdingsPerf, rangeStress, stopCover, stressTest, worthSeries } from '../core/insights.ts';
import { applyTransfer, blankRow, contribRow, dropContrib, replaceTx, setDetails, setTargets } from '../core/edits.ts';
import type { ContribInput, Details } from '../core/edits.ts';
import { cleanPlan, planIsEmpty, planKey, planStrings } from '../core/plan.ts';
import type { Plan, Plans } from '../core/plan.ts';
import { PIN_MS, applyTrade, newPins, pinRows, pinTxs, pinWallet, setWallet, tradeEffect } from '../core/trade.ts';
import type { TradeInput } from '../core/trade.ts';
import type { Contribution, History, HoldingRow, PortfolioRow, Position, Quotes, Tx } from '../core/types.ts';
import { activeProfile, addProfile, canWrite, listProfiles, removeProfile, setActiveProfile, updateProfile } from '../data/config.ts';
import type { Profile } from '../data/config.ts';
import { INDEXES, fetchQuotes } from '../data/quotes.ts';
import type { PriceSource } from '../data/quotes.ts';
import { applyGics, loadCalendar, loadContributions, loadPlans, loadReturns, loadFxRate, loadGics, loadHistory, loadHoldings, loadRegistry, loadTransactions } from '../data/sheets.ts';
import type { CalEvent, GicsMap, Returns } from '../data/sheets.ts';
import {
  addSymbolParams, appendTradeParams, avgParams, capParams, contribAddParams, contribDeleteParams, contribUpdateParams,
  ask, detailsParams, holdingParams, ledgerNow, planClearParams, planParams, removeSymbolParams, reserveParams, send,
  targetParams, targetsParams, transferParams, txDeleteParams, txNoteParams, txUpdateParams, walletParams,
} from '../data/write.ts';
import type { Params } from '../data/write.ts';
import { TH } from './i18n.ts';

export type PageId = 'overview' | 'positions' | 'allocation' | 'analysis' | 'activity';
export const PAGES: PageId[] = ['overview', 'positions', 'allocation', 'analysis', 'activity'];

export const NASDAQ = 'QQQ';
const ETF_KEY = 'portapp.next.etf.v1.';
const ETF_MS = 24 * 3600_000;

interface Prefs {
  theme: 'auto' | 'light' | 'dark';
  tone: 'warm' | 'cool';
  currency: 'USD' | 'THB';
  lang: 'en' | 'th';
  view: string;
  inclCash: boolean;
  /** A holding this many percent off its target value is flagged. 0 turns the flag off. */
  driftBand: number;
  /** Portfolios left out of the switcher. They still count in the combined view. */
  hiddenPorts: string[];
  /** Whether plan levels being reached may raise a browser notification. */
  notify: boolean;
  priceSource: PriceSource;
}
const PREFS_KEY = 'portapp.next.prefs.v1';
const DEFAULT_PREFS: Prefs = { theme: 'auto', tone: 'warm', currency: 'USD', lang: 'en', view: ALL, inclCash: true, driftBand: 25, hiddenPorts: [], notify: false, priceSource: 'auto' };

function loadPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_PREFS }; }
}
const pageFromHash = (): PageId => {
  const p = location.hash.replace(/^#\/?/, '') as PageId;
  return PAGES.includes(p) ? p : 'overview';
};

const QUOTE_MS = { open: 60_000, pre: 300_000, post: 300_000, closed: Infinity };
const SHEET_MS = 5 * 60_000;
const HISTORY_MS = 6 * 3600_000;

export type DialogState = null
  | { kind: 'trade'; symbol?: string; type?: 'Buy' | 'Sell'; portfolio?: string; price?: number; amount?: number }
  | { kind: 'cash' }
  | { kind: 'contrib'; row?: number }
  | { kind: 'tx'; row: number }
  | { kind: 'plan'; symbol: string; portfolio: string }
  | { kind: 'targets'; portfolio: string }
  | { kind: 'transfer'; symbol: string }
  | { kind: 'watch' }
  | { kind: 'details'; symbol: string; portfolio: string }
  | { kind: 'share'; blob: Blob; name: string };

/** The collections a save can change. While one is held, reads of the sheet do not replace it. */
type Held = 'rows' | 'registry' | 'txs' | 'contribs' | 'plans';
/** Google serves a copy from before a write for up to half a minute. Held data outlives that. */
const HOLD_MS = 45_000;
const noHolds = (): Record<Held, number> => ({ rows: 0, registry: 0, txs: 0, contribs: 0, plans: 0 });
export interface CashSettings { fcd: number; usd: number; reserve: number; caps: Record<string, number> }

/** One request of a save. Built when it is sent, so a retry carries today's values, not stale ones. */
interface SaveStep { name: string; params: () => Params }
interface Save { id: number; label: string; profile: Profile; steps: SaveStep[]; holds?: Held[]; after?: () => void }
export interface FailedSave { id: number; label: string }

class AppState {
  // ── inputs ──
  profile = $state.raw<Profile | null>(activeProfile());
  status = $state<'setup' | 'loading' | 'ready' | 'error'>('loading');
  error = $state('');
  refreshing = $state(false);

  rawRows = $state.raw<HoldingRow[]>([]);
  gics = $state.raw<GicsMap>({});
  registry = $state.raw<PortfolioRow[]>([]);
  txs = $state.raw<Tx[]>([]);
  ledgerLoaded = $state(false);
  contribs = $state.raw<Contribution[]>([]);
  plans = $state.raw<Plans>({});
  returns = $state.raw<Returns>({});
  calendar = $state.raw<CalEvent[]>([]);
  etf = $state.raw<EtfData>({});
  /** Closes for the Nasdaq yardstick, fetched only when the sheet's own history does not carry it. */
  nasdaqCloses = $state.raw<Record<string, number> | null>(null);
  #nasdaqAsked = false;
  /** Sector of each stock held only through a fund. */
  etfSectors = $state.raw<Record<string, string>>({});
  history = $state.raw<History>({ prices: {}, dividends: {} });
  quotes = $state.raw<Quotes>({});
  quotesAt = $state(0);
  fx = $state(33);
  now = $state(Date.now());

  prefs = $state<Prefs>(loadPrefs());
  page = $state<PageId>(pageFromHash());
  /** Symbol whose detail sheet is open. */
  symbol = $state<string | null>(null);
  /** The form open on top of everything else, if any. */
  dialog = $state.raw<DialogState>(null);
  /** The saved account whose details the setup screen is changing, if it is not adding a new one. */
  editing = $state.raw<Profile | null>(null);
  /** Saves on their way to the sheet, and the ones that could not be sent. */
  saving = $state(0);
  failed = $state.raw<FailedSave[]>([]);

  // ── derived ──
  rows = $derived(applyGics(this.rawRows, this.gics));
  fifo = $derived(this.ledgerLoaded ? fifoWalk(this.txs) : null);
  book = $derived<Book>({ rows: this.rows, registry: this.registry, quotes: this.quotes, fifo: this.fifo });
  limits = $derived(computeLimits(this.book));
  ports = $derived(this.registry.map(p => p.name));
  view = $derived(this.ports.includes(this.prefs.view) && this.ports.length > 1 && !this.prefs.hiddenPorts.includes(this.prefs.view) ? this.prefs.view : ALL);
  model = $derived(buildModel(this.book, this.view, this.limits));
  /** Portfolios offered in the switcher. */
  shownPorts = $derived(this.ports.filter(p => !this.prefs.hiddenPorts.includes(p)));
  /** One model per portfolio, rebuilt only when the data changes. */
  portModels = $derived(new Map(this.ports.map(p => [p, buildModel(this.book, p, this.limits)])));

  /** Plan levels reached or close, and holdings off target, most urgent first. */
  alerts = $derived.by(() => {
    const out: PlanAlert[] = [];
    for (const [port, m] of this.portModels) {
      if (this.view !== ALL && this.view !== port) continue;
      const seen = new Set<string>();
      for (const p of [...m.positions, ...m.watchlist]) {
        if (seen.has(p.symbol)) continue;
        seen.add(p.symbol);
        const qty = p.qty || 0, value = qty > 0 ? (p as Position).currentValue : 0;
        const td = (p.target || 0) * m.investable;
        const plan = this.plans[planKey(port, p.symbol)];
        if (plan) out.push(...planAlerts(port, p.symbol, plan, { price: this.quotes[p.symbol]?.price ?? p.price, qty, currentValue: value, targetDollar: td }));
        if (qty > 0) { const d = driftAlert(port, p.symbol, value, td, this.prefs.driftBand); if (d) out.push(d); }
      }
    }
    return out.sort((a, b) => b.urgency - a.urgency || Math.abs(b.gap) - Math.abs(a.gap));
  });
  planOf = (p: { symbol: string; portfolio: string }) =>
    this.plans[planKey(this.view === ALL ? this.homePort(p.symbol) : this.view, p.symbol)];

  viewTxs = $derived(this.view === ALL ? this.txs : this.txs.filter(t => t.portfolio === this.view));
  priceIndex = $derived(new PriceIndex(this.history.prices));
  series = $derived(returnSeries(this.viewTxs, this.priceIndex));
  monthly = $derived(monthlyReturns(this.series));
  risk = $derived(riskStats(this.series));
  sales = $derived(realizedSales(this.fifo, this.view));
  realized = $derived(realizedTotals(this.sales));
  dividends = $derived(computeDividends(this.viewTxs, this.history));
  irr = $derived(computeIRR(this.viewTxs, this.dividends, this.model.stockTotal));
  today = $derived(etToday(new Date(this.now)));
  flow = $derived(cashFlow(this.txs, this.contribs, this.fx, this.limits.spendable, this.today));
  paidInTHB = $derived(netContributedTHB(this.contribs, this.fx));
  concentration = $derived(concentration(this.model));
  stops = $derived(stopCover(this.model, this.planOf));
  range52 = $derived(rangeStress(this.model));
  correlation = $derived(correlation(this.model, this.history.prices));
  betas = $derived(betas(this.model.positions.map(p => p.symbol), this.history.prices, this.today));
  stress = $derived(stressTest(this.model, this.betas));
  income = $derived(forwardIncome(this.model, this.history.dividends, this.today));
  perf = $derived(holdingsPerf(this.model, this.viewTxs, this.sales, this.dividends));
  journal = $derived(closedTrades(this.viewTxs, this.sales));
  worth = $derived(worthSeries(this.viewTxs, this.priceIndex));

  session = $derived(session(new Date(this.now)));
  money = $derived(moneyFormatter(this.prefs.currency, this.fx));
  profiles = $derived.by(() => { void this.profile; return listProfiles(); });
  canWrite = $derived(canWrite(this.profile));

  /** Translate. English is the key; anything without a Thai entry stays English. */
  t = (s: string) => this.prefs.lang === 'th' ? TH[s] ?? s : s;

  // ── loading ──
  #token = 0;
  #sheetAt = 0;
  #historyAt = 0;
  #timer: ReturnType<typeof setInterval> | undefined;

  start() {
    addEventListener('hashchange', () => { this.page = pageFromHash(); });
    addEventListener('beforeunload', e => { if (this.saving) e.preventDefault(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.tick(); });
    this.#timer ??= setInterval(() => this.tick(), 20_000);
    loadFxRate().then(r => { if (r) this.fx = r; });
    loadGics().then(g => { this.gics = g; });
    if (this.profile) void this.load(); else this.status = 'setup';
  }

  /** Runs every 20s, and at once when the tab comes back. A hidden tab fetches nothing. */
  tick() {
    this.now = Date.now();
    if (document.hidden || this.status !== 'ready' || this.refreshing || this.saving) return;
    if (this.session === 'open' && this.now - this.#sheetAt > SHEET_MS) void this.load();
    else if (this.now - this.quotesAt > QUOTE_MS[this.session]) void this.refreshQuotes();
  }

  go(page: PageId) { location.hash = '/' + page; this.page = page; window.scrollTo(0, 0); }

  async load(fresh = false) {
    const p = this.profile;
    if (!p) { this.status = 'setup'; return; }
    const token = ++this.#token;
    const mine = () => token === this.#token;
    this.refreshing = true;
    try {
      const [rows, registry] = await Promise.all([loadHoldings(p.sheetId, fresh), loadRegistry(p.sheetId, fresh)]);
      if (!mine()) return;
      if (this.#free('rows')) this.rawRows = pinRows(rows, this.#pins, Date.now());
      if (this.#free('registry')) this.registry = pinWallet(registry, this.#pins, Date.now());
      this.status = 'ready'; this.error = '';
      this.#sheetAt = Date.now();

      // First paint is done. The ledger, history and quotes land on their own as each arrives.
      const quiet = (job: Promise<unknown>) => job.catch(e => console.warn(e));
      const jobs = [
        quiet(this.refreshQuotes()),
        quiet(loadTransactions(p.sheetId, fresh).then(t => { if (mine()) { if (this.#free('txs') || !this.ledgerLoaded) this.txs = pinTxs(t, this.#pins, Date.now()); this.ledgerLoaded = true; } })),
        quiet(loadContributions(p.sheetId, fresh).then(c => { if (mine() && this.#free('contribs')) this.contribs = c; })),
        quiet(loadPlans(p.sheetId, fresh).then(pl => { if (mine() && this.#free('plans')) this.plans = pl; })),
        quiet(loadReturns(p.sheetId).then(r => { if (mine()) this.returns = r; })),
        quiet(loadCalendar(p.sheetId).then(c => { if (mine()) this.calendar = c; })),
        quiet(this.#loadEtf(p, mine)),
      ];
      if (Date.now() - this.#historyAt > HISTORY_MS) {
        jobs.push(quiet(loadHistory(p.sheetId).then(h => { if (mine()) { this.history = h; this.#historyAt = Date.now(); } })));
      }
      await Promise.all(jobs);
    } catch (e) {
      if (!mine()) return;
      this.error = e instanceof Error ? e.message : String(e);
      if (this.status !== 'ready') this.status = 'error';
    } finally {
      if (mine()) this.refreshing = false;
    }
  }

  /**
   * The Nasdaq 100, as QQQ: a fund that tracks it and trades in dollars, so its closes line up with
   * everything else here. If QQQ is held or watched, the sheet already has its history; otherwise
   * ask the script for it, once.
   */
  nasdaq = $derived(this.priceIndex.has(NASDAQ) ? this.priceIndex : this.nasdaqCloses ? new PriceIndex({ [NASDAQ]: this.nasdaqCloses }) : null);
  ensureNasdaq() {
    const p = this.profile;
    if (this.#nasdaqAsked || !p || !canWrite(p) || this.priceIndex.has(NASDAQ) || !this.priceIndex.allDates.length) return;
    this.#nasdaqAsked = true;
    ask<{ ohlc: Record<string, { c: number }> }>(p, { action: 'fetchOHLC', symbol: NASDAQ, range: '5y' })
      .then(r => { if (p === this.profile) this.nasdaqCloses = Object.fromEntries(Object.entries(r.ohlc || {}).map(([d, b]) => [d, b.c])); })
      .catch(e => console.warn(e));
  }

  /** Fund facts change slowly, so they are fetched once a day per account and kept on this device. */
  async #loadEtf(p: Profile, mine: () => boolean) {
    const funds = [...new Set(this.rawRows.filter(r => (r.qty || 0) > 0 && (r.industry === 'ETF' || r.portfolio === 'ETF')).map(r => r.symbol))].sort();
    if (!funds.length) return;
    const key = ETF_KEY + p.id, want = funds.join(',');
    let cached: { at: number; syms: string; data: EtfData; sectors: Record<string, string> } | null = null;
    try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* unreadable: fetch again */ }
    if (cached && mine()) { this.etf = cached.data; this.etfSectors = cached.sectors || {}; }
    if (cached && cached.syms === want && Date.now() - cached.at < ETF_MS) return;
    if (!canWrite(p)) return;
    const { etfData } = await ask<{ etfData: EtfData }>(p, { action: 'fetchHoldings', symbols: want });
    if (!mine()) return;
    this.etf = etfData;
    const own = new Set(this.rawRows.map(r => r.symbol));
    const inside = [...new Set(Object.values(etfData).flatMap(e => e?.topHoldings?.map(h => h.symbol) ?? []))].filter(s => !own.has(s));
    let sectors: Record<string, string> = {};
    if (inside.length) {
      try { sectors = (await ask<{ sectors: Record<string, string> }>(p, { action: 'fetchStockSectors', symbols: inside.join(',') })).sectors || {}; }
      catch (e) { console.warn(e); }
    }
    if (!mine()) return;
    this.etfSectors = sectors;
    try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), syms: want, data: etfData, sectors })); } catch { /* storage full */ }
  }

  async refreshQuotes() {
    const p = this.profile;
    if (!p) return;
    const symbols = [...new Set(this.rawRows.map(r => r.symbol)), ...Object.keys(INDEXES)];
    const q = await fetchQuotes(symbols, p.sheetId, this.prefs.priceSource);
    if (p !== this.profile || !Object.keys(q).length) return;
    this.quotes = q;
    this.quotesAt = Date.now();
  }

  // ── saving ──
  // Every save is applied to this device first and sent to the sheet behind it. A trade is never
  // rolled back: it already happened at the broker, so a save that could not be sent stays on
  // screen and is offered again.
  #pins = newPins();
  #saveId = 0;
  #queue: Promise<void> = Promise.resolve();
  #failed = new Map<number, Save>();

  #hold = noHolds();
  #holding = noHolds();
  #recheck: ReturnType<typeof setTimeout> | undefined;
  #free(k: Held) { return Date.now() > this.#hold[k]; }

  /**
   * Saves run one at a time, and so do the requests inside one: two writes to the same cell must
   * land in the order they were made. A save stops at the first request that cannot be sent, and
   * what is left of it is kept to try again.
   */
  #enqueue(save: Save) {
    this.saving++;
    for (const k of save.holds ?? []) { this.#holding[k]++; this.#hold[k] = Infinity; }
    this.#queue = this.#queue.then(async () => {
      let i = 0;
      try {
        for (; i < save.steps.length; i++) await send(save.profile, save.steps[i].params());
      } catch {
        this.#failed.set(save.id, { ...save, steps: save.steps.slice(i) });
        if (save.profile === this.profile) this.failed = [...this.failed, { id: save.id, label: save.label }];
        return;
      }
      save.after?.();
    }).finally(() => {
      this.saving--;
      if (save.profile !== this.profile || !save.holds?.length) return;
      for (const k of save.holds) if (--this.#holding[k] <= 0) { this.#holding[k] = 0; this.#hold[k] = Date.now() + HOLD_MS; }
      // The reply to a save cannot be read, so once the sheet has settled, read it back: whatever
      // the backend refused shows up as the sheet's own version.
      clearTimeout(this.#recheck);
      this.#recheck = setTimeout(() => { if (!this.saving && !this.dialog) void this.load(true); }, HOLD_MS + 2000);
    });
  }
  /** Queue a save whose requests are already fully known. */
  #push(label: string, params: Params[], holds: Held[], after?: () => void) {
    const profile = this.profile!;
    this.#enqueue({ id: ++this.#saveId, profile, label, steps: params.map(p => ({ name: p.action || 'append', params: () => p })), holds, after });
  }
  get #writable() { return !!this.profile && canWrite(this.profile); }
  retrySave(id: number) {
    const save = this.#failed.get(id);
    this.dismissSave(id);
    if (save) this.#enqueue(save);
  }
  dismissSave(id: number) {
    this.#failed.delete(id);
    this.failed = this.failed.filter(f => f.id !== id);
  }

  /** The current local value of a holding, as the request that writes it. */
  #holdingStep(profile: Profile, portfolio: string, symbol: string): SaveStep {
    let last = holdingParams(portfolio, symbol, 0, 0);
    const params = () => {
      const r = profile === this.profile ? this.rawRows.find(x => x.symbol === symbol && x.portfolio === portfolio) : null;
      if (r) last = holdingParams(portfolio, symbol, r.qty || 0, r.avgPrice || 0);
      return last;
    };
    params();
    return { name: 'holding', params };
  }
  #walletStep(profile: Profile): SaveStep {
    let last: Params = {};
    const params = () => {
      const w = profile === this.profile ? this.registry.find(p => p.name === DEFAULT_PORT) : null;
      if (w) last = walletParams(DEFAULT_PORT, w.fcd, w.usd);
      return last;
    };
    params();
    return { name: 'cash', params };
  }

  /** What a trade would do, without doing it. The form's preview and the save share this. */
  previewTrade(input: TradeInput) {
    const row = this.rawRows.find(r => r.symbol === input.symbol && r.portfolio === input.portfolio);
    const basis = fifoBasis(this.fifo, input.portfolio, input.symbol, row?.qty || 0);
    return tradeEffect(input, row, basis, this.registry.find(p => p.name === DEFAULT_PORT));
  }

  recordTrade(input: TradeInput) {
    const profile = this.profile;
    if (!profile || !canWrite(profile)) return;
    const fx = this.previewTrade(input);
    const isNew = !this.rawRows.some(r => r.symbol === input.symbol);
    const afterRow = this.txs.reduce((m, t) => Math.max(m, t.row), 1);
    const next = applyTrade({ rows: this.rawRows, registry: this.registry, txs: this.txs }, input, fx);
    this.rawRows = next.rows; this.registry = next.registry; this.txs = next.txs;

    const until = Date.now() + PIN_MS;
    this.#pins.rows.set(input.portfolio + '|' + input.symbol, { portfolio: input.portfolio, symbol: input.symbol, qty: fx.newQty, avgPrice: fx.newAvg, price: input.price, until });
    this.#pins.txs.push({ tx: next.tx, afterRow, until });
    const hasWallet = this.registry.some(p => p.name === DEFAULT_PORT);
    if (hasWallet) this.#pins.cash = { fcd: fx.fcd, usd: fx.usd, until };

    const append = appendTradeParams(input);
    this.#enqueue({
      id: ++this.#saveId, profile,
      label: `${input.type} ${input.shares} ${input.symbol}`,
      steps: [
        { name: 'append', params: () => append },
        this.#holdingStep(profile, input.portfolio, input.symbol),
        ...(hasWallet ? [this.#walletStep(profile)] : []),
      ],
      // A symbol the sheet has never seen has no name, sector or price history yet: ask it to fill them.
      after: isNew ? () => { void send(profile, { action: 'maintenance' }).catch(() => {}); } : undefined,
    });
    if (!this.quotes[input.symbol]) void this.refreshQuotes().catch(() => {});
  }

  /** The wallet's balances, the reserve and each portfolio's limit, all as fractions. Only what changed is sent. */
  saveCash(next: CashSettings) {
    const profile = this.profile;
    const w = this.registry.find(p => p.name === DEFAULT_PORT);
    if (!profile || !canWrite(profile) || !w) return;
    const steps: SaveStep[] = [];
    const differs = (a: number, b: number) => Math.abs(a - b) > 1e-9;
    if (differs(w.fcd, next.fcd) || differs(w.usd, next.usd)) {
      this.#pins.cash = { fcd: next.fcd, usd: next.usd, until: Date.now() + PIN_MS };
      steps.push(this.#walletStep(profile));
    }
    const fixed = (p: Params): SaveStep => ({ name: 'limit', params: () => p });
    if (differs(w.cashRes, next.reserve)) steps.push(fixed(reserveParams(DEFAULT_PORT, next.reserve)));
    for (const p of this.registry) if (p.name in next.caps && differs(p.capPct, next.caps[p.name])) steps.push(fixed(capParams(p.name, next.caps[p.name])));
    if (!steps.length) return;
    this.registry = setWallet(this.registry, next.fcd, next.usd).map(p => ({
      ...p, cashRes: p.name === DEFAULT_PORT ? next.reserve : p.cashRes, capPct: p.name in next.caps ? next.caps[p.name] : p.capPct,
    }));
    this.#enqueue({ id: ++this.#saveId, profile, label: 'Cash and limits', steps, holds: ['registry'] });
  }

  /** A model of one portfolio alone, whatever tab is showing. */
  portModel(port: string) { return this.portModels.get(port) ?? buildModel(this.book, port, this.limits); }
  /** The portfolio a symbol's plan and details belong to when the view does not say. */
  homePort(symbol: string) {
    if (this.view !== ALL) return this.view;
    const mine = this.rawRows.filter(r => r.symbol === symbol).sort((a, b) => (b.qty || 0) - (a.qty || 0));
    return mine[0]?.portfolio ?? this.ports[0] ?? DEFAULT_PORT;
  }

  // Deposits and withdrawals belong to the whole account. Only ADDING one moves cash (into FCD):
  // correcting or deleting a row rewrites the record and leaves the balance to be fixed by hand.
  addContribution(input: ContribInput) {
    if (!this.#writable) return;
    const c = contribRow(input, DEFAULT_PORT, this.contribs.reduce((m, x) => Math.max(m, x.row), 1) + 1);
    this.contribs = [...this.contribs, c];
    const w = this.registry.find(p => p.name === DEFAULT_PORT);
    if (w) this.registry = setWallet(this.registry, w.fcd + (input.type === 'Withdraw' ? -input.usd : input.usd), w.usd);
    this.#pins.cash = null;
    this.#push(`${input.type} ${input.date}`, [contribAddParams(c)], ['contribs', 'registry']);
  }
  updateContribution(old: Contribution, input: ContribInput) {
    if (!this.#writable) return;
    const next = contribRow(input, old.portfolio, old.row);
    this.contribs = this.contribs.map(c => c.row === old.row ? next : c);
    this.#push(`${input.type} ${input.date}`, [contribUpdateParams(old, next)], ['contribs']);
  }
  deleteContribution(old: Contribution) {
    if (!this.#writable) return;
    this.contribs = dropContrib(this.contribs, old.row);
    this.#push(`Delete ${old.type} ${old.date}`, [contribDeleteParams(old)], ['contribs']);
  }

  /** Change a recorded trade, or remove it with `next` null. The holding and the USD balance follow. */
  replaceTx(old: Tx, next: Tx | null) {
    if (!this.#writable) return;
    const same = next && old.dateStr === next.dateStr && old.time === next.time && old.type === next.type
      && old.shares === next.shares && old.price === next.price && old.commissionFree === next.commissionFree;
    if (next && same) {
      if (next.note === old.note) return;
      this.txs = this.txs.map(t => t.row === old.row ? next : t);
      this.#push(`Note on ${old.ticker}`, [txNoteParams(old, next.note)], ['txs']);
      return;
    }
    const r = replaceTx({ rows: this.rawRows, registry: this.registry, txs: this.txs }, old, next);
    this.rawRows = r.rows; this.registry = r.registry; this.txs = r.txs;
    this.#pins = newPins();
    // The backend rebuilds the average as a rolling one. Send the first-in-first-out figure after it.
    const params = [next ? txUpdateParams(old, next) : txDeleteParams(old)];
    if (r.avg) params.push(avgParams(old.portfolio, old.ticker, r.avg));
    this.#push(`${next ? 'Edit' : 'Delete'} ${old.type} ${old.ticker}`, params, ['txs', 'rows', 'registry']);
  }

  savePlan(portfolio: string, symbol: string, draft: Plan, target: number | null) {
    if (!this.#writable) return;
    const plan = cleanPlan(draft);
    const params: Params[] = [];
    const row = this.rawRows.find(r => r.symbol === symbol && r.portfolio === portfolio);
    const holds: Held[] = ['plans'];
    if (target != null && Math.abs((row?.target || 0) - target) > 1e-9) {
      this.rawRows = row ? setTargets(this.rawRows, portfolio, { [symbol]: target }) : [...this.rawRows, blankRow(portfolio, symbol, { target })];
      params.push(targetParams(portfolio, symbol, target));
      holds.push('rows');
    }
    const key = planKey(portfolio, symbol);
    const plans = { ...this.plans };
    if (planIsEmpty(plan)) {
      delete plans[key];
      params.push(planClearParams(portfolio, symbol));
    } else {
      plans[key] = plan;
      // Each entry is stored with the dollars it buys, worked out against this portfolio alone.
      const m = this.portModel(portfolio);
      const pos = m.positions.find(p => p.symbol === symbol);
      const td = (target ?? row?.target ?? 0) * m.investable;
      params.push(planParams(portfolio, symbol, plan, planStrings(plan, td > 0 ? (pos?.currentValue || 0) / td * 100 : 0, td)));
    }
    this.plans = plans;
    this.#push(`Plan for ${symbol}`, params, holds);
  }

  /** Target fractions for one portfolio, sent as one request. */
  saveTargets(portfolio: string, targets: Record<string, number>) {
    if (!this.#writable || !Object.keys(targets).length) return;
    this.rawRows = setTargets(this.rawRows, portfolio, targets);
    this.#push(`Targets, ${portfolio}`, [targetsParams(portfolio, targets)], ['rows']);
  }

  transfer(symbol: string, shares: number, from: string, to: string) {
    if (!this.#writable || from === to || !(shares > 0)) return;
    const r = applyTransfer({ rows: this.rawRows, txs: this.txs }, symbol, shares, from, to, ledgerNow());
    this.rawRows = r.rows; this.txs = r.txs;
    this.#pins = newPins();
    this.#push(`Move ${shares} ${symbol}`, [transferParams(symbol, shares, from, to, r.price)], ['rows', 'txs']);
  }

  /** A symbol to follow without holding it. The sheet fills in its name and sector. */
  addWatch(symbol: string, portfolio: string) {
    const profile = this.profile;
    if (!profile || !canWrite(profile) || this.rawRows.some(r => r.symbol === symbol && r.portfolio === portfolio)) return;
    this.rawRows = [...this.rawRows, blankRow(portfolio, symbol)];
    this.#push(`Add ${symbol}`, [addSymbolParams(portfolio, symbol)], ['rows'],
      () => { void send(profile, { action: 'maintenance' }).catch(() => {}); });
    void this.refreshQuotes().catch(() => {});
  }
  /** Drops the row and its plan. Only for a row with no shares: a holding leaves by being sold. */
  removeSymbol(symbol: string, portfolio: string) {
    const row = this.rawRows.find(r => r.symbol === symbol && r.portfolio === portfolio);
    if (!this.#writable || !row || (row.qty || 0) > 0) return;
    this.rawRows = this.rawRows.filter(r => r !== row);
    const plans = { ...this.plans };
    delete plans[planKey(portfolio, symbol)];
    this.plans = plans;
    this.#pins.rows.delete(portfolio + '|' + symbol);
    this.#push(`Remove ${symbol}`, [removeSymbolParams(portfolio, symbol)], ['rows', 'plans']);
  }

  saveDetails(portfolio: string, symbol: string, d: Details) {
    if (!this.#writable) return;
    this.rawRows = setDetails(this.rawRows, portfolio, symbol, d);
    if (d.qty != null || d.avgPrice != null) this.#pins.rows.delete(portfolio + '|' + symbol);
    this.#push(`Details for ${symbol}`, [detailsParams(portfolio, symbol, d)], ['rows']);
  }

  // ── profiles ──
  #reset() {
    this.#token++;
    this.rawRows = []; this.registry = []; this.txs = []; this.contribs = [];
    this.history = { prices: {}, dividends: {} }; this.quotes = {};
    this.ledgerLoaded = false; this.quotesAt = 0; this.#historyAt = 0; this.symbol = null;
    this.dialog = null; this.failed = []; this.#pins = newPins(); this.#failed.clear();
    this.nasdaqCloses = null; this.#nasdaqAsked = false;
    this.plans = {}; this.returns = {}; this.calendar = []; this.etf = {}; this.etfSectors = {}; this.#hold = noHolds(); this.#holding = noHolds(); clearTimeout(this.#recheck);
    this.status = 'loading'; this.refreshing = false;
  }
  switchProfile(id: string) {
    if (id === this.profile?.id) return;
    setActiveProfile(id);
    this.profile = listProfiles().find(p => p.id === id) || activeProfile();
    this.#reset();
    void this.load();
  }
  connect(p: Omit<Profile, 'id'>) {
    this.profile = addProfile(p);
    this.#reset();
    void this.load();
  }
  /** Save changes to the account being edited. A different sheet means different data, so everything reloads. */
  saveProfile(id: string, p: Omit<Profile, 'id'>) {
    const next = updateProfile(id, p);
    this.editing = null;
    if (!next) return;
    if (this.profile?.id === id) { this.profile = next; this.#reset(); }
    this.status = 'loading';
    void this.load();
  }
  forgetProfile(id: string) {
    const next = removeProfile(id);
    this.editing = null;
    this.profile = next;
    this.#reset();
    if (next) { this.status = 'loading'; void this.load(); } else this.status = 'setup';
  }

  savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch { /* private mode */ } }
}

export const app = new AppState();
