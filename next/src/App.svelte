<script lang="ts">
  import { app } from './state/app.svelte.ts';
  import { theme } from './state/theme.svelte.ts';
  import Setup from './ui/Setup.svelte';
  import Shell from './ui/Shell.svelte';

  // Preferences live on <html> so every token switches in one place.
  $effect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme.dark ? 'dark' : 'light';
    root.lang = app.prefs.lang;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.dark ? '#0f1422' : '#e9edf2');
  });
  $effect(() => { JSON.stringify(app.prefs); app.savePrefs(); });
</script>

{#if app.status === 'setup'}
  <Setup />
{:else if app.status === 'loading'}
  <div class="boot loading" aria-busy="true">
    <img class="mark" src="./favicon-white.png" alt="" width="148" height="148" />
    <div class="wait">
      <span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>
      {app.t('Loading your portfolio…')}
    </div>
  </div>
{:else if app.status === 'error'}
  <div class="boot">
    <div class="fail">
      <h1>{app.t('Could not load the sheet')}</h1>
      <p class="ink2">{app.error}</p>
      <p class="muted">{app.t('Check that the sheet is shared as “Anyone with the link can view”.')}</p>
      <div class="row">
        <button class="btn primary" onclick={() => app.load(true)}>{app.t('Try again')}</button>
        <button class="btn" onclick={() => app.status = 'setup'}>{app.t('Connect another sheet')}</button>
      </div>
    </div>
  </div>
{:else}
  <Shell />
{/if}

<style>
  .boot { min-height: 100dvh; display: flex; align-items: center; justify-content: center; gap: var(--sp-3); color: var(--ink-2); padding: var(--gutter); }
  /* The logo is the page while it loads: large and centred, with the progress line under it. */
  .boot.loading { flex-direction: column; gap: var(--sp-6); }
  .mark { width: clamp(112px, 22vw, 148px); height: auto; aspect-ratio: 1; border-radius: 22%; box-shadow: var(--shadow); animation: settle 0.5s var(--ease) both; }
  .wait { display: flex; align-items: center; gap: var(--sp-3); }
  @keyframes settle { from { opacity: 0; transform: scale(0.92); } }
  .bars { display: inline-flex; align-items: flex-end; gap: 3px; height: 18px; }
  .bars i { width: 5px; height: 100%; border-radius: 2px; background: var(--ink); transform-origin: bottom; animation: rise 0.9s var(--ease) infinite alternate; }
  .bars i:nth-child(2) { animation-delay: 0.15s; }
  .bars i:nth-child(3) { animation-delay: 0.3s; }
  @keyframes rise { from { transform: scaleY(0.25); } to { transform: scaleY(1); } }
  .fail { max-width: 480px; display: grid; gap: var(--sp-3); }
  h1 { font: 700 clamp(28px, 5vw, 40px)/1.05 var(--font-display); letter-spacing: -0.03em; }
  .row { display: flex; gap: var(--sp-2); flex-wrap: wrap; margin-top: var(--sp-3); }
</style>
