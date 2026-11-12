<script lang="ts">
  import { untrack } from 'svelte';
  import { cashEffect } from '../../core/edits.ts';
  import { usd as fmtUsd } from '../../core/format.ts';
  import type { Tx } from '../../core/types.ts';
  import { app } from '../../state/app.svelte.ts';
  import { numText, parseNum } from '../num.ts';
  import DeleteButton from '../parts/DeleteButton.svelte';
  import Dialog from '../parts/Dialog.svelte';
  import Seg from '../parts/Seg.svelte';

  let { row }: { row: number } = $props();

  const t = app.t;
  const close = () => { app.dialog = null; };
  const old = untrack(() => app.txs.find(x => x.row === row) ?? null);
  const editable = old?.type === 'Buy' || old?.type === 'Sell';

  let type = $state<'Buy' | 'Sell'>(old?.type === 'Sell' ? 'Sell' : 'Buy');
  let dateStr = $state(old?.dateStr ?? '');
  let time = $state(old?.time ?? '');
  let sharesText = $state(numText(old?.shares));
  let priceText = $state(numText(old?.price));
  let commissionFree = $state(old?.commissionFree ?? false);
  let note = $state(old?.note ?? '');

  const shares = $derived(parseNum(sharesText));
  const price = $derived(parseNum(priceText));
  const valid = $derived(shares > 0 && price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && (!time || /^\d{2}:\d{2}(:\d{2})?$/.test(time)));
  const next = $derived<Tx | null>(old && valid ? {
    ...old, type, dateStr, time: /^\d{2}:\d{2}$/.test(time) ? time + ':00' : time, shares, price,
    tradeValue: shares * price, commissionFree, note: note.trim().slice(0, 200),
  } : null);
  const cashDelta = $derived(old && next ? cashEffect(next) - cashEffect(old) : 0);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!old || !next) return;
    app.replaceTx(old, next);
    close();
  }
</script>

<Dialog title={old ? `${old.ticker}, ${old.portfolio}` : t('Trade')} onclose={close}>
  {#if !old || !editable}
    <p class="muted">{t('Only a buy or a sale can be changed here. To undo a move between portfolios, move the shares back.')}</p>
  {:else}
    <form class="form" onsubmit={submit}>
      <div><Seg bind:value={type} options={[{ value: 'Buy', label: t('Buy') }, { value: 'Sell', label: t('Sell') }]} /></div>
      <div class="fgrid">
        <label class="field"><span>{t('Date')}</span><input class="input" type="date" bind:value={dateStr} required /></label>
        <label class="field"><span>{t('Time, Bangkok')}</span><input class="input" type="time" step="1" bind:value={time} /></label>
        <label class="field"><span>{t('Shares')}</span><input class="input" inputmode="decimal" bind:value={sharesText} /></label>
        <label class="field"><span>{t('Price')}</span><input class="input" inputmode="decimal" bind:value={priceText} /></label>
        <label class="field wide"><span>{t('Note')}</span><input class="input" bind:value={note} maxlength="200" /></label>
      </div>
      <label class="check"><input type="checkbox" bind:checked={commissionFree} /> {t('No commission')}</label>
      <p class="muted">{t('The holding and the USD balance are corrected to match.')}
        {#if Math.abs(cashDelta) >= 0.005}{t('This change moves USD by')} {(cashDelta > 0 ? '+' : '') + fmtUsd(cashDelta)}.{/if}</p>
      <div class="form-foot">
        <DeleteButton label={t('Delete trade')} confirm={t('Press again to delete')} onconfirm={() => { app.replaceTx(old, null); close(); }} />
        <button type="button" class="btn" onclick={close}>{t('Cancel')}</button>
        <button type="submit" class="btn primary" disabled={!next}>{t('Save')}</button>
      </div>
    </form>
  {/if}
</Dialog>
