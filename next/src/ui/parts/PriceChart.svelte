<script lang="ts" module>
  export interface Level { label: string; value: number; tone: 'avg' | 'new' | 'entry' | 'stop' | 'profit' }
  export interface Mark { d: string; type: string; shares: number; price: number }
  const EMAS = [50, 100, 200] as const;
  const EMA_KEY = 'portapp.next.ema';
  const KIND_KEY = 'portapp.next.chartKind';
  // Daily candles change once a day, so one fetch per symbol per session is enough.
  interface Bar { o: number; h: number; l: number; c: number }
  const candleCache = new Map<string, Promise<Map<string, Bar>>>();
</script>

<script lang="ts">
  // The price line for one symbol, with what the plan and the ledger say drawn on it: horizontal
  // levels (average cost, planned buys, stop, take-profits), moving averages, and a flag for every
  // buy and sale showing how many shares went at what price.
  import { date, qty, usd } from '../../core/format.ts';
  import { canWrite } from '../../data/config.ts';
  import { ask } from '../../data/write.ts';
  import { app } from '../../state/app.svelte.ts';
  import { dateTicks, tickLabel, ticks } from '../axis.ts';
  import { tip } from '../tip.ts';

  let { sym, levels = [], marks = [], points = $bindable([]) }: {
    sym: string; levels?: readonly Level[]; marks?: readonly Mark[];
    /** The closes drawn, handed back for a caller that wants to reuse them (the share picture). */
    points?: { d: string; v: number }[];
  } = $props();

  const t = app.t;
  const RANGES = [{ id: '3M', days: 92 }, { id: '1Y', days: 366 }, { id: 'All', days: 0 }] as const;
  let range = $state<(typeof RANGES)[number]['id']>('1Y');
  let ema = $state(localStorage.getItem(EMA_KEY) !== '0');
  $effect(() => { try { localStorage.setItem(EMA_KEY, ema ? '1' : '0'); } catch { /* blocked storage */ } });
  const W = 720, H = 260, PAD = 8;

  // ── Candles are another way to draw the same chart, so everything else on it stays: the range,
  // the averages, the plan's levels and the trade flags. They are Heikin Ashi candles: each is
  // averaged with the one before it, which smooths the noise so a trend reads as a run of one colour.
  const canCandle = $derived(!!app.profile && canWrite(app.profile));
  let kind = $state<'line' | 'candles'>(localStorage.getItem(KIND_KEY) === 'candles' ? 'candles' : 'line');
  $effect(() => { try { localStorage.setItem(KIND_KEY, kind); } catch { /* blocked storage */ } });
  let bars = $state.raw<Map<string, Bar> | null>(null);
  let candleError = $state(false);
  function loadCandles(symbol: string) {
    const p = app.profile!;
    const key = p.id + ':' + symbol;
    let hit = candleCache.get(key);
    if (!hit) {
      hit = ask<{ ohlc: Record<string, Bar> }>(p, { action: 'fetchOHLC', symbol, range: '5y' }).then(r => {
        const out = new Map<string, Bar>();
        let prev: Bar | null = null;
        for (const d of Object.keys(r.ohlc || {}).sort()) {
          const b: Bar = r.ohlc[d], c = (b.o + b.h + b.l + b.c) / 4, o: number = prev ? (prev.o + prev.c) / 2 : (b.o + b.c) / 2;
          prev = { o, c, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c) };
          out.set(d, prev);
        }
        return out;
      });
      hit.catch(() => candleCache.delete(key));
      candleCache.set(key, hit);
    }
    return hit;
  }
  $effect(() => {
    if (kind !== 'candles' || !canCandle) return;
    const symbol = sym;
    bars = null; candleError = false;
    loadCandles(symbol).then(b => { if (symbol === sym) bars = b; }).catch(() => { if (symbol === sym) candleError = true; });
  });
  const drawCandles = $derived(kind === 'candles' && canCandle && !!bars?.size);

  const price = $derived(app.quotes[sym]?.price ?? app.rows.find(r => r.symbol === sym)?.price ?? null);
  // Every close on record, today's live price on the tail. The moving averages need all of it.
  const all = $derived.by(() => {
    const map = app.history.prices[sym];
    if (!map) return [];
    const pts = Object.keys(map).sort().map(d => ({ d, v: map[d] })).filter(p => p.v > 0);
    if (price != null && price > 0) {
      if (pts.length && pts[pts.length - 1].d >= app.today) pts[pts.length - 1] = { d: app.today, v: price };
      else pts.push({ d: app.today, v: price });
    }
    return pts;
  });
  const from = $derived.by(() => {
    const days = RANGES.find(r => r.id === range)!.days;
    if (!days) return 0;
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const i = all.findIndex(p => p.d >= since);
    return i < 0 ? all.length : i;
  });
  const shown = $derived(all.slice(from));
  $effect(() => { points = shown; });

  /** An exponential average over `n` closes, seeded with their plain average. Null until there are `n`. */
  function average(n: number): (number | null)[] {
    const out: (number | null)[] = new Array(all.length).fill(null);
    if (all.length < n) return out;
    let e = 0;
    for (let i = 0; i < n; i++) e += all[i].v;
    e /= n; out[n - 1] = e;
    const k = 2 / (n + 1);
    for (let i = n; i < all.length; i++) { e = all[i].v * k + e * (1 - k); out[i] = e; }
    return out;
  }
  const emas = $derived(ema ? EMAS.map(n => ({ n, v: average(n).slice(from) })).filter(e => e.v.some(x => x != null)) : []);

  const g = $derived.by(() => {
    if (shown.length < 2) return null;
    let lo = Infinity, hi = -Infinity;
    for (const p of shown) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
    for (const e of emas) for (const v of e.v) if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const sticks = drawCandles ? shown.map(p => bars!.get(p.d) ?? null) : null;
    if (sticks) for (const b of sticks) if (b) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; }
    // A level far off the chart would flatten the price line, so only nearby ones stretch the scale.
    const near = (v: number) => v > lo * 0.6 && v < hi * 1.4;
    for (const l of levels) if (near(l.value)) { if (l.value < lo) lo = l.value; if (l.value > hi) hi = l.value; }
    const span = hi - lo || 1;
    const x = (i: number) => PAD + i / (shown.length - 1) * (W - PAD * 2);
    const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
    const path = (vals: (number | null)[]) => { let d = '', pen = false; vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; }); return d; };
    const line = path(shown.map(p => p.v));
    // The same scale read backwards: the price at a height on the chart, for the crosshair.
    const inv = (yv: number) => lo + (1 - (yv - PAD) / (H - PAD * 2)) * span;
    const step = (W - PAD * 2) / (shown.length - 1);
    return { lo, hi, x, y, inv, path, line, sticks, body: Math.max(0.6, step * 0.66), scale: ticks(inv(H), inv(0)), dates: dateTicks(shown.map(p => p.d)), area: `${line}L${x(shown.length - 1).toFixed(1)} ${H}L${x(0).toFixed(1)} ${H}Z`, inside: (v: number) => v >= lo && v <= hi };
  });

  // A flag sits on the close of its day, at the price line. Labels are dropped where they would collide.
  const flags = $derived.by(() => {
    if (!g) return [];
    const out: { left: number; top: number; buy: boolean; text: string; tip: string; label: boolean }[] = [];
    for (const mk of [...marks].sort((a, b) => a.d < b.d ? -1 : 1)) {
      if (mk.d < shown[0].d) continue;
      let i = shown.length - 1;
      while (i > 0 && shown[i].d > mk.d) i--;
      const buy = mk.type === 'Buy';
      out.push({
        left: g.x(i) / W * 100, top: g.y(shown[i].v) / H * 100, buy,
        text: `${buy ? t('B') : t('S')} ${qty(mk.shares)} @ ${usd(mk.price)}`,
        tip: `${buy ? t('Bought') : t('Sold')} ${qty(mk.shares)} ${t('at')} ${usd(mk.price)}\n${date(mk.d)}`, label: true,
      });
    }
    // Newest first keeps the most recent labels; older neighbours within reach lose theirs.
    const kept: number[] = [];
    for (let i = out.length - 1; i >= 0; i--) {
      if (kept.some(x => Math.abs(x - out[i].left) < 15)) out[i].label = false; else kept.push(out[i].left);
    }
    return out;
  });
  const lines = $derived(g ? levels.filter(l => g.inside(l.value)).map(l => ({ ...l, y: g.y(l.value) })) : []);
  const off = $derived(g ? levels.filter(l => !g.inside(l.value)) : []);

  // The crosshair follows the pointer both ways: across, it snaps to a trading day; up and down,
  // it reads the price at that height, so a level can be measured without a line being there.
  let at = $state<number | null>(null);
  let py = $state<number | null>(null);
  function track(e: PointerEvent) {
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    at = Math.round(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * (shown.length - 1));
    py = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)) * H;
  }
  const leave = () => { at = null; py = null; };
  const read = $derived(g && at != null && shown[at] ? shown[at] : null);
  const change = $derived(shown.length > 1 ? (shown[shown.length - 1].v / shown[0].v - 1) * 100 : null);
</script>

<div class="head">
  <span class="small">
    {#if read}<span class="strong">{usd(read.v)}</span> <span class="muted">{date(read.d)}</span>
    {:else if change != null}<span class={change >= 0 ? 'gain' : 'loss'}>{(change > 0 ? '+' : '') + change.toFixed(1)}%</span> <span class="muted">{t('over this range')}</span>{/if}
  </span>
  <span class="spacer"></span>
  {#if canCandle}
    <div class="ranges" role="group" aria-label={t('Chart type')}>
      <button class:on={kind === 'line'} aria-pressed={kind === 'line'} onclick={() => kind = 'line'}>{t('Line')}</button>
      <button class:on={kind === 'candles'} aria-pressed={kind === 'candles'} onclick={() => kind = 'candles'}>{t('Candles')}</button>
    </div>
  {/if}
  <button class="pick" class:on={ema} aria-pressed={ema} onclick={() => ema = !ema}>{t('Averages')}</button>
  <div class="ranges" role="group" aria-label={t('Range')}>
    {#each RANGES as r (r.id)}
      <button class:on={range === r.id} aria-pressed={range === r.id} onclick={() => { range = r.id; at = null; }}>{r.id === 'All' ? t('All') : r.id}</button>
    {/each}
  </div>
</div>

{#if g}
  <div class="frame">
  <div class="plot">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="{sym} {t('Price')}"
      onpointermove={track} onpointerdown={track} onpointerleave={leave}>
      {#each g.scale as v (v)}<line x1="0" x2={W} y1={g.y(v)} y2={g.y(v)} class="grid" vector-effect="non-scaling-stroke" />{/each}
      {#each g.dates as d (d.i)}<line x1={g.x(d.i)} x2={g.x(d.i)} y1="0" y2={H} class="grid" vector-effect="non-scaling-stroke" />{/each}
      {#if !g.sticks}<path d={g.area} class="area" />{/if}
      {#each emas as e (e.n)}<path d={g.path(e.v)} class="ema e{e.n}" vector-effect="non-scaling-stroke" />{/each}
      {#each lines as l (l.label)}<line x1="0" x2={W} y1={l.y} y2={l.y} class="level {l.tone}" vector-effect="non-scaling-stroke" />{/each}
      {#if g.sticks}
        <!-- The close line stays, faint, so days with no candle (and today's live price) still connect. -->
        <path d={g.line} class="line faint" vector-effect="non-scaling-stroke" />
        {#each g.sticks as b, i (i)}
          {#if b}
            {@const up = b.c >= b.o}
            <line x1={g.x(i)} x2={g.x(i)} y1={g.y(b.h)} y2={g.y(b.l)} class="wick {up ? 'up' : 'down'}" vector-effect="non-scaling-stroke" />
            <rect x={g.x(i) - g.body / 2} width={g.body} y={g.y(Math.max(b.o, b.c))} height={Math.max(1, Math.abs(g.y(b.o) - g.y(b.c)))} class="candle {up ? 'up' : 'down'}" />
          {/if}
        {/each}
      {:else}
        <path d={g.line} class="line" vector-effect="non-scaling-stroke" />
      {/if}
      {#if read && at != null}<line x1={g.x(at)} x2={g.x(at)} y1="0" y2={H} class="cross" vector-effect="non-scaling-stroke" />{/if}
      {#if py != null}<line x1="0" x2={W} y1={py} y2={py} class="cross" vector-effect="non-scaling-stroke" />{/if}
    </svg>
    {#each lines as l (l.label)}
      <span class="tag {l.tone}" style:top="{l.y / H * 100}%">{l.label} {usd(l.value)}</span>
    {/each}
    {#each flags as f, i (i)}
      <span class="flag {f.buy ? 'buy' : 'sell'}" style:left="{f.left}%" style:top="{f.top}%" use:tip={f.tip}>
        {#if f.label}<span class="ftext" class:flip={f.left > 78}>{f.text}</span>{/if}
      </span>
    {/each}
  </div>
  <div class="yaxis" aria-hidden="true">
    {#each g.scale as v (v)}<span style:top="{g.y(v) / H * 100}%">{tickLabel(v, g.scale)}</span>{/each}
    {#if py != null}<span class="badge" style:top="{py / H * 100}%">{usd(g.inv(py))}</span>{/if}
  </div>
  <div class="xaxis" aria-hidden="true">
    {#each g.dates as d (d.i)}<span style:left="{g.x(d.i) / W * 100}%">{d.label}</span>{/each}
    {#if read && at != null}<span class="badge" style:left="{g.x(at) / W * 100}%">{date(read.d, true)}</span>{/if}
  </div>
  </div>
  <div class="axis small muted">
    <span class="keys">
      {t('Low')} {usd(g.lo)}, {t('high')} {usd(g.hi)}
      {#each emas as e (e.n)}<span class="key"><i class="e{e.n}"></i>{e.n}</span>{/each}
    </span>
  </div>
  {#if kind === 'candles' && canCandle && !drawCandles}
    <p class="small muted off">{candleError ? t('Candles need the Apps Script connection, and it did not answer. Showing the line instead.') : t('Loading candles')}</p>
  {/if}
  {#if off.length}<p class="small muted off">{t('Off this chart')}: {off.map(l => `${l.label} ${usd(l.value)}`).join(', ')}</p>{/if}
{:else}
  <p class="empty">{t('No price history for this symbol yet.')}</p>
{/if}

<style>
  .head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); min-height: 30px; margin-bottom: var(--sp-2); }
  .ranges { display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--wash); }
  .ranges button, .pick { padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 500; color: var(--ink-2); }
  .pick { background: var(--wash); }
  .ranges button:hover, .pick:hover { color: var(--ink); }
  .ranges button.on, .pick.on { background: var(--ink); color: var(--card); }
  /* The plot, a price scale down its right side and a date scale under it. */
  .frame { display: grid; grid-template-columns: minmax(0, 1fr) 58px; grid-template-rows: auto 22px; }
  .plot { position: relative; }
  .yaxis, .xaxis { position: relative; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .yaxis span { position: absolute; left: 8px; translate: 0 -50%; white-space: nowrap; }
  .xaxis span { position: absolute; top: 5px; translate: -50% 0; white-space: nowrap; }
  .yaxis .badge, .xaxis .badge { padding: 1px 6px; border-radius: 4px; background: var(--ink); color: var(--card); font-weight: 600; z-index: 1; }
  .yaxis .badge { left: 2px; }
  .xaxis .badge { top: 3px; }
  .grid { stroke: var(--line-soft); stroke-width: 1; }
  svg { display: block; width: 100%; height: clamp(220px, 32vh, 320px); touch-action: pan-y; cursor: crosshair; }
  .line { fill: none; stroke: var(--ink); stroke-width: 2; stroke-linejoin: round; }
  .line.faint { stroke: var(--muted); stroke-width: 1; opacity: 0.5; }
  .wick { stroke-width: 1; }
  .wick.up { stroke: var(--gain); } .wick.down { stroke: var(--loss); }
  .candle.up { fill: var(--gain); } .candle.down { fill: var(--loss); }
  .area { fill: color-mix(in oklab, var(--ink) 5%, transparent); }
  .cross { stroke: var(--muted); stroke-width: 1; }
  .ema { fill: none; stroke-width: 1.5; }
  .e50 { stroke: #5cc4b6; background: #5cc4b6; } .e100 { stroke: #3fa8b5; background: #3fa8b5; } .e200 { stroke: #2a6f8f; background: #2a6f8f; }
  .level { stroke-width: 1.5; stroke-dasharray: 5 4; }
  .level.avg { stroke: var(--accent); stroke-dasharray: none; }
  .level.new { stroke: var(--accent); stroke-width: 2; stroke-dasharray: 2 4; }
  .level.entry { stroke: var(--ink-2); }
  .level.stop { stroke: var(--loss); }
  .level.profit { stroke: var(--gain); }
  /* Labels ride on their line at the left, where the price line is oldest and least likely to be read. */
  .tag { position: absolute; left: 6px; translate: 0 -50%; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; background: var(--card); pointer-events: none; }
  .tag.avg, .tag.new { color: var(--accent-ink); } .tag.entry { color: var(--ink-2); } .tag.stop { color: var(--loss); } .tag.profit { color: var(--gain); }
  .flag { position: absolute; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; border-radius: 50%; border: 2px solid var(--card); }
  .flag.buy { background: var(--accent); } .flag.sell { background: var(--honey); }
  .ftext { position: absolute; left: 50%; bottom: 13px; translate: -50% 0; padding: 2px 7px; border-radius: 6px; font-size: 11px; font-weight: 600; white-space: nowrap; color: #fff; pointer-events: none; }
  .ftext.flip { left: auto; right: -4px; translate: 0 0; }
  .buy .ftext { background: var(--accent); } .sell .ftext { background: var(--honey); }
  .sell .ftext { bottom: auto; top: 13px; }
  .axis { display: flex; justify-content: center; gap: var(--sp-3); padding-top: 6px; }
  .keys { display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 2px 10px; }
  .key { display: inline-flex; align-items: center; gap: 4px; }
  .key i { width: 12px; height: 3px; border-radius: 2px; }
  .off { margin: 6px 0 0; }
</style>
