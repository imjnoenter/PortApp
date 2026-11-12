<script lang="ts">
  import { DEFAULT_PORT } from '../../core/fifo.ts';
  import { ALL } from '../../core/model.ts';
  import { app } from '../../state/app.svelte.ts';
  import { isTicker } from '../num.ts';
  import Dialog from '../parts/Dialog.svelte';

  const t = app.t;
  const close = () => { app.dialog = null; };
  let text = $state('');
  let portfolio = $state(app.view !== ALL ? app.view : app.ports.includes(DEFAULT_PORT) ? DEFAULT_PORT : app.ports[0] ?? DEFAULT_PORT);

  const symbol = $derived(text.trim().toUpperCase());
  const exists = $derived(app.rawRows.some(r => r.symbol === symbol && r.portfolio === portfolio));
  const problem = $derived(!symbol ? ' ' : !isTicker(symbol) ? t('That is not a ticker symbol.') : exists ? `${symbol} ${t('is already in')} ${portfolio}.` : '');

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (problem) return;
    app.addWatch(symbol, portfolio);
    close();
  }
  const focus = (el: HTMLInputElement) => { el.focus(); };
</script>

<Dialog title={t('Add to the watchlist')} onclose={close}>
  <form class="form" onsubmit={submit}>
    <p class="muted">{t('Follow a symbol without holding it. The sheet fills in its name and sector within a minute.')}</p>
    <div class="fgrid">
      <label class="field"><span>{t('Symbol')}</span>
        <input class="input" bind:value={text} autocomplete="off" autocapitalize="characters" spellcheck="false" use:focus />
      </label>
      {#if app.ports.length > 1}
        <label class="field"><span>{t('Portfolio')}</span>
          <select class="input" bind:value={portfolio}>{#each app.ports as p (p)}<option value={p}>{p}</option>{/each}</select>
        </label>
      {/if}
    </div>
    {#if problem.trim()}<p class="small loss" role="alert">{problem}</p>{/if}
    <div class="form-foot">
      <button type="button" class="btn" onclick={close}>{t('Cancel')}</button>
      <button type="submit" class="btn primary" disabled={!!problem}>{t('Add')}</button>
    </div>
  </form>
</Dialog>
