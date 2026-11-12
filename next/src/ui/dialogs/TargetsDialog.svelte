<script lang="ts">
  // The target editor for one portfolio: a row per stock with a slider and a box, tools that set
  // many rows at once, and four pies that redraw as the numbers move. Outer ring is the plan,
  // inner ring is what is held now.
  import { untrack } from 'svelte';
  import { allocChanges, allocEqual, allocFillRest, allocGroups, allocMatchCurrent, allocReset, allocRoom, allocScale, allocSet, allocTotal } from '../../core/alloc.ts';
  import type { AllocRow } from '../../core/alloc.ts';
  import { colorFor, pct } from '../../core/format.ts';
  import { app } from '../../state/app.svelte.ts';
  import { numText, parseNum } from '../num.ts';
  import Logo from '../parts/Logo.svelte';
  import Seg from '../parts/Seg.svelte';
  import TwoRing from '../parts/TwoRing.svelte';
  import type { RingSlice } from '../parts/TwoRing.svelte';

  let { portfolio }: { portfolio: string } = $props();

  const t = app.t;
  const money = $derived(app.money);
  const close = () => { app.dialog = null; };

  // Rows and their order are fixed when the editor opens, so nothing jumps while a slider is held.
  const m = untrack(() => app.portModel(portfolio));
  const initial: AllocRow[] = untrack(() => [
    ...m.positions.map(p => ({ symbol: p.symbol, name: p.name, now: p.investWeightPct, saved: (p.target || 0) * 100, target: (p.target || 0) * 100, locked: false, category: p.category, custom: p.custom, myGroup: p.myGroup })),
    ...m.watchlist.map(w => ({ symbol: w.symbol, name: w.name, now: 0, saved: (w.target || 0) * 100, target: (w.target || 0) * 100, locked: false, category: w.category, custom: w.custom, myGroup: w.myGroup })),
  ].sort((a, b) => b.target - a.target || b.now - a.now || a.symbol.localeCompare(b.symbol)));
  let rows = $state.raw(initial);
  const sliderMax = new Map(initial.map(r => [r.symbol, Math.min(100, Math.max(20, Math.ceil(Math.max(r.saved, r.now) * 2 / 5) * 5))]));

  type GroupBy = 'none' | 'category' | 'custom' | 'myGroup';
  let groupBy = $state<GroupBy>('none');
  let filter = $state<{ field: 'category' | 'custom' | 'myGroup'; key: string } | null>(null);
  let hover = $state<string | null>(null);
  let sort = $state<{ key: 'symbol' | 'now' | 'target' | 'drift'; dir: 1 | -1 } | null>(null);
  let order = $state.raw(initial.map(r => r.symbol));

  // ── Undo and redo: a step is recorded when a gesture first changes something, not when it starts ──
  let past = $state.raw<AllocRow[][]>([]);
  let future = $state.raw<AllocRow[][]>([]);
  let pending: AllocRow[] | null = null;
  const begin = () => { pending = rows; };
  function apply(next: AllocRow[], gesture = false) {
    if (next === rows) return;
    const before = gesture ? pending : rows;
    if (before) { past = [...past, before]; future = []; pending = null; }
    rows = next;
  }
  function undo() { const p = past[past.length - 1]; if (!p) return; future = [rows, ...future]; past = past.slice(0, -1); rows = p; }
  function redo() { const f = future[0]; if (!f) return; past = [...past, rows]; future = future.slice(1); rows = f; }
  // A slider cannot be dragged past the room left: the thumb is put back where the total reaches 100,
  // so it stops there under the pointer instead of running on while the number stays put.
  const lock = (sym: string) => { rows = rows.map(r => r.symbol === sym ? { ...r, locked: !r.locked } : r); };

  const total = $derived(allocTotal(rows));
  const over = $derived(total > 100.005);
  const changes = $derived(allocChanges(rows));
  const count = $derived(Object.keys(changes).length);
  const bySym = $derived(new Map(rows.map(r => [r.symbol, r])));

  function sortBy(key: NonNullable<typeof sort>['key']) {
    sort = { key, dir: sort?.key === key ? (sort.dir === 1 ? -1 : 1) : key === 'symbol' ? 1 : -1 };
    const v = (r: AllocRow) => key === 'symbol' ? r.symbol : key === 'now' ? r.now : key === 'target' ? r.target : r.target - r.now;
    order = [...rows].sort((a, b) => { const x = v(a), y = v(b); return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * sort!.dir; }).map(r => r.symbol);
  }
  const visible = $derived(order.map(s => bySym.get(s)!).filter(r => !filter || (r[filter.field] || 'Other') === filter.key));
  const groups = $derived(groupBy === 'none' ? null : allocGroups(visible, groupBy));

  // ── Pies: largest plan first, the unallocated remainder always last ──
  const rest = $derived<RingSlice>({ key: '\u0000rest', label: t('Unallocated, cash'), color: 'var(--line)', outer: Math.max(0, 100 - total), inner: Math.max(0, 100 - rows.reduce((s, r) => s + r.now, 0)) });
  const symSlices = $derived([...rows].filter(r => r.target > 0 || r.now > 0).sort((a, b) => b.target - a.target || a.symbol.localeCompare(b.symbol))
    .map((r): RingSlice => ({ key: r.symbol, label: r.symbol, color: colorFor(r.symbol), outer: r.target, inner: r.now })).concat(rest));
  const groupSlices = (field: 'category' | 'custom' | 'myGroup') =>
    allocGroups(rows, field).filter(g => g.target > 0 || g.now > 0).map((g): RingSlice => ({ key: g.key, label: g.key, color: colorFor(g.key), outer: g.target, inner: g.now })).concat(rest);
  const pick = (field: 'category' | 'custom' | 'myGroup') => (key: string) => {
    if (key === rest.key) return;
    filter = filter?.field === field && filter.key === key ? null : { field, key };
  };
  function focusRow(sym: string) { if (sym !== rest.key) document.getElementById('alloc-' + sym)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }

  function save() {
    if (over || !count) return;
    app.saveTargets(portfolio, changes);
    close();
  }
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  };
</script>

<svelte:window onkeydown={onKey} />

{#snippet line(r: AllocRow)}
  {@const drift = r.target - r.now}
  <li id="alloc-{r.symbol}" class:locked={r.locked} class:hot={hover === r.symbol} onpointerenter={() => hover = r.symbol} onpointerleave={() => hover = null}>
    <button class="icon-btn lock" class:on={r.locked} aria-pressed={r.locked} aria-label="{r.locked ? t('Unlock') : t('Lock')} {r.symbol}" title={r.locked ? t('Locked: nothing moves this row') : t('Lock this row')} onclick={() => lock(r.symbol)}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d={r.locked ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 7.5-2'} /></svg>
    </button>
    <span class="who"><Logo sym={r.symbol} size={24} /><span class="strong">{r.symbol}</span></span>
    <span class="n ink2">{r.now ? pct(r.now, 1) : '—'}</span>
    <input type="range" min="0" max={sliderMax.get(r.symbol)} step="0.5" value={r.target} disabled={r.locked} aria-label="{t('Target')} {r.symbol}"
      onpointerdown={begin} onkeydown={begin} oninput={e => { apply(allocSet(rows, r.symbol, +e.currentTarget.value), true); e.currentTarget.value = String(bySym.get(r.symbol)!.target); }} />
    <input class="input box" inputmode="decimal" value={numText(r.target, 2)} disabled={r.locked} aria-label="{t('Target')} {r.symbol}, %"
      onfocus={begin} onchange={e => { const v = parseNum(e.currentTarget.value || '0'); apply(allocSet(rows, r.symbol, v), true); e.currentTarget.value = numText(bySym.get(r.symbol)!.target, 2); }} />
    <span class="n small {Math.abs(drift) < 0.05 ? 'muted' : ''}" title={t('Target less current weight')}>{r.target || r.now ? (drift > 0 ? '+' : '') + drift.toFixed(1) : ''}</span>
    <span class="n small ink2 dollars">{r.target ? money.compact(r.target / 100 * m.investable) : ''}</span>
    <button class="icon-btn undo1" disabled={r.locked || Math.abs(r.target - r.saved) < 1e-9} aria-label="{t('Back to saved')} {r.symbol}" title="{t('Back to saved')}: {pct(r.saved, 2)}" onclick={() => apply(allocSet(rows, r.symbol, Math.min(r.saved, allocRoom(rows, r.symbol))))}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h10a5 5 0 0 1 0 10H9M4 9l4-4M4 9l4 4" /></svg>
    </button>
  </li>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={close}></div>
<div class="editor" role="dialog" aria-modal="true" aria-label={t('Targets')}>
  <header>
    <h2>{t('Targets')}</h2>
    {#if app.ports.length > 1}
      <Seg small value={portfolio} options={app.ports.map(p => ({ value: p, label: p }))} onchange={p => app.dialog = { kind: 'targets', portfolio: p }} />
    {/if}
    <span class="spacer"></span>
    <button class="icon-btn" onclick={close} aria-label={t('Close')}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </header>

  <div class="budget" class:over>
    <span class="track"><span style:width="{Math.min(100, total)}%"></span></span>
    <span class="small">{#if over}<strong class="loss">{t('Over by')} {pct(total - 100, 2)}.</strong> {t('Lower something to save.')}{:else}<strong>{pct(total, 1)}</strong> {t('planned')}, <strong>{pct(100 - total, 1)}</strong> {t('unallocated')}{/if}</span>
  </div>

  <div class="body">
    <div class="list">
      <div class="tools">
        <button class="btn" onclick={() => apply(allocMatchCurrent(rows))}>{t('Match current')}</button>
        <button class="btn" onclick={() => apply(allocEqual(rows))}>{t('Equal weight')}</button>
        <button class="btn" onclick={() => apply(allocFillRest(rows))}>{t('Fill the rest')}</button>
        <button class="btn" onclick={() => apply(allocReset(rows))}>{t('Reset')}</button>
        <span class="spacer"></span>
        <button class="btn" onclick={undo} disabled={!past.length}>{t('Undo')}</button>
        <button class="btn" onclick={redo} disabled={!future.length}>{t('Redo')}</button>
      </div>
      <div class="tools">
        <span class="small muted">{t('Group by')}</span>
        <Seg small bind:value={groupBy} options={[{ value: 'none', label: t('None') }, { value: 'category', label: t('Category') }, { value: 'custom', label: t('Custom') }, { value: 'myGroup', label: t('My group') }]} />
        {#if filter}<button class="btn on" onclick={() => filter = null}>{filter.key}, {t('show all')}</button>{/if}
      </div>
      <div class="heads small muted">
        <span></span>
        <button onclick={() => sortBy('symbol')}>{t('Symbol')}</button>
        <button class="n" onclick={() => sortBy('now')}>{t('Now')}</button>
        <button onclick={() => sortBy('target')}>{t('Target')}</button>
        <span class="n">%</span>
        <button class="n" onclick={() => sortBy('drift')}>{t('Gap')}</button>
        <span class="n dollars">$</span><span></span>
      </div>
      {#if groups}
        {#each groups as g (g.key)}
          <div class="group" class:locked={g.locked}>
            <span class="strong">{g.key}</span>
            <span class="n ink2 small">{pct(g.now, 1)}</span>
            <input type="range" min="0" max="100" step="0.5" value={g.target} disabled={g.locked} aria-label="{t('Target')} {g.key}"
              onpointerdown={begin} onkeydown={begin} oninput={e => { apply(allocScale(rows, g.members, +e.currentTarget.value), true); e.currentTarget.value = String(g.members.reduce((sum, m) => sum + bySym.get(m)!.target, 0)); }} />
            <strong class="n">{pct(g.target, 1)}</strong>
          </div>
          <ul>{#each visible.filter(r => g.members.includes(r.symbol)) as r (r.symbol)}{@render line(r)}{/each}</ul>
        {/each}
      {:else}
        <ul>{#each visible as r (r.symbol)}{@render line(r)}{/each}</ul>
      {/if}
      {#if !visible.length}<p class="empty">{t('No holdings in this portfolio yet.')}</p>{/if}
    </div>

    <div class="pies">
      <TwoRing title={t('By stock')} outerLabel={t('Outer ring: target')} innerLabel={t('now')} slices={symSlices} bind:hover onpick={focusRow} />
      <TwoRing title={t('Category')} outerLabel={t('Outer ring: target')} innerLabel={t('now')} slices={groupSlices('category')} onpick={pick('category')} />
      <TwoRing title={t('Custom tag')} outerLabel={t('Outer ring: target')} innerLabel={t('now')} slices={groupSlices('custom')} onpick={pick('custom')} />
      <TwoRing title={t('My group')} outerLabel={t('Outer ring: target')} innerLabel={t('now')} slices={groupSlices('myGroup')} onpick={pick('myGroup')} />
    </div>
  </div>

  <footer>
    <span class="small muted">{count ? `${count} ${t('changed')}` : t('Nothing changed yet')}</span>
    <span class="spacer"></span>
    <button class="btn" onclick={close}>{t('Cancel')}</button>
    <button class="btn primary" disabled={over || !count} onclick={save}>{count > 1 ? `${t('Save')} ${count} ${t('targets')}` : t('Save')}</button>
  </footer>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: var(--z-dialog); background: color-mix(in oklab, #060912 62%, transparent); backdrop-filter: blur(3px); }
  .editor { position: fixed; z-index: var(--z-dialog); left: 50%; top: 50%; translate: -50% -50%; width: min(1240px, calc(100vw - 32px)); height: min(92dvh, 920px); display: flex; flex-direction: column; overflow: hidden; background: var(--card); border-radius: 28px; box-shadow: var(--shadow); }
  header, footer { display: flex; align-items: center; gap: var(--sp-4); padding: var(--sp-4) var(--sp-5) var(--sp-4) var(--sp-6); }
  h2 { font: 700 24px/1.1 var(--font-display); letter-spacing: -0.03em; }
  header .icon-btn { background: var(--wash); }
  footer { border-top: 1px solid var(--line-soft); }
  footer .btn { padding: 10px 20px; font-size: 14px; }
  .budget { display: grid; gap: 6px; padding: 0 var(--sp-6) var(--sp-4); }
  .track { display: block; height: 8px; border-radius: 4px; background: var(--wash); overflow: hidden; }
  .track span { display: block; height: 100%; background: var(--accent); border-radius: 4px; }
  .over .track span { background: var(--loss); }

  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); border-top: 1px solid var(--line-soft); }
  .list { overflow-y: auto; padding: var(--sp-4) var(--sp-5) var(--sp-5) var(--sp-6); display: grid; gap: var(--sp-3); align-content: start; border-right: 1px solid var(--line-soft); }
  .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .tools .btn { font-size: 12px; padding: 6px 12px; }
  .tools .btn.on { background: var(--ink); color: var(--bg); }
  ul { list-style: none; margin: 0; padding: 0; }
  li, .heads, .group { display: grid; grid-template-columns: 34px minmax(84px, 1.1fr) 52px minmax(80px, 2fr) 66px 46px 62px 34px; align-items: center; gap: 8px; }
  li { padding: 3px 4px; margin: 0 -4px; border-radius: var(--radius-sm); }
  li.hot { background: var(--sunk); }
  .heads button { font: inherit; color: inherit; text-align: left; }
  .heads button:hover { color: var(--ink); }
  .heads .n, .n { text-align: right; }
  .group { grid-template-columns: minmax(118px, 1.1fr) 52px minmax(80px, 2fr) 66px 150px; padding: var(--sp-3) 0 2px; border-top: 1px solid var(--line-soft); }
  .who { display: flex; align-items: center; gap: 8px; min-width: 0; }
  input[type='range'] { width: 100%; accent-color: var(--accent); }
  .box { padding: 6px 8px; text-align: right; }
  .icon-btn { width: 30px; height: 30px; }
  .lock.on { color: var(--accent-ink); background: var(--accent-soft); }
  /* A locked row dims only what can no longer be moved: it is a choice, not an error. */
  .locked input { opacity: 0.5; }
  .undo1:disabled { visibility: hidden; }

  .pies { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); gap: var(--sp-4); padding: var(--sp-4) var(--sp-5); min-height: 0; overflow: hidden; }

  @media (max-width: 900px) {
    .editor { left: 0; right: 0; top: auto; bottom: 0; translate: none; width: 100%; height: 94dvh; border-radius: 24px 24px 0 0; }
    .body { display: block; overflow-y: auto; }
    .list { overflow: visible; border-right: 0; padding-inline: var(--sp-4); }
    .pies { display: flex; overflow-x: auto; grid-template-rows: none; padding-inline: var(--sp-4); }
    .pies > :global(figure) { flex: 0 0 240px; height: 280px; }
    li, .heads { grid-template-columns: 30px minmax(70px, 1fr) minmax(70px, 1.6fr) 62px 30px; }
    li > :nth-child(3), li > :nth-child(6), li > :nth-child(7), .heads > :nth-child(3), .heads > :nth-child(6), .heads > :nth-child(7) { display: none; }
    .group { grid-template-columns: minmax(90px, 1fr) minmax(70px, 1.6fr) 62px; }
    .group > :nth-child(2) { display: none; }
    header, footer, .budget { padding-inline: var(--sp-4); }
  }
</style>
