<script lang="ts">
  // What the funds hold: the stocks inside them, and how that changes each stock's real weight.
  import { blendedHoldings, trueExposure } from '../../core/etf.ts';
  import { colorFor, pct } from '../../core/format.ts';
  import { app } from '../../state/app.svelte.ts';
  import Donut from './Donut.svelte';
  import type { Slice } from './Donut.svelte';

  const t = app.t;
  const m = $derived(app.model);
  const money = $derived(app.money);
  const blend = $derived(blendedHoldings(m, app.etf));
  const exposure = $derived(trueExposure(m, app.etf));
  const sectorOf = (sym: string) => app.etfSectors[sym] || app.rows.find(r => r.symbol === sym)?.sector || null;

  // Sectors of the fund money that could be seen. The unseen part is stated beside the chart, not drawn as a slice.
  const sectors = $derived.by(() => {
    const by = new Map<string, number>();
    for (const b of blend.rows) { const s = sectorOf(b.symbol); if (s) by.set(s, (by.get(s) || 0) + b.value); }
    return [...by].sort((a, b) => b[1] - a[1]).map(([name, value]): Slice => ({ key: name, label: name, value, color: colorFor(name) }));
  });
  const classified = $derived(sectors.reduce((s, x) => s + x.value, 0));
</script>

{#if blend.rows.length}
  <section class="card card-pad">
    <div class="card-head">
      <h2 class="card-title">{t('Inside the funds')}</h2>
      <span class="card-sub">{t('Each fund’s published top holdings, weighted by how much of the fund is held')}</span>
    </div>
    <div class="cols">
      <div>
        <table class="tbl">
          <thead><tr><th>{t('Stock')}</th><th class="n">{t('Held through funds')}</th><th class="n">{t('Of fund money')}</th><th>{t('Through')}</th></tr></thead>
          <tbody>
            {#each blend.rows.slice(0, 15) as b (b.symbol)}
              <tr>
                <td><span class="strong">{b.symbol}</span><span class="sub name">{b.name}</span></td>
                <td class="n">{money(b.value)}</td>
                <td class="n ink2">{pct(b.value / blend.fundValue * 100, 1)}</td>
                <td class="ink2 small">{b.via.join(', ')}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="small muted note">{t('Not visible')}: {money(blend.unseen)}, {pct(blend.unseen / blend.fundValue * 100, 0)} {t('of fund money, in holdings below each fund’s top list.')}</p>
      </div>
      {#if sectors.length > 1}
        <div class="donut">
          <Donut slices={sectors} title={t('Sectors seen')} centre={s => s ? { top: s.label, main: pct(s.value / classified * 100, 1) } : { top: t('Sectors seen'), main: money.compact(classified) }} />
        </div>
      {/if}
    </div>
  </section>

  {#if exposure?.rows.some(e => e.direct > 0)}
    <section class="card card-pad">
      <div class="card-head">
        <h2 class="card-title">{t('Real weight of each stock')}</h2>
        <span class="card-sub">{t('Held directly plus held through funds, as a share of this tab')}</span>
      </div>
      <table class="tbl">
        <thead><tr><th>{t('Stock')}</th><th class="n">{t('Directly')}</th><th class="n">{t('Through funds')}</th><th class="n">{t('Together')}</th></tr></thead>
        <tbody>
          {#each exposure.rows.filter(e => e.direct > 0).slice(0, 15) as e (e.symbol)}
            <tr class="click" onclick={() => app.symbol = e.symbol}>
              <td class="strong">{e.symbol}{#if e.hidden}<span class="pill warn">{t('more than it looks')}</span>{/if}</td>
              <td class="n ink2">{pct(e.direct, 1)}</td>
              <td class="n ink2">{pct(e.viaEtf, 1)}</td>
              <td class="n strong">{pct(e.total, 1)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="small muted note">{pct(exposure.unseenPct, 1)} {t('of this tab sits in fund holdings that could not be looked through.')}</p>
    </section>
  {/if}
{/if}

<style>
  .cols { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(220px, 1fr); gap: var(--sp-6); align-items: center; }
  .cols > :only-child { grid-column: 1 / -1; }
  .name { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
  .donut { justify-self: center; width: 100%; max-width: 320px; }
  .note { margin: var(--sp-4) 0 0; }
  .pill.warn { margin-left: 8px; background: color-mix(in oklab, var(--honey) 16%, transparent); color: var(--honey); font-size: 11px; }
  @media (max-width: 860px) { .cols { grid-template-columns: minmax(0, 1fr); } }
</style>
