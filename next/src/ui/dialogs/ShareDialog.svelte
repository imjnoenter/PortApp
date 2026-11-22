<script lang="ts">
  // Every picture is shown here first: it is composed, not captured, so this is the first look at it.
  import { onDestroy, untrack } from 'svelte';
  import { app } from '../../state/app.svelte.ts';
  import { canSharePictures, download, sharePicture } from '../share.ts';
  import Dialog from '../parts/Dialog.svelte';

  let { blob, name }: { blob: Blob; name: string } = $props();

  const t = app.t;
  const close = () => { app.dialog = null; };
  const url = URL.createObjectURL(untrack(() => blob));
  onDestroy(() => URL.revokeObjectURL(url));
  const canShare = canSharePictures();

  // StockAnalysis imports "Ticker, Shares, Average Cost" lines. The holdings are the tab on screen,
  // largest share count first; shares keep their full precision, the cost is rounded to the cent.
  let copied = $state<'' | 'ok' | 'fail'>('');
  async function copySA() {
    const text = app.model.positions
      .filter(p => p.qty > 0)
      .toSorted((a, b) => b.qty - a.qty)
      .map(p => `${p.symbol}, ${+p.qty.toFixed(6)}, ${p.avgPrice.toFixed(2)}`)
      .join('\n');
    try { await navigator.clipboard.writeText(text); copied = 'ok'; }
    catch { copied = 'fail'; }
    setTimeout(() => { copied = ''; }, 2000);
  }
</script>

<Dialog title={t('Share a picture')} onclose={close}>
  <div class="form">
    <img src={url} alt={t('The picture that will be shared')} />
    <div class="form-foot">
      <button class="btn" onclick={close}>{t('Close')}</button>
      <button class="btn" onclick={copySA} title={t('Copy the holdings for StockAnalysis')} aria-label={t('Copy the holdings for StockAnalysis')}>
        {copied === 'ok' ? t('Copied') : copied === 'fail' ? t('Could not copy') : 'SA'}
      </button>
      <button class="btn" class:primary={!canShare} onclick={() => download(blob, name)}>{t('Download')}</button>
      {#if canShare}<button class="btn primary" onclick={() => sharePicture(blob, name)}>{t('Share')}</button>{/if}
    </div>
  </div>
</Dialog>

<style>
  img { display: block; width: 100%; max-height: 62dvh; object-fit: contain; border-radius: var(--radius-sm); background: var(--sunk); }
</style>
