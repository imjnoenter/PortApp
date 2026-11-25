/**
 * SVG path for one slice of a ring, from angle `a` (radians, clockwise from 3 o'clock) spanning
 * `span`. A slice wide enough gives up `gap` of its edges so neighbours read as separate.
 */
export function ringArc(r1: number, r0: number, a: number, span: number, gap: number): string {
  const pad = span > gap * 3 ? gap / 2 : 0, a0 = a + pad, a1 = a + span - pad, big = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, t: number) => `${(r * Math.cos(t)).toFixed(2)} ${(r * Math.sin(t)).toFixed(2)}`;
  return `M${p(r1, a0)}A${r1} ${r1} 0 ${big} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 ${big} 0 ${p(r0, a0)}Z`;
}
