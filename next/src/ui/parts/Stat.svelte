<script lang="ts">
  import type { Snippet } from 'svelte';

  let { label, value, note = '', tone = '', badge = '', badgeTone, children }: {
    label: string;
    value: string;
    /** A second, smaller figure beside the value, in plain ink. */
    note?: string;
    /** The badge's own colour, when it is not the value's. */
    badgeTone?: string;
    tone?: string;
    badge?: string;
    children?: Snippet;
  } = $props();
</script>

<div class="stat">
  <div class="label">{label}</div>
  <div class="value {tone}">{value}{#if note} <span class="note">{note}</span>{/if}</div>
  {#if badge}<div class="badge {badgeTone ?? tone}">{badge}</div>{/if}
  {#if children}<div class="sub">{@render children()}</div>{/if}
</div>

<style>
  .stat { min-width: 0; padding: var(--sp-1) var(--sp-5) var(--sp-1) 0; }
  .label { font-size: 13px; color: var(--muted); }
  .value { margin-top: 6px; font: 650 clamp(22px, 2vw, 30px)/1.1 var(--font-display); letter-spacing: -0.03em; white-space: nowrap; }
  /* The second figure stays whole, and drops to its own line only when the column is too narrow for both. */
  .value:has(.note) { white-space: normal; }
  .value:has(.note) { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 0.35em; }
  .note { font-size: 0.62em; color: var(--ink); letter-spacing: -0.01em; white-space: nowrap; }
  .badge { margin-top: 2px; font-size: 14px; font-weight: 600; }
  .sub { margin-top: 8px; font-size: 12px; color: var(--ink-2); line-height: 1.5; max-width: 28ch; }
</style>
