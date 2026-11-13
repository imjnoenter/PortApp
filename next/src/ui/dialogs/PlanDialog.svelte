<script lang="ts">
  // A plan for one holding: a target, a stop, a ladder of buys and up to three sales.
  //
  // Each buy and each sale can be sized two ways, and typing in one box fills in the other:
  // in shares, or as a percentage of the target (how full the position is after a buy; how much of
  // the target a sale lets go). The sheet stores the percentage. Under every row is what it comes
  // to in dollars. In the workspace the chart and the target bar beside the form follow along.
  import { getContext, untrack } from 'svelte';
  import { pct, qty as fmtQty, sign, signedPct, usd } from '../../core/format.ts';
  import { MAX_TRANCHES, MAX_TRIMS, planKey } from '../../core/plan.ts';
  import type { Plan } from '../../core/plan.ts';
  import { app } from '../../state/app.svelte.ts';
  import { numText, parseNum } from '../num.ts';
  import DeleteButton from '../parts/DeleteButton.svelte';
  import Dialog from '../parts/Dialog.svelte';
  import Seg from '../parts/Seg.svelte';
  import { WORKSPACE } from '../workspace.svelte.ts';
  import type { Workspace } from '../workspace.svelte.ts';

  let { symbol, portfolio }: { symbol: string; portfolio: string } = $props();

  const t = app.t;
  const close = () => { app.dialog = null; };
  const saved = untrack(() => app.plans[planKey(portfolio, symbol)]);
  const row = untrack(() => app.rawRows.find(r => r.symbol === symbol && r.portfolio === portfolio));

  /** A row's size is whichever box was typed in last; the other box is worked out from it. */
  interface EntryRow { price: string; shares: string; cum: string; by: 'shares' | 'cum' }
  interface TrimRow { price: string; shares: string; pct: string; by: 'shares' | 'pct' }

  let targetText = $state(row?.target ? numText(row.target * 100, 4) : '');
  let slText = $state(numText(saved?.sl));
  let note = $state(saved?.note ?? '');
  let entries = $state<EntryRow[]>((saved?.tranches ?? []).map(x => x.cumPct > 0 || !(x.dollar && x.price)
    ? { price: numText(x.price), shares: '', cum: x.cumPct ? numText(x.cumPct, 4) : '', by: 'cum' }
    : { price: numText(x.price), shares: numText(x.dollar / x.price, 4), cum: '', by: 'shares' }));
  let trims = $state<TrimRow[]>((saved?.trims ?? []).map(x => ({ price: numText(x.price), shares: '', pct: numText(x.pct, 4), by: 'pct' })));

  const m = $derived(app.portModel(portfolio));
  const pos = $derived(m.positions.find(p => p.symbol === symbol));
  const price = $derived(pos?.price ?? app.quotes[symbol]?.price ?? null);
  const target = $derived(targetText.trim() ? parseNum(targetText) / 100 : 0);
  const targetOk = $derived(target >= 0 && target <= 1);
  const td = $derived(targetOk ? target * m.investable : 0);
  const currPct = $derived(td > 0 ? (pos?.currentValue || 0) / td * 100 : 0);
  const heldQty = $derived(pos?.qty ?? 0);
  const avgCost = $derived(pos?.avgPrice ?? 0);
  const signedUsd = (n: number) => (n >= 0 ? '+' : '') + usd(n);
  /** A planned buy, valued at today's price: what the lot would be up or down if bought there. */
  const lotNow = (at: number, shares: number) => price ? { pnl: (price - at) * shares, pct: (price / at - 1) * 100 } : null;
  /** A planned sale against the average cost of what is held: the profit it would bank, before fees. */
  const saleGain = (at: number, shares: number) => avgCost > 0 ? { pnl: (at - avgCost) * shares, pct: (at / avgCost - 1) * 100 } : null;
  /** What the stop would cost if it were reached: every share held, from its average cost down to the stop. */
  const stopLoss = $derived.by(() => { const sl = parseNum(slText); return sl > 0 && heldQty > 0 && avgCost > 0 ? { pnl: (sl - avgCost) * heldQty, pct: (sl / avgCost - 1) * 100 } : null; });

  const orNull = (s: string) => { const n = parseNum(s); return n > 0 ? n : null; };
  // Highest price on top, in both lists: entries step down from the first buy, take-profits step
  // down to the lowest sale at the bottom. Rows without a price stay below. Run when a price box is
  // left, never while typing, so a row cannot jump out from under the cursor.
  const byPrice = <T extends { price: string }>(rows: T[]) => rows
    .map((r, i) => ({ r, i, p: orNull(r.price) }))
    .sort((a, b) => (a.p == null ? 1 : 0) - (b.p == null ? 1 : 0) || (b.p ?? 0) - (a.p ?? 0) || a.i - b.i)
    .map(x => x.r);
  const same = <T,>(a: T[], b: T[]) => a.every((x, i) => x === b[i]);
  function sortEntries() { const next = byPrice(entries); if (!same(next, entries)) entries = next; }
  function sortTrims() { const next = byPrice(trims); if (!same(next, trims)) trims = next; }

  // ── Buys, in ladder order: each starts from where the one before it left the position ──
  const buys = $derived.by(() => {
    let prevCum = 0;
    return entries.map((e, i) => {
      const at = orNull(e.price);
      // The same rule the saved plan is read back with: a step up from the rung before, or from today.
      const from = i === 0 ? currPct : Math.max(currPct, prevCum);
      let shares = 0, dollars = 0, cum = 0;
      if (e.by === 'shares') {
        shares = orNull(e.shares) ?? 0;
        dollars = at ? shares * at : 0;
        cum = td > 0 && dollars > 0 ? from + dollars / td * 100 : 0;
      } else {
        cum = orNull(e.cum) ?? 0;
        dollars = td > 0 && cum > 0 ? Math.max(0, (cum - from) / 100 * td) : 0;
        shares = at ? dollars / at : 0;
      }
      prevCum = cum;
      return { at, shares, dollars, cum };
    });
  });

  // ── Sales: each takes from what the one before it left ──
  const sales = $derived.by(() => {
    let left = heldQty;
    return trims.map(x => {
      const at = orNull(x.price);
      let shares = 0, share = 0;
      if (x.by === 'shares') {
        shares = orNull(x.shares) ?? 0;
        share = td > 0 && at ? shares * at / td * 100 : 0;
      } else {
        share = orNull(x.pct) ?? 0;
        shares = td > 0 && at ? share / 100 * td / at : 0;
      }
      const before = left, over = shares > before + 1e-9;
      left -= Math.min(shares, left);
      return { at, shares, share, dollars: at ? shares * at : 0, over, before };
    });
  });

  const draft = $derived<Plan>({
    sl: orNull(slText), note,
    tranches: buys.map(b => ({ price: b.at, cumPct: +b.cum.toFixed(4), ...(b.cum > 0 || !(b.dollars > 0) ? {} : { dollar: b.dollars }) })),
    trims: sales.map(s => ({ price: s.at, pct: +s.share.toFixed(4) })),
  });
  // A sale is stored as a share of the target, so one sized in shares cannot be kept without a target.
  const unsavable = $derived(!(td > 0) && sales.some(s => s.at && s.shares > 0));
  const away = (p: number | null) => p && price ? `${Math.abs((p / price - 1) * 100).toFixed(1)}% ${p < price ? t('below now') : t('above now')}` : '';

  // In the workspace, every level typed here is drawn on the chart beside the form straight away.
  const ws = getContext<Workspace | undefined>(WORKSPACE);
  $effect(() => {
    if (!ws) return;
    ws.plan = draft;
    return () => { ws.plan = null; };
  });
  // The average cost once every planned buy has filled: what is held at its cost, plus each buy at
  // its own price. A sale does not move it. Drawn on the chart as the buys are typed.
  $effect(() => {
    if (!ws) return;
    const bought = buys.filter(b => b.at && b.shares > 0);
    const shares = bought.reduce((s, b) => s + b.shares, 0);
    ws.newAvg = shares > 0 ? (heldQty * (pos?.avgPrice ?? 0) + bought.reduce((s, b) => s + b.dollars, 0)) / (heldQty + shares) : null;
    // For the target bar: today's value, plus what the buys spend, less what the sales let go.
    const added = bought.reduce((s, b) => s + b.dollars, 0), sold = sales.reduce((s, x) => s + (x.at ? Math.min(x.shares, x.before) * x.at : 0), 0);
    ws.planValue = added > 0 || sold > 0 ? Math.max(0, (pos?.currentValue ?? 0) + added - sold) : null;
    return () => { ws.newAvg = null; ws.planValue = null; };
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!targetOk) return;
    app.savePlan(portfolio, symbol, draft, target);
    close();
  }
  function clear() {
    app.savePlan(portfolio, symbol, { sl: null, note: '', tranches: [], trims: [] }, null);
    close();
  }
</script>

{#snippet remove(onclick: () => void)}
  <button type="button" class="icon-btn" {onclick} aria-label={t('Remove')}>
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
  </button>
{/snippet}

<Dialog title={`${t('Plan for')} ${symbol}`} onclose={close}>
  <form class="form" onsubmit={submit}>
    {#if app.ports.length > 1 && !ws}
      <div><Seg small value={portfolio} options={app.ports.map(p => ({ value: p, label: p }))} onchange={p => app.dialog = { kind: 'plan', symbol, portfolio: p }} /></div>
    {/if}

    <div class="fgrid">
      <label class="field"><span>{t('Target, % of')} {portfolio}</span><input class="input" inputmode="decimal" bind:value={targetText} placeholder="0" /></label>
      <label class="field"><span>{t('Stop loss price')}</span><input class="input" inputmode="decimal" bind:value={slText} placeholder={t('None')} /></label>
    </div>
    <p class="muted">
      {#if td > 0}{t('Target value')} {usd(td)}. {t('Held now')} {usd(pos?.currentValue ?? 0)}, {pct(currPct, 1)} {t('of target')}.
      {:else}{t('Set a target to size an entry by percentage. Until then, size it in shares.')}{/if}
      {#if price}{t('Price now')} {usd(price)}.{/if}
      {#if stopLoss}{t('At the stop, the holding closes at')} <strong class={sign(stopLoss.pnl)}>{signedUsd(stopLoss.pnl)} ({signedPct(stopLoss.pct, 1)})</strong>.{/if}
    </p>

    <section>
      <h3>{t('Entries')}</h3>
      {#if entries.length}
        <div class="rows">
          <div class="heads small muted"><span>{t('Buy at')}</span><span>{t('Shares')}</span><span>{t('% of target after')}</span><span></span></div>
          {#each entries as e, i (i)}
            {@const b = buys[i]}
            <div class="line">
              <input class="input" inputmode="decimal" bind:value={e.price} onchange={sortEntries} placeholder="0.00" aria-label="{t('Buy at')} {i + 1}" />
              <input class="input" class:derived={e.by !== 'shares'} inputmode="decimal" placeholder="0" aria-label="{t('Shares')} {i + 1}"
                value={e.by === 'shares' ? e.shares : b.shares ? numText(b.shares, 4) : ''} oninput={ev => { e.shares = ev.currentTarget.value; e.by = 'shares'; }} />
              <input class="input" class:derived={e.by !== 'cum'} inputmode="decimal" placeholder={td > 0 ? '0' : '—'} disabled={!(td > 0)} aria-label="{t('% of target after')} {i + 1}"
                value={e.by === 'cum' ? e.cum : b.cum ? numText(b.cum, 2) : ''} oninput={ev => { e.cum = ev.currentTarget.value; e.by = 'cum'; }} />
              {@render remove(() => entries.splice(i, 1))}
              <p class="read small">
                {#if b.at && b.shares > 0}
                  {@const g = lotNow(b.at, b.shares)}
                  <strong>{t('Buys')} {usd(b.dollars)}</strong>, {fmtQty(+b.shares.toFixed(4))} {t('shares')}{#if away(b.at)}, {away(b.at)}{/if}.
                  {#if g && Math.abs(g.pnl) >= 0.005}<span class="pl {sign(g.pnl)}">{t('At today’s price')} {signedUsd(g.pnl)} ({signedPct(g.pct, 1)})</span>{/if}
                {:else if b.at}<span class="muted">{away(b.at)}</span>{/if}
              </p>
            </div>
          {/each}
        </div>
      {/if}
      {#if entries.length < MAX_TRANCHES}<button type="button" class="btn" onclick={() => entries.push({ price: '', shares: '', cum: '', by: td > 0 ? 'cum' : 'shares' })}>{t('Add an entry')}</button>{/if}
    </section>

    <section>
      <h3>{t('Sell')}</h3>
      {#if trims.length}
        <div class="rows">
          <div class="heads small muted"><span>{t('Sell at')}</span><span>{t('Shares')}</span><span>{t('% of target to sell')}</span><span></span></div>
          {#each trims as x, i (i)}
            {@const s = sales[i]}
            <div class="line">
              <input class="input" inputmode="decimal" bind:value={x.price} onchange={sortTrims} placeholder="0.00" aria-label="{t('Sell at')} {i + 1}" />
              <input class="input" class:derived={x.by !== 'shares'} inputmode="decimal" placeholder="0" aria-label="{t('Shares')} {i + 1}"
                value={x.by === 'shares' ? x.shares : s.shares ? numText(s.shares, 4) : ''} oninput={ev => { x.shares = ev.currentTarget.value; x.by = 'shares'; }} />
              <input class="input" class:derived={x.by !== 'pct'} inputmode="decimal" placeholder={td > 0 ? '0' : '—'} disabled={!(td > 0)} aria-label="{t('% of target to sell')} {i + 1}"
                value={x.by === 'pct' ? x.pct : s.share ? numText(s.share, 2) : ''} oninput={ev => { x.pct = ev.currentTarget.value; x.by = 'pct'; }} />
              {@render remove(() => trims.splice(i, 1))}
              <p class="read small">
                {#if s.at && s.shares > 0}
                  {@const g = saleGain(s.at, Math.min(s.shares, s.before))}
                  <strong>{t('Sells')} {usd(s.dollars)}</strong>, {fmtQty(+s.shares.toFixed(4))} {t('shares')}{#if away(s.at)}, {away(s.at)}{/if}.
                  {#if g}<span class="pl {sign(g.pnl)}">{t('Profit')} {signedUsd(g.pnl)} ({signedPct(g.pct, 1)})</span>{/if}
                  {#if s.over}<span class="loss">{t('more than is held then')} ({fmtQty(+s.before.toFixed(4))}).</span>{/if}
                {:else if s.at}<span class="muted">{away(s.at)}</span>{/if}
              </p>
            </div>
          {/each}
        </div>
      {/if}
      {#if trims.length < MAX_TRIMS}<button type="button" class="btn" onclick={() => trims.push({ price: '', shares: '', pct: '', by: td > 0 ? 'pct' : 'shares' })}>{t('Add a sale')}</button>{/if}
      {#if unsavable}<p class="small loss" role="alert">{t('A planned sale is stored as a share of the target, so it needs a target to be saved.')}</p>{/if}
    </section>

    <label class="field"><span>{t('Note')}</span><input class="input" bind:value={note} /></label>

    {#if !targetOk}<p class="small loss" role="alert">{t('The target must be between 0 and 100%.')}</p>{/if}
    <div class="form-foot">
      {#if saved}<DeleteButton label={t('Clear plan')} confirm={t('Press again to clear')} onconfirm={clear} />{/if}
      <button type="button" class="btn" onclick={close}>{t('Cancel')}</button>
      <button type="submit" class="btn primary" disabled={!targetOk || unsavable}>{t('Save plan')}</button>
    </div>
  </form>
</Dialog>

<style>
  section { display: grid; gap: var(--sp-3); justify-items: start; }
  .rows { width: 100%; display: grid; gap: var(--sp-3); }
  .heads, .line { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 34px; gap: 6px 8px; align-items: center; }
  .line .input { min-width: 0; padding-inline: 10px; }
  /* The box that was worked out, not typed, is quieter: type in it and it becomes the one that counts. */
  .line .input.derived { color: var(--ink-2); background: var(--sunk); }
  .line .icon-btn { width: 34px; height: 34px; }
  .read { grid-column: 1 / -1; margin: 0; color: var(--ink-2); line-height: 1.5; min-height: 1.5em; }
  .read strong { color: var(--ink); font-weight: 600; }
  .pl { font-weight: 650; white-space: nowrap; }
</style>
