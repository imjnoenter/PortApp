<script lang="ts" generics="T extends string">
  let { options, value = $bindable(), label = '', small = false, onchange }: {
    options: readonly { value: T; label: string }[];
    value: T;
    label?: string;
    small?: boolean;
    onchange?: (v: T) => void;
  } = $props();
</script>

<div class="seg" class:small role="group" aria-label={label || undefined}>
  {#each options as o (o.value)}
    <button type="button" class:on={o.value === value} aria-pressed={o.value === value}
      onclick={() => { value = o.value; onchange?.(o.value); }}>{o.label}</button>
  {/each}
</div>

<style>
  .seg { display: inline-flex; padding: 3px; gap: 2px; background: var(--wash); border-radius: 999px; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  .seg::-webkit-scrollbar { display: none; }
  button { padding: 6px 15px; border-radius: 999px; font-size: 13px; font-weight: 500; color: var(--ink-2); white-space: nowrap; transition: background 0.15s var(--ease), color 0.15s var(--ease); }
  .small button { padding: 4px 11px; font-size: 12px; }
  button:hover { color: var(--ink); }
  button.on { background: var(--ink); color: var(--bg); }
</style>
