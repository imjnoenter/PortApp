<script lang="ts">
  // The workspace for one symbol: what is known on the left (price, position, the chart with every
  // planned level on it), one task on the right (plan, trade or manage). Switching task keeps the
  // left half, and what is typed on the right moves the lines on the chart.
  import { setContext, untrack } from 'svelte';
  import { DEFAULT_PORT } from '../../core/fifo.ts';
  import { date, pct, qty, sign, signedPct, usd } from '../../core/format.ts';
  import { txMarketDate } from '../../core/market.ts';
  import { ALL } from '../../core/model.ts';
  import { nextTranche, planKey, trancheDollars } from '../../core/plan.ts';
  import { app } from '../../state/app.svelte.ts';
  import type { DialogState } from '../../state/app.svelte.ts';
  import Logo from '../parts/Logo.svelte';
  import PriceChart from '../parts/PriceChart.svelte';
  import Seg from '../parts/Seg.svelte';
  import { WORKSPACE, Workspace, planLevels } from '../workspace.svelte.ts';
  import DetailsDialog from './DetailsDialog.svelte';
  import PlanDialog from './PlanDialog.svelte';
  import TradeDialog from './TradeDialog.svelte';

  type Start = Extract<NonNullable<DialogState>, { kind: 'trade' | 'plan' | 'details' }>;
  let { start }: { start: Start } = $props();

  const t = app.t;
  const money = $derived(app.money);
  const close = () => { app.dialog = null; };

  const ws = new Workspace();
  const first = untrack(() => start);
  ws.symbol = first.symbol ?? '';
  ws.portfolio = ('portfolio' in first && first.portfolio) || (first.symbol ? app.homePort(first.symbol) : app.view !== ALL ? app.view : app.ports[0] ?? DEFAULT_PORT);
  setContext(WORKSPACE, ws);

  let tab = $state<'plan' | 'trade' | 'details'>(first.kind);
  let showContext = $state(false);

  const sym = $derived(ws.symbol);
  const m = $derived(app.portModel(ws.portfolio));
  const pos = $derived(m.positions.find(p => p.symbol === sym) ?? null);
  const row = $derived(app.rows.find(r => r.symbol === sym && r.portfolio === ws.portfolio) ?? app.rows.find(r => r.symbol === sym));
  const quote = $derived(app.quotes[sym]);
  const price = $derived(pos?.price ?? quote?.price ?? row?.price ?? null);
  const dayPct = $derived(pos?.dayChangePct ?? quote?.changePct ?? null);
  // A live pre-market or after-hours price, measured against the regular price beside it.
  const ext = $derived(quote?.ext && quote.extPrice && price ? { pre: quote.ext === 'PRE', price: quote.extPrice, pct: (quote.extPrice / price - 1) * 100 } : null);
  const saved = $derived(app.plans[planKey(ws.portfolio, sym)] ?? null);
  const plan = $derived(tab === 'plan' && ws.plan ? ws.plan : saved);
  const levels = $derived(planLevels(t, pos?.avgPrice, plan, tab === 'details' ? null : ws.newAvg));
  const trades = $derived(app.txs.filter(x => x.ticker === sym && x.portfolio === ws.portfolio)
    .sort((a, b) => (b.dateStr + b.time).localeCompare(a.dateStr + a.time) || b.row - a.row));
  const marks = $derived(trades.filter(x => x.type === 'Buy' || x.type === 'Sell').map(x => ({ d: txMarketDate(x.dateStr, x.time), type: x.type, shares: x.shares, price: x.price })));

  const target = $derived(pos?.target ?? m.watchlist.find(w => w.symbol === sym)?.target ?? 0);
  const td = $derived(target * m.investable);
  const next = $derived.by(() => {
    if (!saved || !price) return null;
    const n = nextTranche(saved, price);
    return n ? { ...n, dollars: td > 0 ? trancheDollars(saved.tranches, (pos?.currentValue ?? 0) / td * 100, td)[n.index] : 0 } : null;
  });
  // ── The target bar, and where the trade being typed would leave it ──
  // A buy or a sale swaps shares for cash inside the same portfolio, so the target's dollars stay
  // put and only the position's side of the bar moves.
  const fill = $derived.by(() => {
    if (!(td > 0)) return null;
    const value = pos?.currentValue ?? 0, now = value / td * 100;
    // A trade is valued at today's price. A plan is valued the way its percentages are: each buy
    // at the dollars it spends, each sale at the share of the target it lets go.
    const then = tab === 'trade' ? (ws.newQty != null && price ? ws.newQty * price : null) : tab === 'plan' ? ws.planValue : null;
    const after = then == null || Math.abs(then - value) < 0.005 ? null : then / td * 100;
    const scale = Math.max(100, now, after ?? 0);
    return { value, now, then, after, scale, weight: m.investable ? (then ?? value) / m.investable * 100 : 0 };
  });

  const hasRow = $derived(app.rawRows.some(r => r.symbol === sym && r.portfolio === ws.portfolio));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={close}></div>
<div class="work" role="dialog" aria-modal="true" aria-label={sym || t('Record a trade')}>
  <header>
    {#if sym}<Logo {sym} size={44} />{/if}
    <div class="who">
      <div class="sym">{sym || t('Record a trade')}</div>
      {#if sym}<div class="muted small name">{row?.name || ''}</div>{/if}
    </div>
    {#if sym && price != null}
      <div class="px">
        <div class="price">{usd(price)}</div>
        {#if dayPct != null}<div class="small {sign(dayPct)}">{signedPct(dayPct)} {t('today')}</div>{/if}
        {#if ext}<div class="small"><span class="muted">{ext.pre ? t('Pre-market') : t('After hours')}</span> <span class="strong">{usd(ext.price)}</span> <span class={sign(ext.pct)}>{signedPct(ext.pct)}</span></div>{/if}
      </div>
    {/if}
    <button class="icon-btn" onclick={close} aria-label={t('Close')}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </header>

  <div class="body">
    <button class="btn reveal" aria-expanded={showContext} onclick={() => showContext = !showContext}>{showContext ? t('Hide the chart') : t('Show the chart and position')}</button>
    <div class="context" class:open={showContext}>
      {#if sym}
        <dl class="facts">
          <div><dt>{t('Shares')}</dt><dd>{pos ? qty(pos.qty) : '—'}</dd></div>
          <div><dt>{t('Avg cost')}</dt><dd>{pos ? usd(pos.avgPrice) : '—'}</dd></div>
          <div><dt>{t('Value')}</dt><dd>{pos ? money(pos.currentValue) : '—'}</dd></div>
          <div><dt>{t('Unrealized')}</dt><dd class={sign(pos?.pnl)}>{pos ? signedPct(pos.pnlPct) : '—'}</dd></div>
        </dl>
        <PriceChart {sym} {levels} {marks} />
        {#if fill}
          <div class="fill">
            <div class="frow"><span class="small ink2">{t('Filled')} {pct(fill.now, 0)} {t('of target')}, {money(fill.value)} {t('of')} {money(td)}</span><span class="small muted">{t('Target')} {pct(target * 100, 1)} {t('of')} {ws.portfolio}</span></div>
            <!-- Solid is what is held now. The lighter stretch is what the trade or plan adds; a hatched one is what it takes away. -->
            <span class="track">
              <span class="held" class:over={Math.min(fill.now, fill.after ?? fill.now) > 100} style:width="{Math.min(fill.now, fill.after ?? fill.now) / fill.scale * 100}%"></span>
              {#if fill.after != null}
                <span class="delta {fill.after > fill.now ? 'add' : 'cut'}" style:left="{Math.min(fill.now, fill.after) / fill.scale * 100}%" style:width="{Math.abs(fill.after - fill.now) / fill.scale * 100}%"></span>
              {/if}
              <span class="goal" style:left="{100 / fill.scale * 100}%"></span>
            </span>
            {#if fill.after != null}
              <div class="frow"><span class="small strong">{tab === 'plan' ? t('After this plan') : t('After this trade')}: {pct(fill.after, 0)} {t('of target')}, {money(fill.then)}</span><span class="small ink2">{pct(fill.weight, 1)} {t('of')} {ws.portfolio}</span></div>
            {/if}
          </div>
        {/if}
        {#if next}
          <p class="small ink2">{t('Next planned buy')}: {t('Buy')} {next.index + 1} {t('at')} {usd(next.tranche.price)}{#if next.dollars > 0}, {usd(next.dollars)}{/if}{#if price && next.tranche.price}, {pct((1 - next.tranche.price / price) * 100, 1)} {t('below now')}{/if}.</p>
        {/if}
        {#if trades.length}
          <!-- Open on every tab: the earlier trades are what the next move is weighed against. -->
          <details open>
            <summary>{t('Trades')} {trades.length}</summary>
            <table class="tbl">
              <thead><tr><th>{t('Date')}</th><th>{t('Type')}</th><th class="n">{t('Shares')}</th><th class="n">{t('Price')}</th><th class="n">{t('Gain')}</th></tr></thead>
              <tbody>
                {#each trades as x (x.row)}
                  {@const g = x.type === 'Buy' && price && x.price > 0 ? (price / x.price - 1) * 100 : null}
                  <tr title={x.note || undefined}>
                    <td>{date(x.dateStr, true)}</td>
                    <td><span class="pill {x.type === 'Buy' ? 'gain' : x.type === 'Sell' ? 'loss' : ''}">{t(x.type)}</span></td>
                    <td class="n">{qty(x.shares)}</td>
                    <td class="n">{usd(x.price)}</td>
                    <td class="n {sign(g)}">{g == null ? '' : signedPct(g)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </details>
        {/if}
      {:else}
        <p class="empty">{t('Enter a symbol to see its chart and position here.')}</p>
      {/if}
    </div>

    <div class="task">
      <div class="tabs">
        <Seg bind:value={tab} options={[{ value: 'plan', label: t('Plan') }, { value: 'trade', label: t('Trade') }, { value: 'details', label: t('Manage') }]} />
        <span class="spacer"></span>
        {#if app.ports.length > 1}
          <select class="input port" bind:value={ws.portfolio} aria-label={t('Portfolio')}>
            {#each app.ports as p (p)}<option value={p}>{p}</option>{/each}
          </select>
        {/if}
      </div>
      {#key tab + '|' + ws.portfolio}
        {#if tab === 'trade'}
          <TradeDialog symbol={ws.symbol} type={first.kind === 'trade' ? first.type : undefined}
            price={first.kind === 'trade' ? first.price : undefined} amount={first.kind === 'trade' ? first.amount : undefined} />
        {:else if !sym}
          <p class="empty">{t('Enter a symbol under Trade first.')}</p>
        {:else if tab === 'plan'}
          <PlanDialog symbol={sym} portfolio={ws.portfolio} />
        {:else if hasRow}
          <DetailsDialog symbol={sym} portfolio={ws.portfolio} />
        {:else}
          <p class="empty">{sym} {t('has no row in')} {ws.portfolio}.</p>
        {/if}
      {/key}
    </div>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: var(--z-dialog); background: color-mix(in oklab, #060912 62%, transparent); backdrop-filter: blur(3px); animation: fade 0.2s var(--ease); }
  .work { position: fixed; z-index: var(--z-dialog); left: 50%; top: 50%; translate: -50% -50%; width: min(1180px, calc(100vw - 32px)); height: min(92dvh, 900px); display: flex; flex-direction: column; overflow: hidden; background: var(--card); border-radius: 28px; box-shadow: var(--shadow); animation: rise 0.3s var(--ease); }
  @keyframes fade { from { opacity: 0; } }
  @keyframes rise { from { transform: translateY(18px) scale(0.985); opacity: 0; } }
  header { display: flex; align-items: center; gap: var(--sp-4); padding: var(--sp-5) var(--sp-5) var(--sp-4) var(--sp-6); border-bottom: 1px solid var(--line-soft); }
  .who { flex: 1; min-width: 0; }
  .sym { font: 750 28px/1 var(--font-display); letter-spacing: -0.035em; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 3px; }
  .px { text-align: right; }
  .price { font: 650 22px/1.1 var(--font-display); letter-spacing: -0.02em; }
  header .icon-btn { background: var(--wash); }

  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 55fr) minmax(0, 45fr); }
  .context, .task { overflow-y: auto; padding: var(--sp-5) var(--sp-6) calc(var(--sp-6) + env(safe-area-inset-bottom)); }
  .context { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-5); align-content: start; border-right: 1px solid var(--line-soft); }
  .task { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-5); align-content: start; }
  .reveal { display: none; }
  .tabs { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
  .port { width: auto; padding-block: 6px; }
  .facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; }
  .facts div { padding: 0 var(--sp-3); border-left: 1px solid var(--line-soft); min-width: 0; }
  .facts div:first-child { padding-left: 0; border-left: 0; }
  dt { font-size: 12px; color: var(--muted); }
  dd { margin: 2px 0 0; font: 650 17px/1.2 var(--font-display); letter-spacing: -0.02em; white-space: nowrap; }
  .fill { display: grid; gap: 6px; }
  .frow { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 2px var(--sp-3); }
  .track { position: relative; display: block; height: 10px; border-radius: 5px; background: var(--wash); overflow: hidden; }
  .track .held { position: absolute; inset: 0 auto 0 0; background: var(--accent); }
  .track .held.over { background: var(--honey); }
  .track .delta { position: absolute; top: 0; bottom: 0; }
  .track .delta.add { background: color-mix(in oklab, var(--accent) 45%, var(--card)); }
  .track .delta.cut { background: repeating-linear-gradient(135deg, color-mix(in oklab, var(--accent) 55%, var(--card)) 0 3px, transparent 3px 6px); }
  .track .goal { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--ink); }
  p { margin: 0; }
  summary { cursor: pointer; font-size: 14px; color: var(--ink-2); padding-bottom: var(--sp-2); }

  @media (max-width: 1000px) {
    .work { left: 0; right: 0; top: auto; bottom: 0; translate: none; width: 100%; height: 94dvh; border-radius: 24px 24px 0 0; }
    .body { display: block; overflow-y: auto; }
    .context, .task { overflow: visible; padding-inline: var(--sp-4); }
    .context { display: none; border-right: 0; padding-bottom: 0; }
    .context.open { display: grid; }
    .reveal { display: inline-flex; margin: var(--sp-4) var(--sp-4) 0; }
    header { padding-inline: var(--sp-4); }
  }
</style>
