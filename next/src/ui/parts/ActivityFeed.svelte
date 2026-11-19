<script lang="ts">
  // The ledger as a feed of plain sentences, a month at a time: what was opened, added to, trimmed,
  // closed or moved, what paid a dividend, and the cash that came in or went out.
  import type { FeedEvent } from '../../core/feed.ts';
  import { baht, date, pct, qty, sign, signedPct, usd } from '../../core/format.ts';
  import { app } from '../../state/app.svelte.ts';
  import Logo from './Logo.svelte';

  let { events, shown, showPort }: { events: FeedEvent[]; shown: number; showPort: boolean } = $props();
  const t = app.t;
  const money = $derived(app.money);

  const LABEL: Record<FeedEvent['kind'], string> = {
    open: 'Opened', add: 'Added to', trim: 'Trimmed', close: 'Closed', move: 'Moved',
    dividend: 'Dividend from', deposit: 'Deposited', withdraw: 'Withdrew',
  };
  const w = (n: number | null | undefined) => n == null ? '—' : pct(n, 1);
  const monthOf = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(app.prefs.lang === 'th' ? 'th-TH' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  /** Month blocks for the events on screen, each with what moved in it. */
  const months = $derived.by(() => {
    const out: { key: string; label: string; items: FeedEvent[]; bought: number; sold: number; realized: number; income: number }[] = [];
    for (const e of events.slice(0, shown)) {
      const key = e.date.slice(0, 7);
      let m = out[out.length - 1];
      if (!m || m.key !== key) out.push(m = { key, label: monthOf(e.date), items: [], bought: 0, sold: 0, realized: 0, income: 0 });
      m.items.push(e);
      if (e.kind === 'open' || e.kind === 'add') m.bought += e.value || 0;
      if (e.kind === 'trim' || e.kind === 'close') { m.sold += e.value || 0; m.realized += e.pnl || 0; }
      if (e.kind === 'dividend') m.income += e.net || 0;
    }
    return out;
  });
</script>

{#each months as m (m.key)}
  <section class="month" aria-label={m.label}>
    <header class="mhead">
      <h3>{m.label}</h3>
      <span class="totals">
        {#if m.bought}<span>{t('Bought')} <b>{money(m.bought)}</b></span>{/if}
        {#if m.sold}<span>{t('Sold')} <b>{money(m.sold)}</b></span>{/if}
        {#if m.realized}<span>{t('Realized')} <b class={sign(m.realized)}>{money.signed(m.realized)}</b></span>{/if}
        {#if m.income}<span>{t('Dividends')} <b class="gain">{money(m.income)}</b></span>{/if}
      </span>
    </header>
    <ol class="feed">
      {#each m.items as e, i (m.key + i)}
        {@const sym = e.ticker}
        <li class="ev {e.kind}">
          <button class="row" disabled={!sym} onclick={() => { if (sym) app.symbol = sym; }}>
            <span class="mark">
              {#if sym}<Logo {sym} size={34} />{:else}<span class="cash" aria-hidden="true">{e.kind === 'deposit' ? '+' : '−'}</span>{/if}
            </span>
            <span class="body">
              <span class="title">
                <span class="verb">{t(LABEL[e.kind])}</span>
                {#if sym}<strong>{sym}</strong>{/if}
                {#if e.largest}<span class="tag">{t('Now your largest holding')}</span>{/if}
                {#if e.first}<span class="tag">{t('First dividend')}</span>{/if}
              </span>
              <span class="line">
                {#if e.kind === 'open'}
                  {t('Bought')} {qty(e.shares!)} {t('shares at')} {usd(e.price)}, {w(e.wAfter)} {t('of holdings')}
                {:else if e.kind === 'add'}
                  {t('Bought')} +{qty(e.shares!)} {t('at')} {usd(e.price)}, {t('weight')} {w(e.wBefore)} → {w(e.wAfter)}
                {:else if e.kind === 'trim'}
                  {t('Sold')} {qty(e.shares!)} {t('at')} {usd(e.price)}, {t('weight')} {w(e.wBefore)} → {w(e.wAfter)}
                {:else if e.kind === 'close'}
                  {t('Sold the last')} {qty(e.shares!)} {t('at')} {usd(e.price)}{#if e.holdDays != null}, {t('held')} {e.holdDays} {t('days')}{/if}
                {:else if e.kind === 'move'}
                  {qty(e.shares!)} {t('shares')}{#if e.portfolio}{' '}{t('from')} {e.portfolio}{/if}{#if e.to}{' '}{t('to')} {e.to}{/if}
                {:else if e.kind === 'dividend'}
                  {qty(e.shares!)} {t('shares held on the ex-date')}, {t('gross')} {money(e.gross!)}
                {:else}
                  {usd(Math.abs(e.usd!))}{#if e.usd}{' '}{t('at')} {(e.thb! / e.usd!).toFixed(2)}{/if}{#if e.note}, {e.note}{/if}
                {/if}
              </span>
              <span class="when">{date(e.date)}{#if e.time}{' '}{e.time.slice(0, 5)}{/if}{#if showPort && e.portfolio && e.kind !== 'move'}, {e.portfolio}{/if}</span>
            </span>
            <span class="fig">
              {#if e.kind === 'trim' || e.kind === 'close'}
                <b class={sign(e.pnl)}>{money.signed(e.pnl!)}</b>
                <span class="sub {sign(e.pnl)}">{e.pnlPct == null ? '' : signedPct(e.pnlPct)}{e.kind === 'close' ? ` ${t('in all')}` : ''}</span>
              {:else if e.kind === 'open' || e.kind === 'add'}
                <b>{money(e.value!)}</b><span class="sub">{t('invested')}</span>
              {:else if e.kind === 'dividend'}
                <b class="gain">+{money(e.net!)}</b><span class="sub">{t('after withholding')}</span>
              {:else if e.kind === 'deposit' || e.kind === 'withdraw'}
                <b class={sign(e.thb)}>{(e.thb! > 0 ? '+' : '') + baht(e.thb!)}</b>
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ol>
  </section>
{/each}

<style>
  .month { padding: 0 var(--sp-3) var(--sp-4); }
  .mhead { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px var(--sp-4); padding: var(--sp-4) 0 var(--sp-2); }
  .mhead h3 { margin: 0; font: 650 16px/1.2 var(--font-display); letter-spacing: -0.01em; }
  .totals { display: flex; flex-wrap: wrap; gap: 2px var(--sp-4); font-size: 12px; color: var(--muted); }
  .totals b { font-weight: 600; color: var(--ink); }
  .totals b.gain { color: var(--gain); } .totals b.loss { color: var(--loss); }

  .feed { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  /* Each event is a soft card; a 3px edge in the event's colour says what kind it is before reading. */
  .ev .row {
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--sp-3);
    width: 100%; padding: 10px 14px 10px 12px; border-radius: var(--radius-sm); text-align: left;
    background: var(--sunk); border-left: 3px solid var(--edge, var(--line)); font: inherit; color: inherit;
  }
  .ev .row:not(:disabled):hover { background: var(--wash); }
  .ev .row:disabled { cursor: default; opacity: 1; }
  .open, .add { --edge: var(--gain); }
  .trim { --edge: var(--honey); }
  .close { --edge: var(--loss); }
  .move { --edge: var(--muted); }
  .dividend, .deposit { --edge: var(--accent); }
  .withdraw { --edge: var(--ink-2); }

  .mark { display: grid; place-items: center; width: 34px; height: 34px; }
  .cash { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--card); font: 650 18px/1 var(--font-display); color: var(--ink-2); }
  .body { display: grid; gap: 1px; min-width: 0; }
  .title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 6px; font-size: 14px; }
  .verb { color: var(--ink-2); }
  .tag { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: color-mix(in oklab, var(--accent) 14%, transparent); color: var(--accent-ink); }
  .line { font-size: 13px; color: var(--ink); font-variant-numeric: tabular-nums; }
  .when { font-size: 11px; color: var(--muted); }
  .fig { display: grid; justify-items: end; text-align: right; font-variant-numeric: tabular-nums; }
  .fig b { font-size: 15px; font-weight: 650; }
  .fig .sub { font-size: 11px; color: var(--muted); }
  .fig .sub.gain { color: var(--gain); } .fig .sub.loss { color: var(--loss); }
  .fig b.gain { color: var(--gain); } .fig b.loss { color: var(--loss); }

  @media (max-width: 560px) {
    .ev .row { grid-template-columns: auto minmax(0, 1fr); }
    .fig { grid-column: 2; justify-items: start; text-align: left; display: flex; gap: 8px; align-items: baseline; }
  }
</style>
