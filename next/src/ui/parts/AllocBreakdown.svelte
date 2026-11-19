<script lang="ts">
  // The Overview's right side on a single portfolio tab: what that portfolio is made of, stock by
  // stock, with its cash as the last slice. A stock opens its window.
  import { colorFor, pct, sign, signedPct } from '../../core/format.ts';
  import { app } from '../../state/app.svelte.ts';
  import Donut from './Donut.svelte';
  import type { Slice } from './Donut.svelte';

  const t = app.t;
  const m = $derived(app.model);
  const money = $derived(app.money);
  const CASH = '\u0000cash';
  let hover = $state<string | null>(null);

  interface Row extends Slice { pnl: number | null; cost: number }
  const rows = $derived.by<Row[]>(() => {
    const out: Row[] = m.positions
      .map(p => ({ key: p.symbol, label: p.symbol, value: p.currentValue, color: colorFor(p.symbol), pnl: p.pnl, cost: p.costBasis }))
      .sort((a, b) => b.value - a.value);
    if (m.cash > 0) out.push({ key: CASH, label: m.limit ? t('Room to buy') : t('Cash'), value: m.cash, color: colorFor('Cash'), pnl: null, cost: 0 });
    return out;
  });
  // One denominator for the ring, the centre and the list.
  const total = $derived(rows.reduce((s, r) => s + r.value, 0));
  const pick = (s: Slice) => { if (s.key !== CASH) app.symbol = s.key; };
  const centre = (s: Slice | null) => s
    ? { top: s.label, main: pct(total ? s.value / total * 100 : 0, 1) }
    : { top: t('Total'), main: money.compact(total) };
</script>

<section class="card card-pad ports" aria-label={t('Allocation')}>
  <div class="card-head">
    <h2 class="card-title">{t('Allocation')}</h2>
  </div>

  <div class="body">
    <div class="ring">
      <Donut slices={rows} bind:hover title={t('Allocation')} {centre} onpick={pick} />
    </div>
    <div class="list table-scroll">
      <table class="tbl">
        <thead><tr><th>{t('Symbol')}</th><th class="n">{t('Value')}</th><th class="n">{t('Weight')}</th><th class="n">{t('Return')}</th></tr></thead>
        <tbody>
          {#each rows as r (r.key)}
            <tr class:click={r.key !== CASH} class:lit={hover === r.key}
              onpointerenter={() => hover = r.key} onpointerleave={() => hover = null} onclick={() => pick(r)}>
              <td>
                <span class="sw" style:background={r.color}></span>
                {#if r.key === CASH}{r.label}{:else}<button class="strong" onclick={e => { e.stopPropagation(); pick(r); }}>{r.label}</button>{/if}
              </td>
              <td class="n">{money(r.value)}</td>
              <td class="n">{pct(total ? r.value / total * 100 : 0, 1)}</td>
              <td class="n {sign(r.pnl)}">{r.pnl == null || !r.cost ? '' : signedPct(r.pnl / r.cost * 100, 1)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</section>

<style>
  .ports { display: grid; gap: var(--sp-3); }
  /* Two columns, as the By portfolio card: the ring on the left, the list on the right. */
  .body { display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr); gap: var(--sp-6); align-items: center; }
  .ring { min-width: 0; }
  .list { max-height: 360px; overflow-y: auto; min-width: 0; }
  .list thead th { position: sticky; top: 0; background: var(--card); z-index: 1; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
  tr.click { cursor: pointer; }
  tr.lit td { background: var(--sunk); }
  @media (max-width: 860px) { .body { grid-template-columns: minmax(0, 1fr); } .ring { max-width: 240px; width: 100%; margin: 0 auto; } }
</style>
