<script lang="ts">
  import { fifoKey } from '../core/fifo.ts';
  import { baht, date, pct, qty, sign, signedPct, usd } from '../core/format.ts';
  import { txMarketDate } from '../core/market.ts';
  import { ALL } from '../core/model.ts';
  import { nextTranche, planKey, trancheDollars } from '../core/plan.ts';
  import { pictureUrls } from '../data/pictures.ts';
  import { app } from '../state/app.svelte.ts';
  import AskAi from './parts/AskAi.svelte';
  import Logo from './parts/Logo.svelte';
  import PriceChart from './parts/PriceChart.svelte';
  import { planLevels } from './workspace.svelte.ts';
  import { drawSymbolCard } from './share.ts';

  let { sym }: { sym: string } = $props();

  // Plans and details belong to one portfolio. In the combined view that is where most of it is held.
  const home = $derived(app.homePort(sym));
  const plan = $derived(app.plans[planKey(home, sym)] ?? null);
  const ladder = $derived.by(() => {
    if (!plan) return null;
    const m = app.portModel(home);
    const p = m.positions.find(x => x.symbol === sym);
    const target = p?.target ?? m.watchlist.find(x => x.symbol === sym)?.target ?? 0;
    const td = target * m.investable;
    return { td, dollars: trancheDollars(plan.tranches, td > 0 ? (p?.currentValue || 0) / td * 100 : 0, td), next: nextTranche(plan, price)?.index ?? -1 };
  });
  const away = (p: number | null) => p && price ? `${p < price ? '' : '+'}${((p / price - 1) * 100).toFixed(1)}%` : '';
  const canMove = $derived(app.ports.length > 1 && app.rawRows.some(r => r.symbol === sym && (r.qty || 0) > 0));
  const homeRow = $derived(app.rawRows.find(r => r.symbol === sym && r.portfolio === home));

  const t = app.t;
  const money = $derived(app.money);
  const close = () => { app.symbol = null; };

  const pos = $derived(app.model.positions.find(p => p.symbol === sym) ?? null);
  const watch = $derived(app.model.watchlist.find(w => w.symbol === sym) ?? null);
  const info = $derived(pos ?? watch);
  const quote = $derived(app.quotes[sym]);
  const price = $derived(pos?.price ?? quote?.price ?? watch?.price ?? null);
  const dayPct = $derived(pos?.dayChangePct ?? quote?.changePct ?? null);
  const dayAbs = $derived(pos?.dayChange ?? quote?.change ?? null);

  /** The closes the chart is showing, for the share picture. */
  let points = $state<{ d: string; v: number }[]>([]);

  // ── Lots, trades, dividends: scoped to the active view ──
  const ports = $derived(app.view === ALL ? app.ports : [app.view]);
  const lots = $derived.by(() => {
    if (!app.fifo) return [];
    const out: { port: string; shares: number; cost: number; date: string }[] = [];
    for (const port of ports) {
      for (const [shares, cost, d] of app.fifo.books.get(fifoKey(port, sym)) ?? []) {
        if (shares > 1e-9) out.push({ port, shares, cost, date: d });
      }
    }
    // Newest first, like the trades above it. Which lot a sale takes is unchanged: still the oldest.
    return out.sort((a, b) => b.date.localeCompare(a.date));
  });
  const showPort = $derived(ports.length > 1 && new Set(lots.map(l => l.port)).size > 1);
  const trades = $derived(app.viewTxs.filter(x => x.ticker === sym)
    .sort((a, b) => (b.dateStr + b.time).localeCompare(a.dateStr + a.time) || b.row - a.row));
  const sold = $derived(app.sales.filter(s => s.ticker === sym));
  const realized = $derived(sold.reduce((s, x) => s + x.pnl, 0));
  const divs = $derived(app.dividends.events.filter(d => d.ticker === sym));
  const divNet = $derived(divs.reduce((s, d) => s + d.net, 0));
  const total = $derived((pos?.pnl ?? 0) + realized + divNet);

  // ── Chart extras: buys and sales marked on their US market day, and a candle view ──
  const marks = $derived(trades.filter(x => x.type === 'Buy' || x.type === 'Sell').map(x => ({ d: txMarketDate(x.dateStr, x.time), type: x.type, shares: x.shares, price: x.price })));
  const levels = $derived(planLevels(t, pos?.avgPrice, plan));

  // ── Where it sits: its share of the tab, and of each tag it carries ──
  const shares = $derived.by(() => {
    if (!pos) return [];
    const of = (label: string, list: typeof app.model.positions) => {
      const sum = list.reduce((s, p) => s + p.currentValue, 0);
      return list.length > 1 && sum > 0 ? [{ label, pct: pos.currentValue / sum * 100, n: list.length }] : [];
    };
    const all = app.model.positions;
    return [
      ...of(app.view === ALL ? t('the holdings') : app.view, all),
      ...(pos.sector ? of(pos.sector, all.filter(p => p.sector === pos.sector)) : []),
      ...(pos.custom ? of(pos.custom, all.filter(p => p.custom === pos.custom)) : []),
      ...(pos.myGroup ? of(pos.myGroup, all.filter(p => p.myGroup === pos.myGroup)) : []),
    ];
  });

  // ── The research picture saved for this symbol, if there is one (see data/pictures.ts) ──
  // Each address is tried in turn; a miss moves to the next, and running out leaves nothing shown.
  const picUrls = $derived(pictureUrls(sym));
  let picStep = $state(0);
  let picShown = $state(false);
  let picOpen = $state(false);
  $effect(() => { void sym; picStep = 0; picShown = false; picOpen = false; });
  const picUrl = $derived(picUrls[picStep] ?? null);
  // While the picture is open full size, Escape closes it and not the whole symbol window behind it.
  function picKey(e: KeyboardEvent) {
    if (!picOpen || e.key !== 'Escape') return;
    e.stopPropagation(); e.preventDefault();
    picOpen = false;
  }

  const aiFacts = $derived(pos
    ? `Holds ${qty(pos.qty)} shares at an average cost of ${usd(pos.avgPrice)}. Price now ${usd(pos.price)}. Unrealized ${usd(pos.pnl)} (${signedPct(pos.pnlPct)}). Weight ${pct(pos.weightPct, 1)} of the portfolio${pos.target ? `, target ${pct(pos.target * 100, 1)}` : ''}. Sector: ${pos.sector || 'unknown'}.${plan?.sl ? ` Stop loss at ${usd(plan.sl)}.` : ''}${plan?.note ? ` Their own note: ${plan.note}` : ''}`
    : `Does not hold it; it is on the watchlist. Price now ${usd(price)}.`);

  // ── Thesis: why it is held, in the holder's own words. Kept as the plan's note. ──
  let writing = $state(false);
  let thesis = $state('');
  const startThesis = () => { thesis = plan?.note ?? ''; writing = true; };
  function saveThesis() {
    app.savePlan(home, sym, { ...(plan ?? { sl: null, note: '', tranches: [], trims: [] }), note: thesis.trim().slice(0, 600) }, null);
    writing = false;
  }
  const focusEnd = (el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); };

  const signedBaht = (n: number) => (n >= 0 ? '+' : '') + baht(n);
  const signedUsd = (n: number) => (n >= 0 ? '+' : '') + usd(n);
  let drawing = $state(false);
  async function share() {
    if (drawing) return;
    drawing = true;
    try {
      const blob = await drawSymbolCard({
        symbol: sym, name: info?.name || '', price: usd(price), dayPct, dayLabel: t('today'),
        points, avg: pos?.avgPrice ?? null, marks,
        labels: { avg: t('Avg cost'), buy: t('Buy'), sell: t('Sell') },
        facts: [
          ...(pos ? [[
            { label: t('Shares'), value: qty(pos.qty) }, { label: t('Avg cost'), value: usd(pos.avgPrice) }, { label: t('Weight'), value: pct(pos.weightPct, 1) },
          ]] : []),
          [
            // Each return in dollars, with the same amount in baht (at today's rate) under it.
            ...(pos ? [{ label: t('Unrealized'), value: signedUsd(pos.pnl), note: `${signedBaht(pos.pnl * app.fx)} (${signedPct(pos.pnlPct)})`, tone: pos.pnl }] : []),
            ...(sold.length ? [{ label: t('Realized'), value: signedUsd(realized), note: signedBaht(realized * app.fx), tone: realized }] : []),
            ...(divs.length ? [{ label: t('Dividends'), value: signedUsd(divNet), note: signedBaht(divNet * app.fx), tone: divNet }] : []),
          ],
        ].filter(row => row.length),
      });
      app.dialog = { kind: 'share', blob, name: `${sym}-${app.today}.png` };
    } finally { drawing = false; }
  }
</script>

<svelte:window onkeydowncapture={picKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={close}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label={sym}>
  <header>
    <Logo {sym} size={48} />
    <div class="who">
      <div class="sym">{sym}</div>
      <div class="muted small name">{info?.name || ''}</div>
    </div>
    <div class="px">
      <div class="price">{price == null ? '—' : usd(price)}</div>
      {#if dayPct != null}<div class="small {sign(dayPct)}">{dayAbs == null ? '' : (dayAbs > 0 ? '+' : '') + usd(dayAbs) + ' '}({signedPct(dayPct)}) {t('today')}</div>{/if}
    </div>
    <button class="icon-btn" onclick={close} aria-label={t('Close')}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </header>

  <div class="body">
    {#if app.canWrite}
      <div class="acts">
        <button class="btn primary" onclick={() => app.dialog = { kind: 'trade', symbol: sym, type: 'Buy' }}>{t('Buy')}</button>
        {#if pos}<button class="btn" onclick={() => app.dialog = { kind: 'trade', symbol: sym, type: 'Sell' }}>{t('Sell')}</button>{/if}
        <button class="btn" onclick={() => app.dialog = { kind: 'plan', symbol: sym, portfolio: home }}>{plan ? t('Edit plan') : t('Make a plan')}</button>
        {#if canMove}<button class="btn" onclick={() => app.dialog = { kind: 'transfer', symbol: sym }}>{t('Move shares')}</button>{/if}
        {#if homeRow}<button class="btn" onclick={() => app.dialog = { kind: 'details', symbol: sym, portfolio: home }}>{t('Tags and corrections')}</button>{/if}
        <button class="btn" onclick={share} disabled={drawing}>{t('Share')}</button>
        {#if homeRow && !(homeRow.qty || 0)}<button class="btn" onclick={() => { app.removeSymbol(sym, home); close(); }}>{t('Remove from the watchlist')}</button>{/if}
      </div>
    {/if}
    {#if pos?.ext}
      <p class="small {sign(pos.extPct)}">{pos.ext === 'PRE' ? t('Pre') : t('After')} {usd(pos.extPrice)} {signedPct(pos.extPct)}</p>
    {/if}
    {#if info?.sector || info?.industry || info?.category}
      <div class="tags">
        {#each [info.sector, info.industry, info.category, info.custom, info.myGroup].filter(Boolean) as tag}<span class="pill">{tag}</span>{/each}
      </div>
    {/if}

    {#if pos}
      <dl class="facts">
        <div><dt>{t('Shares')}</dt><dd>{qty(pos.qty)}</dd></div>
        <div><dt>{t('Avg cost')}</dt><dd>{usd(pos.avgPrice)}</dd></div>
        <div><dt>{t('Value')}</dt><dd>{money(pos.currentValue)}</dd></div>
        <div><dt>{t('Weight')}</dt><dd>{pct(pos.weightPct, 1)}{#if pos.target}<span class="muted small">{' '}/ {pct(pos.target * 100, 1)}</span>{/if}</dd></div>
        <div><dt>{t('Unrealized')}</dt><dd class={sign(pos.pnl)}>{money.signed(pos.pnl)} <span class="small">{signedPct(pos.pnlPct)}</span></dd></div>
        <div><dt>{t('Realized')}</dt><dd class={sign(realized)}>{sold.length ? money.signed(realized) : '—'}</dd></div>
        <div><dt>{t('Dividends')}</dt><dd>{divs.length ? money(divNet) : '—'}</dd></div>
        <div><dt>{t('Total gain')}</dt><dd class={sign(total)}>{money.signed(total)}</dd></div>
      </dl>
    {:else if sold.length || divs.length}
      <dl class="facts">
        <div><dt>{t('Realized')}</dt><dd class={sign(realized)}>{money.signed(realized)}</dd></div>
        <div><dt>{t('Dividends')}</dt><dd>{money(divNet)}</dd></div>
      </dl>
    {/if}

    {#if app.canWrite || plan?.note}
      <section>
        <div class="sec-head"><h3>{t('Thesis')}</h3>{#if app.ports.length > 1}<span class="muted small">{home}</span>{/if}</div>
        {#if writing}
          <textarea class="input" rows="4" maxlength="600" bind:value={thesis} use:focusEnd aria-label={t('Thesis')}
            onkeydown={e => { if (e.key === 'Escape') { e.stopPropagation(); writing = false; } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveThesis(); }}></textarea>
          <div class="acts tight">
            <button class="btn primary" onclick={saveThesis}>{t('Save')}</button>
            <button class="btn" onclick={() => writing = false}>{t('Cancel')}</button>
          </div>
        {:else if plan?.note}
          {#if app.canWrite}<button class="thesis" title={t('Click to edit')} onclick={startThesis}>{plan.note}</button>{:else}<p class="thesis">{plan.note}</p>{/if}
        {:else}
          <button class="btn" onclick={startThesis}>{t('Write down why you hold it')}</button>
        {/if}
      </section>
    {/if}

    {#if plan && ladder}
      <section>
        <div class="sec-head">
          <h3>{t('Plan')}</h3>
          {#if app.ports.length > 1}<span class="muted small">{home}</span>{/if}
        </div>
        <div class="table-scroll">
          <table class="tbl">
            <thead><tr><th>{t('Step')}</th><th class="n">{t('Price')}</th><th class="n">{t('From now')}</th><th class="n">{t('Size')}</th></tr></thead>
            <tbody>
              {#each plan.trims as x}
                <tr><td>{t('Take profit')}</td><td class="n">{usd(x.price)}</td><td class="n ink2">{away(x.price)}</td><td class="n">{x.pct ? pct(x.pct, 0) + ' ' + t('of target') : ''}</td></tr>
              {/each}
              {#each plan.tranches as x, i}
                {#if x.price != null || x.cumPct > 0}
                  <tr class:next={i === ladder.next}>
                    <td>{t('Buy')} {i + 1}{#if i === ladder.next}{' '}<span class="pill">{t('next')}</span>{/if}</td>
                    <td class="n">{usd(x.price)}</td><td class="n ink2">{away(x.price)}</td>
                    <td class="n">{ladder.td > 0 ? usd(ladder.dollars[i]) : pct(x.cumPct, 0)}</td>
                  </tr>
                {/if}
              {/each}
              {#if plan.sl != null}
                <tr><td>{t('Stop loss')}</td><td class="n {price != null && price <= plan.sl ? 'loss' : ''}">{usd(plan.sl)}</td><td class="n ink2">{away(plan.sl)}</td><td></td></tr>
              {/if}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    <section>
      <div class="sec-head">
        <h3>{t('Price')}</h3>
      </div>
      <PriceChart {sym} {levels} {marks} bind:points />
    </section>

    {#if shares.length}
      <section>
        <div class="sec-head"><h3>{t('Where it sits')}</h3></div>
        <ul class="shares">
          {#each shares as s (s.label)}
            <li><span class="lab">{t('Share of')} {s.label} <span class="muted small">{s.n} {t('holdings')}</span></span><span class="strack"><span style:width="{s.pct}%"></span></span><span class="strong">{pct(s.pct, 1)}</span></li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if trades.length}
      <section>
        <div class="sec-head"><h3>{t('Trades')}</h3><span class="small muted">{trades.length}</span></div>
        <div class="table-scroll">
          <table class="tbl">
            <thead><tr><th>{t('Date')}</th><th>{t('Type')}</th><th class="n">{t('Shares')}</th><th class="n">{t('Price')}</th><th class="n" title={t('Today’s price against this buy’s own price')}>{t('Gain')}</th><th class="n">{t('Value')}</th></tr></thead>
            <tbody>
              {#each trades as x (x.row)}
                {@const g = x.type === 'Buy' && price && x.price > 0 ? (price / x.price - 1) * 100 : null}
                <tr title={x.note || undefined}>
                  <td>{date(x.dateStr)}</td>
                  <td><span class="pill {x.type === 'Buy' ? 'gain' : x.type === 'Sell' ? 'loss' : ''}">{t(x.type)}</span></td>
                  <td class="n">{qty(x.shares)}</td>
                  <td class="n">{usd(x.price)}</td>
                  <td class="n {sign(g)}">{g == null ? '' : signedPct(g)}</td>
                  <td class="n">{money(x.tradeValue ?? x.shares * x.price)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {:else if !app.ledgerLoaded}
      <p class="empty">{t('Loading the trade ledger…')}</p>
    {/if}

    {#if lots.length}
      <section>
        <div class="sec-head"><h3>{t('Open lots')}</h3><span class="small muted">{t('newest shown first, oldest sold first')}</span></div>
        <div class="table-scroll">
          <table class="tbl">
            <thead><tr><th>{t('Bought')}</th><th class="n">{t('Shares')}</th><th class="n">{t('Cost')}</th><th class="n">{t('Gain')}</th>{#if showPort}<th>{t('Portfolio')}</th>{/if}</tr></thead>
            <tbody>
              {#each lots as l, i (i)}
                {@const g = price == null ? null : (price - l.cost) * l.shares}
                <tr>
                  <td>{date(l.date)}</td>
                  <td class="n">{qty(l.shares)}</td>
                  <td class="n">{usd(l.cost)}</td>
                  <td class="n {sign(g)}">{g == null ? '—' : money.signed(g)}<span class="sub {sign(g)}">{g == null || !l.cost ? '' : signedPct((price! / l.cost - 1) * 100, 1)}</span></td>
                  {#if showPort}<td class="ink2">{l.port}</td>{/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    {#if divs.length}
      <section>
        <div class="sec-head"><h3>{t('Dividends')}</h3><span class="small muted">{money(divNet)} {t('After withholding').toLowerCase()}</span></div>
        <div class="table-scroll">
          <table class="tbl">
            <thead><tr><th>{t('Ex-date')}</th><th class="n">{t('Shares held')}</th><th class="n">{t('Gross')}</th><th class="n">{t('After withholding')}</th></tr></thead>
            <tbody>
              {#each [...divs].sort((a, b) => b.date.localeCompare(a.date)) as d, i (i)}
                <tr><td>{date(d.date)}</td><td class="n">{qty(d.shares)}</td><td class="n ink2">{money(d.gross)}</td><td class="n">{money(d.net)}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    {#if picUrl}
      <!-- Hidden until it loads, so a symbol with no picture leaves no empty box. Never lazy: a hidden image would not load at all. -->
      <section hidden={!picShown}>
        <div class="sec-head"><h3>{t('Research picture')}</h3><span class="small muted">{t('Click to see it full size')}</span></div>
        <button class="picbtn" onclick={() => picOpen = true} aria-label="{sym} {t('Research picture')}, {t('Click to see it full size')}">
          <img class="pic" src={picUrl} alt="{sym} {t('Research picture')}" onload={() => picShown = true} onerror={() => picStep++} />
        </button>
      </section>
    {/if}

    {#if app.profile?.geminiKey}
      {#key sym}<AskAi {sym} facts={aiFacts} />{/key}
    {/if}
  </div>
</div>

{#if picOpen && picUrl}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="lightbox" role="dialog" aria-modal="true" aria-label="{sym} {t('Research picture')}" tabindex="-1" onclick={() => picOpen = false}>
    <img src={picUrl} alt="{sym} {t('Research picture')}" />
    <button class="icon-btn" onclick={() => picOpen = false} aria-label={t('Close')}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: var(--z-sheet); background: color-mix(in oklab, #060912 62%, transparent); backdrop-filter: blur(3px); animation: fade 0.2s var(--ease); }
  /* A centred window on a desk-sized screen, a sheet rising from the bottom on a phone. */
  .sheet { position: fixed; z-index: var(--z-sheet); left: 50%; top: 50%; translate: -50% -50%; width: min(980px, calc(100vw - 32px)); max-height: min(92dvh, 940px); display: flex; flex-direction: column; overflow: hidden; background: var(--card); border-radius: 28px; box-shadow: var(--shadow); animation: rise 0.3s var(--ease); }
  @keyframes fade { from { opacity: 0; } }
  @keyframes rise { from { transform: translateY(18px) scale(0.985); opacity: 0; } }
  header { display: flex; align-items: center; gap: var(--sp-4); padding: var(--sp-6) var(--sp-6) var(--sp-5); }
  .who { min-width: 0; flex: 1; }
  .sym { font: 750 clamp(28px, 4vw, 40px)/1 var(--font-display); letter-spacing: -0.04em; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 4px; font-size: 14px; }
  .px { text-align: right; }
  .price { font: 650 clamp(22px, 3vw, 30px)/1.1 var(--font-display); letter-spacing: -0.03em; }
  .px .small { font-size: 14px; font-weight: 500; margin-top: 2px; }
  header .icon-btn { align-self: flex-start; margin: -8px -8px 0 0; background: var(--wash); }
  .body { flex: 1; overflow-y: auto; padding: 0 var(--sp-6) calc(var(--sp-7) + env(safe-area-inset-bottom)); display: grid; gap: var(--sp-6); align-content: start; }
  .plot { position: relative; }
  .dot, .dotkey { width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--card); }
  .dot { position: absolute; margin: -4.5px 0 0 -4.5px; pointer-events: none; }
  .dot.buy, .dotkey.buy { background: var(--accent); }
  .dot.sell, .dotkey.sell { background: var(--honey); }
  .dotkey { display: inline-block; vertical-align: middle; margin: 0 4px 0 10px; }
  .shares { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-2); }
  .shares li { display: flex; align-items: center; gap: var(--sp-3); font-size: 14px; }
  .shares .lab { flex: 0 0 46%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .strack { flex: 1; height: 8px; border-radius: 4px; background: var(--wash); overflow: hidden; }
  .strack span { display: block; height: 100%; border-radius: 4px; background: var(--accent); }
  .picbtn { display: block; width: 100%; padding: 0; border-radius: var(--radius-sm); cursor: zoom-in; }
  .pic { display: block; width: 100%; border-radius: var(--radius-sm); }
  /* Above the symbol window, and closed on its own: a click anywhere, the cross, or Escape. */
  .lightbox { position: fixed; inset: 0; z-index: var(--z-dialog); display: grid; place-items: center; padding: clamp(12px, 3vw, 40px); background: color-mix(in oklab, #060912 88%, transparent); cursor: zoom-out; overflow: auto; }
  .lightbox img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: var(--radius-sm); }
  .lightbox .icon-btn { position: fixed; top: calc(14px + env(safe-area-inset-top)); right: 14px; background: color-mix(in oklab, #fff 16%, transparent); color: #fff; }
  .acts { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
  .acts .btn { padding: 9px 18px; font-size: 14px; }
  .thesis { display: block; width: 100%; margin: 0; padding: var(--sp-4); border-radius: var(--radius-sm); background: var(--sunk); text-align: left; font-size: 15px; line-height: 1.55; white-space: pre-wrap; }
  button.thesis:hover { background: var(--wash); }
  textarea { resize: vertical; font: inherit; line-height: 1.5; }
  .acts.tight { margin-top: var(--sp-3); }
  tr.next td { font-weight: 600; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--sp-5) 0; margin: 0; padding: var(--sp-5) 0; border-block: 1px solid var(--line); }
  .facts div { padding: 0 var(--sp-4); border-left: 1px solid var(--line-soft); min-width: 0; }
  dt { font-size: 13px; color: var(--muted); }
  dd { margin: 2px 0 0; font: 650 19px/1.2 var(--font-display); letter-spacing: -0.02em; white-space: nowrap; }
  dd .small { font: 500 13px var(--font); letter-spacing: 0; }
  section { min-width: 0; }
  .sec-head { display: flex; align-items: baseline; gap: var(--sp-3); padding-bottom: var(--sp-3); }
  h3 { font: 650 20px/1.15 var(--font-display); letter-spacing: -0.02em; }
  .chart { display: block; width: 100%; height: clamp(200px, 30vh, 300px); touch-action: pan-y; cursor: crosshair; }
  .line { fill: none; stroke: var(--ink); stroke-width: 2; stroke-linejoin: round; }
  .area { fill: color-mix(in oklab, var(--ink) 6%, transparent); }
  .avg { stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 5 5; }
  .cross { stroke: var(--muted); stroke-width: 1; }
  .axis { display: flex; justify-content: space-between; gap: var(--sp-3); padding-top: 8px; }
  .avgkey { display: inline-block; width: 16px; border-top: 2px dashed var(--accent); vertical-align: middle; margin: 0 4px 0 10px; }
  @media (max-width: 700px) {
    .sheet { left: 0; right: 0; top: auto; bottom: 0; translate: none; width: 100%; max-height: 94dvh; border-radius: 24px 24px 0 0; }
    header { padding: var(--sp-5) var(--sp-4) var(--sp-4); gap: var(--sp-3); }
    .body { padding-inline: var(--sp-4); }
    .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
