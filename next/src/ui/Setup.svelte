<script lang="ts">
  import { parseSheetId } from '../data/config.ts';
  import { app } from '../state/app.svelte.ts';
  import { theme } from '../state/theme.svelte.ts';
  import DeleteButton from './parts/DeleteButton.svelte';

  const t = app.t;
  // Opened from the menu on a saved account, this form changes it; otherwise it adds one.
  const editing = app.editing;
  let name = $state(editing?.profileName ?? '');
  let sheet = $state(editing?.sheetId ?? '');
  let recordUrl = $state(editing?.recordUrl ?? '');
  let writeKey = $state(editing?.writeKey ?? '');
  let geminiKey = $state(editing?.geminiKey ?? '');
  let error = $state('');

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const sheetId = parseSheetId(sheet);
    if (!sheetId) { error = t('That does not look like a Google Sheets link or ID.'); return; }
    const details = {
      profileName: name.trim() || 'Portfolio', sheetId,
      recordUrl: recordUrl.trim() || undefined, writeKey: writeKey.trim() || undefined, geminiKey: geminiKey.trim() || undefined,
    };
    if (editing) app.saveProfile(editing.id, details); else app.connect(details);
  }
  const cancel = () => { app.editing = null; app.status = app.rawRows.length ? 'ready' : 'loading'; void app.load(); };
</script>

<main class="setup">
  <button class="icon-btn mode" onclick={theme.toggle} aria-label={theme.dark ? t('Switch to light mode') : t('Switch to dark mode')}>
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {#if theme.dark}
        <circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
      {:else}
        <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2z" />
      {/if}
    </svg>
  </button>
  <form onsubmit={submit}>
    <h1>{editing ? t('Account details') : t('Connect your portfolio sheet')}</h1>
    <p class="ink2 lead">{t('Everything stays in this browser. The sheet is read directly from Google.')}</p>

    <label>
      <span>{t('Account name')}</span>
      <input class="input" bind:value={name} placeholder="Portfolio" autocomplete="off">
    </label>
    <label>
      <span>{t('Google Sheet link or ID')}</span>
      <input class="input" bind:value={sheet} required placeholder="https://docs.google.com/spreadsheets/d/…" autocomplete="off" oninput={() => error = ''}>
      {#if error}<span class="loss small" role="alert">{error}</span>{/if}
    </label>

    <details open={!!editing}>
      <summary>{t('Saving changes (optional)')}</summary>
      <p class="muted small">{t('Only needed to record trades from here. Without these the app is read-only.')}</p>
      <label>
        <span>{t('Apps Script web app URL')}</span>
        <input class="input" bind:value={recordUrl} placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off">
      </label>
      <label>
        <span>{t('Write key')}</span>
        <input class="input" type="password" bind:value={writeKey} autocomplete="off">
      </label>
      <label>
        <span>{t('Gemini key, for the question box on each symbol')}</span>
        <input class="input" type="password" bind:value={geminiKey} autocomplete="off">
      </label>
    </details>

    <div class="row">
      <button class="btn primary" type="submit">{editing ? t('Save') : t('Connect')}</button>
      {#if app.profile}<button class="btn" type="button" onclick={cancel}>{t('Cancel')}</button>{/if}
      {#if editing}<DeleteButton label={t('Forget this account on this device')} confirm={t('Press again to forget it')} onconfirm={() => app.forgetProfile(editing.id)} />{/if}
    </div>
  </form>
</main>

<style>
  .setup { position: relative; min-height: 100dvh; display: grid; align-content: center; padding: var(--sp-8) var(--gutter); max-width: var(--page-w); margin: 0 auto; }
  .mode { position: absolute; top: calc(var(--sp-4) + env(safe-area-inset-top)); right: var(--gutter); }
  form { width: 100%; max-width: 520px; display: grid; gap: var(--sp-5); }
  h1 { font: 750 clamp(36px, 7vw, 64px)/1 var(--font-display); letter-spacing: -0.045em; max-width: 12ch; }
  .lead { font-size: 16px; line-height: 1.5; max-width: 44ch; margin-bottom: var(--sp-3); }
  label { display: grid; gap: 8px; }
  label > span:first-child { font-size: 14px; font-weight: 500; color: var(--ink); }
  details { display: grid; gap: var(--sp-3); }
  details[open] summary { margin-bottom: var(--sp-3); }
  details label { margin-top: var(--sp-4); }
  summary { cursor: pointer; color: var(--ink-2); font-size: 14px; }
  .row { display: flex; gap: var(--sp-2); margin-top: var(--sp-2); }
</style>
