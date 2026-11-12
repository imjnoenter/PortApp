<script lang="ts">
  // Deleting takes two presses: the first arms the button, the second does it.
  let { label, confirm, onconfirm }: { label: string; confirm: string; onconfirm: () => void } = $props();
  let armed = $state(false);
</script>

<button type="button" class="btn danger left" class:armed onblur={() => armed = false}
  onclick={() => { if (armed) onconfirm(); else armed = true; }}>{armed ? confirm : label}</button>
