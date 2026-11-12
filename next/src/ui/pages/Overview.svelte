<script lang="ts">
  import { contribAmounts, dailyBars } from '../../core/analytics.ts';
  import { baht, date, pct, sign, signedPct, usd } from '../../core/format.ts';
  import { ALL } from '../../core/model.ts';
  import { app } from '../../state/app.svelte.ts';
  import CashFlowCard from '../parts/CashFlowCard.svelte';
  import Logo from '../parts/Logo.svelte';
  import MonthlyHeatmap from '../parts/MonthlyHeatmap.svelte';
  import PlanWatch from '../parts/PlanWatch.svelte';
  import Seg from '../parts/Seg.svelte';
  import Stat from '../parts/Stat.svelte';
  import Treemap from '../parts/Treemap.svelte';
  import Upcoming from '../parts/Upcoming.svelte';
  import { drawDayCard } from '../share.ts';
  import ZeroBars from '../parts/ZeroBars.svelte';

  const t = app.t;
  const m = $derived(app.model);
  const money = $derived(app.money);

  let mapMode = $state<'day' | 'total'>('day');

  // Profit against the baht actually paid in, FX move included. Only the whole account has that baseline.
  const usdReturn = $derived(m.totalPnl + app.realized.pnl + app.dividends.net);
  const usdReturnPct = $derived(m.totalInvested ? usdReturn / m.totalInvested * 100 : 0);
  // What was paid in: the baht deposited, less withdrawals (taken out in dollars) at today's rate.
  const bahtReturn = $derived.by(() => {
    if (m.port !== ALL || !app.contribs.length) return null;
    let depositTHB = 0, withdrawUSD = 0;
    for (const c of app.contribs) { const a = contribAmounts(c, app.fx); if (a.thb >= 0) depositTHB += a.thb; else withdrawUSD += -a.usd; }
    const paid = depositTHB - withdrawUSD * app.fx;
    if (!(paid > 0)) return null;
    const gain = m.totalCurrent * app.fx - paid;
    // The part of the baht profit that came from the exchange rate, not from the stocks.
    return { gain, pct: gain / paid * 100, fx: gain / app.fx - usdReturn };
  });
  const signedUsd = (n: number) => (n >= 0 ? '+' : '') + usd(n);

  const days = $derived(dailyBars(app.series, 30, m.dayPct, app.today));
  const dayBars = $derived(days.map(b => ({
    v: b.r, hot: b.today,
    value: Math.abs(b.r).toFixed(1) + (b.today ? '%' : ''),
    tip: `${b.today ? t('Today') : date(b.d)}\n${signedPct(b.r)}`,
  })));
  const upDays = $derived(days.filter(b => b.r > 0).length);

  const moved = $derived(m.positions.filter(p => p.dayChange != null && p.dayChangePct != null));
  const gainers = $derived(moved.filter(p => p.dayChangePct! > 0).sort((a, b) => b.dayChangePct! - a.dayChangePct!).slice(0, 4));
  const losers = $derived(moved.filter(p => p.dayChangePct! < 0).sort((a, b) => a.dayChangePct! - b.dayChangePct!).slice(0, 4));

  let drawing = $state(false);
  async function shareDay() {
    if (m.dayPct == null || m.dayChange == null || drawing) return;
    drawing = true;
    try {
      const row = (p: (typeof moved)[number]) => ({ symbol: p.symbol, pct: p.dayChangePct!, dollars: p.dayChange! * p.qty });
      const blob = await drawDayCard({
        name: app.profile?.profileName || 'Portfolio', day: app.today,
        dayChange: m.dayChange, dayPct: m.dayPct, fx: app.fx, spxPct: app.quotes['^GSPC']?.changePct ?? null,
        bars: dailyBars(app.series, 20, m.dayPct, app.today).map(b => ({ r: b.r, today: b.today })),
        up: gainers.slice(0, 3).map(row), down: losers.slice(0, 3).map(row),
        value: m.totalCurrent, unrealizedPct: m.totalPnlPct,
        // The same two figures as the Total return card: profit against the baht paid in when that
        // is known, otherwise the dollar return converted, and the card says which.
        ...(bahtReturn ? { bahtReturn: bahtReturn.gain, bahtPct: bahtReturn.pct, bahtNote: 'paid-in' as const }
          : { bahtReturn: usdReturn * app.fx, bahtPct: usdReturnPct, bahtNote: 'converted' as const }),
      });
      app.dialog = { kind: 'share', blob, name: `portfolio-${app.today}.png` };
    } finally { drawing = false; }
  }

  // ── Extended hours: the move since the last regular close, for the holdings that have a price ──
  const extended = $derived.by(() => {
    const live = m.positions.filter(p => p.ext && p.extPrice != null && p.extPct != null);
    if (!live.length) return null;
    const dollars = live.reduce((s, p) => s + (p.extPrice! - p.price) * p.qty, 0);
    const base = live.reduce((s, p) => s + p.currentValue, 0);
    const by = (dir: 1 | -1) => live.filter(p => dir * p.extPct! > 0).sort((a, b) => dir * (b.extPct! - a.extPct!)).slice(0, 4);
    return { pre: live[0].ext === 'PRE', dollars, pct: base ? dollars / base * 100 : 0, count: live.length, value: m.totalCurrent + dollars, up: by(1), down: by(-1) };
  });

  const top3 = $derived(m.positions.slice(0, 3).reduce((s, p) => s + p.stockWeightPct, 0));
  const num = (n: number | null | undefined, dp = 2) => n == null ? '—' : n.toFixed(dp);
</script>

<div class="page">
  <section class="hero">
    <div class="worth">
      <h1>{m.port === ALL ? t('Portfolio value') : `${m.port} ${t('value')}`}</h1>
      <div class="value">{money(m.totalCurrent)}</div>
      <div class="day">
        {#if m.dayChange != null}
          <span class={sign(m.dayChange)}>{money.signed(m.dayChange)} ({signedPct(m.dayPct)})</span>
          <span class="muted">{t('today')}</span>
          <button class="btn shareday" onclick={shareDay} disabled={drawing}>{t('Share today')}</button>
        {:else}
          <span class="muted">{t('Waiting for today’s prices')}</span>
        {/if}
      </div>
      {#if extended}
        <div class="ext">
          <span class="muted">{extended.pre ? t('Pre-market') : t('After hours')}</span>
          <span class={sign(extended.dollars)}>{money.signed(extended.dollars)} ({signedPct(extended.pct)})</span>
          <span class="muted">{t('would make it')} {money(extended.value)}</span>
        </div>
      {/if}
      <dl class="split">
        <div><dt>{t('In stocks')}</dt><dd>{money(m.stockTotal)}</dd></div>
        <div><dt>{m.limit ? t('Room to buy') : t('Cash')}</dt><dd>{money(m.cash)}</dd></div>
        <div><dt>{t('Cost of holdings')}</dt><dd>{money(m.costTotal)}</dd></div>
        <div><dt>{t('Holdings')}</dt><dd>{m.positions.length}</dd></div>
      </dl>
    </div>

    <div class="mapbox">
      <div class="maphead">
        <Seg small label={t('Colour tiles by')} bind:value={mapMode} options={[{ value: 'day', label: t('Today') }, { value: 'total', label: t('Since bought') }]} />
        <span class="spacer"></span>
        <span class="scale" aria-hidden="true">
          <span>{mapMode === 'day' ? '−3%' : '−30%'}</span><i></i><span>{mapMode === 'day' ? '+3%' : '+30%'}</span>
        </span>
      </div>
      <div class="mapfit"><Treemap positions={m.positions} mode={mapMode} /></div>
    </div>
  </section>

  <PlanWatch />

  <section class="figures" aria-label={t('Returns')}>
    <Stat label={t('Unrealized')} value={money.signed(m.totalPnl)} tone={sign(m.totalPnl)} badge={signedPct(m.totalPnlPct)}>
      {t('Against what the held shares cost')}
    </Stat>
    <Stat label={t('Realized')} value={money.signed(app.realized.pnl)} tone={sign(app.realized.pnl)} badge={app.realized.pct == null ? '' : signedPct(app.realized.pct)}>
      {t('On cost sold')} {money(app.realized.cost)}, {t('fees')} {money(app.realized.fee)}
    </Stat>
    <Stat label={t('Dividends')} value={money(app.dividends.net)}>
      {t('After withholding')}. {t('Gross')} {money(app.dividends.gross)}
    </Stat>
    {#if bahtReturn}
      <Stat label={t('Total return')} value={signedUsd(usdReturn)} note={`(${signedUsd(bahtReturn.fx)})`} tone={sign(usdReturn)}
        badge={`${bahtReturn.gain >= 0 ? '+' : ''}${baht(bahtReturn.gain)} (${signedPct(bahtReturn.pct)})`} badgeTone={sign(bahtReturn.gain)}>
        {t('Unrealized P/L')} + {t('Realized P/L')} + {t('Dividends')}
      </Stat>
    {:else}
      <Stat label={t('Total return')} value={money.signed(usdReturn)} tone={sign(usdReturn)} badge={signedPct(usdReturnPct)}>
        {t('Unrealized P/L')} + {t('Realized P/L')} + {t('Dividends')}
      </Stat>
    {/if}
    <Stat label={t('Annualised IRR')} value={app.irr ? signedPct(app.irr.rate) : '—'} tone={app.irr ? sign(app.irr.rate) : ''}>
      {#if app.irr}{t('Money-weighted')}, {app.irr.years.toFixed(1)} {t('years')}{:else}{t('Needs the trade ledger')}{/if}
    </Stat>
    {#if m.limit}
      <Stat label={t('Limit')} value={money(m.limit.dollar)} tone={m.limit.over > 0 ? 'loss' : ''} badge={`${pct(m.limit.pct * 100, 0)} ${t('of the account')}`}>
        {#if m.limit.over > 0}<span class="loss">{t('Over by')} {money(m.limit.over)}</span>
        {:else}{t('Used')} {money(m.limit.used)}{#if m.limit.unfunded > 0}, <span class="warn">{money(m.limit.unfunded)} {t('unfunded')}</span>{/if}{/if}
      </Stat>
    {:else}
      <Stat label={t('Cash')} value={money(m.cash)} badge={m.totalCurrent ? `${pct(m.cash / m.totalCurrent * 100, 1)} ${t('of the account')}` : ''}>
        {t('Reserve')} {money(app.limits.reserve)} ({pct(app.limits.reservePct * 100, 0)}), {t('spendable')} {money(app.limits.spendable)}
      </Stat>
    {/if}
  </section>

  <div class="pair wide-left">
    {#if days.length >= 5}
      <section class="card card-pad">
        <div class="card-head">
          <h2 class="card-title">{t('Daily returns')}</h2>
          <span class="card-sub">{days.length} {t('trading days')}, {upDays} {t('up')} {t('and')} {days.length - upDays} {t('down')}</span>
        </div>
        <ZeroBars bars={dayBars} height={170} />
      </section>
    {/if}

    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">{t('Today’s movers')}</h2></div>
      {#if gainers.length || losers.length}
        <div class="movers">
          {#each [gainers, losers] as list, i}
            <ul>
              {#each list as p (p.symbol)}
                <li>
                  <button onclick={() => app.symbol = p.symbol}>
                    <Logo sym={p.symbol} size={28} />
                    <span class="strong">{p.symbol}</span>
                    <span class="spacer"></span>
                    <span class="ink2 small">{money.signed(p.dayChange! * p.qty)}</span>
                    <span class="mv {sign(p.dayChangePct)}">{signedPct(p.dayChangePct)}</span>
                  </button>
                </li>
              {:else}
                <li class="muted small none">{i ? t('Nothing down today') : t('Nothing up today')}</li>
              {/each}
            </ul>
          {/each}
        </div>
      {:else}
        <p class="empty">{t('Waiting for today’s prices')}</p>
      {/if}
    </section>
  </div>

  {#if extended}
    <section class="card card-pad">
      <div class="card-head">
        <h2 class="card-title">{extended.pre ? t('Pre-market') : t('After hours')}</h2>
        <span class="card-sub">{t('Against the last regular close')}, {extended.count} {t('of')} {m.positions.length} {t('holdings have a price')}</span>
        <span class="spacer"></span>
        <strong class="extsum {sign(extended.dollars)}">{money.signed(extended.dollars)} ({signedPct(extended.pct)})</strong>
      </div>
      <div class="movers two">
        {#each [extended.up, extended.down] as list, i}
          <ul>
            {#each list as p (p.symbol)}
              <li>
                <button onclick={() => app.symbol = p.symbol}>
                  <Logo sym={p.symbol} size={28} />
                  <span class="strong">{p.symbol}</span>
                  <span class="ink2 small">{usd(p.extPrice)}</span>
                  <span class="spacer"></span>
                  <span class="small {sign(p.extPct)}">{money.signed((p.extPrice! - p.price) * p.qty)}</span>
                  <span class="mv {sign(p.extPct)}">{signedPct(p.extPct)}</span>
                </button>
              </li>
            {:else}
              <li class="muted small none">{i ? t('Nothing down') : t('Nothing up')}</li>
            {/each}
          </ul>
        {/each}
      </div>
    </section>
  {/if}

  <Upcoming />

  <MonthlyHeatmap />

  <div class="pair">
    <CashFlowCard />

    <section class="card card-pad">
      <div class="card-head">
        <h2 class="card-title">{t('Risk')}</h2>
        {#if app.risk}<span class="card-sub">{t('vs S&P 500')}, {app.risk.days} {t('trading days')}</span>{/if}
      </div>
      <dl class="risk">
        <div><dt>{t('Largest position')}</dt><dd>{m.positions[0] ? `${m.positions[0].symbol} ${pct(m.positions[0].stockWeightPct, 1)}` : '—'}</dd></div>
        <div><dt>{t('Top 3')}</dt><dd>{m.positions.length ? pct(top3, 1) : '—'}</dd></div>
        <div><dt>{t('Volatility')}</dt><dd>{app.risk ? pct(app.risk.volAnn, 1) : '—'}</dd></div>
        <div><dt>{t('Max drawdown')}</dt><dd>{app.risk ? pct(-Math.abs(app.risk.maxDD), 1) : '—'}</dd></div>
        <div><dt>{t('Sharpe')}</dt><dd>{num(app.risk?.sharpe)}</dd></div>
        <div><dt>{t('Beta')}</dt><dd>{num(app.risk?.beta)}</dd></div>
        <div><dt>{t('Alpha')}</dt><dd class={sign(app.risk?.alpha)}>{app.risk?.alpha == null ? '—' : signedPct(app.risk.alpha, 1)}</dd></div>
      </dl>
    </section>
  </div>
</div>

<style>
  .page { gap: var(--sp-7); }

  /* The hero is unboxed: the number sits straight on the page, the map is the picture beside it. */
  .hero { display: grid; grid-template-columns: minmax(280px, 0.8fr) minmax(0, 1.7fr); gap: var(--sp-7); align-items: stretch; }
  .worth { container-type: inline-size; display: flex; flex-direction: column; min-width: 0; }
  h1 { font-size: 15px; font-weight: 500; color: var(--ink-2); }
  .value { font: 750 clamp(34px, 15cqi, 76px)/1 var(--font-display); letter-spacing: -0.045em; margin: var(--sp-3) 0 var(--sp-3); white-space: nowrap; }
  .day { font-size: 17px; font-weight: 500; display: flex; flex-wrap: wrap; gap: 0 8px; }
  .shareday { margin-left: auto; padding: 5px 13px; font-size: 12px; }
  .ext { margin-top: var(--sp-2); font-size: 14px; font-weight: 500; display: flex; flex-wrap: wrap; gap: 0 8px; }
  .extsum { font: 650 18px/1.2 var(--font-display); letter-spacing: -0.02em; }
  .movers.two { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-6); }
  .movers.two ul + ul { padding-top: 0; border-top: 0; }
  @media (max-width: 700px) { .movers.two { grid-template-columns: minmax(0, 1fr); gap: var(--sp-4); } }
  .split { margin: auto 0 0; padding-top: var(--sp-7); }
  .split div { display: flex; justify-content: space-between; align-items: baseline; gap: var(--sp-4); padding: 11px 0; border-top: 1px solid var(--line); }
  dt { color: var(--ink-2); font-size: 14px; }
  dd { margin: 0; font-weight: 600; font-size: 15px; }

  .mapbox { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
  .maphead { display: flex; align-items: center; gap: var(--sp-3); }
  .mapfit { flex: 1; min-height: clamp(300px, 36vw, 460px); display: flex; }
  .scale { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
  .scale i { width: 96px; height: 8px; border-radius: 4px; background: linear-gradient(90deg, var(--loss-fill), var(--tile), var(--gain-fill)); }

  .figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: var(--sp-6) 0; padding: var(--sp-5) 0; border-block: 1px solid var(--line); }
  .figures > :global(.stat) { padding-left: var(--sp-5); border-left: 1px solid var(--line); }

  .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-5); align-items: start; }
  .pair.wide-left { grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); align-items: stretch; }
  .pair > :global(:only-child) { grid-column: 1 / -1; }

  .movers { display: grid; gap: var(--sp-4); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; align-content: start; }
  ul + ul { padding-top: var(--sp-4); border-top: 1px solid var(--line-soft); }
  li button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px; margin: 0 -6px; border-radius: var(--radius-sm); text-align: left; }
  li button:hover { background: var(--sunk); }
  .mv { font-weight: 600; min-width: 4.4em; text-align: right; }
  .none { padding: 6px 0; }

  .risk { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: var(--sp-5) var(--sp-4); margin: 0; }
  .risk dt { font-size: 13px; color: var(--muted); }
  .risk dd { font: 650 22px/1.2 var(--font-display); letter-spacing: -0.02em; margin-top: 2px; }

  @media (max-width: 960px) {
    .hero, .pair, .pair.wide-left { grid-template-columns: minmax(0, 1fr); }
    .split { padding-top: var(--sp-5); }
    .mapfit { min-height: 340px; }
  }
  @media (max-width: 520px) { .scale i { width: 56px; } }
</style>
