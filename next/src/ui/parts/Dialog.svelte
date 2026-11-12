<script lang="ts">
  import { getContext } from 'svelte';
  import type { Snippet } from 'svelte';
  import { WORKSPACE } from '../workspace.svelte.ts';
  import { app } from '../../state/app.svelte.ts';

  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();
  const t = app.t;
  // Inside the symbol workspace a form is one panel of a larger window, so it brings no frame of its own.
  const embedded = !!getContext(WORKSPACE);
</script>

{#if embedded}
  {@render children()}
{:else}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}></div>
<div class="dialog" role="dialog" aria-modal="true" aria-label={title}>
  <header>
    <h2>{title}</h2>
    <button type="button" class="icon-btn" onclick={onclose} aria-label={t('Close')}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </header>
  <div class="body">{@render children()}</div>
</div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: var(--z-dialog); background: color-mix(in oklab, #060912 62%, transparent); backdrop-filter: blur(3px); animation: fade 0.2s var(--ease); }
  .dialog { position: fixed; z-index: var(--z-dialog); left: 50%; top: 50%; translate: -50% -50%; width: min(560px, calc(100vw - 32px)); max-height: min(92dvh, 900px); display: flex; flex-direction: column; overflow: hidden; background: var(--card); border-radius: 28px; box-shadow: var(--shadow); animation: rise 0.3s var(--ease); }
  @keyframes fade { from { opacity: 0; } }
  @keyframes rise { from { transform: translateY(18px) scale(0.985); opacity: 0; } }
  header { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-5) var(--sp-5) var(--sp-4) var(--sp-6); }
  h2 { font: 700 24px/1.1 var(--font-display); letter-spacing: -0.03em; }
  header .icon-btn { background: var(--wash); }
  .body { overflow-y: auto; padding: 0 var(--sp-6) calc(var(--sp-6) + env(safe-area-inset-bottom)); }
  @media (max-width: 700px) {
    .dialog { left: 0; right: 0; top: auto; bottom: 0; translate: none; width: 100%; max-height: 94dvh; border-radius: 24px 24px 0 0; }
    header { padding-inline: var(--sp-4); }
    .body { padding-inline: var(--sp-4); }
  }
</style>
