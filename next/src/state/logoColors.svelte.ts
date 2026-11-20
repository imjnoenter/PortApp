// Slice colours taken from each stock's logo, plus the user's own per-symbol overrides.
//
// The logo host (FMP) sends Access-Control-Allow-Origin, so a logo can be drawn to a canvas and its
// pixels read. Each logo is measured once and the result cached in the browser (the measurement is
// the same on every device). The user's own colours live in the sheet's `Color` column, so they
// sync; only an account that can't write keeps them in the browser.
import { colorFor } from '../core/format.ts';
import { app } from './app.svelte.ts';

const AUTO_KEY = 'portapp.logoColor.v1';
const OVERRIDE_KEY = 'portapp.sliceColor.v1';

function load(key: string): Record<string, string | null> {
  try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function save(key: string, v: Record<string, string | null>) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

/** sym → the logo's brand colour, or null when the logo has none (black, white, grey) or failed. */
const auto = $state<Record<string, string | null>>(load(AUTO_KEY));
const overrides = $state<Record<string, string>>(load(OVERRIDE_KEY) as Record<string, string>);
const pending = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const HEX_RE = /^#?([0-9a-f]{6})$/i;
export const normHex = (s: string) => { const m = HEX_RE.exec(s.trim()); return m ? `#${m[1].toLowerCase()}` : null; };

/**
 * The user's colour for a symbol. With a write-enabled account it lives in the sheet's `Color`
 * column (so every device sees it, and it goes when the symbol's row is deleted); the browser copy
 * is only for an account that can't write. A colour in the sheet shows on read-only links too.
 */
function ownColor(sym: string): string | undefined {
  return app.sheetColors[sym] ?? (app.canWrite ? undefined : overrides[sym]);
}

export const sliceColors = {
  override: (sym: string): string | null => ownColor(sym) ?? null,
  auto: (sym: string): string | null | undefined => auto[sym],
  setOverride(sym: string, hex: string) {
    const h = normHex(hex);
    if (!h || h === ownColor(sym)) return;
    if (app.canWrite) {
      // Dragging the picker fires on every step: show each one, write only once it settles.
      app.saveColor(sym, h, false);
      clearTimeout(timers.get(sym));
      timers.set(sym, setTimeout(() => { timers.delete(sym); app.saveColor(sym, h); }, 700));
    } else { overrides[sym] = h; save(OVERRIDE_KEY, overrides); }
  },
  clearOverride(sym: string) {
    clearTimeout(timers.get(sym)); timers.delete(sym);
    if (app.canWrite) app.saveColor(sym, null);
    else { delete overrides[sym]; save(OVERRIDE_KEY, overrides); }
  },
  /** Measure the logo once; a no-op when it is cached or already loading. */
  request(sym: string) {
    if (sym in auto || pending.has(sym)) return;
    pending.add(sym);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { pending.delete(sym); auto[sym] = dominant(img); save(AUTO_KEY, auto); };
    // A logo that fails to load isn't cached, so it is tried again next visit.
    img.onerror = () => { pending.delete(sym); };
    img.src = `https://financialmodelingprep.com/image-stock/${encodeURIComponent(sym)}.png`;
  },
};

/** The logo's most common colourful hue, averaged; null when too little of it is colourful. */
function dominant(img: HTMLImageElement): string | null {
  const N = 40;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, N, N);
  let px: Uint8ClampedArray;
  try { px = ctx.getImageData(0, 0, N, N).data; } catch { return null; }   // tainted canvas
  const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let opaque = 0, colourful = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue;
    opaque++;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 510;
    const s = d === 0 ? 0 : d / 255 / (1 - Math.abs(2 * l - 1));
    // Near-white, near-black and greys say nothing about the brand.
    if (d < 40 || s < 0.25 || l > 0.93 || l < 0.08) continue;
    colourful++;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const bin = bins[Math.floor(h / 15) % 24], w = s;
    bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
  }
  if (!opaque || colourful / opaque < 0.08) return null;
  // Take the heaviest bin with its neighbours, so a hue on a bin edge isn't split in two.
  let best = 0, bestW = -1;
  for (let i = 0; i < 24; i++) {
    const w = bins[i].w + 0.5 * (bins[(i + 23) % 24].w + bins[(i + 1) % 24].w);
    if (w > bestW) { bestW = w; best = i; }
  }
  const b = bins[best];
  if (!b.w) return null;
  const hx = (v: number) => Math.round(v / b.w).toString(16).padStart(2, '0');
  return `#${hx(b.r)}${hx(b.g)}${hx(b.b)}`;
}

// ── OKLab, for judging lightness and how far apart two colours look ───────────────────────────
type Lab = [number, number, number];
const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const gam = (v: number) => { const x = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, x)) * 255); };
function toLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16);
  const r = lin(n >> 16 & 255), g = lin(n >> 8 & 255), b = lin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromLab([L, A, B]: Lab): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const b = gam(-0.0041960863 * l - 0.7034186168 * m + 1.707614701 * s);
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
const dist = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const withL = (lab: Lab, L: number): Lab => [Math.min(0.95, Math.max(0.2, L)), lab[1], lab[2]];

/** Keep a colour visible against the card: lighten dark ones in dark mode, darken pale ones in light. */
function forTheme(hex: string, dark: boolean): string {
  const lab = toLab(hex);
  if (dark && lab[0] < 0.58) return fromLab(withL(lab, 0.58));
  if (!dark && lab[0] > 0.8) return fromLab(withL(lab, 0.8));
  return hex;
}

const NEAR = 0.1;   // OKLab distance under which two neighbouring slices read as one

/**
 * Colours for slices in ring order. An override is used exactly as given; otherwise the logo's
 * colour, fitted to the theme, then moved off a neighbour it's too close to — lighter or darker
 * first, and the app's own colour for the symbol if that isn't enough.
 */
export function ringColors(keys: string[], dark: boolean, fixed: Record<string, string> = {}): string[] {
  const out: string[] = [];
  const labs: Lab[] = [];
  keys.forEach((k, i) => {
    if (fixed[k]) { out.push(fixed[k]); labs.push(toLab(fixed[k])); return; }
    const own = ownColor(k);
    if (own) { out.push(own); labs.push(toLab(own)); return; }
    let hex = forTheme(auto[k] || colorFor(k), dark);
    let lab = toLab(hex);
    // The last slice also touches the first.
    const near = (c: Lab) => (i > 0 && dist(c, labs[i - 1]) < NEAR) || (i === keys.length - 1 && i > 0 && dist(c, labs[0]) < NEAR);
    if (near(lab)) {
      const tries = [0.14, -0.14, 0.24, -0.24].map(d => withL(lab, lab[0] + d)).filter(c => !dark || c[0] >= 0.5);
      const ok = tries.find(c => !near(c));
      if (ok) { lab = ok; hex = fromLab(ok); }
      else {
        const pal = forTheme(colorFor(k), dark);
        if (!near(toLab(pal))) { hex = pal; lab = toLab(pal); }
      }
    }
    out.push(hex); labs.push(lab);
  });
  return out;
}
