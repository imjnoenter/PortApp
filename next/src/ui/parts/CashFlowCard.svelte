<script lang="ts">
  import type { FlowBucket } from '../../core/analytics.ts';
  import { date, monthName, sign } from '../../core/format.ts';
  import { app } from '../../state/app.svelte.ts';
  import Seg from './Seg.svelte';
  import ZeroBars from './ZeroBars.svelte';

  const t = app.t;
  let mode = $state<'w' | 'm'>('w');
  const flow = $derived(app.flow);
  const buckets = $derived(flow ? (mode === 'w' ? flow.weeks : flow.months) : []);

  const name = (b: FlowBucket) => b.key.length > 7 ? date(b.key, true) : `${monthName(Number(b.key.slice(5, 7)) - 1)} ${b.key.slice(2, 4)}`;
  const bars = $derived(buckets.map(b => ({
    v: b.net, hot: b.current, axis: name(b),
    tip: [
      (mode === 'w' ? t('Week of') + ' ' : '') + name(b) + (b.current ? ', ' + t('so far') : ''),
      `${t('Deposited')}  ${app.money.signed(b.deposited)}`,
      `${t('Sold')}  ${app.money.signed(b.sold)}`,
      `${t('Bought')}  ${app.money(-b.bought)}`,
      `${t('Net')}  ${app.money.signed(b.net)}`,
    ].join('\n'),
  })));
  const runwayTone = $derived(flow?.runway == null ? '' : flow.runway < 4 ? 'loss' : flow.runway < 8 ? 'warn' : '');
</script>

{#if flow}
  <section class="card card-pad">
    <div class="card-head">
      <h2 class="card-title">{t('Cash flow')}</h2>
      <span class="card-sub">{t('Sold')} − {t('Bought')}, {t('deposits left out')}, {t('whole account')}</span>
      <span class="spacer"></span>
      <Seg small bind:value={mode} options={[{ value: 'w', label: t('Weekly') }, { value: 'm', label: t('Monthly') }]} />
    </div>

    <div class="facts">
      <div><span class="k">{t('Spendable cash')}</span><span class="v">{app.money(app.limits.spendable)}</span></div>
      <div>
        <span class="k">{t('Avg weekly net')}</span>
        <span class="v {sign(flow.avgNet)}">{app.money.signed(flow.avgNet)}</span>
        {#if flow.avgWeeks}<span class="k">{t('last')} {flow.avgWeeks} {t('complete weeks')}</span>{/if}
      </div>
      <div>
        <span class="k">{t('Runway')}</span>
        <span class="v {runwayTone}">{flow.runway == null ? t('Not drawing down') : `${flow.runway.toFixed(1)} ${t('weeks')}`}</span>
      </div>
    </div>

    <ZeroBars {bars} height={170} />

    <details>
      <summary>{t('Show the numbers')}</summary>
      <div class="table-scroll">
        <table class="tbl">
          <thead><tr><th>{mode === 'w' ? t('Week of') : t('Month')}</th><th class="n">{t('Bought')}</th><th class="n">{t('Sold')}</th><th class="n">{t('Deposited')}</th><th class="n">{t('Net')}</th></tr></thead>
          <tbody>
            {#each [...buckets].reverse() as b (b.key)}
              <tr>
                <td>{name(b)}{#if b.current}{' '}<span class="muted small">{t('so far')}</span>{/if}</td>
                <td class="n">{b.bought ? app.money(b.bought) : ''}</td>
                <td class="n">{b.sold ? app.money(b.sold) : ''}</td>
                <td class="n">{b.deposited ? app.money.signed(b.deposited) : ''}</td>
                <td class="n strong {sign(b.net)}">{b.net ? app.money.signed(b.net) : ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
  </section>
{/if}

<style>
  .facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-4); margin-bottom: var(--sp-4); }
  .facts > div { display: flex; flex-direction: column; gap: 2px; }
  .k { font-size: 13px; color: var(--muted); }
  .v { font: 650 22px/1.2 var(--font-display); letter-spacing: -0.02em; }
  details { margin-top: var(--sp-4); border-top: 1px solid var(--line-soft); padding-top: var(--sp-3); }
  summary { cursor: pointer; color: var(--ink-2); font-size: 13px; }
  details[open] summary { margin-bottom: var(--sp-2); }
  @media (max-width: 600px) { .facts { grid-template-columns: 1fr; gap: var(--sp-3); } }
</style>
