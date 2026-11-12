<script lang="ts">
  import { getContext, untrack } from 'svelte';
  import { pct, usd } from '../../core/format.ts';
  import { MAX_TRANCHES, MAX_TRIMS, planKey, trancheDollars } from '../../core/plan.ts';
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

  let targetText = $state(row?.target ? numText(row.target * 100, 4) : '');
  let slText = $state(numText(saved?.sl));
  let note = $state(saved?.note ?? '');
  let entries = $state((saved?.tranches ?? []).map(x => ({ price: numText(x.price), cum: x.cumPct ? numText(x.cumPct, 2) : '' })));
  let trims = $state((saved?.trims ?? []).map(x => ({ price: numText(x.price), pct: numText(x.pct, 2) })));

  const m = $derived(app.portModel(portfolio));
  const pos = $derived(m.positions.find(p => p.symbol === symbol));
  const price = $derived(pos?.price ?? app.quotes[symbol]?.price ?? null);
  const target = $derived(targetText.trim() ? parseNum(targetText) / 100 : 0);
  const targetOk = $derived(target >= 0 && target <= 1);
  const td = $derived(targetOk ? target * m.investable : 0);
  const currPct = $derived(td > 0 ? (pos?.currentValue || 0) / td * 100 : 0);

  const orNull = (s: string) => { const n = parseNum(s); return n > 0 ? n : null; };
  const draft = $derived<Plan>({
    sl: orNull(slText), note,
    tranches: entries.map(e => ({ price: orNull(e.price), cumPct: orNull(e.cum) ?? 0 })),
    trims: trims.map(x => ({ price: orNull(x.price), pct: orNull(x.pct) ?? 0 })),
  });
  const dollars = $derived(trancheDollars(draft.tranches, currPct, td));
  const away = (p: number | null) => p && price ? `${p < price ? '' : '+'}${((p / price - 1) * 100).toFixed(1)}%` : '';

  // In the workspace, every level typed here is drawn on the chart beside the form straight away.
  const ws = getContext<Workspace | undefined>(WORKSPACE);
  $effect(() => {
    if (!ws) return;
    ws.plan = draft;
    return () => { ws.plan = null; };
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
      {#if td > 0}{t('Target value')} {usd(td)}. {t('Held now')} {usd(pos?.currentValue ?? 0)}, {pct(currPct, 1)} {t('of target')}.{:else}{t('Set a target to see how many dollars each entry buys.')}{/if}
      {#if price}{t('Price now')} {usd(price)}.{/if}
    </p>

    <section>
      <h3>{t('Entries')}</h3>
      {#if entries.length}
        <table class="rows">
          <thead><tr><th>{t('Buy at')}</th><th>{t('Position then, % of target')}</th><th class="n">{t('Buys')}</th><th></th></tr></thead>
          <tbody>
            {#each entries as e, i (i)}
              <tr>
                <td><input class="input" inputmode="decimal" bind:value={e.price} placeholder="0.00" aria-label="{t('Buy at')} {i + 1}" /><span class="small muted">{away(draft.tranches[i].price)}</span></td>
                <td><input class="input" inputmode="decimal" bind:value={e.cum} placeholder="0" aria-label="{t('Position then, % of target')} {i + 1}" /></td>
                <td class="n">{td > 0 && draft.tranches[i].cumPct ? usd(dollars[i]) : '—'}</td>
                <td><button type="button" class="icon-btn" onclick={() => entries.splice(i, 1)} aria-label={t('Remove')}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if entries.length < MAX_TRANCHES}<button type="button" class="btn" onclick={() => entries.push({ price: '', cum: '' })}>{t('Add an entry')}</button>{/if}
    </section>

    <section>
      <h3>{t('Take profit')}</h3>
      {#if trims.length}
        <table class="rows">
          <thead><tr><th>{t('Sell at')}</th><th>{t('Sell, % of target')}</th><th class="n">{t('Sells')}</th><th></th></tr></thead>
          <tbody>
            {#each trims as x, i (i)}
              <tr>
                <td><input class="input" inputmode="decimal" bind:value={x.price} placeholder="0.00" aria-label="{t('Sell at')} {i + 1}" /><span class="small muted">{away(draft.trims[i].price)}</span></td>
                <td><input class="input" inputmode="decimal" bind:value={x.pct} placeholder="0" aria-label="{t('Sell, % of target')} {i + 1}" /></td>
                <td class="n">{td > 0 && draft.trims[i].pct ? usd(draft.trims[i].pct / 100 * td) : '—'}</td>
                <td><button type="button" class="icon-btn" onclick={() => trims.splice(i, 1)} aria-label={t('Remove')}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if trims.length < MAX_TRIMS}<button type="button" class="btn" onclick={() => trims.push({ price: '', pct: '' })}>{t('Add a sale')}</button>{/if}
    </section>

    <label class="field"><span>{t('Note')}</span><input class="input" bind:value={note} /></label>

    {#if !targetOk}<p class="small loss" role="alert">{t('The target must be between 0 and 100%.')}</p>{/if}
    <div class="form-foot">
      {#if saved}<DeleteButton label={t('Clear plan')} confirm={t('Press again to clear')} onconfirm={clear} />{/if}
      <button type="button" class="btn" onclick={close}>{t('Cancel')}</button>
      <button type="submit" class="btn primary" disabled={!targetOk}>{t('Save plan')}</button>
    </div>
  </form>
</Dialog>

<style>
  section { display: grid; gap: var(--sp-3); justify-items: start; }
  .rows { width: 100%; border-collapse: collapse; }
  .rows th { font-size: 12px; font-weight: 500; color: var(--muted); text-align: left; padding: 0 8px 6px 0; }
  .rows td { padding: 4px 8px 4px 0; vertical-align: middle; }
  .rows td:first-child { display: flex; align-items: center; gap: 8px; }
  .rows td:first-child .input { min-width: 0; }
  .rows td:first-child .small { flex: 0 0 48px; }
  .rows .n { text-align: right; white-space: nowrap; font-weight: 600; font-size: 14px; }
  .rows td:last-child { padding-right: 0; width: 38px; }
</style>
