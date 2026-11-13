<script lang="ts">
  import { untrack } from 'svelte';
  import { NEAR_STOP } from '../../core/alerts.ts';
  import { colorFor, compactNum, date, pct, qty, sign, signedPct, usd } from '../../core/format.ts';
  import { nextTranche } from '../../core/plan.ts';
  import type { Position, WatchItem } from '../../core/types.ts';
  import { PERIODS } from '../../data/sheets.ts';
  import type { Period } from '../../data/sheets.ts';
  import { app } from '../../state/app.svelte.ts';
  import DeleteButton from '../parts/DeleteButton.svelte';
  import Logo from '../parts/Logo.svelte';
  import Seg from '../parts/Seg.svelte';
  import { drawTable } from '../share.ts';
  import { tip } from '../tip.ts';

  const t = app.t;
  const m = $derived(app.model);
  const money = $derived(app.money);

  // ── Lookups the columns read ──
  const perfBy = $derived(new Map(app.perf.map(h => [h.symbol, h])));
  const nextDate = (pick: (e: (typeof app.calendar)[number]) => string | null) => {
    const by = new Map<string, string>();
    for (const e of app.calendar) { const d = pick(e); if (d && d >= app.today && (!by.has(e.symbol) || d < by.get(e.symbol)!)) by.set(e.symbol, d); }
    return by;
  };
  const earnings = $derived(nextDate(e => e.earnings));
  const exDivs = $derived(nextDate(e => e.exDiv));
  /** Trailing return in percent. A fund's own figure wins over the one worked out from prices. */
  function ret(p: Position, period: Period): number | null {
    const f = period === 'YTD' ? app.etf[p.symbol]?.ytdReturn : app.etf[p.symbol]?.trailingReturns?.[period];
    return f != null ? f * 100 : app.returns[p.symbol]?.[period] ?? null;
  }

  // ── Columns: one registry, three tabs that pick from it ──
  interface Cell { main: string; sub?: string; tone?: string; subTone?: string; strong?: boolean }
  interface Col {
    id: string; label: string; text?: boolean;
    /** What the column sorts by. */
    val: (p: Position) => number | string | null;
    /** Its dollar twin, used when sorting by amount. */
    abs?: (p: Position) => number | null;
    /** Said beside the sort arrow when the column is sorting by something other than its face value. */
    note?: () => string;
    cell: (p: Position) => Cell;
  }
  /** The extended session some holding has a live price for, if any. */
  const ext = $derived(m.positions.find(p => p.ext)?.ext ?? null);
  const dash: Cell = { main: '—', tone: 'muted' };
  /** A dollar amount as a percentage of everything in the tab: stocks plus cash. */
  const share = (dollars: number) => m.totalCurrent ? pct(dollars / m.totalCurrent * 100, 1) : undefined;
  const text = (id: string, label: string, pick: (p: Position) => string | null): Col =>
    ({ id, label, text: true, val: pick, cell: p => pick(p) ? { main: pick(p)!, tone: 'ink2' } : dash });
  const away = (level: number | null | undefined, p: Position) => level ? signedPct((p.price / level - 1) * 100, 1) : '';

  const COLS: Col[] = [
    // While any holding has a pre-market or after-hours price, Price sorts by that move (percent, or
    // dollars for the position with the $ switch): that is the number that is changing. Holdings
    // without one sink to the bottom. With no extended session running it sorts by the price itself.
    { id: 'price', label: 'Price', val: p => ext ? p.extPct : p.price, abs: p => !ext ? p.price : p.extPrice == null ? null : (p.extPrice - p.price) * p.qty,
      note: () => ext === 'PRE' ? t('Pre') : ext === 'POST' ? t('After') : '',
      cell: p => ({ main: usd(p.price), sub: p.ext ? `${p.ext === 'PRE' ? t('Pre') : t('After')} ${usd(p.extPrice)} ${signedPct(p.extPct)}` : undefined, subTone: sign(p.extPct) }) },
    { id: 'day', label: 'Day', val: p => p.dayChangePct, abs: p => p.dayChange == null ? null : p.dayChange * p.qty,
      cell: p => ({ main: signedPct(p.dayChangePct), tone: sign(p.dayChangePct), sub: p.dayChange == null ? undefined : money.signed(p.dayChange * p.qty), subTone: sign(p.dayChange) }) },
    { id: 'qty', label: 'Shares', val: p => p.qty, cell: p => ({ main: qty(p.qty) }) },
    { id: 'avg', label: 'Avg cost', val: p => p.avgPrice, cell: p => ({ main: usd(p.avgPrice) }) },
    // Both show their share of the whole portfolio, cash included, so the two lines can be compared:
    // what went in against what it is worth now, on the same base.
    { id: 'cost', label: 'Cost', val: p => p.costBasis, cell: p => ({ main: money(p.costBasis), sub: share(p.costBasis) }) },
    { id: 'value', label: 'Value', val: p => p.currentValue, cell: p => ({ main: money(p.currentValue), strong: true, sub: share(p.currentValue) }) },
    { id: 'unrealized', label: 'Unrealized', val: p => p.pnlPct, abs: p => p.pnl,
      cell: p => ({ main: signedPct(p.pnlPct), tone: sign(p.pnl), sub: money.signed(p.pnl), subTone: sign(p.pnl) }) },
    { id: 'weight', label: 'Weight', val: p => p.weightPct, cell: p => ({ main: pct(p.weightPct, 1), sub: p.target ? `${t('Target')} ${pct(p.target * 100, 1)}` : undefined }) },
    { id: 'total', label: 'Total result', val: p => perfBy.get(p.symbol)?.pct ?? null, abs: p => perfBy.get(p.symbol)?.total ?? null,
      cell: p => { const h = perfBy.get(p.symbol); return h ? { main: money.signed(h.total), tone: sign(h.total), sub: h.pct == null ? undefined : signedPct(h.pct, 1), subTone: sign(h.total) } : dash; } },
    { id: 'realized', label: 'Realized', val: p => perfBy.get(p.symbol)?.realized ?? null,
      cell: p => { const v = perfBy.get(p.symbol)?.realized; return v ? { main: money.signed(v), tone: sign(v) } : dash; } },
    { id: 'dividends', label: 'Dividends', val: p => perfBy.get(p.symbol)?.dividends ?? null,
      cell: p => { const v = perfBy.get(p.symbol)?.dividends; return v ? { main: money(v) } : dash; } },
    { id: 'stop', label: 'Stop loss', val: p => { const sl = app.planOf(p)?.sl; return sl ? p.price / sl - 1 : null; },
      cell: p => { const sl = app.planOf(p)?.sl; return sl ? { main: usd(sl), sub: away(sl, p), subTone: p.price <= sl ? 'loss' : '' } : dash; } },
    { id: 'entry', label: 'Next buy', val: p => { const n = nextTranche(app.planOf(p) ?? { sl: null, note: '', tranches: [], trims: [] }, p.price); return n?.tranche.price ? p.price / n.tranche.price - 1 : null; },
      cell: p => { const plan = app.planOf(p); const n = plan ? nextTranche(plan, p.price) : null; return n ? { main: usd(n.tranche.price), sub: `${t('Buy')} ${n.index + 1}, ${away(n.tranche.price, p)}` } : dash; } },
    ...PERIODS.map((period): Col => ({ id: 'r' + period, label: period, val: p => ret(p, period),
      cell: p => { const r = ret(p, period); return r == null ? dash : { main: signedPct(r, 1), tone: sign(r) }; } })),
    { id: 'cap', label: 'Market cap', val: p => p.marketCap, cell: p => p.marketCap ? { main: compactNum(p.marketCap) } : dash },
    { id: 'volume', label: 'Volume', val: p => p.volume, cell: p => p.volume ? { main: compactNum(p.volume), tone: 'ink2' } : dash },
    { id: 'fee', label: 'Fund fee', val: p => app.etf[p.symbol]?.expenseRatio ?? null, cell: p => { const v = app.etf[p.symbol]?.expenseRatio; return v == null ? dash : { main: pct(v * 100, 2) }; } },
    { id: 'assets', label: 'Fund size', val: p => app.etf[p.symbol]?.netAssets ?? null, cell: p => { const v = app.etf[p.symbol]?.netAssets; return v ? { main: compactNum(v) } : dash; } },
    { id: 'earnings', label: 'Next earnings', text: true, val: p => earnings.get(p.symbol) ?? null, cell: p => earnings.has(p.symbol) ? { main: date(earnings.get(p.symbol)!, true) } : dash },
    { id: 'exdiv', label: 'Ex-dividend', text: true, val: p => exDivs.get(p.symbol) ?? null, cell: p => exDivs.has(p.symbol) ? { main: date(exDivs.get(p.symbol)!, true) } : dash },
    text('sector', 'Sector', p => p.sector), text('industry', 'Industry', p => p.industry), text('category', 'Category', p => p.category),
    text('custom', 'Custom tag', p => p.custom), text('group', 'My group', p => p.myGroup),
    // The next two draw a bar in the table (see the markup); `cell` is their text form, for the picture.
    { id: 'alloc', label: 'Allocation', val: p => alloc(p).filled, abs: p => { const a = alloc(p); return a.want == null ? null : a.gap; },
      cell: p => { const a = alloc(p); return a.want == null ? { main: pct(a.now, 1) } : { main: `${pct(a.now, 1)} / ${pct(a.target!, 1)}`, sub: `${money.signed(a.gap)} (${a.filled!.toFixed(0)}%)` }; } },
    { id: 'range', label: '52-week range', val: p => rangePos(p),
      cell: p => rangePos(p) == null ? dash : { main: signedPct((p.price / p.high52! - 1) * 100, 1), sub: `${usd(p.low52)} to ${usd(p.high52)}` } },
  ];
  /**
   * Where a holding stands against its target: weight now and wanted (percent of what the tab can
   * invest), the dollars the target asks for, how far short (+) or over (−) it is, and how full.
   */
  function alloc(p: Position) {
    const now = p.investWeightPct;
    if (p.target == null || !(p.target > 0)) return { now, target: null, want: null, gap: 0, filled: null, state: '' };
    const want = p.target * m.investable, gap = want - p.currentValue, target = p.target * 100;
    return { now, target, want, gap, filled: want > 0 ? p.currentValue / want * 100 : 0, state: Math.abs(now - target) <= 0.5 ? 'ok' : now > target ? 'over' : 'under' };
  }
  const byId = new Map(COLS.map(c => [c.id, c]));
  const TABS = {
    holdings: ['price', 'day', 'qty', 'avg', 'cost', 'value', 'unrealized', 'alloc', 'range'],
    performance: ['price', 'day', 'rYTD', 'r1M', 'r3M', 'r1Y', 'r3Y', 'r5Y', 'total', 'cap', 'volume'],
  };
  /** A tab of the user's own: a name and the columns it shows, in order. */
  interface View { id: string; name: string; cols: string[] }
  const STARTER = ['price', 'day', 'value', 'unrealized', 'total', 'stop', 'entry', 'earnings'];

  // ── What is remembered on this device ──
  const KEY = 'portapp.next.positions.v1';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();
  const known = (ids: unknown) => Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && byId.has(id)) : null;
  let views = $state<View[]>(Array.isArray(saved.views) && saved.views.length
    ? saved.views.map((v: View, i: number) => ({ id: String(v.id || 'v' + i), name: String(v.name || ''), cols: known(v.cols) ?? STARTER }))
    : [{ id: 'v1', name: '', cols: known(saved.custom) ?? STARTER }]);   // the earlier single list becomes the first tab
  let tab = $state<string>(untrack(() => saved.tab === 'custom' ? views[0].id : saved.tab === 'performance' || views.some(v => v.id === saved.tab) ? saved.tab : 'holdings'));
  const view = $derived(views.find(v => v.id === tab) ?? null);
  const custom = $derived(view?.cols ?? []);
  const setCols = (cols: string[]) => { views = views.map(v => v.id === tab ? { ...v, cols } : v); };
  const viewName = (v: View) => v.name || t('My columns');

  let renaming = $state<string | null>(null);
  function rename(id: string, name: string) { views = views.map(v => v.id === id ? { ...v, name: name.trim().slice(0, 24) } : v); renaming = null; }
  function addView() {
    const v: View = { id: 'v' + Date.now(), name: '', cols: view ? [...view.cols] : cols.map(c => c.id).filter(id => id !== 'range') };
    views = [...views, v]; tab = v.id; renaming = v.id; colsOpen = true;
  }
  function removeView() {
    if (!view || views.length < 2) return;
    views = views.filter(v => v.id !== view.id); tab = views[0].id;
  }
  const focusAll = (el: HTMLInputElement) => { el.focus(); el.select(); };
  let basis = $state<'pct' | 'abs'>(saved.basis === 'abs' ? 'abs' : 'pct');
  $effect(() => { try { localStorage.setItem(KEY, JSON.stringify({ tab, basis, views })); } catch { /* storage full or blocked */ } });

  const cols = $derived((view ? view.cols : tab === 'performance' ? TABS.performance : TABS.holdings).map(id => byId.get(id)!));
  let sortKey = $state('value');
  let dir = $state<1 | -1>(-1);
  let query = $state('');
  function sortBy(c: Col | null) {
    if (dragged) return;   // the click that ends a drag is not a request to sort
    const id = c?.id ?? 'symbol';
    if (sortKey === id) dir = dir === 1 ? -1 : 1;
    else { sortKey = id; dir = !c || c.text ? 1 : -1; }
  }

  // ── Filters: any of the chosen values within a group, all of the groups together ──
  const GROUPS = [
    { key: 'category', label: 'Category' }, { key: 'sector', label: 'Sector' }, { key: 'industry', label: 'Industry' },
    { key: 'custom', label: 'Custom tag' }, { key: 'myGroup', label: 'My group' },
  ] as const;
  type GroupKey = (typeof GROUPS)[number]['key'];
  let filters = $state<Record<GroupKey, string[]>>({ category: [], sector: [], industry: [], custom: [], myGroup: [] });
  let filtersOpen = $state(false);
  let colsOpen = $state(false);
  const options = $derived(GROUPS.map(g => ({ ...g, values: [...new Set(m.positions.map(p => p[g.key] || 'Other'))].sort() })).filter(g => g.values.length > 1));
  const active = $derived(GROUPS.reduce((n, g) => n + filters[g.key].length, 0));
  const toggle = (g: GroupKey, v: string) => { filters[g] = filters[g].includes(v) ? filters[g].filter(x => x !== v) : [...filters[g], v]; };
  const clear = () => { for (const g of GROUPS) filters[g.key] = []; };

  const rows = $derived.by(() => {
    const q = query.trim().toLowerCase();
    let list = m.positions.filter(p => GROUPS.every(g => !filters[g.key].length || filters[g.key].includes(p[g.key] || 'Other')));
    if (q) list = list.filter(p => p.symbol.toLowerCase().includes(q) || p.name?.toLowerCase().includes(q));
    const col = byId.get(sortKey);
    const read = (p: Position) => !col ? p.symbol : basis === 'abs' && col.abs ? col.abs(p) : col.val(p);
    return list.sort((a, b) => {
      const x = read(a), y = read(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;   // blanks last either way
      return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * dir;
    });
  });
  const shownValue = $derived(rows.reduce((s, p) => s + p.currentValue, 0));
  const shownPnl = $derived(rows.reduce((s, p) => s + p.pnl, 0));
  const shownCost = $derived(rows.reduce((s, p) => s + p.costBasis, 0));
  const whole = $derived(!query && !active);

  // Where the price sits between the 52-week low and high, 0–100.
  function rangePos(p: Position) {
    return p.low52 != null && p.high52 != null && p.high52 > p.low52 ? Math.min(100, Math.max(0, (p.price - p.low52) / (p.high52 - p.low52) * 100)) : null;
  }
  const aria = (id: string) => sortKey === id ? (dir === 1 ? 'ascending' : 'descending') : 'none';
  const stopState = (p: Position) => { const sl = app.planOf(p)?.sl; return !sl ? '' : p.price <= sl ? 'hit' : p.price <= sl * (1 + NEAR_STOP / 100) ? 'near' : ''; };

  // ── Dragging a header sideways moves its column (own tabs only). The buttons in the column
  // list do the same for a keyboard. ──
  let drag = $state<{ id: string; x0: number; on: boolean; over: string | null; after: boolean } | null>(null);
  let dragged = false;
  function dragStart(e: PointerEvent, id: string) { if (view && e.button === 0) drag = { id, x0: e.clientX, on: false, over: null, after: false }; }
  function dragMove(e: PointerEvent) {
    if (!drag) return;
    if (!drag.on && Math.abs(e.clientX - drag.x0) < 6) return;
    drag.on = true;
    const th = (document.elementsFromPoint(e.clientX, e.clientY).find(el => el instanceof HTMLElement && el.closest('th[data-col]')) as HTMLElement | undefined)?.closest<HTMLElement>('th[data-col]');
    if (!th) { drag.over = null; return; }
    const box = th.getBoundingClientRect();
    drag.over = th.dataset.col!; drag.after = e.clientX > box.left + box.width / 2;
  }
  function dragEnd() {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.on) return;
    dragged = true; setTimeout(() => { dragged = false; }, 0);
    if (!d.over || d.over === d.id) return;
    const next = custom.filter(x => x !== d.id);
    next.splice(next.indexOf(d.over) + (d.after ? 1 : 0), 0, d.id);
    setCols(next);
  }

  // ── The watchlist sorts on its own, by any of its columns ──
  let wSort = $state<{ key: 'symbol' | 'price' | 'day' | 'target' | 'high'; dir: 1 | -1 }>({ key: 'symbol', dir: 1 });
  const wVal = (w: WatchItem, k: typeof wSort.key) => k === 'symbol' ? w.symbol : k === 'price' ? w.price : k === 'day' ? w.dayChangePct : k === 'target' ? w.target : w.high52 && w.price ? w.price / w.high52 - 1 : null;
  const watch = $derived([...m.watchlist].sort((a, b) => {
    const x = wVal(a, wSort.key), y = wVal(b, wSort.key);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * wSort.dir;
  }));
  const wBy = (key: typeof wSort.key) => { wSort = { key, dir: wSort.key === key ? (wSort.dir === 1 ? -1 : 1) : key === 'symbol' ? 1 : -1 }; };
  const wArrow = (key: typeof wSort.key) => wSort.key === key ? (wSort.dir === 1 ? ' ↑' : ' ↓') : '';

  // ── The table as a picture: the rows and columns on screen, drawn fresh ──
  let drawing = $state(false);
  async function sharePic() {
    if (drawing || !rows.length) return;
    drawing = true;
    try {
      const shown = cols;
      const blob = await drawTable({
        title: app.view === 'ALL' ? (app.profile?.profileName || t('Positions')) : app.view,
        subtitle: `${rows.length} ${t('holdings')}, ${date(app.today)}`,
        columns: shown.map(c => ({ label: t(c.label), left: c.text })),
        rows: rows.map(p => ({ symbol: p.symbol, name: p.name || '', cells: shown.map(c => c.cell(p)) })),
        foot: { label: whole ? t('Total') : t('Shown'), cells: shown.map(c => c.id === 'value' ? money(whole ? m.totalCurrent : shownValue) : c.id === 'cost' ? money(shownCost) : c.id === 'unrealized' ? money.signed(shownPnl) : '') },
      });
      app.dialog = { kind: 'share', blob, name: `positions-${app.today}.png` };
    } finally { drawing = false; }
  }

  function move(id: string, by: number) {
    const i = custom.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= custom.length) return;
    const next = [...custom];
    [next[i], next[j]] = [next[j], next[i]];
    setCols(next);
  }
  const flip = (id: string) => { setCols(custom.includes(id) ? custom.filter(x => x !== id) : [...custom, id]); };
</script>

<svelte:window onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={dragEnd} />

<div class="page">
  <header class="page-head">
    <h1 class="page-title">{t('Positions')}</h1>
    <span class="page-count">{rows.length}{whole ? '' : ` ${t('of')} ${m.positions.length}`} {t('holdings')}</span>
    <span class="spacer"></span>
    {#if app.canWrite}<button class="btn" onclick={() => app.dialog = { kind: 'watch' }}>{t('Add to the watchlist')}</button>{/if}
    <input class="input search" type="search" bind:value={query} placeholder={t('Search symbol or name')} aria-label={t('Search symbol or name')}>
  </header>

  <section class="card">
    <div class="bar">
      {#if m.dayChange != null}
        <!-- The whole tab's move today, whatever the filters or search below are showing. -->
        <span class="today {sign(m.dayChange)}" title={t('Change today across the holdings of this portfolio')}>
          <span class="lab">{t('Today')}</span>
          <strong>{money.signed(m.dayChange)}</strong>
          <span class="pc">{signedPct(m.dayPct)}</span>
        </span>
      {/if}
      <!-- Which table, beside the day's figure; the controls that act on it sit to the right. -->
      <div class="tabs" role="group" aria-label={t('Table layout')}>
        <button class:on={tab === 'holdings'} aria-pressed={tab === 'holdings'} onclick={() => tab = 'holdings'}>{t('Holdings')}</button>
        <button class:on={tab === 'performance'} aria-pressed={tab === 'performance'} onclick={() => tab = 'performance'}>{t('Performance')}</button>
        {#each views as v (v.id)}
          {#if renaming === v.id}
            <input class="rename" value={viewName(v)} maxlength="24" aria-label={t('Tab name')} use:focusAll
              onkeydown={e => { if (e.key === 'Enter') rename(v.id, e.currentTarget.value); else if (e.key === 'Escape') { e.stopPropagation(); renaming = null; } }}
              onblur={e => { if (renaming === v.id) rename(v.id, e.currentTarget.value); }} />
          {:else}
            <button class:on={tab === v.id} aria-pressed={tab === v.id} title={t('Double-click to rename')} onclick={() => tab = v.id} ondblclick={() => renaming = v.id}>{viewName(v)}</button>
          {/if}
        {/each}
        <button class="add" onclick={addView} aria-label={t('Add a tab of your own')} title={t('Add a tab of your own')}>+</button>
      </div>
      <span class="spacer"></span>
      {#if view}<button class="btn" aria-expanded={colsOpen} onclick={() => colsOpen = !colsOpen}>{t('Choose columns')}</button>{/if}
      {#if rows.length}<button class="btn" onclick={sharePic} disabled={drawing}>{t('Share')}</button>{/if}
      {#if options.length}<button class="btn" class:on={active > 0} aria-expanded={filtersOpen} onclick={() => filtersOpen = !filtersOpen}>{t('Filter')}{active ? ` ${active}` : ''}</button>{/if}
      <Seg small label={t('Sort returns by')} bind:value={basis} options={[{ value: 'pct', label: t('Sort by %') }, { value: 'abs', label: t('Sort by $') }]} />
    </div>

    {#if view && colsOpen}
      <div class="panel">
        <div class="viewtools">
          <span class="small muted">{t('Drag a column heading sideways to move it, or use the arrows here.')}</span>
          <span class="spacer"></span>
          <button class="btn" onclick={() => renaming = view.id}>{t('Rename this tab')}</button>
          {#if views.length > 1}<DeleteButton label={t('Delete this tab')} confirm={t('Press again to delete')} onconfirm={removeView} />{/if}
        </div>
        <ul class="colpick">
          {#each [...custom, ...COLS.map(c => c.id).filter(id => !custom.includes(id))] as id (id)}
            {@const on = custom.includes(id)}
            <li>
              <label class="check"><input type="checkbox" checked={on} onchange={() => flip(id)} /> {t(byId.get(id)!.label)}</label>
              {#if on}
                <button class="icon-btn" onclick={() => move(id, -1)} aria-label="{t('Move left')}: {t(byId.get(id)!.label)}" disabled={custom[0] === id}>←</button>
                <button class="icon-btn" onclick={() => move(id, 1)} aria-label="{t('Move right')}: {t(byId.get(id)!.label)}" disabled={custom[custom.length - 1] === id}>→</button>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if filtersOpen && options.length}
      <div class="panel">
        {#each options as g (g.key)}
          <div class="fgroup">
            <span class="small muted">{t(g.label)}</span>
            {#each g.values as v (v)}
              <button class="chip" class:on={filters[g.key].includes(v)} aria-pressed={filters[g.key].includes(v)} onclick={() => toggle(g.key, v)}>{v}</button>
            {/each}
          </div>
        {/each}
        {#if active}<div><button class="btn" onclick={clear}>{t('Clear filters')}</button></div>{/if}
      </div>
    {/if}

    {#if rows.length}
      <div class="table-scroll">
        <table class="tbl dense">
          <thead>
            <tr>
              <th class="sortable" aria-sort={aria('symbol')}><button onclick={() => sortBy(null)}>{t('Symbol')}{#if sortKey === 'symbol'}<span aria-hidden="true">{' '}{dir === 1 ? '↑' : '↓'}</span>{/if}</button></th>
              {#each cols as c (c.id)}
                <th class="sortable" class:n={!c.text && c.id !== 'range' && c.id !== 'alloc'} class:mine={!!view} class:lifting={drag?.on && drag.id === c.id}
                  class:before={drag?.on && drag.over === c.id && !drag.after && drag.id !== c.id} class:after={drag?.on && drag.over === c.id && drag.after && drag.id !== c.id}
                  data-col={c.id} aria-sort={aria(c.id)} onpointerdown={e => dragStart(e, c.id)}>
                  <button onclick={() => sortBy(c)}>{t(c.label)}{#if sortKey === c.id}<span aria-hidden="true">{' '}{dir === 1 ? '↑' : '↓'}{c.note ? (c.note() ? ` ${c.note()}${basis === 'abs' ? ' $' : ' %'}` : '') : c.abs ? (basis === 'abs' ? ' $' : ' %') : ''}</span>{/if}</button>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as p (p.symbol)}
              {@const stop = stopState(p)}
              <tr class="click" onclick={() => app.symbol = p.symbol}>
                <td class="sym">
                  <div class="symcell">
                    <Logo sym={p.symbol} size={22} />
                    <div>
                      <button class="strong" onclick={e => { e.stopPropagation(); app.symbol = p.symbol; }}>{p.symbol}</button>{#if p.basisFallback}<span class="muted" use:tip={t('Ledger does not match the share count, so this uses the sheet’s stored average.')}>{' '}≈</span>{/if}
                      {#if stop}<span class="pill {stop === 'hit' ? 'loss' : 'near'}">{stop === 'hit' ? t('Stop reached') : t('Near stop')}</span>{/if}
                      <span class="sub name">{p.name || ''}</span>
                    </div>
                  </div>
                </td>
                {#each cols as c (c.id)}
                  {#if c.id === 'range'}
                    {@const r = rangePos(p)}
                    <td>
                      {#if r != null}
                        {@const tone = r >= 80 ? 'gain' : r <= 20 ? 'loss' : 'mid'}
                        <div class="range {tone}" use:tip={`${t('Low')} ${usd(p.low52)}\n${t('High')} ${usd(p.high52)}\n${t('Now')} ${r.toFixed(0)}% ${t('of the way up the range')}`}>
                          <span class="track"><span class="fill" style:width="{r}%"></span><span class="dot" style:left="{r}%"></span></span>
                          <span class="ends"><span class="muted">{usd(p.low52)}</span><span class="from">{signedPct((p.price / p.high52! - 1) * 100, 1)}</span><span class="muted">{usd(p.high52)}</span></span>
                        </div>
                      {:else}<span class="muted">—</span>{/if}
                    </td>
                  {:else if c.id === 'alloc'}
                    {@const a = alloc(p)}
                    <td>
                      <div class="alloc">
                        <span class="pair">{pct(a.now, 1)}{#if a.target != null}{' '}<span class="muted">/ {pct(a.target, 1)}</span>{/if}</span>
                        {#if a.want == null}
                          <span class="track"><span class="fill" style:width="{Math.min(a.now, 100)}%" style:background={colorFor(p.symbol)}></span></span>
                          <span class="ends"><span class="muted">{money(p.currentValue)}</span></span>
                        {:else}
                          <!-- The bar is scaled so the target mark stays in view even when the holding is past it. -->
                          {@const scale = Math.max(a.filled!, 100)}
                          <span class="track"><span class="fill" style:width="{a.filled! / scale * 100}%" style:background={colorFor(p.symbol)}></span><span class="mark" style:left="{100 / scale * 100}%"></span></span>
                          <span class="ends"><span class="muted">/ {money(a.want)}</span><span class="gap {a.state}">{money.signed(a.gap)} ({a.filled!.toFixed(0)}%)</span></span>
                        {/if}
                      </div>
                    </td>
                  {:else}
                    {@const x = c.cell(p)}
                    <td class="{c.text ? '' : 'n'} {x.tone ?? ''}" class:strong={x.strong}>{x.main}{#if x.sub}<span class="sub {x.subTone ?? ''}">{x.sub}</span>{/if}</td>
                  {/if}
                {/each}
              </tr>
            {/each}
          </tbody>
          <tfoot>
            {#if whole}
              <tr>
                <td>{m.limit ? t('Room to buy') : t('Cash')}</td>
                {#each cols as c (c.id)}<td class="n">{c.id === 'value' ? money(m.cash) : (c.id === 'weight' || c.id === 'alloc') && m.totalCurrent ? pct(m.cash / m.totalCurrent * 100, 1) : ''}{#if c.id === 'value' && m.totalCurrent}<span class="sub">{pct(m.cash / m.totalCurrent * 100, 1)}</span>{/if}</td>{/each}
              </tr>
            {/if}
            <tr>
              <td>{whole ? t('Total') : t('Shown')}</td>
              {#each cols as c (c.id)}
                <td class="n {c.id === 'unrealized' ? sign(shownPnl) : c.id === 'day' && whole ? sign(m.dayChange) : ''}">
                  {c.id === 'value' ? money(whole ? m.totalCurrent : shownValue) : c.id === 'cost' ? money(shownCost) : c.id === 'unrealized' ? money.signed(shownPnl) : c.id === 'day' && whole && m.dayChange != null ? signedPct(m.dayPct) : ''}
                </td>
              {/each}
            </tr>
          </tfoot>
        </table>
      </div>
    {:else}
      <p class="empty">{query || active ? t('No holding matches that search.') : t('No holdings in this portfolio yet.')}</p>
    {/if}
  </section>

  {#if m.watchlist.length && whole}
    <h2 class="section-title">{t('Watchlist')} <span class="muted">{m.watchlist.length}</span></h2>
    <section class="card">
      <div class="table-scroll">
        <table class="tbl dense">
          <thead><tr>
            <th class="sortable"><button onclick={() => wBy('symbol')}>{t('Symbol')}{wArrow('symbol')}</button></th>
            <th class="sortable n"><button onclick={() => wBy('price')}>{t('Price')}{wArrow('price')}</button></th>
            <th class="sortable n"><button onclick={() => wBy('day')}>{t('Day')}{wArrow('day')}</button></th>
            <th class="sortable n"><button onclick={() => wBy('target')}>{t('Target')}{wArrow('target')}</button></th>
            <th class="sortable n"><button onclick={() => wBy('high')}>{t('From 52-week high')}{wArrow('high')}</button></th>
          </tr></thead>
          <tbody>
            {#each watch as w (w.symbol)}
              <tr class="click" onclick={() => app.symbol = w.symbol}>
                <td class="sym"><div class="symcell"><Logo sym={w.symbol} size={22} /><div><span class="strong">{w.symbol}</span><span class="sub name">{w.name || ''}</span></div></div></td>
                <td class="n">{usd(w.price)}</td>
                <td class="n {sign(w.dayChangePct)}">{signedPct(w.dayChangePct)}</td>
                <td class="n">{w.target ? pct(w.target * 100, 1) : ''}</td>
                <td class="n">{w.high52 && w.price ? pct((w.price / w.high52 - 1) * 100, 1) : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</div>

<style>
  .card { padding: var(--sp-1) var(--sp-1) var(--sp-2); overflow: hidden; }

  /* ── A dense table: this page is for scanning many rows, so every gap is cut to the least that
     still keeps a row readable and a cell tappable. ── */
  .dense { font-size: 13px; }
  .dense :global(th) { padding: 6px 8px; font-size: 12px; }
  .dense :global(td) { padding: 5px 8px; line-height: 1.25; }
  .dense :global(.sub) { font-size: 11px; }
  .dense :global(tfoot td) { padding-block: 7px; }
  /* A tinted pill in the day's colour: the label stays quiet, the amount leads, the percent rides in its own chip. */
  .today { display: inline-flex; align-items: center; gap: 8px; align-self: center; padding: 5px 6px 5px 14px; border-radius: 999px; font-size: 14px; white-space: nowrap; background: color-mix(in oklab, currentColor 10%, transparent); }
  .today.flat { color: var(--ink-2); }
  .today .lab { font-size: 12px; font-weight: 500; color: var(--ink-2); }
  .today strong { font: 650 16px/1 var(--font-display); letter-spacing: -0.02em; }
  .today .pc { padding: 4px 9px; border-radius: 999px; font-size: 12px; font-weight: 650; background: color-mix(in oklab, currentColor 16%, transparent); }
  .bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); padding: var(--sp-2) var(--sp-2) var(--sp-2); }
  .bar .btn.on { background: var(--ink); color: var(--bg); }
  .tabs { display: inline-flex; align-items: center; padding: 3px; gap: 2px; background: var(--wash); border-radius: 999px; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  .tabs button { padding: 6px 15px; border-radius: 999px; font-size: 13px; font-weight: 500; color: var(--ink-2); white-space: nowrap; }
  .tabs button:hover { color: var(--ink); }
  .tabs button.on { background: var(--ink); color: var(--bg); }
  .tabs .add { padding-inline: 11px; }
  .rename { width: 130px; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--accent); background: var(--card); font-size: 13px; }
  .viewtools { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); }
  /* A sideways drag on one of these moves the column; up and down still scrolls the page. */
  th.mine { touch-action: pan-y; cursor: grab; }
  th.lifting { opacity: 0.4; }
  th.before { box-shadow: inset 3px 0 0 var(--accent); }
  th.after { box-shadow: inset -3px 0 0 var(--accent); }
  .panel { display: grid; gap: var(--sp-3); padding: var(--sp-4); margin: 0 var(--sp-3) var(--sp-4); border-radius: var(--radius-sm); background: var(--sunk); }
  .fgroup { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .fgroup > span { flex: 0 0 92px; }
  .chip { padding: 5px 12px; border-radius: 999px; font-size: 13px; background: var(--card); color: var(--ink-2); }
  .chip:hover { color: var(--ink); }
  .chip.on { background: var(--ink); color: var(--bg); }
  .colpick { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 2px var(--sp-5); }
  .colpick li { display: flex; align-items: center; gap: 4px; min-height: 34px; }
  .colpick .check { flex: 1; }
  .colpick .icon-btn { width: 30px; height: 30px; }
  .section-title .muted { font-weight: 500; }
  .search { max-width: 300px; }
  th button { font: inherit; color: inherit; letter-spacing: inherit; text-transform: inherit; white-space: nowrap; }
  .symcell { display: flex; align-items: center; gap: 8px; }
  /* Half the room it had: the ticker is what is read, the name is a reminder. */
  .name { max-width: 90px; overflow: hidden; text-overflow: ellipsis; }
  .sym { position: sticky; left: 0; background: var(--card); z-index: 1; }
  tr.click:hover .sym { background: var(--sunk); }
  .sym .pill { margin-left: 4px; font-size: 10px; padding: 1px 5px; }
  .pill.near { background: color-mix(in oklab, var(--honey) 16%, transparent); color: var(--honey); }
  /* Two cells that draw a bar with their numbers under it. */
  .range, .alloc { display: grid; gap: 2px; min-width: 128px; font-size: 11px; font-variant-numeric: tabular-nums; }
  .alloc { min-width: 146px; }
  .alloc .pair { font-size: 13px; font-weight: 600; }
  .track { position: relative; display: block; height: 5px; border-radius: 3px; background: var(--wash); }
  .track .fill { position: absolute; inset: 0 auto 0 0; border-radius: 3px; opacity: 0.5; }
  .alloc .track .fill { opacity: 1; }
  .dot { position: absolute; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; border: 2px solid var(--card); }
  .mark { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--ink); }
  .ends { display: flex; justify-content: space-between; gap: 8px; white-space: nowrap; }
  .range.gain .fill, .range.gain .dot { background: var(--gain); } .range.gain .from { color: var(--gain); }
  .range.loss .fill, .range.loss .dot { background: var(--loss); } .range.loss .from { color: var(--loss); }
  .range.mid .fill, .range.mid .dot { background: var(--accent); } .range.mid .from { color: var(--accent-ink); }
  .from, .gap { font-weight: 600; }
  .gap.under { color: var(--accent-ink); } .gap.over { color: var(--honey); } .gap.ok { color: var(--muted); }
  @media (max-width: 760px) { .name { max-width: 72px; } .search { max-width: none; flex: 1 1 100%; } .fgroup > span { flex-basis: 100%; } }
  /* A phone held upright: the first column is the logo and the ticker and nothing wider, so the
     numbers get the rest of the screen. The name and the stop-loss tag are in the symbol window. */
  @media (max-width: 760px) and (orientation: portrait) {
    .sym { width: 1%; padding-right: 6px; }
    .sym .name, .sym .pill { display: none; }
    .symcell { gap: 6px; }
    .dense :global(td), .dense :global(th) { padding-inline: 6px; }
  }
</style>
