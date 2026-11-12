<script lang="ts" module>
  export interface RingSlice { key: string; label: string; color: string; outer: number; inner: number }
</script>

<script lang="ts">
  // Two rings sharing one set of slices: the outer ring is the plan, the inner ring is what is held
  // now. Seeing them nested shows at a glance which slices the plan grows and which it shrinks.
  let { slices, title, outerLabel, innerLabel, hover = $bindable(null), onpick }: {
    slices: readonly RingSlice[]; title: string; outerLabel: string; innerLabel: string;
    hover?: string | null; onpick?: (key: string) => void;
  } = $props();

  const GAP = 0.018;
  function arcs(pick: (s: RingSlice) => number, r1: number, r0: number) {
    const total = slices.reduce((s, x) => s + Math.max(0, pick(x)), 0);
    if (!(total > 0)) return [];
    let a = -Math.PI / 2;
    const out: { key: string; color: string; d: string }[] = [];
    for (const s of slices) {
      const v = Math.max(0, pick(s));
      if (!v) continue;
      const span = Math.min(v / total * Math.PI * 2, Math.PI * 2 - 0.0001);
      const pad = span > GAP * 3 ? GAP / 2 : 0, a0 = a + pad, a1 = a + span - pad, big = a1 - a0 > Math.PI ? 1 : 0;
      a += span;
      const p = (r: number, t: number) => `${(Math.cos(t) * r).toFixed(2)} ${(Math.sin(t) * r).toFixed(2)}`;
      out.push({ key: s.key, color: s.color, d: `M${p(r1, a0)}A${r1} ${r1} 0 ${big} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 ${big} 0 ${p(r0, a0)}Z` });
    }
    return out;
  }
  const outer = $derived(arcs(s => s.outer, 100, 76));
  const inner = $derived(arcs(s => s.inner, 70, 52));
  const shown = $derived(slices.find(s => s.key === hover) ?? null);
  const fmt = (n: number) => n.toFixed(1) + '%';
</script>

<figure>
  <figcaption>{title}</figcaption>
  <div class="box">
    <svg viewBox="-104 -104 208 208" role="img" aria-label="{title}: {slices.map(s => `${s.label} ${fmt(s.outer)}`).join(', ')}">
      {#each [outer, inner] as ring, i (i)}
        {#each ring as a (a.key)}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <path d={a.d} fill={a.color} class:dim={hover != null && hover !== a.key} class:pick={!!onpick}
            onpointerenter={() => hover = a.key} onpointerleave={() => hover = null} onclick={() => onpick?.(a.key)} />
        {/each}
      {/each}
    </svg>
    <div class="mid">
      {#if shown}
        <span class="lab">{shown.label}</span>
        <strong>{fmt(shown.outer)}</strong>
        <span class="small muted">{innerLabel} {fmt(shown.inner)}</span>
      {:else}
        <span class="small muted">{outerLabel}</span>
        <span class="small muted">{innerLabel}</span>
      {/if}
    </div>
  </div>
</figure>

<style>
  figure { margin: 0; display: grid; gap: 6px; min-width: 0; min-height: 0; grid-template-rows: auto minmax(0, 1fr); }
  figcaption { font-size: 13px; font-weight: 600; color: var(--ink-2); }
  .box { position: relative; min-height: 0; display: grid; place-items: center; }
  svg { width: 100%; height: 100%; max-height: 240px; }
  path { transition: opacity 0.15s var(--ease); }
  path.dim { opacity: 0.25; }
  path.pick { cursor: pointer; }
  .mid { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 1px; text-align: center; pointer-events: none; padding: 0 30%; }
  .lab { font-size: 12px; font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { font: 700 20px/1.1 var(--font-display); letter-spacing: -0.02em; }
  .small { font-size: 11px; }
</style>
