<script lang="ts">
  import { untrack } from 'svelte';
  import { qty as fmtQty } from '../../core/format.ts';
  import { app } from '../../state/app.svelte.ts';
  import { numText, parseNum } from '../num.ts';
  import Dialog from '../parts/Dialog.svelte';

  let { symbol }: { symbol: string } = $props();

  const t = app.t;
  const close = () => { app.dialog = null; };
  const holders = $derived(app.rawRows.filter(r => r.symbol === symbol && (r.qty || 0) > 0));
  let from = $state(untrack(() => holders.find(r => r.portfolio === app.view)?.portfolio ?? holders[0]?.portfolio ?? ''));
  let to = $state(untrack(() => app.ports.find(p => p !== from) ?? ''));
  let sharesText = $state('');

  const held = $derived(holders.find(r => r.portfolio === from)?.qty || 0);
  const shares = $derived(parseNum(sharesText));
  const problem = $derived(
    from === to ? t('Pick two different portfolios.')
    : shares > held + 1e-6 ? `${t('You hold only')} ${fmtQty(held)} ${t('in')} ${from}.` : '');
  const valid = $derived(shares > 0 && !problem && !!from && !!to);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    app.transfer(symbol, Math.min(shares, held), from, to);
    close();
  }
</script>

<Dialog title={`${t('Move')} ${symbol}`} onclose={close}>
  <form class="form" onsubmit={submit}>
    <p class="muted">{t('Shares cross at the cost they are carried at. No cash moves and no gain is realized.')}</p>
    <div class="fgrid">
      <label class="field"><span>{t('From')}</span>
        <select class="input" bind:value={from}>{#each holders as r (r.portfolio)}<option value={r.portfolio}>{r.portfolio}</option>{/each}</select>
      </label>
      <label class="field"><span>{t('To')}</span>
        <select class="input" bind:value={to}>{#each app.ports as p (p)}<option value={p}>{p}</option>{/each}</select>
      </label>
      <label class="field wide"><span>{t('Shares')}, {fmtQty(held)} {t('held')}</span>
        <input class="input" inputmode="decimal" bind:value={sharesText} placeholder="0" />
      </label>
    </div>
    <div><button type="button" class="btn" onclick={() => sharesText = numText(held)}>{t('All of them')}</button></div>
    {#if problem && sharesText}<p class="small loss" role="alert">{problem}</p>{/if}
    <div class="form-foot">
      <button type="button" class="btn" onclick={close}>{t('Cancel')}</button>
      <button type="submit" class="btn primary" disabled={!valid}>{t('Move shares')}</button>
    </div>
  </form>
</Dialog>
