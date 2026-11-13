<script lang="ts">
  // Today Plan: a board of zones the user names and colours, with a card per stock that is dragged
  // from zone to zone as the day's plan changes. The board is a personal working surface, so it is
  // kept in this browser, per account; nothing here writes to the sheet.
  import { addZone, moveCard, newBoard, onBoard, readBoard, removeCard, removeZone, shiftZone, updateZone, ZONE_COLORS } from '../../core/board.ts';
  import type { Board, Zone } from '../../core/board.ts';
  import { pct, sign, signedPct, usd } from '../../core/format.ts';
  import { ALL } from '../../core/model.ts';
  import { planKey, trancheDollars } from '../../core/plan.ts';
  import { app } from '../../state/app.svelte.ts';
  import DeleteButton from '../parts/DeleteButton.svelte';
  import Logo from '../parts/Logo.svelte';
  import PlanWatch from '../parts/PlanWatch.svelte';

  const t = app.t;
  const money = $derived(app.money);

  // ── The board, loaded for the account in use and saved on every change ──
  const KEY = 'portapp.next.board.v1.';
  let board = $state.raw<Board>(newBoard());
  let loadedFor: string | null = null;
  $effect(() => {
    const id = app.profile?.id ?? '';
    if (id === loadedFor) return;
    loadedFor = id;
    try { board = readBoard(JSON.parse(localStorage.getItem(KEY + id) || 'null')); } catch { board = newBoard(); }
  });
  function save(next: Board) {
    board = next;
    try { localStorage.setItem(KEY + (app.profile?.id ?? ''), JSON.stringify(next)); } catch { /* storage full or blocked: the board still works until the page closes */ }
  }
  const placed = $derived(onBoard(board));
  // The four starting zones are named in the app's language until one is renamed.
  const STARTERS = new Set(['Waiting to buy', 'Bought', 'Watching', 'Waiting to sell']);
  // 'Bought' is also the verb in a chart tooltip, where Thai wants a different word, so the zone has its own entry.
  const zoneName = (z: Zone) => !STARTERS.has(z.name) ? z.name : z.name === 'Bought' ? (app.prefs.lang === 'th' ? t('Bought, as a zone') : z.name) : t(z.name);

  // ── What a card shows, looked up once per render ──
  const pos = $derived(new Map(app.model.positions.map(p => [p.symbol, p])));
  const watch = $derived(new Map(app.model.watchlist.map(w => [w.symbol, w])));
  const perf = $derived(new Map(app.perf.map(h => [h.symbol, h])));
  const planned = $derived(new Set(Object.keys(app.plans).map(k => k.slice(k.indexOf('\u0000') + 1))));
  /** The most pressing plan level for each symbol; the alert list is already sorted by urgency. */
  const alert = $derived.by(() => {
    const by = new Map<string, (typeof app.alerts)[number]>();
    for (const a of app.alerts) if (a.kind !== 'drift' && !by.has(a.symbol)) by.set(a.symbol, a);
    return by;
  });
  function facts(sym: string) {
    const p = pos.get(sym), q = app.quotes[sym], h = perf.get(sym);
    return {
      name: p?.name ?? watch.get(sym)?.name ?? '',
      price: p?.price ?? q?.price ?? watch.get(sym)?.price ?? null,
      dayPct: p?.dayChangePct ?? q?.changePct ?? null,
      dayMoney: p && p.dayChange != null ? p.dayChange * p.qty : null,
      unrealized: p ? p.pnl : null, unrealizedPct: p ? p.pnlPct : null,
      realized: h && h.realized ? h.realized : null,
      weight: p ? p.weightPct : null,
    };
  }
  /**
   * The plan's levels for a card, nearest first on each side of the price: every buy not yet reached
   * with what it spends, every take-profit, and the stop. A level the price has already passed is
   * marked, so the card says what is waiting and what is due.
   */
  function levels(sym: string) {
    const port = app.view === ALL ? app.homePort(sym) : app.view;
    const plan = app.plans[planKey(port, sym)];
    if (!plan) return [];
    const m = app.portModel(port), p = m.positions.find(x => x.symbol === sym);
    const price = p?.price ?? app.quotes[sym]?.price ?? null;
    const target = p?.target ?? m.watchlist.find(w => w.symbol === sym)?.target ?? 0, td = target * m.investable;
    const dollars = trancheDollars(plan.tranches, td > 0 ? (p?.currentValue ?? 0) / td * 100 : 0, td);
    const gap = (level: number) => price ? (level / price - 1) * 100 : null;
    const out: { kind: 'profit' | 'entry' | 'stop'; label: string; price: number; size: string; gap: number | null; due: boolean }[] = [];
    plan.trims.forEach((x, i) => { if (x.price) out.push({ kind: 'profit', label: `${t('Sell')} ${i + 1}`, price: x.price, size: x.pct ? `${+x.pct.toFixed(1)}% ${t('of target')}` : '', gap: gap(x.price), due: !!price && !!p && price >= x.price }); });
    plan.tranches.forEach((x, i) => { if (x.price) out.push({ kind: 'entry', label: `${t('Buy')} ${i + 1}`, price: x.price, size: dollars[i] > 0 ? usd(dollars[i]) : x.cumPct > 0 ? `${t('to')} ${+x.cumPct.toFixed(0)}%` : '', gap: gap(x.price), due: !!price && price <= x.price }); });
    if (plan.sl) out.push({ kind: 'stop', label: t('Stop loss'), price: plan.sl, size: '', gap: gap(plan.sl), due: !!price && !!p && price <= plan.sl });
    return out.sort((a, b) => b.price - a.price);
  }

  /** Where the price stands against the stock's plan. */
  function status(sym: string): { label: string; tone: string; solid: boolean } {
    const a = alert.get(sym);
    if (a) {
      const what = a.kind === 'stop' ? t('Stop loss') : a.kind === 'profit' ? `${t('Sell')} ${a.step}` : `${t('Buy')} ${a.step}`;
      return { label: `${what} ${a.hit ? t('reached') : t('close')}`, tone: a.kind === 'stop' ? 'loss' : a.kind === 'profit' ? 'gain' : 'accent', solid: a.hit };
    }
    return planned.has(sym) ? { label: t('Plan not reached'), tone: 'quiet', solid: false } : { label: t('No plan'), tone: 'none', solid: false };
  }

  // ── Adding a stock: everything held or watched that is not on the board yet, laid out as a tray
  // of chips above it. A chip is dragged straight onto a zone; a click drops it into the zone whose
  // "+" opened the tray (the first zone otherwise), which is also how a keyboard adds one. ──
  let adding = $state(false);
  let addTo = $state('');
  let query = $state('');
  const choices = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const all = [
      ...app.model.positions.map(p => ({ symbol: p.symbol, name: p.name, day: p.dayChangePct, unrealized: p.pnlPct as number | null })),
      ...app.model.watchlist.map(w => ({ symbol: w.symbol, name: w.name, day: w.dayChangePct ?? app.quotes[w.symbol]?.changePct ?? null, unrealized: null })),
    ];
    // The name is not shown, but typing it still finds the stock.
    return all.filter(c => !placed.has(c.symbol)&& (!q || c.symbol.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q)));
  });
  function openAdd(zoneId?: string) {
    if (!board.zones.length) save(addZone(board, t('Watching')));
    addTo = zoneId ?? (board.zones.some(z => z.id === addTo) ? addTo : board.zones[0].id);
    query = ''; adding = true;
  }
  const add = (sym: string) => save(moveCard(board, sym, addTo, Infinity));
  const focus = (el: HTMLInputElement) => { el.focus(); el.select(); };

  // ── Zones: rename, recolour, reorder, delete ──
  let tools = $state<string | null>(null);
  let renaming = $state<string | null>(null);
  function rename(id: string, name: string) { const n = name.trim().slice(0, 40); if (n) save(updateZone(board, id, { name: n })); renaming = null; }
  function newZone() { const b = addZone(board, t('New zone')); save(b); renaming = b.zones[b.zones.length - 1].id; }

  // ── Dragging a card. It lifts after a few pixels of movement, so a plain click still opens the
  // stock. With a mouse the whole card is the handle; on a touch screen only the grip is, so a
  // finger on the rest of the card scrolls the board as usual. ──
  let drag = $state<{ sym: string; x0: number; y0: number; x: number; y: number; ox: number; oy: number; w: number; on: boolean; zone: string | null; index: number } | null>(null);
  let dragged = false;
  function grab(e: PointerEvent, sym: string, whole = false) {
    if (e.button !== 0) return;
    // A tray chip is small and has no grip, so all of it is the handle, finger included.
    if (!whole && e.pointerType === 'touch' && !(e.target as HTMLElement).closest('.grip')) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    drag = { sym, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, on: false, zone: null, index: 0 };
  }
  function slide(e: PointerEvent) {
    if (!drag) return;
    if (!drag.on && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    drag.on = true; drag.x = e.clientX; drag.y = e.clientY;
    const zone = (document.elementsFromPoint(e.clientX, e.clientY).find(el => el instanceof HTMLElement && el.closest('[data-zone]')) as HTMLElement | undefined)?.closest<HTMLElement>('[data-zone]');
    if (!zone) { drag.zone = null; return; }
    drag.zone = zone.dataset.zone!;
    // The slot is before the first card whose middle is below the pointer.
    const cards = [...zone.querySelectorAll<HTMLElement>('[data-card]')];
    const at = cards.findIndex(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    drag.index = at < 0 ? cards.length : at;
  }
  function drop() {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.on) return;
    dragged = true; setTimeout(() => { dragged = false; }, 0);
    if (d.zone) save(moveCard(board, d.sym, d.zone, d.index));
  }
  const open = (sym: string) => { if (!dragged) app.symbol = sym; };
  const pick = (sym: string) => { if (!dragged) add(sym); };
</script>

<svelte:window onpointermove={slide} onpointerup={drop} onpointercancel={drop} />

{#snippet card(sym: string, ghost: boolean)}
  {@const f = facts(sym)}
  {@const s = status(sym)}
  {@const lv = levels(sym)}
  <div class="top">
    <span class="grip" aria-hidden="true"><i></i><i></i><i></i></span>
    <Logo {sym} size={22} />
    <strong class="sym">{sym}</strong>
    <span class="price">{f.price == null ? '—' : usd(f.price)}</span>
  </div>
  <div class="mid">
    <span class="status {s.tone}" class:solid={s.solid}>{s.label}</span>
    <span class="day {sign(f.dayPct)}">{signedPct(f.dayPct)}{#if f.dayMoney != null}<span class="small">{' '}{money.signed(f.dayMoney)}</span>{/if}</span>
  </div>
  <dl>
    <div><dt>{t('Unrealized')}</dt><dd class={sign(f.unrealized)}>{f.unrealizedPct == null ? '—' : signedPct(f.unrealizedPct, 1)}{#if f.unrealized != null}<span class="small">{' '}{money.signed(f.unrealized)}</span>{/if}</dd></div>
    <div><dt>{t('Realized')}</dt><dd class={sign(f.realized)}>{f.realized == null ? '—' : money.signed(f.realized)}</dd></div>
    <div><dt>{t('Weight')}</dt><dd>{f.weight == null ? '—' : pct(f.weight, 1)}</dd></div>
  </dl>
  {#if lv.length}
    <ul class="plan">
      {#each lv as l (l.label)}
        <li class="{l.kind}" class:due={l.due}>
          <span class="what">{l.label}</span>
          <span class="at">{usd(l.price)}</span>
          <span class="size">{l.size}</span>
          <span class="gap">{l.due ? t('reached') : l.gap == null ? '' : signedPct(l.gap, 1)}</span>
        </li>
      {/each}
    </ul>
  {/if}
  {#if !ghost}
    <button class="off" onclick={e => { e.stopPropagation(); save(removeCard(board, sym)); }} onpointerdown={e => e.stopPropagation()} aria-label="{t('Take off the board')}: {sym}" title={t('Take off the board')}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  {/if}
{/snippet}

<div class="page">
  <header class="page-head">
    <h1 class="page-title">{t('Today Plan')}</h1>
    <span class="page-count">{placed.size} {t('on the board')}</span>
    <span class="spacer"></span>
    <button class="btn" onclick={newZone}>{t('Add a zone')}</button>
    <button class="btn primary" aria-expanded={adding} onclick={() => adding ? adding = false : openAdd()}>{adding ? t('Hide the list') : t('Add a stock')}</button>
  </header>

  <!-- The same list as on the Overview: what has reached its level, and what is close. -->
  <PlanWatch />

  {#if adding}
    <section class="card picker">
      <div class="prow">
        <input class="input" type="search" bind:value={query} placeholder={t('Search symbol or name')} aria-label={t('Search symbol or name')} use:focus
          onkeydown={e => { if (e.key === 'Enter' && choices.length) { add(choices[0].symbol); query = ''; } else if (e.key === 'Escape') { e.stopPropagation(); adding = false; } }} />
        <span class="small muted">{t('Drag a stock onto a zone. A click puts it in')} <strong>{zoneName(board.zones.find(z => z.id === addTo) ?? board.zones[0])}</strong>.</span>
      </div>
      {#if choices.length}
        <ul class="choices">
          {#each choices as c (c.symbol)}
            <li>
              <button class="chip" class:lifting={drag?.on && drag.sym === c.symbol} onpointerdown={e => grab(e, c.symbol, true)} onclick={() => pick(c.symbol)}>
                <Logo sym={c.symbol} size={22} />
                <strong>{c.symbol}</strong>
                <span class="spacer"></span>
                <span class="fig"><span class="k">{t('Today')}</span> <span class={sign(c.day)}>{signedPct(c.day, 1)}</span></span>
                <span class="fig"><span class="k">{t('Unrealized')}</span> <span class={sign(c.unrealized)}>{c.unrealized == null ? '—' : signedPct(c.unrealized, 1)}</span></span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="small muted none">{query ? t('No stock matches that search.') : t('Everything you hold or watch is already on the board.')}</p>
      {/if}
    </section>
  {/if}

  {#if board.zones.length}
    <div class="board" class:dragging={drag?.on}>
      {#each board.zones as z, zi (z.id)}
        {@const cards = drag?.on ? z.cards.filter(s => s !== drag!.sym) : z.cards}
        <section class="zone c{z.color}" class:target={drag?.on && drag.zone === z.id} data-zone={z.id}>
          <header>
            {#if renaming === z.id}
              <input class="zname" value={zoneName(z)} maxlength="40" aria-label={t('Zone name')} use:focus
                onkeydown={e => { if (e.key === 'Enter') rename(z.id, e.currentTarget.value); else if (e.key === 'Escape') { e.stopPropagation(); renaming = null; } }}
                onblur={e => { if (renaming === z.id) rename(z.id, e.currentTarget.value); }} />
            {:else}
              <button class="ztitle" title={t('Click to rename')} onclick={() => renaming = z.id}>{zoneName(z)}</button>
            {/if}
            <span class="count">{z.cards.length}</span>
            <span class="spacer"></span>
            <button class="icon-btn" onclick={() => openAdd(z.id)} aria-label="{t('Add a stock')}: {zoneName(z)}" title={t('Add a stock')}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button class="icon-btn" aria-expanded={tools === z.id} onclick={() => tools = tools === z.id ? null : z.id} aria-label="{t('Zone settings')}: {zoneName(z)}" title={t('Zone settings')}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            </button>
          </header>

          {#if tools === z.id}
            <div class="ztools">
              <div class="swatches" role="group" aria-label={t('Colour')}>
                {#each Array(ZONE_COLORS) as _, c (c)}
                  <button class="sw c{c}" class:on={z.color === c} aria-pressed={z.color === c} aria-label="{t('Colour')} {c + 1}" onclick={() => save(updateZone(board, z.id, { color: c }))}></button>
                {/each}
              </div>
              <div class="zrow">
                <button class="btn" disabled={zi === 0} onclick={() => save(shiftZone(board, z.id, -1))}>{t('Move left')}</button>
                <button class="btn" disabled={zi === board.zones.length - 1} onclick={() => save(shiftZone(board, z.id, 1))}>{t('Move right')}</button>
                <DeleteButton label={t('Delete zone')} confirm={t('Press again to delete')} onconfirm={() => { tools = null; save(removeZone(board, z.id)); }} />
              </div>
            </div>
          {/if}

          <ul>
            {#each cards as sym, i (sym)}
              {#if drag?.on && drag.zone === z.id && drag.index === i}<li class="slot" aria-hidden="true"></li>{/if}
              <li>
                <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
                <div class="tile" data-card={sym} onpointerdown={e => grab(e, sym)} onclick={() => open(sym)}>
                  {@render card(sym, false)}
                </div>
              </li>
            {/each}
            {#if drag?.on && drag.zone === z.id && drag.index >= cards.length}<li class="slot" aria-hidden="true"></li>{/if}
          </ul>
          {#if !z.cards.length && !(drag?.on && drag.zone === z.id)}<p class="small hint">{t('Drag a card here, or press + to add one.')}</p>{/if}
        </section>
      {/each}
    </div>
  {:else}
    <section class="card blank">
      <p>{t('The board is empty. Add a zone to start laying out the day.')}</p>
      <button class="btn primary" onclick={newZone}>{t('Add a zone')}</button>
    </section>
  {/if}
</div>

{#if drag?.on}
  <div class="tile ghost" style:left="{drag.x - drag.ox}px" style:top="{drag.y - drag.oy}px" style:width="{drag.w}px" aria-hidden="true">
    {@render card(drag.sym, true)}
  </div>
{/if}

<style>
  .picker { padding: var(--sp-4); display: grid; gap: var(--sp-3); }
  .prow { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); }
  .prow > .input { flex: 1 1 220px; }
  .choices { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 6px; max-height: 280px; overflow-y: auto; }
  /* A chip is picked up whole, so it must not start a scroll or a text selection under the finger. */
  .chip { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; border-radius: var(--radius-sm); background: var(--sunk); text-align: left; font-size: 14px; cursor: grab; touch-action: none; user-select: none; font-variant-numeric: tabular-nums; }
  .chip:hover { background: var(--wash); }
  /* The chip stays in place, dimmed, while its card is in the air: taking it out mid-drag would end a finger's drag. */
  .chip.lifting { opacity: 0.35; }
  .chip .fig { font-size: 12px; font-weight: 650; white-space: nowrap; }
  .chip .k { font-size: 10px; font-weight: 500; color: var(--muted); }
  .none { margin: 0; }

  /* ── The board: zones side by side, wrapping onto further rows when they do not fit across ── */
  /* A grid, not a wrapping row: every zone is one column wide whichever row it lands on, so a zone
     alone on the last row stays the size of the others instead of stretching across. */
  .board { display: grid; grid-template-columns: repeat(auto-fill, minmax(264px, 1fr)); align-items: start; gap: var(--sp-3); }
  .board.dragging { user-select: none; cursor: grabbing; }
  /* Six colours a zone can take. Each is a wash of one token over the card surface, so it works in both themes. */
  .c0 { --zc: var(--accent); } .c1 { --zc: var(--gain); } .c2 { --zc: var(--gold); }
  .c3 { --zc: var(--loss); } .c4 { --zc: var(--honey); } .c5 { --zc: var(--muted); }
  .zone { min-width: 0; min-height: 220px; padding: var(--sp-3); border-radius: var(--radius); background: color-mix(in oklab, var(--zc) 10%, var(--card)); border: 2px solid transparent; transition: border-color 0.12s var(--ease), background 0.12s var(--ease); }
  .zone.target { border-color: var(--zc); background: color-mix(in oklab, var(--zc) 17%, var(--card)); }
  .zone > header { display: flex; align-items: center; gap: 6px; min-height: 34px; margin-bottom: var(--sp-2); }
  .ztitle { font: 700 16px/1.2 var(--font-display); letter-spacing: -0.02em; text-align: left; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: color-mix(in oklab, var(--zc) 55%, var(--ink)); }
  .zname { flex: 1; min-width: 0; padding: 4px 8px; border-radius: var(--radius-xs); border: 1px solid var(--zc); background: var(--card); font: 700 16px/1.2 var(--font-display); }
  .count { padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 650; background: color-mix(in oklab, var(--zc) 18%, transparent); color: color-mix(in oklab, var(--zc) 60%, var(--ink)); }
  .zone .icon-btn { width: 28px; height: 28px; color: var(--ink-2); }
  .ztools { display: grid; gap: var(--sp-2); padding: var(--sp-2); margin-bottom: var(--sp-2); border-radius: var(--radius-sm); background: var(--card); }
  .swatches { display: flex; gap: 6px; }
  .sw { width: 24px; height: 24px; border-radius: 50%; background: var(--zc); border: 2px solid var(--card); box-shadow: 0 0 0 1px var(--line); }
  .sw.on { box-shadow: 0 0 0 2px var(--ink); }
  .zrow { display: flex; flex-wrap: wrap; gap: 6px; }
  .zrow .btn, .zrow :global(.btn) { font-size: 12px; padding: 5px 10px; }
  .zone ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .slot { height: 44px; border-radius: var(--radius-sm); border: 2px dashed var(--zc); background: color-mix(in oklab, var(--zc) 10%, transparent); }
  .hint { margin: var(--sp-4) 0; text-align: center; color: color-mix(in oklab, var(--zc) 45%, var(--muted)); }
  .blank { padding: var(--sp-7); display: grid; gap: var(--sp-4); justify-items: center; text-align: center; color: var(--ink-2); }
  .blank p { margin: 0; }

  /* ── A card ── */
  .tile { position: relative; display: grid; gap: 5px; padding: 9px 10px; border-radius: var(--radius-sm); background: var(--card); cursor: grab; box-shadow: 0 1px 2px rgb(14 19 32 / 0.08); font-variant-numeric: tabular-nums; }
  .tile:hover { box-shadow: 0 2px 8px rgb(14 19 32 / 0.14); }
  .tile.ghost { position: fixed; z-index: var(--z-tip); pointer-events: none; rotate: 2deg; box-shadow: var(--shadow); cursor: grabbing; }
  .top { display: flex; align-items: center; gap: 7px; }
  .sym { font: 700 15px/1 var(--font-display); letter-spacing: -0.02em; }
  .price { margin-left: auto; font-weight: 650; font-size: 14px; padding-right: 14px; }
  /* Three bars: the handle for a finger. Hidden where there is a mouse, since the whole card drags. */
  .grip { display: none; flex-direction: column; gap: 2px; padding: 6px 4px 6px 0; touch-action: none; }
  .grip i { width: 12px; height: 2px; border-radius: 1px; background: var(--muted); }
  @media (pointer: coarse) { .grip { display: flex; } .tile { cursor: default; } }
  .mid { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .day { font-size: 13px; font-weight: 650; white-space: nowrap; }
  .day .small, dd .small { font-size: 11px; font-weight: 500; }
  .status { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status.loss { background: color-mix(in oklab, var(--loss) 15%, transparent); color: var(--loss); }
  .status.gain { background: color-mix(in oklab, var(--gain) 15%, transparent); color: var(--gain); }
  .status.accent { background: var(--accent-soft); color: var(--accent-ink); }
  .status.solid.loss { background: var(--loss); color: #fff; }
  .status.solid.gain { background: var(--gain); color: var(--card); }
  .status.solid.accent { background: var(--accent); color: #fff; }
  .status.quiet { background: var(--wash); color: var(--ink-2); }
  .status.none { background: none; color: var(--muted); padding-left: 0; font-weight: 500; }
  dl { display: grid; grid-template-columns: 1.35fr 1fr 0.7fr; gap: 6px; margin: 0; padding-top: 5px; border-top: 1px solid var(--line-soft); }
  dl div { min-width: 0; }
  dt { font-size: 10px; color: var(--muted); }
  dd { margin: 0; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* The plan's levels, highest price first, so the list reads like the chart: sales above, buys below. */
  .plan { list-style: none; margin: 0; padding: 5px 0 0; border-top: 1px solid var(--line-soft); display: grid; gap: 2px; }
  .plan li { display: grid; grid-template-columns: minmax(0, 1.5fr) auto minmax(0, 1.2fr) auto; align-items: baseline; gap: 6px; font-size: 11px; }
  .plan .what { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .plan .profit .what { color: var(--gain); } .plan .entry .what { color: var(--accent-ink); } .plan .stop .what { color: var(--loss); }
  .plan .at { font-weight: 650; }
  .plan .size { color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .plan .gap { color: var(--muted); text-align: right; white-space: nowrap; }
  .plan li.due .gap { color: var(--ink); font-weight: 650; }
  .off { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; display: grid; place-items: center; border-radius: 50%; color: var(--muted); opacity: 0; transition: opacity 0.12s var(--ease); }
  .tile:hover .off, .off:focus-visible { opacity: 1; }
  .off:hover { background: var(--wash); color: var(--ink); }
  @media (pointer: coarse) { .off { opacity: 1; } }

</style>
