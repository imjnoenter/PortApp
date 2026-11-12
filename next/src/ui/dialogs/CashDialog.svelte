<script lang="ts">
  import { DEFAULT_PORT } from '../../core/fifo.ts';
  import { usd as fmtUsd } from '../../core/format.ts';
  import { CAP_PORT } from '../../core/model.ts';
  import { app } from '../../state/app.svelte.ts';
  import { numText, parseNum } from '../num.ts';
  import Dialog from '../parts/Dialog.svelte';

  const t = app.t;
  const close = () => { app.dialog = null; };
  const wallet = app.registry.find(p => p.name === DEFAULT_PORT);
  const trade = app.registry.find(p => p.name === CAP_PORT);
  // Portfolios that divide what is left after the reserve. With only one there is nothing to divide.
  const split = [...app.limits.shares.keys()];

  let fcdText = $state(numText(wallet?.fcd ?? 0, 2));
  let usdText = $state(numText(wallet?.usd ?? 0, 2));
  let reserveText = $state(numText((wallet?.cashRes ?? 0) * 100, 2));
  let tradeText = $state(numText((trade?.capPct ?? 0) * 100, 2));
  let shareText = $state<Record<string, string>>(Object.fromEntries(split.map(n => [n, numText((app.limits.shares.get(n) ?? 0) * 100, 2)])));

  const fcd = $derived(parseNum(fcdText));
  const usd = $derived(parseNum(usdText));
  const reserve = $derived(parseNum(reserveText || '0'));
  const tradePct = $derived(parseNum(tradeText || '0'));
  const shares = $derived(split.map(n => parseNum(shareText[n] || '0')));
  const shareSum = $derived(shares.reduce((s, x) => s + x, 0));
  const inRange = (x: number) => x >= 0 && x <= 100;
  const sharesOk = $derived(split.length < 2 || (shares.every(inRange) && Math.abs(shareSum - 100) < 0.01));
  const valid = $derived(!Number.isNaN(fcd) && !Number.isNaN(usd) && inRange(reserve) && inRange(tradePct) && sharesOk);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    const caps: Record<string, number> = {};
    if (trade) caps[CAP_PORT] = tradePct / 100;
    if (split.length > 1) split.forEach((n, i) => { caps[n] = shares[i] / 100; });
    app.saveCash({ fcd, usd, reserve: reserve / 100, caps });
    close();
  }
</script>

<Dialog title={t('Cash and limits')} onclose={close}>
  <form class="form" onsubmit={submit}>
    <p class="muted">{t('One wallet pays for every portfolio. Set each balance to what the broker shows.')}</p>
    <div class="fgrid">
      <label class="field"><span>FCD</span><input class="input" inputmode="decimal" bind:value={fcdText} /></label>
      <label class="field"><span>USD</span><input class="input" inputmode="decimal" bind:value={usdText} /></label>
    </div>
    <p><span class="muted">{t('Total')}</span> <strong>{Number.isNaN(fcd + usd) ? '—' : fmtUsd(fcd + usd)}</strong></p>

    <h3>{t('Limits')}</h3>
    <div class="fgrid">
      <label class="field"><span>{t('Cash kept in reserve, % of the account')}</span><input class="input" inputmode="decimal" bind:value={reserveText} /></label>
      {#if trade}
        <label class="field"><span>{CAP_PORT}, {t('% of the account')}</span><input class="input" inputmode="decimal" bind:value={tradeText} /></label>
      {/if}
    </div>
    {#if split.length > 1}
      <p class="muted">{t('The rest, after the reserve, is divided between these portfolios.')}</p>
      <div class="fgrid">
        {#each split as name (name)}
          <label class="field"><span>{name}, %</span><input class="input" inputmode="decimal" bind:value={shareText[name]} /></label>
        {/each}
      </div>
      {#if !sharesOk}<p class="small loss" role="alert">{t('These must add up to 100%. They add up to')} {Number.isNaN(shareSum) ? '—' : +shareSum.toFixed(2) + '%'}.</p>{/if}
    {/if}

    <div class="form-foot">
      <button type="button" class="btn" onclick={close}>{t('Cancel')}</button>
      <button type="submit" class="btn primary" disabled={!valid}>{t('Save')}</button>
    </div>
  </form>
</Dialog>

<style>
  strong { font: 650 20px/1.2 var(--font-display); letter-spacing: -0.02em; margin-left: 8px; }
</style>
