<script lang="ts">
  // Earnings and ex-dividend dates for what this tab holds or watches, as a month to look across.
  // On a narrow screen a grid of seven columns cannot hold a ticker, so it becomes a list.
  import { date } from '../../core/format.ts';
  import { app } from '../../state/app.svelte.ts';
  import Logo from './Logo.svelte';
  import { tip } from '../tip.ts';

  const t = app.t;
  /**
   * What a day's item is. Earnings split by when the report lands, because the two are a full
   * trading session apart: before the open moves that day's price, after the close moves the next.
   */
  type Slot = 'bmo' | 'amc' | 'earnings' | 'exdiv';
  interface Ev { d: string; symbol: string; kind: 'earnings' | 'exdiv'; slot: Slot; note: string; held: boolean }
  // The order a day lists them in: morning reports, evening reports, reports with no time, dividends.
  const SLOTS: { id: Slot; short: string; label: string }[] = [
    { id: 'bmo', short: 'BMO', label: 'Before market open' },
    { id: 'amc', short: 'AMC', label: 'After market close' },
    { id: 'earnings', short: '', label: 'Earnings, time not known' },
    { id: 'exdiv', short: '', label: 'Ex-dividend' },
  ];
  const slotOf = (time: string): Slot => /before|bmo|pre/i.test(time) ? 'bmo' : /after|amc|post/i.test(time) ? 'amc' : 'earnings';

  const events = $derived.by(() => {
    const held = new Set(app.model.positions.map(p => p.symbol));
    const mine = new Set([...held, ...app.model.watchlist.map(w => w.symbol)]);
    const out: Ev[] = [];
    for (const e of app.calendar) {
      if (!mine.has(e.symbol)) continue;
      if (e.earnings) out.push({ d: e.earnings, symbol: e.symbol, kind: 'earnings', slot: slotOf(e.time), held: held.has(e.symbol),
        note: e.earningsEnd && e.earningsEnd !== e.earnings ? `${t('through')} ${date(e.earningsEnd, true)}` : t(e.time) });
      // An ex-dividend date only matters for shares actually held.
      if (e.exDiv && held.has(e.symbol)) out.push({ d: e.exDiv, symbol: e.symbol, kind: 'exdiv', slot: 'exdiv', note: '', held: true });
    }
    const rank = (e: Ev) => SLOTS.findIndex(x => x.id === e.slot);
    return out.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : rank(a) - rank(b) || a.symbol.localeCompare(b.symbol));
  });
  /** A day's items in their groups, empty groups left out. */
  const grouped = (list: Ev[]) => SLOTS.map(x => ({ ...x, events: list.filter(e => e.slot === x.id) })).filter(g => g.events.length);

  /** Months away from the current one. */
  let shift = $state(0);
  const month = $derived.by(() => {
    const y = +app.today.slice(0, 4), mo = +app.today.slice(5, 7) - 1;
    const first = new Date(Date.UTC(y, mo + shift, 1));
    const key = first.toISOString().slice(0, 7), days = new Date(Date.UTC(y, mo + shift + 1, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;   // weeks start on Monday
    const cells: ({ d: string; n: number; events: Ev[] } | null)[] = new Array(lead).fill(null);
    for (let n = 1; n <= days; n++) { const d = `${key}-${String(n).padStart(2, '0')}`; cells.push({ d, n, events: events.filter(e => e.d === d) }); }
    return { key, cells, title: first.toLocaleDateString(app.prefs.lang === 'th' ? 'th-TH' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), list: events.filter(e => e.d.startsWith(key)) };
  });
  const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const what = (e: Ev) => `${e.symbol}: ${e.kind === 'earnings' ? t('Earnings') : t('Ex-dividend')}${e.note ? ', ' + e.note : ''}${e.held ? '' : ', ' + t('watching')}`;
  const upcoming = $derived(events.filter(e => e.d >= app.today).length);
</script>

{#if events.length}
  <section class="card card-pad">
    <div class="card-head">
      <h2 class="card-title">{t('Calendar')}</h2>
      <span class="card-sub"><i class="k bmo"></i>BMO, {t('before market open')} <i class="k amc"></i>AMC, {t('after market close')} <i class="k exdiv"></i>{t('Ex-dividend')}, {upcoming} {t('ahead')}</span>
      <span class="spacer"></span>
      <button class="btn" onclick={() => shift--} aria-label={t('Earlier month')}>‹</button>
      <button class="btn title" onclick={() => shift = 0} title={t('Back to this month')}>{month.title}</button>
      <button class="btn" onclick={() => shift++} aria-label={t('Later month')}>›</button>
    </div>

    <div class="grid" role="grid" aria-label={month.title}>
      {#each WEEK as w (w)}<span class="wd small muted">{t(w)}</span>{/each}
      {#each month.cells as c, i (i)}
        {#if c}
          <div class="day" class:today={c.d === app.today} class:past={c.d < app.today} role="gridcell">
            <span class="num">{c.n}</span>
            {#each grouped(c.events) as g (g.id)}
              <div class="slot {g.id}">
                {#if g.short}<span class="tag" title={t(g.label)}>{g.short}</span>{/if}
                {#each g.events as e (e.symbol)}
                  <button class="ev" class:watch={!e.held} onclick={() => app.symbol = e.symbol} use:tip={what(e)}>{e.symbol}</button>
                {/each}
              </div>
            {/each}
          </div>
        {:else}<span class="day blank"></span>{/if}
      {/each}
    </div>

    <ul class="list">
      {#each month.list as e (e.d + e.symbol + e.kind)}
        <li>
          <button onclick={() => app.symbol = e.symbol}>
            <Logo sym={e.symbol} size={26} />
            <span class="who"><strong>{e.symbol}</strong> <span class="ink2">{e.kind === 'earnings' ? t('Earnings') : t('Ex-dividend')}</span>{#if e.note}<span class="small muted"> {e.note}</span>{/if}</span>
            {#if e.slot === 'bmo' || e.slot === 'amc'}<span class="pill {e.slot}">{e.slot === 'bmo' ? 'BMO' : 'AMC'}</span>{/if}
            <span class="when">{date(e.d, true)}</span>
          </button>
        </li>
      {:else}
        <li class="small muted none">{t('Nothing this month.')}</li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .card-head .btn { padding: 5px 12px; font-size: 13px; }
  .card-head .title { min-width: 150px; justify-content: center; }
  /* Morning reports are amber, evening reports are blue, dividends green: one colour per group,
     used for the legend key, the group's tag and its symbols alike. */
  .bmo { --c: var(--honey); }
  .amc { --c: var(--accent); --ct: var(--accent-ink); }
  .earnings { --c: var(--ink-2); }
  .exdiv { --c: var(--gain); }
  .k { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin: 0 5px 0 10px; background: var(--c); }
  .slot { flex: 0 0 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 3px; padding-left: 5px; border-left: 3px solid var(--c); }
  .slot + .slot { margin-top: 3px; }
  .tag { font-size: 9px; font-weight: 700; letter-spacing: 0.02em; color: var(--ct, var(--c)); margin-right: 1px; }
  .slot .ev { background: color-mix(in oklab, var(--c) 15%, transparent); color: var(--ct, var(--c)); }
  .pill.bmo, .pill.amc { background: color-mix(in oklab, var(--c) 15%, transparent); color: var(--ct, var(--c)); }
  .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
  .wd { text-align: center; padding-bottom: 4px; }
  /* Every symbol is listed: a busy day grows taller, and its week grows with it. */
  .day { min-height: 76px; padding: 6px; border-radius: 10px; background: var(--sunk); display: flex; flex-wrap: wrap; align-content: flex-start; gap: 3px; }
  .day.blank { background: none; }
  .day.past { opacity: 0.55; }
  .day.today { box-shadow: inset 0 0 0 2px var(--ink); }
  .num { flex: 0 0 100%; font-size: 12px; font-weight: 600; color: var(--ink-2); }
  .ev { padding: 1px 6px; border-radius: 5px; font-size: 11px; font-weight: 650; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .ev.watch { font-weight: 500; opacity: 0.75; }
  .list { display: none; list-style: none; margin: 0; padding: 0; }
  .list button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 7px 0; text-align: left; font-size: 14px; }
  .who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when { font-weight: 600; white-space: nowrap; }
  .none { padding: 8px 0; }
  @media (max-width: 760px) { .grid { display: none; } .list { display: block; } }
</style>
