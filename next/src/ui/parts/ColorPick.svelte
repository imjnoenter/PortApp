<script lang="ts">
  // A swatch that opens a small editor for one symbol's slice colour: a picker, a HEX box, and a
  // reset back to the colour taken from the logo.
  import { normHex, sliceColors } from '../../state/logoColors.svelte.ts';
  import { app } from '../../state/app.svelte.ts';

  let { sym, color }: { sym: string; color: string } = $props();
  const t = app.t;
  let open = $state(false);
  let text = $state('');
  let root = $state<HTMLElement>();
  const own = $derived(sliceColors.override(sym));
  const valid = $derived(normHex(text));

  // Fixed to the viewport: the legend it lives in scrolls and would clip it.
  let at = $state({ x: 0, y: 0 });
  function toggle(e: MouseEvent) {
    e.stopPropagation();
    open = !open;
    if (!open) return;
    text = own ?? color;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    at = { x: Math.max(8, Math.min(r.left, innerWidth - 236)), y: r.bottom + 220 > innerHeight ? Math.max(8, r.top - 186) : r.bottom + 6 };
  }
  function apply(hex: string) { const h = normHex(hex); if (h) { sliceColors.setOverride(sym, h); text = h; } }
  function reset() { sliceColors.clearOverride(sym); open = false; }

  // The panel is moved to <body>: inside the table, the table's borders and later rows painted over it.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
  let pop = $state<HTMLElement>();
  const inside = (n: Node) => !!(root?.contains(n) || pop?.contains(n));

  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!inside(e.target as Node)) open = false; };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') open = false; };
    const scroll = (e: Event) => { if (!inside(e.target as Node)) open = false; };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key); document.removeEventListener('scroll', scroll, true); };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<span class="cp" bind:this={root} onclick={e => e.stopPropagation()}>
  <button class="sw" class:own={!!own} style:background={color} onclick={toggle}
    aria-label="{t('Slice colour for')} {sym}" title="{t('Slice colour for')} {sym}"></button>
  {#if open}
    <div class="pop" use:portal bind:this={pop} style:left="{at.x}px" style:top="{at.y}px" role="dialog" aria-label="{t('Slice colour for')} {sym}">
      <div class="row">
        <input type="color" value={valid ?? color} oninput={e => apply(e.currentTarget.value)} aria-label={t('Pick a colour')}>
        <input class="hex" type="text" bind:value={text} maxlength="7" spellcheck="false" placeholder="#2a78d6"
          class:bad={text.length > 0 && !valid}
          onkeydown={e => { if (e.key === 'Enter' && valid) { apply(text); open = false; } }}
          oninput={() => { if (valid) apply(text); }} aria-label="HEX">
      </div>
      <p class="small muted">{own ? t('Your colour.') : t('Taken from the logo.')}</p>
      <div class="row acts">
        <button class="btn" onclick={reset} disabled={!own} title={t('Reset to logo colour')}>{t('Reset')}</button>
        <button class="btn" onclick={() => open = false}>{t('Done')}</button>
      </div>
    </div>
  {/if}
</span>

<style>
  .cp { position: relative; display: inline-block; vertical-align: middle; margin-right: 8px; }
  .sw { display: block; width: 14px; height: 14px; border-radius: 50%; cursor: pointer; box-shadow: 0 0 0 1px var(--line); }
  .sw:hover { box-shadow: 0 0 0 2px var(--ink-2); }
  /* A ring marks a colour the user set. */
  .sw.own { box-shadow: 0 0 0 2px var(--card), 0 0 0 3.5px var(--ink); }
  /* Every track is minmax(0, …) so no child's natural width (an input's default size, a button's
     label) can push past the panel's edge. */
  .pop { position: fixed; z-index: var(--z-pop); width: 236px;
    padding: var(--sp-3); border-radius: var(--radius-sm); background: var(--card); border: 1px solid var(--line);
    box-shadow: var(--shadow); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-2); font-weight: 400; }
  .row { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 8px; align-items: center; min-width: 0; }
  .row.acts { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  input[type='color'] { width: 40px; height: 32px; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: none; cursor: pointer; }
  .hex { width: 100%; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--sunk); color: var(--ink); font: 500 13px var(--font); text-transform: lowercase; }
  .hex.bad { border-color: var(--loss); }
  p { margin: 0; }
  .row .btn { min-width: 0; justify-content: center; padding: 6px 12px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
