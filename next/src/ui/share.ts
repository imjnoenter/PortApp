// Pictures to share: composed on a canvas from live figures, not screenshots of the page.
//
// Drawing straight to a canvas needs no library. A canvas can only be exported if every image on it
// was served with permission to be read, so logos come from the one source that grants it, and a
// symbol it does not have gets a lettered disc instead.
import { colorFor } from '../core/format.ts';
export interface DayCard {
  name: string; dateLabel: string;
  dayPct: number; dayMoney: string; value: string; unrealizedPct: string;
  bars: { r: number; today?: boolean }[];
  up: { symbol: string; pct: string; money: string }[];
  down: { symbol: string; pct: string; money: string }[];
  labels: { today: string; value: string; unrealized: string; days: string; up: string; down: string };
}
export interface SymbolCard {
  symbol: string; name: string; price: string; dayPct: number | null; dayLabel: string;
  points: number[]; rangeLabel: string;
  facts: { label: string; value: string; tone?: number }[];
}

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const DISPLAY = '"Bricolage Grotesque", "IBM Plex Sans Thai", system-ui, sans-serif';
const BODY = 'Geist, "IBM Plex Sans Thai", system-ui, sans-serif';

function stage(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const c = canvas.getContext('2d')!;
  const tone = { bg: css('--bg'), card: css('--card'), ink: css('--ink'), ink2: css('--ink-2'), muted: css('--muted'), gain: css('--gain'), loss: css('--loss'), line: css('--line') };
  c.fillStyle = tone.bg; c.fillRect(0, 0, w, h);
  c.textBaseline = 'alphabetic';
  const text = (s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left') => {
    c.font = font; c.fillStyle = color; c.textAlign = align; c.fillText(s, x, y);
  };
  const box = (x: number, y: number, bw: number, bh: number, r: number, color: string) => {
    c.fillStyle = color; c.beginPath(); c.roundRect(x, y, bw, bh, r); c.fill();
  };
  const done = () => new Promise<Blob>((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Could not draw the picture')), 'image/png'));
  return { c, tone, text, box, done };
}
const logos = new Map<string, Promise<HTMLImageElement | null>>();
function loadLogo(sym: string) {
  let p = logos.get(sym);
  if (!p) {
    p = new Promise(res => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img); img.onerror = () => res(null);
      img.src = `https://financialmodelingprep.com/image-stock/${encodeURIComponent(sym)}.png`;
    });
    logos.set(sym, p);
  }
  return p;
}
/** A round logo, or the symbol's first letter on its own colour. Call after every logo needed has been awaited. */
async function drawLogo(c: CanvasRenderingContext2D, sym: string, x: number, y: number, size: number, backing: string) {
  const img = await loadLogo(sym), r = size / 2;
  c.save();
  c.beginPath(); c.arc(x + r, y + r, r, 0, Math.PI * 2); c.closePath();
  c.fillStyle = img ? backing : colorFor(sym); c.fill();
  c.clip();
  if (img) {
    const k = Math.min(size * 0.72 / img.width, size * 0.72 / img.height), w = img.width * k, h = img.height * k;
    c.drawImage(img, x + r - w / 2, y + r - h / 2, w, h);
  } else {
    c.font = `700 ${Math.round(size * 0.44)}px ${DISPLAY}`; c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(sym.slice(0, 1), x + r, y + r + 1); c.textBaseline = 'alphabetic';
  }
  c.restore();
}

const signed = (n: number, dp = 2) => (n > 0 ? '+' : '') + n.toFixed(dp) + '%';

export async function drawDayCard(d: DayCard): Promise<Blob> {
  await document.fonts.ready;
  const W = 1080, H = 1350, M = 72;
  const { c, tone, text, box, done } = stage(W, H);
  const dayColor = d.dayPct >= 0 ? tone.gain : tone.loss;

  text(d.name, M, 118, `700 44px ${DISPLAY}`, tone.ink);
  text(d.dateLabel, W - M, 118, `500 30px ${BODY}`, tone.muted, 'right');

  text(d.labels.today, M, 250, `500 34px ${BODY}`, tone.ink2);
  text(signed(d.dayPct), M - 6, 440, `800 200px ${DISPLAY}`, dayColor);
  text(d.dayMoney, M, 510, `600 44px ${BODY}`, dayColor);

  box(M, 570, W - M * 2, 150, 32, tone.card);
  text(d.labels.value, M + 40, 628, `500 28px ${BODY}`, tone.muted);
  text(d.value, M + 40, 688, `700 52px ${DISPLAY}`, tone.ink);
  text(d.labels.unrealized, W - M - 40, 628, `500 28px ${BODY}`, tone.muted, 'right');
  text(d.unrealizedPct, W - M - 40, 688, `700 52px ${DISPLAY}`, d.unrealizedPct.startsWith('-') ? tone.loss : tone.gain, 'right');

  // Daily bars: gains rise from the middle line, losses hang below it.
  const top = 770, bh = 250, mid = top + bh / 2, n = d.bars.length;
  if (n) {
    const max = Math.max(1e-9, ...d.bars.map(b => Math.abs(b.r)));
    const gap = 8, bw = (W - M * 2 - gap * (n - 1)) / n;
    c.fillStyle = tone.line; c.fillRect(M, mid - 1, W - M * 2, 2);
    d.bars.forEach((b, i) => {
      const len = Math.max(3, Math.abs(b.r) / max * (bh / 2 - 8)), x = M + i * (bw + gap);
      c.globalAlpha = b.today ? 1 : 0.55;
      c.fillStyle = b.r >= 0 ? tone.gain : tone.loss;
      c.beginPath();
      if (b.r >= 0) c.roundRect(x, mid - len, bw, len, [6, 6, 0, 0]); else c.roundRect(x, mid, bw, len, [0, 0, 6, 6]);
      c.fill();
    });
    c.globalAlpha = 1;
    text(d.labels.days, M, top + bh + 44, `500 26px ${BODY}`, tone.muted);
  }

  const col = async (x: number, title: string, rows: DayCard['up'], color: string) => {
    text(title, x, 1150, `600 30px ${BODY}`, tone.ink2);
    for (const [i, r] of rows.entries()) {
      const y = 1206 + i * 50;
      await drawLogo(c, r.symbol, x, y - 31, 38, tone.card);
      text(r.symbol, x + 50, y, `700 32px ${DISPLAY}`, tone.ink);
      text(r.pct, x + 310, y, `600 30px ${BODY}`, color, 'right');
      text(r.money, x + 444, y, `500 24px ${BODY}`, tone.muted, 'right');
    }
  };
  await col(M, d.labels.up, d.up, tone.gain);
  await col(W / 2 + 24, d.labels.down, d.down, tone.loss);
  return done();
}

export async function drawSymbolCard(d: SymbolCard): Promise<Blob> {
  await document.fonts.ready;
  const W = 1080, H = 1080, M = 72;
  const { c, tone, text, box, done } = stage(W, H);
  await drawLogo(c, d.symbol, M, 78, 112, tone.card);
  text(d.symbol, M + 136, 168, `800 104px ${DISPLAY}`, tone.ink);
  text(d.name.length > 40 ? d.name.slice(0, 39) + '…' : d.name, M, 246, `500 32px ${BODY}`, tone.muted);
  text(d.price, W - M, 150, `700 76px ${DISPLAY}`, tone.ink, 'right');
  if (d.dayPct != null) text(`${signed(d.dayPct)} ${d.dayLabel}`, W - M, 210, `600 36px ${BODY}`, d.dayPct >= 0 ? tone.gain : tone.loss, 'right');

  const top = 300, ch = 400, cw = W - M * 2;
  box(M, top, cw, ch + 70, 32, tone.card);
  if (d.points.length > 1) {
    const lo = Math.min(...d.points), hi = Math.max(...d.points), span = hi - lo || 1, pad = 36;
    const up = d.points[d.points.length - 1] >= d.points[0];
    c.strokeStyle = up ? tone.gain : tone.loss; c.lineWidth = 5; c.lineJoin = 'round'; c.beginPath();
    d.points.forEach((v, i) => {
      const x = M + pad + i / (d.points.length - 1) * (cw - pad * 2), y = top + pad + (1 - (v - lo) / span) * (ch - pad * 2);
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    });
    c.stroke();
  }
  text(d.rangeLabel, M + 36, top + ch + 36, `500 26px ${BODY}`, tone.muted);

  const fw = cw / Math.max(1, d.facts.length);
  d.facts.forEach((f, i) => {
    const x = M + i * fw;
    text(f.label, x, 860, `500 28px ${BODY}`, tone.muted);
    text(f.value, x, 920, `700 46px ${DISPLAY}`, f.tone == null ? tone.ink : f.tone >= 0 ? tone.gain : tone.loss);
  });
  return done();
}

/** Hand a picture to the system share sheet. False when this device has none for files. */
export async function sharePicture(blob: Blob, filename: string): Promise<boolean> {
  const file = new File([blob], filename, { type: 'image/png' });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try { await navigator.share({ files: [file] }); } catch { /* dismissed: not an error */ }
  return true;
}
export const canSharePictures = () => {
  try { return !!navigator.canShare?.({ files: [new File([''], 'a.png', { type: 'image/png' })] }); } catch { return false; }
};

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** A table as a CSV file a spreadsheet opens cleanly: quoted where needed, with a byte-order mark. */
export function downloadCsv(filename: string, rows: readonly (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  download(new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename);
}

// ── A table as a picture (the Positions list) ────────────────────────────────────────────────────
export interface TableCell { main: string; sub?: string; tone?: string; subTone?: string }
export interface TablePicture {
  title: string; subtitle: string;
  columns: { label: string; left?: boolean }[];
  rows: { symbol: string; name: string; cells: TableCell[] }[];
  foot?: { label: string; cells: string[] };
}

/** Sized to its content: wide enough for every column, tall enough for every row, capped for phone browsers. */
export async function drawTable(d: TablePicture): Promise<Blob> {
  await document.fonts.ready;
  const M = 56, ROW = 78, SYM = 300, COL = 190, HEAD = 190;
  const W = Math.max(900, M * 2 + SYM + d.columns.length * COL);
  const rows = d.rows.slice(0, 60);
  const H = HEAD + rows.length * ROW + (d.foot ? ROW : 0) + M;
  const { c, tone, text, box, done } = stage(W, H);
  const ink = (t?: string) => t === 'gain' ? tone.gain : t === 'loss' ? tone.loss : t === 'muted' ? tone.muted : t === 'ink2' ? tone.ink2 : tone.ink;

  text(d.title, M, 84, `750 52px ${DISPLAY}`, tone.ink);
  text(d.subtitle, W - M, 84, `500 28px ${BODY}`, tone.muted, 'right');
  box(M - 20, 116, W - (M - 20) * 2, H - 116 - M + 20, 28, tone.card);
  const colX = (i: number, left?: boolean) => M + SYM + i * COL + (left ? 0 : COL - 16);
  d.columns.forEach((col, i) => text(col.label, colX(i, col.left), HEAD - 22, `500 22px ${BODY}`, tone.muted, col.left ? 'left' : 'right'));

  await Promise.all(rows.map(r => loadLogo(r.symbol)));
  for (const [n, r] of rows.entries()) {
    const y = HEAD + n * ROW;
    c.fillStyle = tone.line; c.globalAlpha = 0.5; c.fillRect(M, y, W - M * 2, 1); c.globalAlpha = 1;
    await drawLogo(c, r.symbol, M, y + 17, 44, tone.bg);
    text(r.symbol, M + 60, y + 36, `700 28px ${DISPLAY}`, tone.ink);
    text(r.name.length > 20 ? r.name.slice(0, 19) + '…' : r.name, M + 60, y + 62, `400 19px ${BODY}`, tone.muted);
    r.cells.forEach((cell, i) => {
      const left = d.columns[i].left, x = colX(i, left), align = left ? 'left' : 'right';
      text(cell.main, x, y + (cell.sub ? 36 : 47), `600 25px ${BODY}`, ink(cell.tone), align);
      if (cell.sub) text(cell.sub, x, y + 62, `400 19px ${BODY}`, cell.subTone ? ink(cell.subTone) : tone.muted, align);
    });
  }
  if (d.foot) {
    const y = HEAD + rows.length * ROW;
    c.fillStyle = tone.line; c.fillRect(M, y, W - M * 2, 2);
    text(d.foot.label, M, y + 48, `600 25px ${BODY}`, tone.ink2);
    d.foot.cells.forEach((v, i) => text(v, colX(i, d.columns[i].left), y + 48, `700 25px ${BODY}`, tone.ink, d.columns[i].left ? 'left' : 'right'));
  }
  return done();
}
