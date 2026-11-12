// One floating tooltip for the whole app: `use:tip={'line one\nline two'}`.
// Text only (never HTML), follows the pointer, stays inside the viewport.
let el: HTMLDivElement | undefined;

function show(text: string, x: number, y: number) {
  if (!el) {
    el = document.createElement('div');
    el.className = 'float-tip';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.hidden = false;
  const r = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, x + 14), innerWidth - r.width - 8);
  const top = y + 18 + r.height > innerHeight ? y - r.height - 12 : y + 18;
  el.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(8, top))}px)`;
}

export function tip(node: HTMLElement | SVGElement, text: string | null | undefined) {
  let cur = text;
  const move = (e: Event) => { if (cur) show(cur, (e as PointerEvent).clientX, (e as PointerEvent).clientY); };
  const hide = () => { if (el) el.hidden = true; };
  node.addEventListener('pointerenter', move);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerleave', hide);
  node.addEventListener('pointercancel', hide);
  return {
    update(t: string | null | undefined) { cur = t; },
    destroy() {
      hide();
      node.removeEventListener('pointerenter', move);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', hide);
      node.removeEventListener('pointercancel', hide);
    },
  };
}
