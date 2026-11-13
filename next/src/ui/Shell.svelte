<script lang="ts">
  import { sign, signedPct } from '../core/format.ts';
  import { isOvernight } from '../core/market.ts';
  import { ALL } from '../core/model.ts';
  import { usd } from '../core/format.ts';
  import { INDEXES, fetchFutures } from '../data/quotes.ts';
  import { PAGES, app } from '../state/app.svelte.ts';
  import type { PageId } from '../state/app.svelte.ts';
  import { theme } from '../state/theme.svelte.ts';
  import SymbolSheet from './SymbolSheet.svelte';
  import ActionDialog from './dialogs/ActionDialog.svelte';
  import CashDialog from './dialogs/CashDialog.svelte';
  import ContribDialog from './dialogs/ContribDialog.svelte';
  import ShareDialog from './dialogs/ShareDialog.svelte';
  import TargetsDialog from './dialogs/TargetsDialog.svelte';
  import TransferDialog from './dialogs/TransferDialog.svelte';
  import TxDialog from './dialogs/TxDialog.svelte';
  import WatchDialog from './dialogs/WatchDialog.svelte';
  import Activity from './pages/Activity.svelte';
  import Analysis from './pages/Analysis.svelte';
  import Allocation from './pages/Allocation.svelte';
  import Overview from './pages/Overview.svelte';
  import Positions from './pages/Positions.svelte';
  import Today from './pages/Today.svelte';
  import Seg from './parts/Seg.svelte';

  const t = app.t;
  const TITLES: Record<PageId, string> = { overview: 'Overview', today: 'Today Plan', positions: 'Positions', allocation: 'Allocation', analysis: 'Analysis', activity: 'Activity' };
  const SESSION = { open: 'Market open', pre: 'Pre-market', post: 'After hours', closed: 'Market closed' };

  const views = $derived([{ value: ALL, label: t('All') }, ...app.shownPorts.map(p => ({ value: p, label: p }))]);
  const indexes = $derived(Object.entries(INDEXES).map(([sym, i]) => ({ label: i.label, q: app.quotes[sym] })).filter(i => i.q?.price != null));
  const age = $derived.by(() => {
    if (!app.quotesAt) return '';
    const s = Math.max(0, Math.round((app.now - app.quotesAt) / 1000));
    return s < 90 ? t('prices just now') : `${t('prices')} ${Math.round(s / 60)} ${t('min ago')}`;
  });

  // Through the US night no stock trades, but index futures do: show those in place of the indexes.
  const overnight = $derived(isOvernight(new Date(app.now)));
  let futures = $state.raw<{ label: string; changePct: number }[]>([]);
  let futuresAt = 0;
  $effect(() => {
    if (!overnight || app.now - futuresAt < 300_000) return;
    futuresAt = app.now;
    fetchFutures().then(f => { futures = f; }).catch(() => {});
  });

  // A notification fires once, when a plan level is first reached. The first pass after prices
  // arrive only records what is already true, so opening the app never sets off a burst.
  let known: Set<string> | null = null;
  $effect(() => {
    const hits = app.alerts.filter(a => a.hit);
    if (known && app.prefs.notify && 'Notification' in window && Notification.permission === 'granted') {
      for (const a of hits) {
        if (known.has(a.key)) continue;
        const what = a.kind === 'stop' ? t('Stop loss reached') : a.kind === 'profit' ? `${t('Take profit')} ${a.step} ${t('reached')}` : `${t('Buy')} ${a.step} ${t('reached')}`;
        new Notification(`${a.symbol}: ${what}`, { body: `${t('Level')} ${usd(a.level)}`, tag: a.key });
      }
    }
    if (app.quotesAt) known = new Set(hits.map(a => a.key));
  });
  async function setNotify(on: string) {
    if (on === 'on' && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    app.prefs.notify = on === 'on' && 'Notification' in window && Notification.permission === 'granted';
  }
  const flipPort = (p: string) => {
    const h = app.prefs.hiddenPorts;
    app.prefs.hiddenPorts = h.includes(p) ? h.filter(x => x !== p) : [...h, p];
  };

  let menu = $state(false);
  let menuEl = $state<HTMLElement>();
  const onDocClick = (e: MouseEvent) => { if (menu && menuEl && !menuEl.contains(e.target as Node)) menu = false; };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (app.dialog) app.dialog = null; else if (app.symbol) app.symbol = null; else menu = false; } };
</script>

<svelte:document onclick={onDocClick} onkeydown={onKey} />

<header class="top">
  <div class="bar">
    <a class="brand" href="#/overview" onclick={e => { e.preventDefault(); app.go('overview'); }}><img src="./favicon-white.png" alt="" width="30" height="30" /><span>{app.profile?.profileName || 'Portfolio'}</span></a>

    <nav aria-label={t('Pages')}>
      {#each PAGES as p (p)}
        <a href="#/{p}" class:on={app.page === p} aria-current={app.page === p ? 'page' : undefined}
          onclick={e => { e.preventDefault(); app.go(p); }}>{t(TITLES[p])}</a>
      {/each}
    </nav>

    {#if app.shownPorts.length > 1}
      <div class="ports"><Seg small label={t('Portfolio')} options={views} value={app.view} onchange={v => app.prefs.view = v} /></div>
    {/if}

    <div class="tools">
      {#if app.saving}<span class="saving small muted" role="status">{t('Saving')}</span>{/if}
      {#if app.canWrite}
        <button class="btn primary trade" onclick={() => app.dialog = { kind: 'trade' }}>{t('Record a trade')}</button>
      {/if}
      <button class="icon-btn" onclick={theme.toggle} aria-label={theme.dark ? t('Switch to light mode') : t('Switch to dark mode')} title={theme.dark ? t('Switch to light mode') : t('Switch to dark mode')}>
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          {#if theme.dark}
            <circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
          {:else}
            <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2z" />
          {/if}
        </svg>
      </button>
      <button class="icon-btn" class:spin={app.refreshing} onclick={() => app.load(true)} disabled={app.refreshing} aria-label={t('Refresh')} title={t('Refresh')}>
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6.3M20 4v7h-7" /></svg>
      </button>
      <div class="menu-wrap" bind:this={menuEl}>
        <button class="icon-btn" onclick={() => menu = !menu} aria-expanded={menu} aria-label={t('Settings')} title={t('Settings')}>
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
        </button>
        {#if menu}
          <div class="menu">
            <div class="mrow"><span>{t('Language')}</span><Seg small bind:value={app.prefs.lang} options={[{ value: 'en', label: 'EN' }, { value: 'th', label: 'ไทย' }]} /></div>
            <div class="mrow"><span>{t('Currency')}</span><Seg small bind:value={app.prefs.currency} options={[{ value: 'USD', label: '$' }, { value: 'THB', label: '฿' }]} /></div>
            <div class="mrow"><span>{t('Theme')}</span><Seg small bind:value={app.prefs.theme} options={[{ value: 'auto', label: t('Auto') }, { value: 'light', label: t('Light') }, { value: 'dark', label: t('Dark') }]} /></div>
            <div class="mrow"><span>{t('Prices from')}</span><Seg small bind:value={app.prefs.priceSource} onchange={() => app.refreshQuotes()} options={[{ value: 'auto', label: t('Auto') }, { value: 'cnbc', label: 'CNBC' }, { value: 'sheet', label: t('Sheet') }]} /></div>
            <div class="mrow"><span>{t('Notify at plan levels')}</span><Seg small value={app.prefs.notify ? 'on' : 'off'} onchange={setNotify} options={[{ value: 'off', label: t('Off') }, { value: 'on', label: t('On') }]} /></div>
            <div class="mrow"><span>{t('Flag drift beyond')}</span><Seg small value={String(app.prefs.driftBand)} onchange={v => app.prefs.driftBand = Number(v)} options={[{ value: '0', label: t('Off') }, { value: '10', label: '10%' }, { value: '25', label: '25%' }, { value: '50', label: '50%' }]} /></div>
            {#if app.ports.length > 1}
              <div class="mlabel">{t('Portfolios in the switcher')}</div>
              <div class="mports">
                {#each app.ports as p (p)}
                  <label class="check"><input type="checkbox" checked={!app.prefs.hiddenPorts.includes(p)} onchange={() => flipPort(p)} /> {p}</label>
                {/each}
              </div>
            {/if}
            <hr>
            {#if app.profiles.length > 1}
              <div class="mlabel">{t('Account')}</div>
              {#each app.profiles as p (p.id)}
                <button class="mitem" class:on={p.id === app.profile?.id} onclick={() => { menu = false; app.switchProfile(p.id); }}>{p.profileName}</button>
              {/each}
            {/if}
            {#if app.canWrite}
              <button class="mitem" onclick={() => { menu = false; app.dialog = { kind: 'cash' }; }}>{t('Cash and limits…')}</button>
            {/if}
            {#if app.profile && !app.profile.ephemeral}
              <button class="mitem" onclick={() => { menu = false; app.editing = app.profile; app.status = 'setup'; }}>{t('Edit this account…')}</button>
            {/if}
            <button class="mitem" onclick={() => { menu = false; app.editing = null; app.status = 'setup'; }}>{t('Add an account…')}</button>
          </div>
        {/if}
      </div>
    </div>
  </div>
</header>

<div class="frame">
  <div class="context">
    <span class="spacer"></span>
    <div class="indexes">
      {#if overnight && futures.length}
        <span class="muted nowrap">{t('Futures')}</span>
        {#each futures as f (f.label)}
          <span class="nowrap"><span class="muted">{f.label}</span> <span class="strong {sign(f.changePct)}">{signedPct(f.changePct)}</span></span>
        {/each}
      {:else}
        {#each indexes as i (i.label)}
          <span class="nowrap"><span class="muted">{i.label}</span> <span class="strong {sign(i.q.changePct)}">{signedPct(i.q.changePct)}</span></span>
        {/each}
      {/if}
    </div>
    <span class="sess nowrap"><span class="led {app.session}"></span>{t(SESSION[app.session])}{#if age}<span class="muted">, {age}</span>{/if}</span>
  </div>

  {#if app.error}
    <div class="banner" role="alert">{t('Refresh failed')}: {app.error}</div>
  {/if}

  <main>
    {#if app.page === 'overview'}<Overview />
    {:else if app.page === 'today'}<Today />
    {:else if app.page === 'positions'}<Positions />
    {:else if app.page === 'allocation'}<Allocation />
    {:else if app.page === 'analysis'}<Analysis />
    {:else}<Activity />{/if}
  </main>
</div>

{#if app.symbol}<SymbolSheet sym={app.symbol} />{/if}
{#if app.dialog}
  {@const d = app.dialog}
  <!-- Keyed, so switching portfolio inside a form starts it again from that portfolio's saved values. -->
  {#if d.kind === 'trade' || d.kind === 'plan' || d.kind === 'details'}
    <!-- One workspace per symbol: moving between its tasks must not rebuild the chart beside them. -->
    {#key d.symbol ?? ''}<ActionDialog start={d} />{/key}
  {:else}
  {#key d}
    {#if d.kind === 'cash'}<CashDialog />
    {:else if d.kind === 'contrib'}<ContribDialog row={d.row} />
    {:else if d.kind === 'tx'}<TxDialog row={d.row} />
    {:else if d.kind === 'targets'}<TargetsDialog portfolio={d.portfolio} />
    {:else if d.kind === 'transfer'}<TransferDialog symbol={d.symbol} />
    {:else if d.kind === 'watch'}<WatchDialog />
    {:else if d.kind === 'share'}<ShareDialog blob={d.blob} name={d.name} />{/if}
  {/key}
  {/if}
{/if}

{#if app.failed.length}
  <div class="toasts" role="alert">
    {#each app.failed as f (f.id)}
      <div class="toast">
        <span><strong>{f.label}</strong> {t('was not saved to the sheet.')}</span>
        <button class="btn" onclick={() => app.retrySave(f.id)}>{t('Try again')}</button>
        <button class="icon-btn" onclick={() => app.dismissSave(f.id)} aria-label={t('Dismiss')}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .top { position: sticky; top: 0; z-index: var(--z-nav); background: color-mix(in oklab, var(--bg) 86%, transparent); backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); padding-top: env(safe-area-inset-top); }
  .bar { display: flex; align-items: stretch; gap: var(--sp-7); max-width: var(--page-w); margin: 0 auto; padding: 0 var(--gutter); min-height: 64px; }
  /* The logo is smaller than the bar is tall, so adding it leaves the header the height it was. */
  .brand { align-self: center; display: flex; align-items: center; gap: 10px; min-width: 0; font: 750 23px/1 var(--font-display); letter-spacing: -0.035em; color: var(--ink); text-decoration: none; max-width: 40vw; }
  .brand img { flex: none; width: 30px; height: 30px; border-radius: 8px; }
  .brand span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  nav { display: flex; align-items: stretch; gap: var(--sp-6); flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  nav::-webkit-scrollbar { display: none; }
  nav a { position: relative; display: flex; align-items: center; font-size: 15px; font-weight: 500; color: var(--muted); text-decoration: none; white-space: nowrap; transition: color 0.15s var(--ease); }
  nav a:hover { color: var(--ink); }
  nav a.on { color: var(--ink); }
  /* The active page is marked on the header's own bottom edge. */
  nav a.on::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 3px; border-radius: 3px 3px 0 0; background: var(--ink); }

  .ports { display: flex; align-items: center; min-width: 0; }
  .tools { display: flex; align-items: center; gap: 2px; margin-right: -8px; }
  .trade { margin-right: 6px; white-space: nowrap; }
  .saving { margin-right: 10px; white-space: nowrap; }
  .toasts { position: fixed; z-index: var(--z-toast); left: 50%; translate: -50% 0; bottom: calc(var(--sp-5) + env(safe-area-inset-bottom)); display: grid; gap: var(--sp-2); width: min(520px, calc(100vw - 24px)); }
  .toast { display: flex; align-items: center; gap: var(--sp-3); padding: 10px 10px 10px 18px; border-radius: 999px; background: var(--ink); color: var(--bg); font-size: 14px; box-shadow: var(--shadow); }
  .toast span { flex: 1; min-width: 0; }
  .toast .btn { background: color-mix(in oklab, var(--bg) 18%, transparent); color: var(--bg); white-space: nowrap; }
  .toast .icon-btn { color: var(--bg); width: 32px; height: 32px; }
  .spin svg { animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .menu-wrap { position: relative; }
  .menu { position: absolute; right: 0; top: calc(100% + 10px); width: 320px; padding: var(--sp-4); display: grid; gap: var(--sp-3); z-index: var(--z-pop); background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
  .mrow { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); font-size: 14px; color: var(--ink-2); }
  .mports { display: flex; flex-wrap: wrap; gap: 6px var(--sp-4); padding: 0 var(--sp-2); }
  .menu { max-height: calc(100dvh - 90px); overflow-y: auto; }
  .mlabel { font-size: 12px; color: var(--muted); padding: 0 var(--sp-2); }
  .mitem { display: block; width: 100%; text-align: left; padding: 8px var(--sp-2); border-radius: var(--radius-sm); font-size: 14px; color: var(--ink); text-decoration: none; }
  .mitem:hover { background: var(--wash); }
  .mitem.on { font-weight: 650; }
  .mitem.on::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--ink); margin-right: 8px; vertical-align: middle; }
  hr { border: 0; border-top: 1px solid var(--line-soft); margin: 0; width: 100%; }

  .frame { max-width: var(--page-w); margin: 0 auto; padding: 0 var(--gutter) calc(var(--sp-9) + env(safe-area-inset-bottom)); }
  .context { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-3) var(--sp-5); padding: var(--sp-5) 0; font-size: 13px; }
  .indexes { display: flex; gap: var(--sp-5); }
  .sess { display: inline-flex; align-items: center; gap: 8px; color: var(--ink-2); }
  .sess .muted { margin-left: -4px; }
  .led { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  .led.open { background: var(--gain); box-shadow: 0 0 0 4px color-mix(in oklab, var(--gain) 22%, transparent); }
  .led.pre, .led.post { background: var(--honey); }
  .banner { margin-bottom: var(--sp-4); padding: 12px 16px; border-radius: var(--radius-sm); background: color-mix(in oklab, var(--loss) 14%, var(--card)); color: var(--loss); font-size: 13px; }

  @media (max-width: 1000px) { .indexes { display: none; } }
  /* Between a phone and a wide desk the header cannot hold pages, portfolios and tools on one line:
     the switcher drops to a second line of the same sticky header rather than squeezing the pages. */
  @media (max-width: 1280px) and (min-width: 761px) {
    .bar { flex-wrap: wrap; row-gap: 0; }
    .bar > .brand, .bar > nav, .bar > .tools { min-height: 64px; }
    .ports { order: 5; flex: 0 0 100%; padding-bottom: 12px; }
  }
  @media (max-width: 760px) {
    .bar { flex-wrap: wrap; gap: 0 var(--sp-4); min-height: 0; }
    .brand { flex: 1; font-size: 20px; padding: 14px 0 6px; }
    .brand img { width: 26px; height: 26px; }
    .tools { padding-top: 6px; }
    .trade { padding: 7px 13px; }
    .toast { border-radius: var(--radius); flex-wrap: wrap; }
    nav { order: 3; flex: 0 0 100%; gap: var(--sp-5); }
    /* On a phone the switcher takes its own row under the pages, still inside the sticky header. */
    .ports { order: 4; flex: 0 0 100%; padding-bottom: 10px; }
    nav a { padding: 10px 0 12px; }
    .context { padding: var(--sp-4) 0; }
  }
</style>
