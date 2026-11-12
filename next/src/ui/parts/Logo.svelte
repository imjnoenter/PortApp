<script lang="ts">
  import { colorFor } from '../../core/format.ts';

  let { sym, size = 28 }: { sym: string; size?: number } = $props();
  // Remember which symbol failed rather than a bare flag, so a reused row retries for its new symbol.
  let failed = $state<string | null>(null);
</script>

<span class="logo" style:width="{size}px" style:height="{size}px" style:font-size="{Math.round(size * 0.4)}px">
  {#if failed === sym}
    <span class="chip" style:background={colorFor(sym)}>{sym.slice(0, 1)}</span>
  {:else}
    <img src="https://financialmodelingprep.com/image-stock/{encodeURIComponent(sym)}.png" alt="" loading="lazy" onerror={() => failed = sym}>
  {/if}
</span>

<style>
  .logo { display: inline-grid; place-items: center; flex: none; border-radius: 50%; overflow: hidden; background: var(--sunk); }
  img { width: 100%; height: 100%; object-fit: contain; padding: 12%; }
  .chip { width: 100%; height: 100%; display: grid; place-items: center; color: #fff; font-weight: 700; }
</style>
