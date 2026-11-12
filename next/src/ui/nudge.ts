// Number boxes that step: Up and Down arrows, or the mouse wheel, raise and lower the value.
//
// Every number box in the app is a text input marked inputmode="decimal" (a real type="number"
// input rejects a typed comma and behaves differently per browser), so this adds the stepping they
// would otherwise lack, in one place, for all of them.
//
//   plain   1        Shift   10        Alt   0.1
//
// The wheel only acts on the box that has focus, so scrolling a form past a field never changes it.
const isNumberBox = (el: EventTarget | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement && el.inputMode === 'decimal' && !el.disabled && !el.readOnly;

const decimals = (s: string) => { const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };

function step(el: HTMLInputElement, dir: 1 | -1, e: { shiftKey: boolean; altKey: boolean }) {
  const text = el.value.replace(/,/g, '').trim();
  const now = text === '' ? 0 : Number(text);
  if (!Number.isFinite(now)) return;
  const by = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
  // Keep the decimals already typed, and never go below zero: nothing here takes a negative.
  const dp = Math.max(decimals(text), e.altKey ? 1 : 0);
  const next = Math.max(0, now + dir * by);
  el.value = next.toFixed(dp);
  // Fields listen for one or the other; send both so each updates as if the value had been typed.
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

let installed = false;
export function installNudge() {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', e => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.ctrlKey || e.metaKey || !isNumberBox(e.target)) return;
    e.preventDefault();
    step(e.target, e.key === 'ArrowUp' ? 1 : -1, e);
  });
  // Not passive: the page must not scroll while the wheel is turning a focused value.
  document.addEventListener('wheel', e => {
    if (!isNumberBox(e.target) || document.activeElement !== e.target || !e.deltaY) return;
    e.preventDefault();
    step(e.target, e.deltaY < 0 ? 1 : -1, e);
  }, { passive: false });
}
