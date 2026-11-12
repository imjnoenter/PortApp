<script lang="ts" module>
  export interface Slice { key: string; label: string; value: number; color: string }
</script>

<script lang="ts">
  // A ring of slices with a centre readout. Hover is shared with the caller (bind:hover) so a
  // legend beside it can light up the same slice.
  let { slices, hover = $bindable(null), title, centre, onpick, onback, backLabel = '' }: {
    slices: Slice[];
    hover?: string | null;
    title: string;
    centre: (s: Slice | null) => { top: string; main: string };
    onpick?: (s: Slice) => void;
    /** When set, the middle of the ring is a button that goes back up a level. */
    onback?: () => void;
    backLabel?: string;
  } = $props();

  const R = 100, R0 = 72, GAP = 0.02;   // radians of surface between neighbours
  const total = $derived(slices.reduce((s, x) => s + Math.max(0, x.value), 0));
  const arcs = $derived.by(() => {
    let a = -Math.PI / 2;
    return slices.filter(s => s.value > 0).map(s => {
      const span = Math.min(s.value / total * Math.PI * 2, Math.PI * 2 - 0.0001);
      const pad = span > GAP * 3 ? GAP / 2 : 0;
      const a0 = a + pad, a1 = a + span - pad;
      a += span;
      const p = (r: number, ang: number) => `${(r * Math.cos(ang)).toFixed(2)} ${(r * Math.sin(ang)).toFixed(2)}`;
      const big = a1 - a0 > Math.PI ? 1 : 0;
      return { s, d: `M${p(R, a0)}A${R} ${R} 0 ${big} 1 ${p(R, a1)}L${p(R0, a1)}A${R0} ${R0} 0 ${big} 0 ${p(R0, a0)}Z` };
    });
  });
  const active = $derived(slices.find(s => s.key === hover) || null);
  const read = $derived(centre(active));
</script>

<div class="donut">
  <svg viewBox="-104 -104 208 208" role="img" aria-label={title}>
    {#each arcs as a (a.s.key)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <path d={a.d} fill={a.s.color} class:dim={hover != null && hover !== a.s.key} class:pick={!!onpick}
        onpointerenter={() => hover = a.s.key} onpointerleave={() => hover = null} onclick={() => onpick?.(a.s)} />
    {/each}
  </svg>
  {#if onback}
    <button class="centre back" onclick={onback} aria-label={backLabel} title={backLabel}>
      <span class="top">{read.top}</span>
      <span class="main">{read.main}</span>
      <span class="hint">{backLabel}</span>
    </button>
  {:else}
    <div class="centre">
      <span class="top">{read.top}</span>
      <span class="main">{read.main}</span>
    </div>
  {/if}
</div>

<style>
  .donut { position: relative; width: 100%; max-width: 360px; aspect-ratio: 1; margin: 0 auto; }
  svg { width: 100%; height: 100%; display: block; }
  path { transition: opacity 0.15s var(--ease); }
  path.dim { opacity: 0.35; }
  path.pick { cursor: pointer; }
  .centre { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; text-align: center; padding: 0 26%; }
  /* The button is the hole of the ring, so it never covers a slice. */
  .centre.back { pointer-events: auto; inset: 20%; padding: 0 6%; border-radius: 50%; cursor: pointer; transition: background 0.15s var(--ease); }
  .centre.back:hover { background: var(--wash); }
  .hint { margin-top: 4px; font-size: 11px; font-weight: 500; color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .top { font-size: 13px; color: var(--ink-2); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .main { font: 750 clamp(24px, 3vw, 34px)/1.1 var(--font-display); letter-spacing: -0.04em; }
</style>
