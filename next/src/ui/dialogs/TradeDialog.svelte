<script lang="ts">
  import { getContext, untrack } from 'svelte';
  import { DEFAULT_PORT } from '../../core/fifo.ts';
  import { qty as fmtQty, usd } from '../../core/format.ts';
  import { COMMISSION_RATE, VAT_RATE } from '../../core/fees.ts';
  import { ALL } from '../../core/model.ts';
  import { nextTranche, planKey, trancheDollars } from '../../core/plan.ts';
  import { DUST } from '../../core/trade.ts';
  import type { CashSource, TradeInput } from '../../core/trade.ts';
  import { ledgerNow } from '../../data/write.ts';
  import { app } from '../../state/app.svelte.ts';
  import Dialog from '../parts/Dialog.svelte';
  import Seg from '../parts/Seg.svelte';
  import { WORKSPACE } from '../workspace.svelte.ts';
  import type { Workspace } from '../workspace.svelte.ts';

  let { symbol: symbol0 = '', type: type0 = 'Buy' }: { symbol?: string; type?: 'Buy' | 'Sell' } = $props();

  const t = app.t;
  const close = () => { app.dialog = null; };
  const num = (s: string) => { const n = parseFloat(s.replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };
  const trim = (n: number, dp: number) => String(+n.toFixed(dp));

  // The date and time are fixed when the form opens: the backend recognises a re-sent trade by them.
  const opened = ledgerNow();
  let type = $state<'Buy' | 'Sell'>(untrack(() => type0));
  let symbolText = $state(untrack(() => symbol0));
  let picked = $state<string | null>(null);
  let dateStr = $state(opened.dateStr);
  let time = $state(opened.time);
  let priceText = $state<string | null>(null);
  let sharesText = $state('');
  let amountText = $state('');
  let last = $state<'shares' | 'amount'>('shares');
  let commissionFree = $state(false);
  let cashSource = $state<CashSource>('USD');
  let note = $state('');

  const symbol = $derived(symbolText.trim().toUpperCase());
  const known = $derived([...new Set(app.rawRows.map(r => r.symbol))].sort());

  // Where the trade goes unless told otherwise: the tab being viewed, else wherever most of it is held.
  const autoPort = $derived.by(() => {
    if (app.view !== ALL) return app.view;
    let best = DEFAULT_PORT, max = 0;
    for (const r of app.rawRows) if (r.symbol === symbol && (r.qty || 0) > max) { max = r.qty || 0; best = r.portfolio; }
    return app.ports.includes(best) ? best : app.ports[0] ?? DEFAULT_PORT;
  });
  // In the symbol workspace the portfolio is chosen once, above, for all three tasks.
  const ws = getContext<Workspace | undefined>(WORKSPACE);
  const portfolio = $derived(ws ? ws.portfolio : picked ?? autoPort);

  const live = $derived(app.quotes[symbol]?.price ?? app.rawRows.find(r => r.symbol === symbol)?.price ?? null);
  const priceShown = $derived(priceText ?? (live ? trim(live, 4) : ''));
  const price = $derived(num(priceShown));
  const shares = $derived(last === 'shares' ? num(sharesText) : price ? +(num(amountText) / price).toFixed(6) : 0);
  const sharesShown = $derived(last === 'shares' ? sharesText : shares ? trim(shares, 6) : '');
  const amountShown = $derived(last === 'amount' ? amountText : shares && price ? trim(shares * price, 2) : '');

  const input = $derived<TradeInput>({
    type, symbol, portfolio, shares, price, commissionFree, cashSource, dateStr,
    time: /^\d{2}:\d{2}$/.test(time) ? time + ':00' : time, note: note.trim(),
  });
  const fx = $derived(app.previewTrade(input));
  const wallet = $derived(app.registry.find(p => p.name === DEFAULT_PORT));
  const cashNow = $derived(cashSource === 'FCD' ? wallet?.fcd ?? 0 : wallet?.usd ?? 0);
  const cashAfter = $derived(cashSource === 'FCD' ? fx.fcd : fx.usd);

  const problem = $derived.by(() => {
    if (!symbol || !shares || !price) return ' ';
    if (!/^[A-Z0-9.^-]+$/.test(symbol)) return t('That is not a ticker symbol.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return t('Enter the date and time of the trade.');
    if (type === 'Sell' && shares > fx.oldQty + DUST) return `${t('You hold only')} ${fmtQty(fx.oldQty)} ${t('in')} ${portfolio}.`;
    return '';
  });

  // ── Shortcuts that fill in the size from the plan, the target or the cash on hand ──
  const pm = $derived(app.portModel(portfolio));
  const held = $derived(pm.positions.find(p => p.symbol === symbol));
  const chips = $derived.by(() => {
    const out: { label: string; amount?: number; shares?: number }[] = [];
    if (type === 'Sell') {
      if (fx.oldQty > 0) for (const f of [0.25, 0.5, 1]) out.push({ label: f === 1 ? `${t('Sell all')} ${fmtQty(fx.oldQty)}` : `${f * 100}%`, shares: fx.oldQty * f });
      return out;
    }
    const target = held?.target ?? pm.watchlist.find(w => w.symbol === symbol)?.target ?? 0;
    const td = target * pm.investable, value = held?.currentValue ?? 0;
    const plan = app.plans[planKey(portfolio, symbol)];
    const next = plan && price ? nextTranche(plan, price) : null;
    if (plan && next && td > 0) {
      const d = trancheDollars(plan.tranches, value / td * 100, td)[next.index];
      if (d > 0) out.push({ label: `${t('Buy')} ${next.index + 1} ${t('of the plan')}, ${usd(d)}`, amount: d });
    }
    if (td > value + 1) out.push({ label: `${t('Up to target')}, ${usd(td - value)}`, amount: td - value });
    // Leave room for the fee, so "all" does not overdraw by the commission.
    const all = app.limits.spendable / (1 + COMMISSION_RATE * (1 + VAT_RATE));
    if (all > 1) out.push({ label: t('A quarter of spendable cash'), amount: all / 4 }, { label: t('All spendable cash'), amount: all });
    return out;
  });
  function pick(c: { amount?: number; shares?: number }) {
    if (c.shares != null) { sharesText = trim(c.shares, 6); last = 'shares'; }
    else if (c.amount != null) { amountText = trim(c.amount, 2); last = 'amount'; }
  }
  // When a buy needs more than the spendable cash: the holdings furthest over their target, as
  // candidates to trim, up to the amount that is short.
  const funding = $derived.by(() => {
    if (type !== 'Buy') return null;
    const short = fx.amount - app.limits.spendable;
    if (!(short > 1)) return null;
    let left = short;
    const from = pm.positions
      .filter(p => p.symbol !== symbol && (p.target || 0) > 0 && p.currentValue > p.target! * pm.investable)
      .map(p => ({ symbol: p.symbol, over: p.currentValue - p.target! * pm.investable }))
      .sort((a, b) => b.over - a.over).slice(0, 4)
      .map(p => { const take = Math.min(p.over, left); left -= take; return { ...p, take }; })
      .filter(p => p.take > 1);
    return { short, from, left: Math.max(0, left) };
  });
  // Neither of these stops the trade: it has already happened at the broker.
  const overLimit = $derived(type === 'Buy' && pm.limit ? Math.max(0, pm.limit.used + fx.tradeValue - pm.limit.dollar) : 0);
  const intoReserve = $derived(type === 'Buy' ? Math.max(0, app.limits.reserve - (app.limits.wallet.cash - fx.amount)) : 0);
  // Tell the workspace what is being typed, so its chart can follow.
  $effect(() => { if (ws) ws.symbol = symbol; });
  $effect(() => {
    if (!ws) return;
    ws.newAvg = shares && price ? fx.newAvg : null;
    return () => { ws.newAvg = null; };
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (problem) return;
    app.recordTrade(input);
    close();
  }
  const focus = (el: HTMLInputElement) => { el.focus(); };
</script>

<Dialog title={t('Record a trade')} onclose={close}>
  <form onsubmit={submit}>
    <div class="row">
      <Seg bind:value={type} options={[{ value: 'Buy', label: t('Buy') }, { value: 'Sell', label: t('Sell') }]} />
      {#if app.ports.length > 1 && !ws}
        <label class="inline">
          <span>{t('Portfolio')}</span>
          <select class="input" value={portfolio} onchange={e => picked = e.currentTarget.value}>
            {#each app.ports as p (p)}<option value={p}>{p}</option>{/each}
          </select>
        </label>
      {/if}
    </div>

    <div class="grid">
      <label class="wide">
        <span>{t('Symbol')}</span>
        {#if symbol0}
          <input class="input" bind:value={symbolText} list="trade-symbols" autocomplete="off" autocapitalize="characters" spellcheck="false" required />
        {:else}
          <input class="input" bind:value={symbolText} list="trade-symbols" autocomplete="off" autocapitalize="characters" spellcheck="false" required use:focus />
        {/if}
        <datalist id="trade-symbols">{#each known as s (s)}<option value={s}></option>{/each}</datalist>
      </label>
      <label>
        <span>{t('Date')}</span>
        <input class="input" type="date" bind:value={dateStr} required />
      </label>
      <label>
        <span>{t('Time, Bangkok')}</span>
        <input class="input" type="time" step="1" bind:value={time} required />
      </label>
      <label>
        <span>{t('Price')}</span>
        <input class="input" inputmode="decimal" value={priceShown} oninput={e => priceText = e.currentTarget.value} placeholder="0.00" />
      </label>
      <label>
        <span>{t('Shares')}</span>
        {#if symbol0}
          <input class="input" inputmode="decimal" value={sharesShown} oninput={e => { sharesText = e.currentTarget.value; last = 'shares'; }} placeholder="0" use:focus />
        {:else}
          <input class="input" inputmode="decimal" value={sharesShown} oninput={e => { sharesText = e.currentTarget.value; last = 'shares'; }} placeholder="0" />
        {/if}
      </label>
      <label class="wide">
        <span>{t('Amount in dollars')}</span>
        <input class="input" inputmode="decimal" value={amountShown} oninput={e => { amountText = e.currentTarget.value; last = 'amount'; }} placeholder="0.00" />
      </label>
    </div>

    {#if symbol && chips.length}
      <div class="chips">{#each chips as c (c.label)}<button type="button" class="btn" onclick={() => pick(c)}>{c.label}</button>{/each}</div>
    {/if}

    <div class="row">
      <label class="inline">
        <span>{t('Cash from')}</span>
        <Seg small bind:value={cashSource} options={[{ value: 'USD', label: 'USD' }, { value: 'FCD', label: 'FCD' }]} />
      </label>
      <label class="check"><input type="checkbox" bind:checked={commissionFree} /> {t('No commission')}</label>
    </div>

    <label>
      <span>{t('Note')}</span>
      <input class="input" bind:value={note} placeholder={t('Why this trade, optional')} />
    </label>

    {#if shares && price}
      <table class="sum">
        <thead><tr><th></th><th>{t('Now')}</th><th>{t('After this trade')}</th></tr></thead>
        <tbody>
          <tr><th>{t('Shares')}</th><td>{fmtQty(fx.oldQty)}</td><td>{fmtQty(fx.newQty)}</td></tr>
          <tr><th>{t('Avg cost')}</th><td>{fx.oldQty ? usd(fx.oldAvg) : '—'}</td><td>{fx.newQty ? usd(fx.newAvg) : '—'}</td></tr>
          <tr><th>{t('Cash')}, {cashSource}</th><td>{usd(cashNow)}</td><td class:loss={cashAfter < 0}>{usd(cashAfter)}</td></tr>
        </tbody>
      </table>
      <p class="small muted">{t('Trade value')} {usd(fx.tradeValue)}, {t('fees')} {usd(fx.fees.total)}, {type === 'Buy' ? t('you pay') : t('you receive')} {usd(fx.amount)}</p>
      {#if cashAfter < 0}<p class="small loss">{t('This takes the balance below zero. The trade is still recorded.')}</p>{/if}
      {#if funding}
        <p class="small ink2">{t('Spendable cash is short by')} {usd(funding.short)}.
          {#if funding.from.length}{t('Over target and could fund it')}: {funding.from.map(f => `${f.symbol} ${usd(f.take)}`).join(', ')}{#if funding.left > 1}, {t('still short by')} {usd(funding.left)}{/if}.{/if}</p>
      {/if}
      {#if overLimit > 0.5}<p class="small loss">{t('This takes')} {portfolio} {t('over its limit by')} {usd(overLimit)}.</p>{/if}
      {#if intoReserve > 0.5 && app.limits.reserve > 0}<p class="small loss">{t('This dips into the cash reserve by')} {usd(Math.min(intoReserve, fx.amount))}.</p>{/if}
    {/if}

    {#if problem.trim()}<p class="small loss" role="alert">{problem}</p>{/if}
    <div class="foot">
      <button type="button" class="btn" onclick={close}>{t('Cancel')}</button>
      <button type="submit" class="btn primary" disabled={!!problem}>{type === 'Buy' ? t('Record buy') : t('Record sale')}</button>
    </div>
  </form>
</Dialog>

<style>
  form { display: grid; gap: var(--sp-5); }
  .row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--sp-3) var(--sp-4); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-4); }
  .wide { grid-column: 1 / -1; }
  label { display: grid; gap: 6px; min-width: 0; }
  label > span:first-child { font-size: 13px; color: var(--ink-2); }
  label.inline { display: flex; align-items: center; gap: var(--sp-3); }
  label.inline select { width: auto; }
  label.check { display: flex; align-items: center; gap: 8px; font-size: 14px; }
  .btn { justify-self: start; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips .btn { font-size: 12px; padding: 6px 12px; }
  .sum { width: 100%; border-collapse: collapse; font-size: 14px; }
  .sum th { font-weight: 500; color: var(--muted); font-size: 13px; text-align: left; padding: 7px 0; }
  .sum thead th:not(:first-child), .sum td { text-align: right; }
  .sum td { padding: 7px 0; font-weight: 600; }
  .sum td:nth-child(2) { color: var(--ink-2); font-weight: 500; }
  .sum tbody tr { border-top: 1px solid var(--line-soft); }
  p { margin: 0; }
  .foot { display: flex; justify-content: flex-end; gap: var(--sp-3); }
  .foot .btn { padding: 10px 20px; font-size: 14px; }
  .foot .btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
