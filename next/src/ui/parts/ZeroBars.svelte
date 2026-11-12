<script lang="ts" module>
  export interface Bar { v: number; tip: string; value?: string; axis?: string; hot?: boolean }
</script>

<script lang="ts">
  // Bars around a zero line: gains rise, losses hang, both scaled to the largest move in view.
  // Direction is carried by side and colour, so printed values are magnitudes.
  import { tip } from '../tip.ts';

  let { bars, height = 160, floor = 0 }: { bars: Bar[]; height?: number; floor?: number } = $props();

  const max = $derived(Math.max(floor, ...bars.map(b => Math.abs(b.v))) || 1);
  const hasAxis = $derived(bars.some(b => b.axis));
</script>

<div class="zb" style:--h="{height}px">
  <div class="plot">
    <div class="zero"></div>
    {#each bars as b, i (i)}
      {@const h = Math.abs(b.v) / max * 100}
      <div class="col" class:hot={b.hot} use:tip={b.tip}>
        <div class="half up">
          {#if b.v > 0}<div class="bar gainbar" style:height="max(2px, {h}%)">{#if b.value}<span class="val">{b.value}</span>{/if}</div>{/if}
        </div>
        <div class="half down">
          {#if b.v < 0}<div class="bar lossbar" style:height="max(2px, {h}%)">{#if b.value}<span class="val">{b.value}</span>{/if}</div>{/if}
        </div>
      </div>
    {/each}
  </div>
  {#if hasAxis}
    <div class="axis">{#each bars as b, i (i)}<span class:hot={b.hot}>{b.axis || ''}</span>{/each}</div>
  {/if}
</div>

<style>
  .plot { position: relative; display: flex; gap: 3px; height: var(--h); }
  .zero { position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: var(--line); }
  .col { flex: 1; min-width: 0; display: flex; flex-direction: column; opacity: 0.72; transition: opacity 0.15s var(--ease); }
  .col.hot, .col:hover { opacity: 1; }
  .half { flex: 1; display: flex; padding: 0 12%; min-height: 0; }
  /* 18px at each end is the strip the printed values sit in */
  .half.up { align-items: flex-end; padding-top: 18px; }
  .half.down { align-items: flex-start; padding-bottom: 18px; }
  .bar { position: relative; width: 100%; max-width: 28px; margin: 0 auto; }
  .gainbar { background: var(--gain); border-radius: 4px 4px 0 0; }
  .lossbar { background: var(--loss); border-radius: 0 0 4px 4px; }
  .val { position: absolute; left: 50%; transform: translateX(-50%); font-size: 10px; color: var(--ink-2); white-space: nowrap; }
  .gainbar .val { bottom: calc(100% + 3px); }
  .lossbar .val { top: calc(100% + 3px); }
  .col.hot .val { color: var(--ink); font-weight: 600; }
  .axis { display: flex; gap: 3px; margin-top: 6px; }
  .axis span { flex: 1; min-width: 0; text-align: center; font-size: 10px; color: var(--muted); white-space: nowrap; overflow: hidden; }
  .axis span.hot { color: var(--ink); font-weight: 600; }
  @media (max-width: 900px) { .val { display: none; } }
</style>
