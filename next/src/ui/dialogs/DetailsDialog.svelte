<script lang="ts">
  import { untrack } from 'svelte';
  import type { Details } from '../../core/edits.ts';
  import { app } from '../../state/app.svelte.ts';
  import { numText, parseNum } from '../num.ts';
  import Dialog from '../parts/Dialog.svelte';

  let { symbol, portfolio }: { symbol: string; portfolio: string } = $props();

  const t = app.t;
  const close = () => { app.dialog = null; };
  const CATEGORIES = ['Big Name', 'Wait for sell', 'Medium Cap', 'Small Cap', 'Growth', 'Dividend', 'Other'];
  const row = untrack(() => app.rawRows.find(r => r.symbol === symbol && r.portfolio === portfolio));
  const used = (pick: (r: (typeof app.rawRows)[number]) => string | null) => [...new Set(app.rawRows.map(pick).filter((x): x is string => !!x))].sort();
  const customs = used(r => r.custom), groups = used(r => r.myGroup);
  const categories = row?.category && !CATEGORIES.includes(row.category) ? [...CATEGORIES, row.category] : CATEGORIES;

  let category = $state(row?.category ?? '');
  let custom = $state(row?.custom ?? '');
  let myGroup = $state(row?.myGroup ?? '');
  let qtyText = $state(numText(row?.qty));
  let avgText = $state(numText(row?.avgPrice));

  const qty = $derived(qtyText.trim() ? parseNum(qtyText) : 0);
  const avg = $derived(avgText.trim() ? parseNum(avgText) : 0);
  const valid = $derived(qty >= 0 && avg >= 0);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!valid || !row) return;
    const d: Details = { category, custom: custom.trim(), myGroup: myGroup.trim() };
    // Quantity and average are sent only when touched, so saving a tag never rewrites a holding.
    if (Math.abs(qty - (row.qty || 0)) > 1e-9) d.qty = qty;
    if (Math.abs(avg - (row.avgPrice || 0)) > 1e-9) d.avgPrice = avg;
    app.saveDetails(portfolio, symbol, d);
    close();
  }
</script>

<Dialog title={`${symbol}, ${portfolio}`} onclose={close}>
  {#if !row}
    <p class="muted">{symbol} {t('has no row in')} {portfolio}.</p>
  {:else}
    <form class="form" onsubmit={submit}>
      <div class="fgrid">
        <label class="field wide"><span>{t('Category')}</span>
          <select class="input" bind:value={category}>
            <option value="">{t('None')}</option>
            {#each categories as c (c)}<option value={c}>{c}</option>{/each}
          </select>
        </label>
        <label class="field"><span>{t('Custom tag')}</span><input class="input" bind:value={custom} list="details-custom" /></label>
        <label class="field"><span>{t('My group')}</span><input class="input" bind:value={myGroup} list="details-group" /></label>
        <datalist id="details-custom">{#each customs as c (c)}<option value={c}></option>{/each}</datalist>
        <datalist id="details-group">{#each groups as g (g)}<option value={g}></option>{/each}</datalist>
      </div>
      <p class="muted">{t('The two tags describe the symbol, so they apply in every portfolio that has it.')}</p>

      <details>
        <summary>{t('Correct the shares or the average cost')}</summary>
        <div class="fgrid">
          <label class="field"><span>{t('Shares')}</span><input class="input" inputmode="decimal" bind:value={qtyText} /></label>
          <label class="field"><span>{t('Avg cost')}</span><input class="input" inputmode="decimal" bind:value={avgText} /></label>
        </div>
        <p class="muted">{t('Use this when the sheet disagrees with the broker. While the trade ledger accounts for every share, the average shown is worked out from the ledger and a figure typed here is not used.')}</p>
      </details>

      <div class="form-foot">
        <button type="button" class="btn" onclick={close}>{t('Cancel')}</button>
        <button type="submit" class="btn primary" disabled={!valid}>{t('Save')}</button>
      </div>
    </form>
  {/if}
</Dialog>

<style>
  details { display: grid; gap: var(--sp-3); }
  summary { cursor: pointer; font-size: 14px; color: var(--ink-2); }
  details[open] summary { margin-bottom: var(--sp-3); }
  details p { margin-top: var(--sp-3); }
</style>
