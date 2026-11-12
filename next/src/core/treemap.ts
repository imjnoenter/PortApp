// Squarified treemap: areas proportional to value, tiles kept as close to square as the box allows.

export interface Rect<T> { item: T; x: number; y: number; w: number; h: number }

/** Worst aspect ratio in a strip whose largest/smallest areas are `max`/`min` and whose total is `sum`. */
const worst = (max: number, min: number, sum: number, side: number) =>
  Math.max(side * side * max / (sum * sum), sum * sum / (side * side * min));

export function squarify<T>(items: readonly T[], value: (t: T) => number, W: number, H: number): Rect<T>[] {
  const nodes = items.map(item => ({ item, v: value(item) })).filter(n => n.v > 0).sort((a, b) => b.v - a.v);
  const total = nodes.reduce((s, n) => s + n.v, 0);
  if (!total || !(W > 0) || !(H > 0)) return [];
  const k = W * H / total;
  const area = nodes.map(n => n.v * k);

  const out: Rect<T>[] = [];
  let x = 0, y = 0, w = W, h = H, i = 0;
  while (i < nodes.length) {
    const side = Math.min(w, h);
    let sum = area[i], j = i + 1, best = worst(area[i], area[i], sum, side);
    // Sorted descending, so the strip's largest is its first and its smallest is the one being added.
    while (j < nodes.length) {
      const next = worst(area[i], area[j], sum + area[j], side);
      if (next > best) break;
      best = next; sum += area[j]; j++;
    }
    const thick = sum / side;
    let off = 0;
    for (let m = i; m < j; m++) {
      const len = area[m] / thick;
      out.push(w >= h ? { item: nodes[m].item, x, y: y + off, w: thick, h: len } : { item: nodes[m].item, x: x + off, y, w: len, h: thick });
      off += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    i = j;
  }
  return out;
}
