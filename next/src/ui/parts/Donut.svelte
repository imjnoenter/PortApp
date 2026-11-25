<script lang="ts" module>
  export interface Slice { key: string; label: string; value: number; color: string }
</script>

<script lang="ts">
  import { ringArc } from '../arc.ts';
  // A ring of slices with a centre readout. Hover is shared with the caller (bind:hover) so a
  // legend beside it can light up the same slice.
  let { slices, hover = $bindable(null), title, centre, onpick, onback, backLabel = '', logos = false, noLogo = [], maxSize }: {
    slices: Slice[];
    hover?: string | null;
    title: string;
    centre: (s: Slice | null) => { top: string; main: string };
    onpick?: (s: Slice) => void;
    /** When set, the middle of the ring is a button that goes back up a level. */
    onback?: () => void;
    backLabel?: string;
    /** Draw each slice's stock logo: inside the slice when it fits, else outside on a leader line. */
    logos?: boolean;
    /** Keys that get no logo (cash, say). */
    noLogo?: string[];
    /** With logos: the tallest the donut may be, in px (default 440). Logos keep their size. */
    maxSize?: number;
  } = $props();

  const R = 100, R0 = 72, GAP = 0.02;   // radians of surface between neighbours
  // With logos the box takes the full width at a capped height, and the view box widens to match,
  // so the ring stays the same size and the outside logos spread into the sides.
  const MAXH = $derived(maxSize ?? 440);
  let boxW = $state(0);
  const boxH = $derived(logos ? Math.min(MAXH, boxW || MAXH) : 0);
  // Logos are a fixed size on screen, whatever the donut's: 22px across, the same as the Positions
  // table's (Logo size 22, image inset 12%). The view box then leaves just enough room round the
  // ring for the outside ones: VB = R + 24 + 2·OLR, with OLR in view-box units.
  const LR_PX = 11, OLR_PX = 11;
  const VB = $derived(logos ? (R + 24) / (1 - 4 * OLR_PX / Math.max(220, boxH || MAXH)) : 104);
  const unit = $derived(logos ? Math.max(220, boxH || MAXH) / (2 * VB) : 1);   // px per view-box unit
  const VBX = $derived(logos && boxW && boxH ? Math.max(VB, VB * boxW / boxH) : VB);
  const total = $derived(slices.reduce((s, x) => s + Math.max(0, x.value), 0));
  const arcs = $derived.by(() => {
    let a = -Math.PI / 2;
    return slices.filter(s => s.value > 0).map(s => {
      const span = Math.min(s.value / total * Math.PI * 2, Math.PI * 2 - 0.0001);
      const mid = a + span / 2, d = ringArc(R, R0, a, span, GAP);
      a += span;
      return { s, span, mid, d };
    });
  });

  // Logo placement. A logo of radius LR sits mid-ring when the slice's chord there is wide enough;
  // the rest sit on one circle round the ring, each at its slice's angle, nudged apart only where
  // two would overlap.
  const RM = (R + R0) / 2;
  const LR = $derived(LR_PX / unit), OLR = $derived(OLR_PX / unit);
  const RO = $derived(VB - OLR - 6);
  const DA = $derived(2 * Math.asin(Math.min(1, (OLR * 2 + 3) / 2 / RO)));   // the least angle between two outside logos
  interface Mark { s: Slice; x: number; y: number; r: number; line?: string }
  const marks = $derived.by<Mark[]>(() => {
    if (!logos) return [];
    const out: Mark[] = [];
    let outside: { s: Slice; mid: number; a: number }[] = [];
    for (const a of arcs) {
      if (noLogo.includes(a.s.key)) continue;
      if (2 * RM * Math.sin(Math.min(a.span, Math.PI) / 2) >= LR * 2 + 5) out.push({ s: a.s, x: RM * Math.cos(a.mid), y: RM * Math.sin(a.mid), r: LR });
      else outside.push({ s: a.s, mid: a.mid, a: a.mid });
    }
    // When there are more small slices than the circle holds, the biggest of them keep their logo.
    const fit = Math.floor(Math.PI * 2 / DA);
    outside = outside.sort((a, b) => b.s.value - a.s.value).slice(0, fit).sort((a, b) => a.mid - b.mid);
    const n = outside.length;
    // Spread crowded neighbours: push each overlapping pair apart by half the shortfall, round the
    // whole circle (the last and first are neighbours too), until nothing overlaps.
    for (let pass = 0; pass < 200 && n > 1; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        const p = outside[i], q = outside[(i + 1) % n];
        const gap = (q.a - p.a + (i === n - 1 ? Math.PI * 2 : 0));
        if (gap < DA - 1e-6) { const d = (DA - gap) / 2; p.a -= d; q.a += d; moved = true; }
      }
      if (!moved) break;
    }
    for (const o of outside) {
      const c0 = Math.cos(o.mid), s0 = Math.sin(o.mid), c = Math.cos(o.a), s = Math.sin(o.a), e = RO - OLR - 2;
      out.push({ s: o.s, x: RO * c, y: RO * s, r: OLR,
        line: `M${(R + 1) * c0} ${(R + 1) * s0}L${(R + 6) * c0} ${(R + 6) * s0}L${e * c} ${e * s}` });
    }
    return out;
  });
  let failed = $state<Record<string, true>>({});
  const logoUrl = (sym: string) => `https://financialmodelingprep.com/image-stock/${encodeURIComponent(sym)}.png`;

  const active = $derived(slices.find(s => s.key === hover) || null);
  const read = $derived(centre(active));
</script>

<div class="donut" class:wide={logos} bind:clientWidth={boxW} style:height={logos ? `${boxH}px` : null}
  style:--hole={logos && boxH ? `${(R0 * 2) / (VB * 2) * boxH}px` : null}>
  <svg viewBox="{-VBX} {-VB} {VBX * 2} {VB * 2}" role="img" aria-label={title}>
    {#each arcs as a (a.s.key)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <path d={a.d} fill={a.s.color} class:dim={hover != null && hover !== a.s.key} class:pick={!!onpick}
        onpointerenter={() => hover = a.s.key} onpointerleave={() => hover = null} onclick={() => onpick?.(a.s)} />
    {/each}
    {#each marks as k (k.s.key)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <g class="mark" class:out={!!k.line} class:dim={hover != null && hover !== k.s.key} class:pick={!!onpick && !!k.line}
        onpointerenter={k.line ? () => hover = k.s.key : undefined} onpointerleave={k.line ? () => hover = null : undefined}
        onclick={k.line ? () => onpick?.(k.s) : undefined}>
        {#if k.line}<path class="leader" d={k.line} stroke={k.s.color} />{/if}
        <circle cx={k.x} cy={k.y} r={k.r} class="chip" />
        {#if failed[k.s.key]}
          <text x={k.x} y={k.y} class="letter" font-size={k.r * 0.95}>{k.s.label.slice(0, 1)}</text>
        {:else}
          <image href={logoUrl(k.s.key)} x={k.x - k.r * 0.76} y={k.y - k.r * 0.76} width={k.r * 1.52} height={k.r * 1.52}
            preserveAspectRatio="xMidYMid meet" onerror={() => failed[k.s.key] = true} />
        {/if}</g>
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
  .mark { transition: opacity 0.15s var(--ease); pointer-events: none; }
  .mark.out { pointer-events: auto; }
  .mark.pick { cursor: pointer; }
  .mark.dim { opacity: 0.3; }
  /* In screen pixels, not view-box units, so it stays this thin whatever size the donut is drawn at. */
  .leader { fill: none; stroke-width: 1px; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
  .chip { fill: var(--sunk); stroke: var(--card); stroke-width: 1.5; }
  .letter { fill: var(--ink-2); font-weight: 700; text-anchor: middle; dominant-baseline: central; }
  /* With logos round it, the ring is a smaller share of the box, so the hole is too. */
  /* Full width at a capped height (set inline); the centre readout is sized to the ring's hole. */
  .donut.wide { max-width: none; aspect-ratio: auto; }
  .donut.wide .centre { inset: auto; left: 50%; top: 50%; width: var(--hole, 50%); height: var(--hole, 50%); transform: translate(-50%, -50%); padding: 0 calc(var(--hole, 200px) * 0.1); border-radius: 50%; }
  /* (A % padding would be of the card's width, not the hole's — on a wide card it ate the whole hole.) */
  .donut.wide .main { font-size: clamp(20px, 2.4vw, 28px); }
  .centre { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; text-align: center; padding: 0 26%; }
  /* The button is the hole of the ring, so it never covers a slice. */
  .centre.back { pointer-events: auto; inset: 20%; padding: 0 6%; border-radius: 50%; cursor: pointer; transition: background 0.15s var(--ease); }
  .centre.back:hover { background: var(--wash); }
  .hint { margin-top: 4px; font-size: 11px; font-weight: 500; color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .top { font-size: 13px; color: var(--ink-2); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .main { font: 750 clamp(24px, 3vw, 34px)/1.1 var(--font-display); letter-spacing: -0.04em; }
</style>
