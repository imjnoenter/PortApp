<script lang="ts">
  // A small line chart: one y-axis, a legend that doubles as the readout, a crosshair on hover.
  import { date } from '../../core/format.ts';
  import { dateTicks, ticks } from '../axis.ts';

  interface Line { name: string; color: string; values: readonly number[]; dashed?: boolean }
  let { lines, labels, format, axisFormat, zero = false }: {
    lines: readonly Line[];
    labels: readonly string[];
    format: (n: number) => string;
    /** A shorter form for the scale down the side, where there is little room. Defaults to `format`. */
    axisFormat?: (n: number) => string;
    /** Draw a rule at zero (for returns). */
    zero?: boolean;
  } = $props();

  const W = 720, H = 240, PAD = 8;
  const n = $derived(labels.length);
  const scale = $derived.by(() => {
    let lo = Infinity, hi = -Infinity;
    for (const l of lines) for (const v of l.values) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (!(hi > lo)) { hi = lo + 1; }
    const x = (i: number) => PAD + (n > 1 ? i / (n - 1) : 0) * (W - PAD * 2);
    const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD * 2);
    const inv = (yv: number) => lo + (1 - (yv - PAD) / (H - PAD * 2)) * (hi - lo);
    return { lo, hi, x, y, inv, ticks: ticks(inv(H), inv(0)), dates: dateTicks(labels) };
  });
  const paths = $derived(lines.map(l => l.values.map((v, i) => `${i ? 'L' : 'M'}${scale.x(i).toFixed(1)} ${scale.y(v).toFixed(1)}`).join('')));

  let at = $state<number | null>(null);
  let py = $state<number | null>(null);
  function track(e: PointerEvent) {
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    at = Math.round(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * (n - 1));
    py = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)) * H;
  }
  const leave = () => { at = null; py = null; };
  const shown = $derived(at ?? n - 1);
</script>

{#if n > 1}
  <div class="legend">
    {#each lines as l (l.name)}
      <span class="key"><i style:background={l.color} class:dashed={l.dashed}></i>{l.name} <strong>{format(l.values[shown])}</strong></span>
    {/each}
    <span class="muted when">{date(labels[shown])}</span>
  </div>
  <div class="frame">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label={lines.map(l => `${l.name} ${format(l.values[n - 1])}`).join(', ')}
    onpointermove={track} onpointerdown={track} onpointerleave={leave}>
    {#each scale.ticks as v (v)}<line class="grid" x1="0" x2={W} y1={scale.y(v)} y2={scale.y(v)} vector-effect="non-scaling-stroke" />{/each}
    {#each scale.dates as d (d.i)}<line class="grid" x1={scale.x(d.i)} x2={scale.x(d.i)} y1="0" y2={H} vector-effect="non-scaling-stroke" />{/each}
    {#if zero}<line class="rule" x1="0" x2={W} y1={scale.y(0)} y2={scale.y(0)} />{/if}
    {#each lines as l, i (l.name)}
      <path d={paths[i]} fill="none" stroke={l.color} stroke-width="2" stroke-linejoin="round" stroke-dasharray={l.dashed ? '5 5' : undefined} vector-effect="non-scaling-stroke" />
    {/each}
    {#if at != null}<line class="cross" x1={scale.x(at)} x2={scale.x(at)} y1="0" y2={H} vector-effect="non-scaling-stroke" />{/if}
    {#if py != null}<line class="cross" x1="0" x2={W} y1={py} y2={py} vector-effect="non-scaling-stroke" />{/if}
  </svg>
  <div class="yaxis" aria-hidden="true">
    {#each scale.ticks as v (v)}<span style:top="{scale.y(v) / H * 100}%">{(axisFormat ?? format)(v)}</span>{/each}
    {#if py != null}<span class="badge" style:top="{py / H * 100}%">{(axisFormat ?? format)(scale.inv(py))}</span>{/if}
  </div>
  <div class="xaxis" aria-hidden="true">
    {#each scale.dates as d (d.i)}<span style:left="{scale.x(d.i) / W * 100}%">{d.label}</span>{/each}
    {#if at != null}<span class="badge" style:left="{scale.x(at) / W * 100}%">{date(labels[at], true)}</span>{/if}
  </div>
  </div>
{/if}

<style>
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px var(--sp-5); font-size: 13px; color: var(--ink-2); margin-bottom: var(--sp-3); }
  .key { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
  .key i { width: 14px; height: 3px; border-radius: 2px; }
  .key i.dashed { background-image: linear-gradient(90deg, var(--card) 40%, transparent 40%); background-size: 6px 3px; }
  .key strong { color: var(--ink); font-weight: 650; }
  .when { margin-left: auto; }
  svg { display: block; width: 100%; height: clamp(180px, 26vh, 260px); touch-action: pan-y; cursor: crosshair; }
  .frame { display: grid; grid-template-columns: minmax(0, 1fr) 64px; grid-template-rows: auto 22px; }
  .yaxis, .xaxis { position: relative; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .yaxis span { position: absolute; left: 8px; translate: 0 -50%; white-space: nowrap; }
  .xaxis span { position: absolute; top: 5px; translate: -50% 0; white-space: nowrap; }
  .badge { padding: 1px 6px; border-radius: 4px; background: var(--ink); color: var(--card); font-weight: 600; z-index: 1; }
  .yaxis .badge { left: 2px; }
  .xaxis .badge { top: 3px; }
  .grid { stroke: var(--line-soft); stroke-width: 1; }
  .rule { stroke: var(--line); stroke-width: 1; }
  .cross { stroke: var(--muted); stroke-width: 1; }
</style>
