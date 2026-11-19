<script lang="ts">
  // Every portfolio side by side on the whole-account Overview: what each holds, how it moved
  // today, where it stands against cost, and the pre/after-hours move while one is running.
  // Values are each portfolio's stocks only. A portfolio tab's own "value" adds the room left
  // under its limit, and those limits overlap (Trade sits on top of the others), so they can't be
  // summed. Stocks plus the one wallet adds up to the account total exactly.
  import { realizedSales, realizedTotals } from '../../core/analytics.ts';
  import { colorFor, pct, sign, signedPct } from '../../core/format.ts';
  import type { Model } from '../../core/types.ts';
  import { app } from '../../state/app.svelte.ts';
  import Donut from './Donut.svelte';
  import type { Slice } from './Donut.svelte';

  const t = app.t;
  const money = $derived(app.money);
  const all = $derived(app.model);

  function ext(m: Model) {
    const live = m.positions.filter(p => p.ext && p.extPrice != null);
    if (!live.length) return null;
    const dollars = live.reduce((s, p) => s + (p.extPrice! - p.price) * p.qty, 0);
    const base = live.reduce((s, p) => s + p.currentValue, 0);
    return { dollars, pct: base ? dollars / base * 100 : 0 };
  }

  const rows = $derived(app.ports
    .map(name => ({ name, m: app.portModel(name) }))
    .filter(r => r.m.positions.length)
    .map(r => ({
      ...r, ext: ext(r.m), realized: realizedTotals(realizedSales(app.fifo, r.name)),
      color: app.registry.find(p => p.name === r.name)?.color || colorFor(r.name),
      share: all.totalCurrent ? r.m.stockTotal / all.totalCurrent * 100 : 0,
    })));
  const allExt = $derived(ext(all));
  const allRealized = $derived(realizedTotals(realizedSales(app.fifo, 'ALL')));
  const session = $derived(all.positions.find(p => p.ext)?.ext ?? null);
  const cashShare = $derived(all.totalCurrent ? all.cash / all.totalCurrent * 100 : 0);

  // The ring: each portfolio's stocks, then the shared cash, so the slices make up the account total.
  const CASH = '__cash';
  const slices = $derived<Slice[]>([
    ...rows.map(r => ({ key: r.name, label: r.name, value: r.m.stockTotal, color: r.color })),
    ...(all.cash > 0 ? [{ key: CASH, label: t('Cash'), value: all.cash, color: colorFor('Cash') }] : []),
  ]);
  let hover = $state<string | null>(null);
  const centre = (s: Slice | null) => s
    ? { top: s.label, main: pct(all.totalCurrent ? s.value / all.totalCurrent * 100 : 0, 1) }
    : { top: t('Total'), main: money(all.totalCurrent) };
</script>

{#if rows.length > 1}
  <section class="card card-pad ports" aria-label={t('By portfolio')}>
    <div class="card-head">
      <h2 class="card-title">{t('By portfolio')}</h2>
      <span class="card-sub">{t('Stocks in each portfolio; cash is shared')}</span>
    </div>

    <div class="body">
    <div class="ring">
      <Donut {slices} bind:hover title={t('By portfolio')} {centre}
        onpick={s => { if (s.key !== CASH) app.prefs.view = s.key; }} />
    </div>

    <div class="grid" class:has-ext={!!session} role="table">
      <div class="row head" role="row">
        <span role="columnheader">{t('Portfolio')}</span>
        <span role="columnheader" class="n">{t('Value')}</span>
        <span role="columnheader" class="n">{t('Today')}</span>
        <span role="columnheader" class="n">{t('Unrealized')}</span>
        <span role="columnheader" class="n">{t('Realized')}</span>
        {#if session}<span role="columnheader" class="n">{session === 'PRE' ? t('Pre-market') : t('After hours')}</span>{/if}
      </div>
      {#each rows as r (r.name)}
        <button class="row" class:lit={hover === r.name} role="row" onpointerenter={() => hover = r.name} onpointerleave={() => hover = null} onclick={() => app.prefs.view = r.name} title={t('Open this portfolio')}>
          <span class="name" role="cell"><i class="dot" style:background={r.color}></i><span class="strong">{r.name}</span><span class="muted small">{r.m.positions.length}</span></span>
          <span class="n" role="cell" data-label={t('Value')}><span class="strong">{money(r.m.stockTotal)}</span><span class="sub">{pct(r.share, 1)}</span></span>
          <span class="n" role="cell" data-label={t('Today')}>
            {#if r.m.dayChange != null}<span class={sign(r.m.dayChange)}>{money.signed(r.m.dayChange)}</span><span class="sub {sign(r.m.dayChange)}">{signedPct(r.m.dayPct)}</span>{:else}<span class="muted">—</span>{/if}
          </span>
          <span class="n" role="cell" data-label={t('Unrealized')}><span class={sign(r.m.totalPnl)}>{money.signed(r.m.totalPnl)}</span><span class="sub {sign(r.m.totalPnl)}">{signedPct(r.m.totalPnlPct)}</span></span>
          <span class="n" role="cell" data-label={t('Realized')}><span class={sign(r.realized.pnl)}>{money.signed(r.realized.pnl)}</span>{#if r.realized.pct != null}<span class="sub {sign(r.realized.pnl)}">{signedPct(r.realized.pct)}</span>{/if}</span>
          {#if session}
            <span class="n" role="cell" data-label={session === 'PRE' ? t('Pre-market') : t('After hours')}>
              {#if r.ext}<span class={sign(r.ext.dollars)}>{money.signed(r.ext.dollars)}</span><span class="sub {sign(r.ext.dollars)}">{signedPct(r.ext.pct)}</span>{:else}<span class="muted">—</span>{/if}
            </span>
          {/if}
        </button>
      {/each}
      {#if all.cash > 0}
        <!-- svelte-ignore a11y_interactive_supports_focus (hover only mirrors the ring; nothing to activate) -->
        <div class="row cashrow" class:lit={hover === CASH} role="row" onpointerenter={() => hover = CASH} onpointerleave={() => hover = null}>
          <span class="name" role="cell"><i class="dot" style:background={colorFor('Cash')}></i><span>{t('Cash')}</span></span>
          <span class="n" role="cell" data-label={t('Value')}><span>{money(all.cash)}</span><span class="sub">{pct(cashShare, 1)}</span></span>
        </div>
      {/if}
      <div class="row total" role="row">
        <span class="name" role="cell"><span class="strong">{t('Total')}</span></span>
        <span class="n" role="cell" data-label={t('Value')}><span class="strong">{money(all.totalCurrent)}</span></span>
        <span class="n" role="cell" data-label={t('Today')}>
          {#if all.dayChange != null}<span class={sign(all.dayChange)}>{money.signed(all.dayChange)}</span><span class="sub {sign(all.dayChange)}">{signedPct(all.dayPct)}</span>{/if}
        </span>
        <span class="n" role="cell" data-label={t('Unrealized')}><span class={sign(all.totalPnl)}>{money.signed(all.totalPnl)}</span><span class="sub {sign(all.totalPnl)}">{signedPct(all.totalPnlPct)}</span></span>
        <span class="n" role="cell" data-label={t('Realized')}><span class={sign(allRealized.pnl)}>{money.signed(allRealized.pnl)}</span>{#if allRealized.pct != null}<span class="sub {sign(allRealized.pnl)}">{signedPct(allRealized.pct)}</span>{/if}</span>
        {#if session}
          <span class="n" role="cell" data-label={session === 'PRE' ? t('Pre-market') : t('After hours')}>
            {#if allExt}<span class={sign(allExt.dollars)}>{money.signed(allExt.dollars)}</span><span class="sub {sign(allExt.dollars)}">{signedPct(allExt.pct)}</span>{/if}
          </span>
        {/if}
      </div>
    </div>
    </div>
  </section>
{/if}

<style>
  .ports { display: grid; gap: var(--sp-4); }
  /* Two columns: the ring on the left, the figures on the right. */
  .body { display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr); gap: var(--sp-6); align-items: center; }
  .ring { min-width: 0; }
  .grid { display: grid; font-variant-numeric: tabular-nums; min-width: 0; }
  .row.lit { background: var(--sunk); }
  @media (max-width: 860px) { .body { grid-template-columns: minmax(0, 1fr); } .ring { max-width: 240px; width: 100%; margin: 0 auto; } }
  .row {
    display: grid; grid-template-columns: minmax(120px, 1.2fr) repeat(4, minmax(0, 1fr));
    align-items: center; gap: var(--sp-3); padding: 9px 8px; margin: 0 -8px; border-radius: var(--radius-sm);
    text-align: left; font: inherit; color: inherit; width: calc(100% + 16px);
  }
  .has-ext .row { grid-template-columns: minmax(120px, 1.2fr) repeat(5, minmax(0, 1fr)); }
  button.row:hover { background: var(--sunk); }
  .row + .row { border-top: 1px solid var(--line-soft); }
  .head { font-size: 12px; color: var(--muted); padding-block: 4px; }
  .row.row.total { border-top: 1px solid var(--line); }
  .cashrow { color: var(--ink-2); }
  .name { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  .n { display: grid; justify-items: end; text-align: right; font-size: 15px; font-weight: 600; }
  .n .sub { font-size: 12px; font-weight: 500; }
  .head .n { font-size: 12px; font-weight: 500; }

  /* A phone: each portfolio becomes a small block, the name on top and the figures labelled beneath. */
  @media (max-width: 640px) {
    .head { display: none; }
    .row, .has-ext .row { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-2) var(--sp-4); padding-block: 12px; }
    .name { grid-column: 1 / -1; }
    .n { justify-items: start; text-align: left; }
    .n::before { content: attr(data-label); font-size: 11px; font-weight: 500; color: var(--muted); }
  }
</style>
