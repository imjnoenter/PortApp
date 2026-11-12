<script lang="ts">
  import { contribAmounts } from '../../core/analytics.ts';
  import { feesOn } from '../../core/fees.ts';
  import { isTransfer } from '../../core/fifo.ts';
  import { baht, date, qty, sign, signedPct, usd } from '../../core/format.ts';
  import { ALL } from '../../core/model.ts';
  import { app } from '../../state/app.svelte.ts';
  import Seg from '../parts/Seg.svelte';
  import { downloadCsv } from '../share.ts';

  const t = app.t;
  const money = $derived(app.money);
  const PAGE = 100;

  type Tab = 'trades' | 'realized' | 'closed' | 'dividends' | 'cash';
  let tab = $state<Tab>('trades');
  let query = $state('');
  let kind = $state<'all' | 'Buy' | 'Sell' | 'transfer'>('all');
  let shown = $state(PAGE);
  const reset = () => { shown = PAGE; };

  const q = $derived(query.trim().toLowerCase());
  const hit = (sym: string) => !q || sym.toLowerCase().includes(q);
  const showPort = $derived(app.view === ALL && app.ports.length > 1);

  const trades = $derived(app.viewTxs
    .filter(x => hit(x.ticker) && (kind === 'all' || (kind === 'transfer' ? isTransfer(x) : x.type === kind)))
    .map(x => {
      const tv = x.tradeValue ?? x.shares * x.price;
      const traded = x.type === 'Buy' || x.type === 'Sell';
      return { x, tv, fee: traded ? feesOn(tv, x.commissionFree).total : 0 };
    })
    .sort((a, b) => (b.x.dateStr + b.x.time).localeCompare(a.x.dateStr + a.x.time) || b.x.row - a.x.row));
  const sales = $derived(app.sales.filter(s => hit(s.ticker)).sort((a, b) => b.date.localeCompare(a.date)));
  const divs = $derived(app.dividends.events.filter(d => hit(d.ticker)).sort((a, b) => b.date.localeCompare(a.date)));
  const cash = $derived(app.contribs.map(c => ({ c, ...contribAmounts(c, app.fx) })).sort((a, b) => b.c.date.localeCompare(a.c.date)));

  const closed = $derived(app.journal.filter(c => hit(c.ticker)));
  const closedPnl = $derived(closed.reduce((s, c) => s + c.pnl, 0));
  const wins = $derived(closed.filter(c => c.pnl > 0).length);
  const count = $derived({ trades: trades.length, realized: sales.length, closed: closed.length, dividends: divs.length, cash: cash.length }[tab]);

  /** The rows on screen, every one of them (not just the page shown), in plain numbers. */
  function exportCsv() {
    const rows = tab === 'trades' ? [['Date', 'Time', 'Type', 'Symbol', 'Shares', 'Price', 'Value', 'Fees', 'Portfolio', 'Note'],
        ...trades.map(({ x, tv, fee }) => [x.dateStr, x.time, x.type, x.ticker, x.shares, x.price, tv.toFixed(2), fee.toFixed(2), x.portfolio, x.note])]
      : tab === 'realized' ? [['Date', 'Symbol', 'Shares', 'Sold at', 'Cost', 'Fees', 'Realized', 'Portfolio'],
        ...sales.map(s => [s.date, s.ticker, s.shares, s.price, s.cost.toFixed(2), s.fee.toFixed(2), s.pnl.toFixed(2), s.portfolio])]
      : tab === 'closed' ? [['Symbol', 'Opened', 'Closed', 'Days held', 'Shares', 'Avg entry', 'Avg exit', 'Result', 'Result %', 'Portfolio'],
        ...closed.map(c => [c.ticker, c.openDate, c.closeDate, c.holdDays, c.shares, c.avgEntry.toFixed(4), c.avgExit.toFixed(4), c.pnl.toFixed(2), c.pct?.toFixed(2), c.portfolio])]
      : tab === 'dividends' ? [['Ex-date', 'Symbol', 'Shares held', 'Gross', 'After withholding'], ...divs.map(d => [d.date, d.ticker, d.shares, d.gross.toFixed(2), d.net.toFixed(2)])]
      : [['Date', 'Type', 'THB', 'USD', 'Note'], ...cash.map(({ c, thb, usd: dollars }) => [c.date, c.type, thb.toFixed(2), dollars.toFixed(2), c.note])];
    downloadCsv(`${tab}-${app.today}.csv`, rows);
  }
  const salesPnl = $derived(sales.reduce((s, x) => s + x.pnl, 0));
  const divNet = $derived(divs.reduce((s, x) => s + x.net, 0));
</script>

<div class="page">
  <header class="page-head">
    <h1 class="page-title">{t('Activity')}</h1>
    {#if app.ledgerLoaded || tab === 'cash'}<span class="page-count">{count} {t('rows')}</span>{/if}
  </header>

  <section class="card">
    <div class="bar">
      <Seg bind:value={tab} onchange={reset} options={[
        { value: 'trades', label: t('Trades') }, { value: 'realized', label: t('Realized') }, { value: 'closed', label: t('Closed trades') },
        { value: 'dividends', label: t('Dividends') }, { value: 'cash', label: t('Cash in / out') },
      ]} />
      <span class="spacer"></span>
      {#if tab === 'trades'}
        <Seg small bind:value={kind} onchange={reset} options={[
          { value: 'all', label: t('All') }, { value: 'Buy', label: t('Buy') }, { value: 'Sell', label: t('Sell') }, { value: 'transfer', label: t('Transfers') },
        ]} />
      {/if}
      {#if tab === 'cash' && app.canWrite}
        <button class="btn primary" onclick={() => app.dialog = { kind: 'contrib' }}>{t('Add deposit or withdrawal')}</button>
      {/if}
      {#if count}<button class="btn" onclick={exportCsv}>{t('Export CSV')}</button>{/if}
      {#if tab !== 'cash'}
        <input class="input search" type="search" bind:value={query} oninput={reset} placeholder={t('Search symbol')} aria-label={t('Search symbol')}>
      {/if}
    </div>

    {#if !app.ledgerLoaded && tab !== 'cash'}
      <p class="empty">{t('Loading the trade ledger…')}</p>
    {:else if !count}
      <p class="empty">{t('Nothing to show here.')}</p>
    {:else}
      <div class="table-scroll">
        {#if tab === 'trades'}
          <table class="tbl">
            <thead><tr><th>{t('Date')}</th><th>{t('Type')}</th><th>{t('Symbol')}</th><th class="n">{t('Shares')}</th><th class="n">{t('Price')}</th><th class="n">{t('Value')}</th><th class="n">{t('Fees')}</th>{#if showPort}<th>{t('Portfolio')}</th>{/if}<th>{t('Note')}</th>{#if app.canWrite}<th></th>{/if}</tr></thead>
            <tbody>
              {#each trades.slice(0, shown) as { x, tv, fee } (x.row)}
                <tr class="click" onclick={() => app.symbol = x.ticker}>
                  <td>{date(x.dateStr)}<span class="sub">{x.time.slice(0, 5)}</span></td>
                  <td><span class="pill {x.type === 'Buy' ? 'gain' : x.type === 'Sell' ? 'loss' : ''}">{t(x.type)}</span></td>
                  <td class="strong">{x.ticker}</td>
                  <td class="n">{qty(x.shares)}</td>
                  <td class="n">{usd(x.price)}</td>
                  <td class="n">{money(tv)}</td>
                  <td class="n ink2">{fee ? money(fee) : ''}</td>
                  {#if showPort}<td class="ink2">{x.portfolio}</td>{/if}
                  <td class="note ink2">{x.note}</td>
                  {#if app.canWrite}
                    <td class="n">{#if x.type === 'Buy' || x.type === 'Sell'}<button class="btn edit" onclick={e => { e.stopPropagation(); app.dialog = { kind: 'tx', row: x.row }; }}>{t('Edit')}</button>{/if}</td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        {:else if tab === 'realized'}
          <table class="tbl">
            <thead><tr><th>{t('Date')}</th><th>{t('Symbol')}</th><th class="n">{t('Shares')}</th><th class="n">{t('Sold at')}</th><th class="n">{t('Cost')}</th><th class="n">{t('Fees')}</th><th class="n">{t('Realized')}</th>{#if showPort}<th>{t('Portfolio')}</th>{/if}</tr></thead>
            <tbody>
              {#each sales.slice(0, shown) as s, i (i)}
                <tr class="click" onclick={() => app.symbol = s.ticker}>
                  <td>{date(s.date)}</td>
                  <td class="strong">{s.ticker}</td>
                  <td class="n">{qty(s.shares)}</td>
                  <td class="n">{usd(s.price)}</td>
                  <td class="n">{money(s.cost)}</td>
                  <td class="n ink2">{money(s.fee)}</td>
                  <td class="n {sign(s.pnl)}">{money.signed(s.pnl)}<span class="sub {sign(s.pnl)}">{s.cost ? signedPct(s.pnl / s.cost * 100) : ''}</span></td>
                  {#if showPort}<td class="ink2">{s.portfolio}</td>{/if}
                </tr>
              {/each}
            </tbody>
            <tfoot><tr><td colspan="6">{t('Total')}, {t('after fees on both sides')}</td><td class="n {sign(salesPnl)}">{money.signed(salesPnl)}</td>{#if showPort}<td></td>{/if}</tr></tfoot>
          </table>
        {:else if tab === 'closed'}
          <table class="tbl">
            <thead><tr><th>{t('Symbol')}</th><th>{t('Opened')}</th><th>{t('Closed')}</th><th class="n">{t('Days held')}</th><th class="n">{t('Shares')}</th><th class="n">{t('Avg entry')}</th><th class="n">{t('Avg exit')}</th><th class="n">{t('Result')}</th>{#if showPort}<th>{t('Portfolio')}</th>{/if}</tr></thead>
            <tbody>
              {#each closed.slice(0, shown) as c, i (i)}
                <tr class="click" onclick={() => app.symbol = c.ticker}>
                  <td class="strong">{c.ticker}</td>
                  <td>{date(c.openDate)}</td>
                  <td>{date(c.closeDate)}</td>
                  <td class="n ink2">{c.holdDays}</td>
                  <td class="n">{qty(c.shares)}</td>
                  <td class="n">{usd(c.avgEntry)}</td>
                  <td class="n">{usd(c.avgExit)}</td>
                  <td class="n {sign(c.pnl)}">{money.signed(c.pnl)}<span class="sub {sign(c.pnl)}">{c.pct == null ? '' : signedPct(c.pct)}</span></td>
                  {#if showPort}<td class="ink2">{c.portfolio}</td>{/if}
                </tr>
              {/each}
            </tbody>
            <tfoot><tr><td colspan="7">{wins} {t('of')} {closed.length} {t('closed at a gain')}</td><td class="n {sign(closedPnl)}">{money.signed(closedPnl)}</td>{#if showPort}<td></td>{/if}</tr></tfoot>
          </table>
        {:else if tab === 'dividends'}
          <table class="tbl">
            <thead><tr><th>{t('Ex-date')}</th><th>{t('Symbol')}</th><th class="n">{t('Shares held')}</th><th class="n">{t('Gross')}</th><th class="n">{t('After withholding')}</th></tr></thead>
            <tbody>
              {#each divs.slice(0, shown) as d, i (i)}
                <tr class="click" onclick={() => app.symbol = d.ticker}>
                  <td>{date(d.date)}</td>
                  <td class="strong">{d.ticker}</td>
                  <td class="n">{qty(d.shares)}</td>
                  <td class="n ink2">{money(d.gross)}</td>
                  <td class="n">{money(d.net)}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot><tr><td colspan="4">{t('Total')}, {t('estimated from ex-dates, not broker payouts')}</td><td class="n">{money(divNet)}</td></tr></tfoot>
          </table>
        {:else}
          <table class="tbl">
            <thead><tr><th>{t('Date')}</th><th>{t('Type')}</th><th class="n">THB</th><th class="n">USD</th><th class="n">{t('Rate')}</th><th>{t('Note')}</th></tr></thead>
            <tbody>
              {#each cash.slice(0, shown) as { c, thb, usd: dollars } (c.row)}
                <tr class:click={app.canWrite} onclick={() => { if (app.canWrite) app.dialog = { kind: 'contrib', row: c.row }; }}>
                  <td>{date(c.date)}</td>
                  <td><span class="pill {thb >= 0 ? 'gain' : 'loss'}">{t(c.type)}</span></td>
                  <td class="n {sign(thb)}">{(thb > 0 ? '+' : '') + baht(thb)}</td>
                  <td class="n ink2">{usd(dollars)}</td>
                  <td class="n ink2">{dollars ? (thb / dollars).toFixed(2) : ''}</td>
                  <td class="note ink2">{c.note}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot><tr><td colspan="2">{t('Net paid in')}</td><td class="n">{baht(app.paidInTHB)}</td><td colspan="3"></td></tr></tfoot>
          </table>
        {/if}
      </div>
      {#if count > shown}
        <div class="more"><button class="btn" onclick={() => shown += PAGE}>{t('Show more')} ({count - shown} {t('left')})</button></div>
      {/if}
    {/if}
  </section>
</div>

<style>
  .card { padding: 0 var(--sp-2) var(--sp-3); overflow: hidden; }
  .bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-3); padding: var(--sp-4) var(--sp-3); }
  .search { max-width: 220px; }
  .edit { padding: 4px 12px; font-size: 12px; }
  .note { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
  .more { padding: var(--sp-4); text-align: center; border-top: 1px solid var(--line-soft); }
  @media (max-width: 760px) { .search { max-width: none; flex: 1 1 140px; } }
</style>
