<script lang="ts">
  import { untrack } from 'svelte';
  import { contribAmounts } from '../../core/analytics.ts';
  import type { ContribInput } from '../../core/edits.ts';
  import { usd as fmtUsd } from '../../core/format.ts';
  import { ledgerNow } from '../../data/write.ts';
  import { app } from '../../state/app.svelte.ts';
  import { numText, parseNum } from '../num.ts';
  import DeleteButton from '../parts/DeleteButton.svelte';
  import Dialog from '../parts/Dialog.svelte';
  import Seg from '../parts/Seg.svelte';

  let { row }: { row?: number } = $props();

  const t = app.t;
  const close = () => { app.dialog = null; };
  const old = untrack(() => row == null ? null : app.contribs.find(c => c.row === row) ?? null);
  const was = old ? contribAmounts(old, app.fx) : null;

  let type = $state<'Deposit' | 'Withdraw'>(old && !/^deposit/i.test(old.type) ? 'Withdraw' : 'Deposit');
  let date = $state(old?.date || ledgerNow().dateStr);
  let thbText = $state(was ? numText(Math.abs(was.thb), 2) : '');
  let usdText = $state(was ? numText(Math.abs(was.usd), 2) : '');
  let note = $state(old?.note ?? '');

  const thb = $derived(parseNum(thbText));
  const usd = $derived(parseNum(usdText));
  const valid = $derived(thb > 0 && usd > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date));

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    const input: ContribInput = { type, date, thb, usd, note: note.trim() };
    if (old) app.updateContribution(old, input); else app.addContribution(input);
    close();
  }
</script>

<Dialog title={old ? t('Edit deposit or withdrawal') : t('Add deposit or withdrawal')} onclose={close}>
  <form class="form" onsubmit={submit}>
    <div class="frow">
      <Seg bind:value={type} options={[{ value: 'Deposit', label: t('Deposit') }, { value: 'Withdraw', label: t('Withdraw') }]} />
      <input class="input date" type="date" bind:value={date} aria-label={t('Date')} required />
    </div>
    <div class="fgrid">
      <label class="field"><span>{t('Baht')}</span><input class="input" inputmode="decimal" bind:value={thbText} placeholder="0" /></label>
      <label class="field"><span>{t('Dollars')}</span><input class="input" inputmode="decimal" bind:value={usdText} placeholder="0.00" /></label>
      <label class="field wide"><span>{t('Note')}</span><input class="input" bind:value={note} /></label>
    </div>
    {#if valid}
      <p class="muted">{t('Rate')} {(thb / usd).toFixed(2)} {t('baht per dollar')}.
        {#if !old}{type === 'Deposit' ? t('Adds') : t('Takes')} {fmtUsd(usd)} {type === 'Deposit' ? t('to the FCD balance') : t('from the FCD balance')}.{/if}</p>
    {/if}
    {#if old}<p class="muted">{t('Changing or deleting a recorded row does not move cash. Correct the balance under Cash and limits.')}</p>{/if}
    <div class="form-foot">
      {#if old}<DeleteButton label={t('Delete')} confirm={t('Press again to delete')} onconfirm={() => { app.deleteContribution(old); close(); }} />{/if}
      <button type="button" class="btn" onclick={close}>{t('Cancel')}</button>
      <button type="submit" class="btn primary" disabled={!valid}>{t('Save')}</button>
    </div>
  </form>
</Dialog>

<style>
  .date { width: auto; }
</style>
