<script lang="ts">
  // Plan levels the price has reached or is close to, and holdings that have drifted off target.
  import type { PlanAlert } from '../../core/alerts.ts';
  import { pct, usd } from '../../core/format.ts';
  import { ALL } from '../../core/model.ts';
  import { app } from '../../state/app.svelte.ts';
  import Logo from './Logo.svelte';

  const t = app.t;
  const MAX = 8;
  let all = $state(false);
  const list = $derived(all ? app.alerts : app.alerts.slice(0, MAX));
  const showPort = $derived(app.view === ALL && app.ports.length > 1);

  function label(a: PlanAlert) {
    if (a.kind === 'stop') return a.hit ? t('Stop loss reached') : t('Near stop loss');
    if (a.kind === 'profit') return `${t('Take profit')} ${a.step} ${a.hit ? t('reached') : t('close')}`;
    if (a.kind === 'entry') return `${t('Buy')} ${a.step} ${a.hit ? t('reached') : t('close')}`;
    return a.gap > 0 ? t('Over target') : t('Under target');
  }
  function detail(a: PlanAlert) {
    const gap = pct(Math.abs(a.gap), 1);
    if (a.kind === 'drift') return `${gap} ${a.gap > 0 ? t('above') : t('below')} ${t('target value')}, ${a.gap > 0 ? t('trim') : t('add')} ${app.money(a.dollars)}`;
    const side = a.gap >= 0 ? t('above') : t('below');
    return `${t('Level')} ${usd(a.level)}, ${t('price is')} ${gap} ${side}${a.kind === 'entry' && a.dollars > 0 ? `, ${t('buys')} ${usd(a.dollars)}` : ''}`;
  }
  const tone = (a: PlanAlert) => a.kind === 'stop' ? 'loss' : a.kind === 'profit' ? 'gain' : a.kind === 'entry' ? 'accent' : 'warn';
  function act(a: PlanAlert) {
    if (app.canWrite && a.hit && a.kind !== 'drift') app.dialog = { kind: 'trade', symbol: a.symbol, type: a.kind === 'entry' ? 'Buy' : 'Sell' };
    else app.symbol = a.symbol;
  }
</script>

{#if app.alerts.length}
  <section class="card card-pad">
    <div class="card-head">
      <h2 class="card-title">{t('Needs attention')}</h2>
      <span class="card-sub">{app.alerts.filter(a => a.hit).length} {t('reached')}, {app.alerts.filter(a => !a.hit).length} {t('to watch')}</span>
    </div>
    <ul>
      {#each list as a (a.key)}
        <li>
          <button class:hit={a.hit} onclick={() => act(a)}>
            <Logo sym={a.symbol} size={30} />
            <span class="who"><strong>{a.symbol}</strong>{#if showPort}<span class="muted small"> {a.portfolio}</span>{/if}<span class="small ink2 d">{detail(a)}</span></span>
            <span class="pill {tone(a)}" class:solid={a.hit}>{label(a)}</span>
          </button>
        </li>
      {/each}
    </ul>
    {#if app.alerts.length > MAX}
      <button class="btn more" onclick={() => all = !all}>{all ? t('Show fewer') : `${t('Show all')} ${app.alerts.length}`}</button>
    {/if}
  </section>
{/if}

<style>
  ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 2px var(--sp-5); }
  li button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px; margin: 0 -8px; border-radius: var(--radius-sm); text-align: left; }
  li button:hover { background: var(--sunk); }
  .who { flex: 1; min-width: 0; }
  .d { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pill { white-space: nowrap; }
  .pill.accent { background: var(--accent-soft); color: var(--accent-ink); }
  .pill.warn { background: color-mix(in oklab, var(--honey) 16%, transparent); color: var(--honey); }
  .pill.solid.loss { background: var(--loss); color: #fff; }
  .pill.solid.gain { background: var(--gain); color: var(--card); }
  .pill.solid.accent { background: var(--accent); color: #fff; }
  .more { margin-top: var(--sp-3); }
  @media (max-width: 520px) { ul { grid-template-columns: minmax(0, 1fr); } }
</style>
