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
  // Two groups: levels the price has already reached, then the ones it is close to (and drift).
  const groups = $derived.by(() => {
    let room = all ? Infinity : MAX;
    return [
      { id: 'hit', title: t('Reached'), sub: t('the price is at or past the level'), items: app.alerts.filter(a => a.hit) },
      { id: 'near', title: t('Not reached yet'), sub: t('close to a level, or off target'), items: app.alerts.filter(a => !a.hit) },
    ].map(g => { const items = g.items.slice(0, Math.max(0, room)); room -= items.length; return { ...g, items, total: g.items.length }; })
      .filter(g => g.total);
  });
  const showPort = $derived(app.view === ALL && app.ports.length > 1);

  function label(a: PlanAlert) {
    if (a.kind === 'stop') return a.hit ? t('Stop loss reached') : t('Near stop loss');
    if (a.kind === 'profit') return `${t('Sell')} ${a.step} ${a.hit ? t('reached') : t('close')}`;
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
    if (!app.canWrite || a.kind === 'drift') { app.symbol = a.symbol; return; }
    // A planned buy opens the buy form filled in with that entry: its price, and the dollars it buys.
    if (a.kind === 'entry') app.dialog = { kind: 'trade', symbol: a.symbol, type: 'Buy', portfolio: a.portfolio, price: a.level, amount: a.dollars > 0 ? a.dollars : undefined };
    else if (a.hit) app.dialog = { kind: 'trade', symbol: a.symbol, type: 'Sell', portfolio: a.portfolio };
    else app.symbol = a.symbol;
  }
</script>

{#if app.alerts.length}
  <section class="card card-pad">
    <div class="card-head">
      <h2 class="card-title">{t('Needs attention')}</h2>
      <span class="card-sub">{app.alerts.filter(a => a.hit).length} {t('reached')}, {app.alerts.filter(a => !a.hit).length} {t('to watch')}</span>
    </div>
    {#each groups as g (g.id)}
      <div class="group {g.id}">
        <h3><span class="dot"></span>{g.title} <span class="count">{g.total}</span> <span class="small muted">{g.sub}</span></h3>
        <ul>
          {#each g.items as a (a.key)}
            <li>
              <button class:hit={a.hit} onclick={() => act(a)}>
                <Logo sym={a.symbol} size={30} />
                <span class="who"><strong>{a.symbol}</strong>{#if showPort}<span class="muted small">{' '}{a.portfolio}</span>{/if}<span class="small ink2 d">{detail(a)}</span></span>
                <span class="pill {tone(a)}" class:solid={a.hit}>{label(a)}</span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
    {#if app.alerts.length > MAX}
      <button class="btn more" onclick={() => all = !all}>{all ? t('Show fewer') : `${t('Show all')} ${app.alerts.length}`}</button>
    {/if}
  </section>
{/if}

<style>
  .group + .group { margin-top: var(--sp-5); padding-top: var(--sp-4); border-top: 1px solid var(--line-soft); }
  h3 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 var(--sp-2); font: 650 15px/1.2 var(--font-display); letter-spacing: -0.01em; }
  h3 .small { font-family: var(--font); font-weight: 400; }
  .dot { width: 9px; height: 9px; border-radius: 50%; align-self: center; }
  .hit .dot { background: var(--loss); box-shadow: 0 0 0 4px color-mix(in oklab, var(--loss) 20%, transparent); }
  .near .dot { background: var(--honey); }
  .count { padding: 1px 8px; border-radius: 999px; font: 650 12px var(--font); background: var(--wash); color: var(--ink-2); }
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
