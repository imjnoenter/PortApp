<script lang="ts" module>
  // One conversation per symbol, kept while the page is open so reopening a symbol costs nothing.
  interface Turn { role: 'user' | 'model'; text: string }
  const sessions = new Map<string, Turn[]>();
</script>

<script lang="ts">
  // A question box about one symbol, answered by Google Gemini with the account's own key. The
  // first message carries the position's facts, so answers can refer to them.
  import { untrack } from 'svelte';
  import { app } from '../../state/app.svelte.ts';

  let { sym, facts }: { sym: string; facts: string } = $props();

  const t = app.t;
  const MODEL = 'gemini-2.5-flash';
  let turns = $state<Turn[]>(untrack(() => sessions.get(sym) ?? []));
  let draft = $state('');
  let busy = $state(false);
  let failed = $state('');

  async function send(e: SubmitEvent) {
    e.preventDefault();
    const key = app.profile?.geminiKey, q = draft.trim();
    if (!key || !q || busy) return;
    draft = ''; failed = ''; busy = true;
    turns = [...turns, { role: 'user', text: q }];
    try {
      const lead = `You are helping an individual investor think about ${sym}. Be brief and concrete, and say when you are unsure. Their position:\n${facts}`;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: lead }] }, contents: turns.map(x => ({ role: x.role, parts: [{ text: x.text }] })) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || `Gemini answered ${res.status}`);
      const text = (json.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim();
      turns = [...turns, { role: 'model', text: text || t('No answer came back.') }];
      sessions.set(sym, turns);
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err);
    } finally { busy = false; }
  }
</script>

<section>
  <div class="sec-head"><h3>{t('Ask about')} {sym}</h3><span class="small muted">Gemini</span></div>
  {#if turns.length}
    <div class="log">
      {#each turns as x, i (i)}<p class={x.role}>{x.text}</p>{/each}
      {#if busy}<p class="model muted">{t('Thinking')}</p>{/if}
    </div>
  {/if}
  {#if failed}<p class="small loss" role="alert">{t('The question could not be answered')}: {failed}</p>{/if}
  <form onsubmit={send}>
    <input class="input" bind:value={draft} placeholder={t('What do you want to know?')} aria-label={t('Question')} />
    <button class="btn primary" disabled={busy || !draft.trim()}>{t('Ask')}</button>
  </form>
  <p class="small muted">{t('Answers come from a language model and can be wrong. Nothing here is advice.')}</p>
</section>

<style>
  section { display: grid; gap: var(--sp-3); }
  .sec-head { display: flex; align-items: baseline; gap: var(--sp-3); }
  h3 { font: 650 20px/1.15 var(--font-display); letter-spacing: -0.02em; }
  .log { display: grid; gap: var(--sp-2); max-height: 360px; overflow-y: auto; }
  p { margin: 0; }
  .log p { padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; max-width: 86%; }
  .user { justify-self: end; background: var(--ink); color: var(--bg); }
  .model { justify-self: start; background: var(--sunk); }
  form { display: flex; gap: var(--sp-2); }
</style>
