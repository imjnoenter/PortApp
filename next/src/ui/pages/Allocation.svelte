<script lang="ts">
  import { colorFor, pct, sign, signedPct } from '../../core/format.ts';
  import { ALL, targetDollar } from '../../core/model.ts';
  import type { Position } from '../../core/types.ts';
  import { app } from '../../state/app.svelte.ts';
  import Donut from '../parts/Donut.svelte';
  import LookThrough from '../parts/LookThrough.svelte';
  import type { Slice } from '../parts/Donut.svelte';
  import Seg from '../parts/Seg.svelte';
  import { tip } from '../tip.ts';

  const t = app.t;
  const m = $derived(app.model);
  const money = $derived(app.money);

  type Field = 'symbol' | 'sector' | 'industry' | 'category' | 'custom' | 'myGroup';
  const FIELDS: { value: Field; label: string }[] = [
    { value: 'symbol', label: 'Symbol' }, { value: 'sector', label: 'Sector' }, { value: 'industry', label: 'Industry' },
    { value: 'category', label: 'Category' }, { value: 'custom', label: 'Custom' }, { value: 'myGroup', label: 'My group' },
  ];
  let field = $state<Field>('sector');
  let drill = $state<string | null>(null);
  let hover = $state<string | null>(null);
  const CASH = '\u0000cash';

  interface Row extends Slice { pnl: number | null; cost: number; count: number }
  const keyOf = (p: Position, f: Field) => f === 'symbol' ? p.symbol : p[f] || 'Other';

  const rows = $derived.by<Row[]>(() => {
    const by: Field = drill != null ? 'symbol' : field;
    const src = drill != null ? m.positions.filter(p => keyOf(p, field) === drill) : m.positions;
    const map = new Map<string, Row>();
    for (const p of src) {
      const k = keyOf(p, by);
      let r = map.get(k);
      if (!r) map.set(k, r = { key: k, label: k === 'Other' && by !== 'symbol' ? t('Other') : k, value: 0, color: colorFor(k), pnl: 0, cost: 0, count: 0 });
      r.value += p.currentValue; r.pnl! += p.pnl; r.cost += p.costBasis; r.count++;
    }
    const out = [...map.values()].sort((a, b) => b.value - a.value);
    // Cash has nothing inside it to drill into, so it only joins the top level.
    if (drill == null && app.prefs.inclCash && m.cash > 0) {
      out.push({ key: CASH, label: m.limit ? t('Room to buy') : t('Cash'), value: m.cash, color: colorFor('Cash'), pnl: null, cost: 0, count: 0 });
    }
    return out;
  });
  // One denominator for the ring, the centre and the legend.
  const total = $derived(rows.reduce((s, r) => s + r.value, 0));
  const canDrill = $derived(field !== 'symbol' && drill == null);

  function pick(s: Slice) {
    if (s.key === CASH) return;
    if (canDrill) { drill = s.key; hover = null; }
    else app.symbol = s.key;
  }
  const centre = (s: Slice | null) => s
    ? { top: s.label, main: pct(total ? s.value / total * 100 : 0, 1) }
    : { top: drill != null ? drill : t('Total'), main: money.compact(total) };

  // Targets are stored per portfolio. On a portfolio tab they are that portfolio's own; in the
  // combined view the model has already restated each as a share of the whole account.
  const targets = $derived.by(() => {
    const held = m.positions.map(p => ({ symbol: p.symbol, now: p.investWeightPct, target: (p.target || 0) * 100, value: p.currentValue, want: targetDollar(p, m) }));
    const watched = m.watchlist.filter(w => (w.target || 0) > 0).map(w => ({ symbol: w.symbol, now: 0, target: w.target! * 100, value: 0, want: targetDollar(w, m) }));
    return [...held, ...watched].filter(r => r.target > 0 || r.now > 0).sort((a, b) => b.target - a.target || b.now - a.now);
  });
  const scale = $derived(Math.max(1, ...targets.map(r => Math.max(r.now, r.target))));
  const planned = $derived(targets.reduce((s, r) => s + r.target, 0));
</script>

<div class="page">
  <header class="page-head">
    <h1 class="page-title">{t('Allocation')}</h1>
    <span class="page-count">{money.compact(total)} {t('across')} {m.positions.length} {t('holdings')}</span>
  </header>

  <section class="card card-pad">
    <div class="card-head">
      <h2 class="card-title">{t('Breakdown')}</h2>
      <span class="spacer"></span>
      <label class="check"><input type="checkbox" bind:checked={app.prefs.inclCash}> {t('Include cash')}</label>
      <Seg small label={t('Group by')} options={FIELDS.map(f => ({ value: f.value, label: t(f.label) }))} bind:value={field} onchange={() => { drill = null; hover = null; }} />
    </div>

    {#if rows.length}
      <div class="split">
        <div>
          <Donut slices={rows} bind:hover title={t('Breakdown')} {centre} onpick={pick}
            onback={drill != null ? () => { drill = null; hover = null; } : undefined} backLabel={`${t('Back to')} ${t(FIELDS.find(f => f.value === field)!.label)}`} />
          {#if drill != null}
            <div class="back"><button class="btn" onclick={() => { drill = null; hover = null; }}>{t('Back to')} {t(FIELDS.find(f => f.value === field)!.label)}</button></div>
          {/if}
        </div>
        <div class="table-scroll legend">
          <table class="tbl">
            <thead><tr><th>{drill != null ? drill : t(FIELDS.find(f => f.value === field)!.label)}</th><th class="n">{t('Value')}</th><th class="n">{t('Weight')}</th><th class="n">{t('Return')}</th></tr></thead>
            <tbody>
              {#each rows as r (r.key)}
                <tr class:click={r.key !== CASH} class:lit={hover === r.key}
                  onpointerenter={() => hover = r.key} onpointerleave={() => hover = null} onclick={() => pick(r)}>
                  <td>
                    <span class="sw" style:background={r.color}></span>
                    {#if r.key === CASH}{r.label}{:else}<button class="strong" onclick={e => { e.stopPropagation(); pick(r); }}>{r.label}</button>{/if}
                    {#if canDrill && r.count}<span class="muted small"> {r.count}</span>{/if}
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
    {:else}
      <p class="empty">{t('No holdings in this portfolio yet.')}</p>
    {/if}
  </section>

  <section class="card card-pad">
    <div class="card-head">
      <h2 class="card-title">{t('Targets')}</h2>
      {#if targets.length}<span class="card-sub">{pct(planned, 1)} {t('planned')}, {pct(Math.max(0, 100 - planned), 1)} {t('unallocated')}</span>{/if}
      {#if app.canWrite}
        <span class="spacer"></span>
        <button class="btn" onclick={() => app.dialog = { kind: 'targets', portfolio: app.homePort('') }}>{t('Edit targets')}</button>
      {/if}
    </div>
    {#if m.port === ALL && targets.length}
      <p class="small muted allnote">{t('Each target here is its share of the whole account: every portfolio’s target for the stock, in dollars, added up. Targets are still set per portfolio.')}{#if planned > 100.5} {t('They can pass 100% because the portfolios’ cash overlaps.')}{/if}</p>
    {/if}
    {#if targets.length}
      <div class="key small muted"><span class="kbar"></span>{t('Now')}<span class="ktick"></span>{t('Target')}</div>
      <div class="table-scroll">
        <table class="tbl">
          <thead><tr><th>{t('Symbol')}</th><th class="wide"></th><th class="n">{t('Now')}</th><th class="n">{t('Target')}</th><th class="n">{t('Gap')}</th></tr></thead>
          <tbody>
            {#each targets as r (r.symbol)}
              {@const gap = r.want - r.value}
              <tr class="click" onclick={() => app.symbol = r.symbol}>
                <td><button class="strong" onclick={e => { e.stopPropagation(); app.symbol = r.symbol; }}>{r.symbol}</button></td>
                <td class="wide">
                  <div class="tbar" use:tip={`${r.symbol}\n${t('Now')} ${pct(r.now, 2)}\n${t('Target')} ${pct(r.target, 2)}`}>
                    <span class="fill" style:width="{r.now / scale * 100}%"></span>
                    {#if r.target > 0}<span class="tick" style:left="{r.target / scale * 100}%"></span>{/if}
                  </div>
                </td>
                <td class="n">{pct(r.now, 1)}</td>
                <td class="n">{r.target > 0 ? pct(r.target, 1) : '—'}</td>
                <td class="n ink2">{r.target > 0 ? (gap >= 0 ? t('Buy') : t('Trim')) + ' ' + money(Math.abs(gap)) : ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="empty">{t('No targets set in this portfolio.')}</p>
    {/if}
  </section>

  <LookThrough />
</div>

<style>
  .allnote { margin: 0 0 var(--sp-4); max-width: 78ch; }
  .split { display: grid; grid-template-columns: minmax(240px, 380px) minmax(0, 1fr); gap: var(--sp-6); align-items: center; }
  .legend { max-height: 420px; overflow-y: auto; }
  .legend thead th { position: sticky; top: 0; background: var(--card); z-index: 1; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
  tr.lit td { background: var(--sunk); }
  .back { text-align: center; margin-top: var(--sp-3); }
  .check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink-2); cursor: pointer; }
  .check input { accent-color: var(--ink); }
  .wide { width: 45%; min-width: 140px; }
  .tbar { position: relative; height: 10px; border-radius: 5px; background: var(--wash); }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 5px; background: var(--ink); }
  .tick { position: absolute; top: -5px; bottom: -5px; width: 3px; margin-left: -1.5px; border-radius: 2px; background: var(--accent); }
  .key { display: flex; align-items: center; gap: 6px; margin-bottom: var(--sp-2); }
  .kbar { width: 16px; height: 8px; border-radius: 4px; background: var(--ink); }
  .ktick { width: 3px; height: 14px; border-radius: 2px; background: var(--accent); margin-left: var(--sp-3); }
  @media (max-width: 820px) { .split { grid-template-columns: minmax(0, 1fr); } }
</style>
