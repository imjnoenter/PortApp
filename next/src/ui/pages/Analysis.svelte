<script lang="ts">
  import { benchmark } from '../../core/analytics.ts';
  import { groupPnl } from '../../core/insights.ts';
  import { PALETTE, date, pct, sign, signedPct } from '../../core/format.ts';
  import { NASDAQ, app } from '../../state/app.svelte.ts';
  import LineChart from '../parts/LineChart.svelte';
  import Seg from '../parts/Seg.svelte';
  import { tip } from '../tip.ts';

  const t = app.t;
  const m = $derived(app.model);
  const money = $derived(app.money);
  const num = (n: number | null | undefined, dp = 2) => n == null ? '—' : n.toFixed(dp);

  // ── Against the market. The sums live in core/analytics (benchmark); this only picks the window. ──
  type Range = '3M' | '6M' | '1Y' | 'All';
  const SPAN: Record<Range, number> = { '3M': 63, '6M': 126, '1Y': 252, All: 0 };
  let range = $state<Range>('1Y');
  const bench = $derived(app.series ? benchmark(app.series, SPAN[range], app.nasdaq && { idx: app.nasdaq, sym: NASDAQ }) : null);
  const benchLines = $derived(bench ? [
    { name: t('Portfolio'), color: 'var(--accent)', values: bench.portfolio },
    { name: 'S&P 500', color: 'var(--muted)', values: bench.spy, dashed: true },
    ...(bench.other ? [{ name: 'Nasdaq 100', color: PALETTE[1], values: bench.other, dashed: true }] : []),
  ] : []);
  /** Where the window ends: the portfolio's lead over each yardstick, in percentage points. */
  const lead = $derived.by(() => {
    if (!bench) return null;
    const end = bench.portfolio.length - 1, mine = bench.portfolio[end];
    return { spy: mine - bench.spy[end], nasdaq: bench.other ? mine - bench.other[end] : null, since: bench.dates[0] };
  });
  const points = (n: number) => `${Math.abs(n).toFixed(1)} ${t('points')} ${n >= 0 ? t('ahead of') : t('behind')}`;
  // The sheet only has Nasdaq prices if QQQ is held or watched. Otherwise ask for them, once.
  $effect(() => { if (app.series) app.ensureNasdaq(); });
  const worth = $derived.by(() => {
    const w = app.worth;
    if (!w) return null;
    const from = SPAN[range] ? Math.max(0, w.dates.length - SPAN[range]) : 0;
    return { dates: w.dates.slice(from), value: w.value.slice(from), invested: w.invested.slice(from) };
  });

  // ── Result per holding ──
  let perfTab = $state<'all' | 'up' | 'down'>('all');
  let perfUnit = $state<'money' | 'pct'>('money');
  const perf = $derived(app.perf.filter(h => perfTab === 'all' || (perfTab === 'up' ? h.total > 0 : h.total < 0)));
  const perfVal = (h: (typeof app.perf)[number]) => perfUnit === 'money' ? h.total : h.pct ?? 0;
  const perfSorted = $derived([...perf].sort((a, b) => perfVal(b) - perfVal(a)));
  const perfMax = $derived(Math.max(1e-9, ...perfSorted.map(h => Math.abs(perfVal(h)))));

  let groupBy = $state<'sector' | 'category' | 'industry' | 'custom' | 'myGroup'>('sector');
  const groups = $derived(groupPnl(m, groupBy));
  const groupMax = $derived(Math.max(1e-9, ...groups.map(g => Math.abs(g.pnl))));

  // Red as two holdings move together (concentration), green as they offset each other.
  const corrFill = (r: number | null) => r == null ? 'transparent'
    : `color-mix(in oklab, var(${r >= 0 ? '--loss' : '--gain'}) ${Math.round(8 + Math.abs(r) * 40)}%, var(--card))`;
</script>

<div class="page">
  <header class="page-head">
    <h1 class="page-title">{t('Analysis')}</h1>
    <span class="spacer"></span>
    <Seg small bind:value={range} options={[{ value: '3M', label: '3M' }, { value: '6M', label: '6M' }, { value: '1Y', label: '1Y' }, { value: 'All', label: t('All') }]} />
  </header>

  <div class="pair">
    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">{t('Return against the S&P 500 and the Nasdaq')}</h2><span class="card-sub">{t('Time-weighted, deposits taken out')}</span></div>
      {#if bench}
        <LineChart zero labels={bench.dates} format={v => signedPct(v, 1)} lines={benchLines} />
        {#if lead}
          <p class="small ink2 note">{t('Since')} {date(lead.since)}: <strong class={sign(lead.spy)}>{points(lead.spy)}</strong> {t('the S&P 500')}{#if lead.nasdaq != null}, <strong class={sign(lead.nasdaq)}>{points(lead.nasdaq)}</strong> {t('the Nasdaq 100')}{/if}. {t('Price moves only; no line counts dividends.')}</p>
        {/if}
        {#if !bench.other}
          <p class="small muted note">
            {#if bench.otherFrom}{t('The Nasdaq line is left out: its prices start on')} {date(bench.otherFrom)}, {t('after this window begins. A shorter range will show it.')}
            {:else}{t('The Nasdaq line needs QQQ’s price history. Add QQQ to the watchlist and it will appear once the sheet has fetched it.')}{/if}
          </p>
        {/if}
      {:else}<p class="empty">{t('Needs about a month of trade and price history.')}</p>{/if}
    </section>

    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">{t('Value against money put in')}</h2><span class="card-sub">{t('Holdings only, cash left out')}</span></div>
      {#if worth}
        <LineChart labels={worth.dates} format={v => money(v)} axisFormat={v => money.compact(v)} lines={[
          { name: t('Market value'), color: 'var(--accent)', values: worth.value },
          { name: t('Net invested'), color: 'var(--muted)', values: worth.invested, dashed: true },
        ]} />
      {:else}<p class="empty">{t('Needs the trade ledger and price history.')}</p>{/if}
    </section>
  </div>

  <section class="card card-pad">
    <div class="card-head"><h2 class="card-title">{t('Risk')}</h2>{#if app.risk}<span class="card-sub">{app.risk.days} {t('trading days')}</span>{/if}</div>
    <div class="risk">
      <dl>
        <dt class="group">{t('Concentration')}</dt>
        <div><dt>{t('Largest position')}</dt><dd>{app.concentration.largest ? `${app.concentration.largest.symbol} ${pct(app.concentration.largest.pct, 1)}` : '—'}</dd></div>
        <div><dt>{t('Top 3')}</dt><dd>{m.positions.length ? pct(app.concentration.top3, 1) : '—'}</dd></div>
        <div><dt use:tip={t('Sum of squared weights. Above 2,500 is concentrated, below 1,500 is spread out.')}>{t('Concentration index')}</dt><dd>{m.positions.length ? Math.round(app.concentration.hhi).toLocaleString('en-US') : '—'}</dd></div>
        <div><dt>{t('Top sector')}</dt><dd>{app.concentration.topSector ? `${app.concentration.topSector.name} ${pct(app.concentration.topSector.pct, 0)}` : '—'}</dd></div>
        <div><dt>{t('Cash')}</dt><dd>{pct(app.concentration.cashPct, 1)}</dd></div>
      </dl>
      <dl>
        <dt class="group">{t('Stop losses')}</dt>
        <div><dt>{t('Equity with a stop')}</dt><dd>{pct(app.stops.coveredPct, 0)}</dd></div>
        <div><dt>{t('Loss if every stop is reached')}</dt><dd class={app.stops.maxLoss ? 'loss' : ''}>{app.stops.maxLoss ? money(-app.stops.maxLoss) : '—'}</dd></div>
        <div><dt>{t('Value with no stop')}</dt><dd>{money(app.stops.unprotected)}</dd></div>
        {#if app.stops.hit.length}<div><dt>{t('Below their stop now')}</dt><dd class="loss">{app.stops.hit.join(', ')}</dd></div>{/if}
      </dl>
      <dl>
        <dt class="group">{t('52-week range')}</dt>
        <div><dt>{t('Average distance from high')}</dt><dd>{app.range52 ? pct(app.range52.fromHigh, 1) : '—'}</dd></div>
        <div><dt>{t('Within 10% of their low')}</dt><dd>{app.range52 ? app.range52.nearLow : '—'}</dd></div>
      </dl>
      <dl>
        <dt class="group">{t('Against the S&P 500')}</dt>
        <div><dt>{t('Volatility')}</dt><dd>{app.risk ? pct(app.risk.volAnn, 1) : '—'}</dd></div>
        <div><dt>{t('Max drawdown')}</dt><dd>{app.risk ? pct(-Math.abs(app.risk.maxDD), 1) : '—'}</dd></div>
        <div><dt>{t('Sharpe')}</dt><dd>{num(app.risk?.sharpe)}</dd></div>
        <div><dt>{t('Beta')}</dt><dd>{num(app.risk?.beta)}</dd></div>
        <div><dt>{t('Alpha')}</dt><dd class={sign(app.risk?.alpha)}>{app.risk?.alpha == null ? '—' : signedPct(app.risk.alpha, 1)}</dd></div>
      </dl>
    </div>
  </section>

  <div class="pair">
    <section class="card card-pad">
      <div class="card-head">
        <h2 class="card-title">{t('If the market moves')}</h2>
        <span class="card-sub">{t('Each holding moves by its own beta')}</span>
      </div>
      {#if m.positions.length}
        <table class="tbl">
          <thead><tr><th>S&P 500</th><th class="n">{t('This portfolio')}</th><th class="n">{t('Change')}</th><th>{t('Hit hardest')}</th></tr></thead>
          <tbody>
            {#each app.stress as s (s.market)}
              <tr>
                <td class="strong">{signedPct(s.market, 0)}</td>
                <td class="n {sign(s.pct)}">{signedPct(s.pct, 1)}</td>
                <td class="n {sign(s.dollars)}">{money.signed(s.dollars)}</td>
                <td class="ink2 small">{s.worst.map(w => w.symbol).join(', ')}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="small muted note">{t('Beta is measured against the last year of daily prices. A holding with too little history counts as 1. Cash does not move.')}</p>
      {:else}<p class="empty">{t('No holdings in this portfolio yet.')}</p>{/if}
    </section>

    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">{t('Where the return comes from')}</h2>{#if app.irr}<span class="card-sub">{t('Annualised IRR')} {signedPct(app.irr.rate)}, {app.irr.years.toFixed(1)} {t('years')}</span>{/if}</div>
      {#if app.irr}
        {@const r = app.irr}
        {@const gain = r.terminal + r.proceeds + r.dividends + r.transfersNet - r.invested}
        <dl class="adds">
          <div><dt>{t('Holdings now')}</dt><dd>{money(r.terminal)}</dd></div>
          <div><dt>{t('Received from sales')}</dt><dd>{money(r.proceeds)}</dd></div>
          <div><dt>{t('Dividends')}</dt><dd>{money(r.dividends)}</dd></div>
          {#if Math.abs(r.transfersNet) > 0.005}<div><dt>{t('Moved in or out of this portfolio')}</dt><dd>{money.signed(r.transfersNet)}</dd></div>{/if}
          <div><dt>{t('Paid for purchases')}</dt><dd>{money(-r.invested)}</dd></div>
          <div class="sum"><dt>{t('Total gain')}</dt><dd class={sign(gain)}>{money.signed(gain)}</dd></div>
        </dl>
        <p class="small muted note">{t('The rate weighs each dollar by how long it was invested, so a late deposit counts for less than an early one.')}</p>
      {:else}<p class="empty">{t('Needs the trade ledger')}</p>{/if}
    </section>
  </div>

  <div class="pair">
    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">{t('Income')}</h2><span class="card-sub">{t('A year at the last 12 months’ rate, after withholding')}</span></div>
      {#if app.income}
        <dl class="trio">
          <div><dt>{t('Per year')}</dt><dd>{money(app.income.net)}</dd></div>
          <div><dt>{t('Yield now')}</dt><dd>{pct(app.income.fwdYield, 2)}</dd></div>
          <div><dt>{t('Yield on cost')}</dt><dd>{pct(app.income.yieldOnCost, 2)}</dd></div>
        </dl>
        <ul class="bars">
          {#each app.income.payers.slice(0, 6) as p (p.symbol)}
            <li><button onclick={() => app.symbol = p.symbol}><span class="strong lab">{p.symbol}</span><span class="track"><span class="fill" style:width="{p.net / app.income.payers[0].net * 100}%"></span></span><span class="val">{money(p.net)}</span></button></li>
          {/each}
        </ul>
      {:else}<p class="empty">{t('No dividends yet.')}</p>{/if}
    </section>
  </div>

  <section class="card card-pad">
    <div class="card-head">
      <h2 class="card-title">{t('Result per holding')}</h2>
      <span class="card-sub">{t('Unrealized, realized and dividends, over all money ever put in')}</span>
      <span class="spacer"></span>
      <Seg small bind:value={perfTab} options={[{ value: 'all', label: t('All') }, { value: 'up', label: t('Gainers') }, { value: 'down', label: t('Losers') }]} />
      <Seg small bind:value={perfUnit} options={[{ value: 'money', label: '$' }, { value: 'pct', label: '%' }]} />
    </div>
    {#if perfSorted.length}
      <ul class="bars two">
        {#each perfSorted as h (h.symbol)}
          {@const v = perfVal(h)}
          <li>
            <button onclick={() => app.symbol = h.symbol}
              use:tip={`${h.symbol}${h.held ? '' : ', ' + t('sold out')}\n${t('Unrealized')} ${money.signed(h.unrealized)}\n${t('Realized')} ${money.signed(h.realized)}\n${t('Dividends')} ${money(h.dividends)}\n${t('Put in')} ${money(h.deployed)}`}>
              <span class="lab" class:muted={!h.held}><span class="strong">{h.symbol}</span></span>
              <span class="track mid"><span class="fill {v >= 0 ? 'up' : 'down'}" style:width="{Math.abs(v) / perfMax * 50}%"></span></span>
              <span class="val {sign(v)}">{perfUnit === 'money' ? money.signed(h.total) : h.pct == null ? '—' : signedPct(h.pct, 1)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}<p class="empty">{t('Nothing to show here.')}</p>{/if}
  </section>

  <div class="pair">
    <section class="card card-pad">
      <div class="card-head">
        <h2 class="card-title">{t('Unrealized by group')}</h2>
        <span class="spacer"></span>
        <Seg small bind:value={groupBy} options={[
          { value: 'sector', label: t('Sector') }, { value: 'category', label: t('Category') }, { value: 'industry', label: t('Industry') },
          { value: 'custom', label: t('Custom') }, { value: 'myGroup', label: t('My group') },
        ]} />
      </div>
      {#if groups.length}
        <ul class="bars">
          {#each groups as g (g.name)}
            <li><div class="row"><span class="lab wide">{g.name}</span>
              <span class="track mid"><span class="fill {g.pnl >= 0 ? 'up' : 'down'}" style:width="{Math.abs(g.pnl) / groupMax * 50}%"></span></span>
              <span class="val {sign(g.pnl)}">{money.signed(g.pnl)}<span class="sub">{g.pct == null ? '' : signedPct(g.pct, 1)}</span></span></div></li>
          {/each}
        </ul>
      {:else}<p class="empty">{t('No holdings in this portfolio yet.')}</p>{/if}
    </section>

    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">{t('How the largest holdings move together')}</h2></div>
      {#if app.correlation}
        {@const c = app.correlation}
        <div class="table-scroll">
          <table class="corr">
            <thead><tr><th></th>{#each c.symbols as s (s)}<th>{s}</th>{/each}</tr></thead>
            <tbody>
              {#each c.symbols as s, i (s)}
                <tr><th>{s}</th>{#each c.r[i] as r, j (j)}<td style:background={i === j ? 'var(--wash)' : corrFill(r)} class:muted={r == null}>{r == null ? '—' : i === j ? '' : r.toFixed(2)}</td>{/each}</tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="small muted note"><span class="grad"></span>{t('Green offsets, red moves together. Daily returns; a pair with under 30 shared days is left blank.')}</p>
      {:else}<p class="empty">{t('Needs two holdings with price history.')}</p>{/if}
    </section>
  </div>
</div>

<style>
  .page { gap: var(--sp-6); }
  .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-5); align-items: start; }
  .pair > :global(:only-child) { grid-column: 1 / -1; }
  .risk { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--sp-6) var(--sp-7); }
  dl { margin: 0; }
  .risk dl > div { display: flex; justify-content: space-between; align-items: baseline; gap: var(--sp-3); padding: 9px 0; border-top: 1px solid var(--line-soft); }
  .risk dt { font-size: 14px; color: var(--ink-2); }
  .risk dt.group { font: 650 15px/1.2 var(--font-display); color: var(--ink); padding-bottom: var(--sp-2); }
  .risk dd { margin: 0; font-weight: 600; font-size: 14px; text-align: right; }
  .trio { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-4); margin-bottom: var(--sp-5); }
  .trio dt { font-size: 13px; color: var(--muted); }
  .trio dd { margin: 2px 0 0; font: 650 22px/1.2 var(--font-display); letter-spacing: -0.02em; }
  .note { margin: var(--sp-4) 0 0; }
  .adds > div { display: flex; justify-content: space-between; gap: var(--sp-3); padding: 9px 0; border-top: 1px solid var(--line-soft); font-size: 14px; }
  .adds dt { color: var(--ink-2); }
  .adds dd { margin: 0; font-weight: 600; }
  .adds .sum { border-top-color: var(--line); font-size: 16px; }
  .adds .sum dt { color: var(--ink); font-weight: 600; }

  .bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .bars.two { grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 2px var(--sp-7); }
  .bars button, .bars .row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 5px 6px; margin: 0 -6px; border-radius: var(--radius-sm); font-size: 14px; }
  .bars button:hover { background: var(--sunk); }
  .lab { flex: 0 0 64px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lab.wide { flex-basis: 150px; }
  .track { position: relative; flex: 1; height: 10px; border-radius: 5px; background: var(--wash); overflow: hidden; }
  .fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 5px; background: var(--accent); }
  /* Zero sits in the middle: gains grow right, losses grow left. */
  .mid .fill.up { left: 50%; background: var(--gain); border-radius: 0 5px 5px 0; }
  .mid .fill.down { left: auto; right: 50%; background: var(--loss); border-radius: 5px 0 0 5px; }
  .val { flex: 0 0 96px; text-align: right; font-weight: 600; white-space: nowrap; }
  .val .sub { display: block; font-weight: 500; font-size: 12px; }

  .corr { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 2px; font-size: 12px; }
  .corr th { font-weight: 600; color: var(--ink-2); padding: 4px 2px; overflow: hidden; text-overflow: ellipsis; }
  .corr tbody th { text-align: left; width: 3.6rem; }
  .corr td { text-align: center; padding: 8px 0; border-radius: 6px; font-weight: 600; min-width: 40px; }
  .grad { display: inline-block; width: 64px; height: 8px; border-radius: 4px; margin-right: 8px; vertical-align: middle; background: linear-gradient(90deg, var(--gain), var(--card), var(--loss)); }
  @media (max-width: 960px) { .pair { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 520px) { .bars.two { grid-template-columns: minmax(0, 1fr); } .lab.wide { flex-basis: 96px; } }
</style>
