<script lang="ts">
  // The holdings as one picture: a tile's area is its share of the money, its colour is how it
  // moved. Tiles keep white text in both themes, so their fills come from their own tokens.
  import { pct, signedPct } from '../../core/format.ts';
  import { squarify } from '../../core/treemap.ts';
  import type { Position } from '../../core/types.ts';
  import { app } from '../../state/app.svelte.ts';
  import { tip } from '../tip.ts';

  let { positions, mode }: { positions: Position[]; mode: 'day' | 'total' } = $props();

  const t = app.t;
  const GAP = 3;
  // The move at which a tile reaches full colour: a 3% day, a 30% gain since purchase.
  const cap = $derived(mode === 'day' ? 3 : 30);
  let w = $state(0), h = $state(0);

  const move = (p: Position) => mode === 'day' ? p.dayChangePct : p.pnlPct;
  const fill = (v: number | null | undefined) => !v ? 'var(--tile)'
    : `color-mix(in oklab, var(--${v > 0 ? 'gain' : 'loss'}-fill) ${Math.round(22 + Math.min(Math.abs(v) / cap, 1) * 78)}%, var(--tile))`;

  const tiles = $derived(squarify(positions, p => p.currentValue, w, h).map(r => {
    const tw = r.w - GAP, th = r.h - GAP;
    return {
      p: r.item, x: r.x, y: r.y, tw, th, v: move(r.item),
      size: Math.max(11, Math.min(tw / 4.4, th / 2.5, 38)),
      name: tw >= 34 && th >= 20,
      figure: tw >= 56 && th >= 46,
      weight: tw >= 120 && th >= 96,
    };
  }));
  const tipFor = (p: Position) => [
    p.name ? `${p.symbol}  ${p.name}` : p.symbol,
    `${t('Today')}  ${signedPct(p.dayChangePct)}${p.dayChange == null ? '' : `  ${app.money.signed(p.dayChange * p.qty)}`}`,
    `${t('Since bought')}  ${signedPct(p.pnlPct)}  ${app.money.signed(p.pnl)}`,
    `${t('Value')}  ${app.money(p.currentValue)}  (${pct(p.stockWeightPct, 1)})`,
  ].join('\n');
</script>

<div class="map" bind:clientWidth={w} bind:clientHeight={h}>
  {#each tiles as k (k.p.symbol)}
    <button class="tile" style:left="{k.x}px" style:top="{k.y}px" style:width="{k.tw}px" style:height="{k.th}px"
      style:background={fill(k.v)} style:font-size="{k.size}px"
      use:tip={tipFor(k.p)} onclick={() => app.symbol = k.p.symbol}
      aria-label="{k.p.symbol}, {pct(k.p.stockWeightPct, 1)} {t('of holdings')}, {signedPct(k.v)}">
      {#if k.name}<span class="sym">{k.p.symbol}</span>{/if}
      {#if k.figure}<span class="fig">{signedPct(k.v)}</span>{/if}
      {#if k.weight}<span class="wt">{pct(k.p.stockWeightPct, 1)} {t('of holdings')}</span>{/if}
    </button>
  {:else}
    {#if w}<p class="empty">{t('No holdings in this portfolio yet.')}</p>{/if}
  {/each}
</div>

<style>
  .map { position: relative; width: 100%; height: 100%; min-height: 300px; margin: 0 -3px -3px 0; }
  .tile {
    position: absolute; display: flex; flex-direction: column; justify-content: flex-start; align-items: flex-start;
    padding: 0.5em 0.6em; border-radius: 8px; overflow: hidden; color: #fff; text-align: left; line-height: 1.05;
    transition: filter 0.15s var(--ease), left 0.4s var(--ease), top 0.4s var(--ease), width 0.4s var(--ease), height 0.4s var(--ease);
  }
  .tile:hover { filter: brightness(1.12); }
  .tile:focus-visible { outline: 3px solid var(--ink); outline-offset: 1px; z-index: 1; }
  .sym { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; }
  .fig { font-size: max(11px, 0.52em); font-weight: 500; margin-top: 0.3em; opacity: 0.92; }
  .wt { font-size: 12px; margin-top: auto; opacity: 0.8; }
  .empty { position: absolute; inset: 0; display: grid; place-items: center; }
</style>
