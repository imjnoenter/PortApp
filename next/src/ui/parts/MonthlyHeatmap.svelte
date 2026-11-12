<script lang="ts">
  import { monthName, sign, signedPct } from '../../core/format.ts';
  import { app } from '../../state/app.svelte.ts';
  import { tip } from '../tip.ts';

  const t = app.t;
  const data = $derived(app.monthly);

  // Saturates at a fixed ±20% so a colour means the same thing in every year.
  const fill = (r: number | null) => r == null ? 'transparent'
    : `color-mix(in oklab, var(--${r >= 0 ? 'gain' : 'loss'}) ${(Math.min(Math.abs(r) / 0.2, 1) * 60).toFixed(0)}%, var(--card))`;
  const cell = (r: number | null) => r == null ? '' : (r * 100).toFixed(1).replace(/\.0$/, '') + '%';
</script>

<section class="card card-pad">
  <div class="card-head">
    <h2 class="card-title">{t('Monthly returns')}</h2>
    <span class="card-sub">{t('Time-weighted, deposits stripped out')}</span>
  </div>
  {#if data}
    <div class="table-scroll">
      <table>
        <thead>
          <tr><th>{t('Year')}</th>{#each { length: 12 } as _, m}<th>{monthName(m)}</th>{/each}<th class="yr">{t('Total')}</th></tr>
        </thead>
        <tbody>
          {#each data.years as y (y.year)}
            <tr>
              <th>{y.year}</th>
              {#each y.months as r, m}
                <td style:background={fill(r)} use:tip={r == null ? null : `${monthName(m)} ${y.year}\n${signedPct(r * 100)}`}>{cell(r)}</td>
              {/each}
              <td class="yr {sign(y.yearTotal)}">{y.yearTotal == null ? '' : signedPct(y.yearTotal * 100, 1)}</td>
            </tr>
          {/each}
          {#if data.years.length > 1}
            <tr class="avg">
              <th>{t('Avg')}</th>
              {#each data.avgMonths as r}<td class={sign(r)}>{r == null ? '' : signedPct(r * 100, 1)}</td>{/each}
              <td class="yr {sign(data.avgYear)}">{data.avgYear == null ? '' : signedPct(data.avgYear * 100, 1)}</td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="empty">{t('Needs about a month of price history.')}</p>
  {/if}
</section>

<style>
  table { width: 100%; min-width: 640px; border-collapse: separate; border-spacing: 3px; table-layout: fixed; font-size: 13px; }
  th { font-weight: 500; color: var(--muted); font-size: 12px; padding: 4px 0; text-align: center; }
  tbody th { text-align: left; color: var(--ink-2); width: 3.2rem; }
  thead th:first-child { text-align: left; width: 3.2rem; }
  td { text-align: center; padding: 11px 0; border-radius: 8px; color: var(--ink); font-weight: 500; }
  .yr { font-weight: 600; width: 4.2rem; }
  .avg td, .avg th { padding-top: 10px; font-weight: 500; }
</style>
