// Pictures to share: composed on a canvas from live figures, not screenshots of the page.
//
// Drawing straight to a canvas needs no library. A canvas can only be exported if every image on it
// was served with permission to be read, so logos come from the one source that grants it, and a
// symbol it does not have gets a lettered disc instead.
import { colorFor } from '../core/format.ts';
/** The day as raw figures. The card words and formats them itself, in Thai, whatever the app is set to. */
export interface DayCard {
  name: string;
  /** The market day, yyyy-MM-dd. */
  day: string;
  dayChange: number; dayPct: number;
  /** Baht per dollar. */
  fx: number;
  /** The S&P 500's move today, percent, if known. */
  spxPct: number | null;
  bars: { r: number; today?: boolean }[];
  up: { symbol: string; pct: number; dollars: number }[];
  down: { symbol: string; pct: number; dollars: number }[];
  value: number;
  /** Unrealized gain over the cost of what is held, percent: the figure beside Portfolio value in the app. */
  unrealizedPct: number;
  /** Profit since the start, in baht, and what it is measured against. */
  bahtReturn: number; bahtPct: number; bahtNote: 'paid-in' | 'converted';
}
export interface SymbolCard {
  symbol: string; name: string; price: string; dayPct: number | null; dayLabel: string;
  /** The closes to draw, oldest first, with their dates so trades can be placed on them. */
  points: { d: string; v: number }[];
  /** Average cost, drawn as a line across the chart. */
  avg: number | null;
  /** Buys and sales, each marked on the close of its day. */
  marks: { d: string; type: string }[];
  labels: { avg: string; buy: string; sell: string };
  /** Two rows of figures under the chart. */
  facts: { label: string; value: string; note?: string; tone?: number }[][];
}

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const DISPLAY = '"Bricolage Grotesque", "IBM Plex Sans Thai", system-ui, sans-serif';
const BODY = 'Geist, "IBM Plex Sans Thai", system-ui, sans-serif';

function stage(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const c = canvas.getContext('2d')!;
  const tone = { bg: css('--bg'), card: css('--card'), ink: css('--ink'), ink2: css('--ink-2'), muted: css('--muted'), gain: css('--gain'), loss: css('--loss'), line: css('--line'), accent: css('--accent'), honey: css('--honey') };
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

// The daily card is a picture for Thai readers and is always in Thai, like the card it replaces:
// the wording is fixed here and does not follow the app's language switch.
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thaiDate = (day: string) => { const [y, m, d] = day.split('-').map(Number); return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`; };
const NOTE = { 'paid-in': 'เทียบเงินบาทที่ใส่เข้าไป', converted: 'แปลงจากผลตอบแทนดอลลาร์' };
const plus = (n: number) => n >= 0 ? '+' : '−';
const usdAbs = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bahtAbs = (n: number) => '฿' + Math.round(Math.abs(n)).toLocaleString('en-US');
const pctAbs = (n: number, dp = 2) => Math.abs(n).toFixed(dp) + '%';

export async function drawDayCard(d: DayCard): Promise<Blob> {
  await document.fonts.ready;
  const W = 1080, H = 1350, M = 72;
  const { c, tone, text, box, done } = stage(W, H);
  const hue = (n: number) => n >= 0 ? tone.gain : tone.loss;
  const width = (s: string, font: string) => { c.font = font; return c.measureText(s).width; };

  // ── Whose day, and which day ──
  // The app's own logo leads the name. It is served from beside the app, so it is safe to draw; if
  // it cannot be loaded the name simply starts at the margin.
  const mark = await new Promise<HTMLImageElement | null>(res => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = () => res(null);
    img.src = './favicon-white.png';
  });
  const S = 48;
  if (mark) {
    c.save();
    c.beginPath(); c.roundRect(M, 66, S, S, 12); c.clip();
    c.drawImage(mark, M, 66, S, S);
    c.restore();
  }
  text(d.name, M + (mark ? S + 16 : 0), 104, `700 38px ${DISPLAY}`, tone.ink);
  text('ผลตอบแทนวันนี้', M, 160, `500 30px ${BODY}`, tone.muted);
  text(`ปิดตลาด ${thaiDate(d.day)}`, W - M, 160, `500 28px ${BODY}`, tone.muted, 'right');

  // ── Today: the dollars lead, the percent and the baht sit under them ──
  const day = hue(d.dayChange), money = plus(d.dayChange) + usdAbs(d.dayChange);
  // Sized to fit: seven figures of dollars must not run into the S&P figure on the right.
  let size = 132;
  while (size > 84 && width(money, `800 ${size}px ${DISPLAY}`) > W - M * 2 - (d.spxPct == null ? 0 : 250)) size -= 6;
  text(money, M - 4, 300, `800 ${size}px ${DISPLAY}`, day);
  const pctText = plus(d.dayPct) + pctAbs(d.dayPct), pctFont = `700 50px ${DISPLAY}`;
  text(pctText, M, 372, pctFont, day);
  text(plus(d.dayChange) + bahtAbs(d.dayChange * d.fx), M + width(pctText, pctFont) + 26, 372, `500 36px ${BODY}`, tone.muted);
  if (d.spxPct != null) {
    text('เทียบ S&P 500', W - M, 258, `500 28px ${BODY}`, tone.muted, 'right');
    text(plus(d.spxPct) + pctAbs(d.spxPct), W - M, 306, `650 40px ${DISPLAY}`, hue(d.spxPct), 'right');
  }

  // ── The last trading days: gains rise from the middle line, losses hang below it ──
  const n = d.bars.length, top = 500, bh = 250, mid = top + bh / 2;
  if (n) {
    const max = Math.max(1e-9, ...d.bars.map(b => Math.abs(b.r)));
    const last = d.bars[n - 1].r, best = last > 0 && last >= Math.max(...d.bars.map(b => b.r));
    text(`${n} วันทำการล่าสุด`, M, 462, `500 28px ${BODY}`, tone.muted);
    // "Strongest day" is only said when today actually rose; on an all-red run it would mean least bad.
    text(best ? `วันนี้ขึ้นแรงที่สุดในรอบ ${n} วัน` : `สูงสุด ±${max.toFixed(2)}%`, W - M, 462, `600 28px ${BODY}`, tone.ink2, 'right');
    const gap = 8, bw = (W - M * 2 - gap * (n - 1)) / n;
    c.fillStyle = tone.line; c.fillRect(M, mid - 1, W - M * 2, 2);
    d.bars.forEach((b, i) => {
      const len = Math.max(3, Math.abs(b.r) / max * (bh / 2 - 8)), x = M + i * (bw + gap);
      c.globalAlpha = b.today ? 1 : 0.55;
      c.fillStyle = hue(b.r);
      c.beginPath();
      if (b.r >= 0) c.roundRect(x, mid - len, bw, len, [6, 6, 0, 0]); else c.roundRect(x, mid, bw, len, [0, 0, 6, 6]);
      c.fill();
    });
    c.globalAlpha = 1;
    const ups = String(d.bars.filter(b => b.r > 0).length), downs = String(d.bars.filter(b => b.r < 0).length);
    const f = `500 26px ${BODY}`, fb = `650 26px ${BODY}`;
    let x = M;
    for (const [s, font, color] of [[ups, fb, tone.gain], [' วันขึ้น, ', f, tone.muted], [downs, fb, tone.loss], [' วันลง', f, tone.muted]] as const) { text(s, x, top + bh + 46, font, color); x += width(s, font); }
    text('ความสูงคือขนาดการเปลี่ยนแปลง', W - M, top + bh + 46, f, tone.muted, 'right');
  }

  // ── What moved it ──
  const col = async (x: number, title: string, rows: DayCard['up'], none: string) => {
    text(title, x, 882, `500 28px ${BODY}`, tone.muted);
    c.fillStyle = tone.line; c.fillRect(x, 900, 444, 2);
    if (!rows.length) text(none, x, 962, `500 28px ${BODY}`, tone.muted);
    for (const [i, r] of rows.entries()) {
      const y = 958 + i * 54;
      await drawLogo(c, r.symbol, x, y - 32, 40, tone.card);
      text(r.symbol, x + 54, y, `700 32px ${DISPLAY}`, tone.ink);
      text(plus(r.pct) + pctAbs(r.pct), x + 316, y, `650 30px ${BODY}`, hue(r.pct), 'right');
      text(plus(r.dollars) + usdAbs(r.dollars), x + 444, y, `500 22px ${BODY}`, tone.muted, 'right');
    }
  };
  await col(M, 'ขึ้นมากสุด', d.up, 'ไม่มีตัวที่ขึ้นวันนี้');
  await col(W / 2 + 24, 'ลงมากสุด', d.down, 'ไม่มีตัวที่ลงวันนี้');

  // ── The account, in baht: what it is worth, and what it has made since the start ──
  box(M, 1110, W - M * 2, 180, 32, tone.card);
  const L = M + 40, R = W - M - 40;
  text('มูลค่าพอร์ต', L, 1160, `500 26px ${BODY}`, tone.muted);
  const worth = bahtAbs(d.value * d.fx), worthFont = `750 54px ${DISPLAY}`;
  text(worth, L, 1222, worthFont, tone.ink);
  text(plus(d.unrealizedPct) + pctAbs(d.unrealizedPct), L + width(worth, worthFont) + 18, 1222, `650 30px ${DISPLAY}`, hue(d.unrealizedPct));
  text(usdAbs(d.value), L, 1262, `500 24px ${BODY}`, tone.muted);
  text('กำไรรวมตั้งแต่เริ่ม', R, 1160, `500 26px ${BODY}`, tone.muted, 'right');
  const rp = plus(d.bahtPct) + pctAbs(d.bahtPct), rpFont = `600 32px ${DISPLAY}`;
  text(rp, R, 1222, rpFont, hue(d.bahtReturn), 'right');
  text(plus(d.bahtReturn) + bahtAbs(d.bahtReturn), R - width(rp, rpFont) - 16, 1222, `750 46px ${DISPLAY}`, hue(d.bahtReturn), 'right');
  text(NOTE[d.bahtNote], R, 1262, `500 22px ${BODY}`, tone.muted, 'right');
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

  // ── The chart: the price line, the average cost across it, and a dot for every buy and sale ──
  const top = 290, ch = 400, cw = W - M * 2, pad = 36;
  box(M, top, cw, ch + 66, 32, tone.card);
  const pts = d.points, n = pts.length;
  let keyX = M + pad;
  if (n > 1) {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
    // The cost line stretches the scale only when it is near the prices; far off, it would flatten them.
    const showAvg = d.avg != null && d.avg > lo * 0.6 && d.avg < hi * 1.4;
    if (showAvg) { lo = Math.min(lo, d.avg!); hi = Math.max(hi, d.avg!); }
    const span = hi - lo || 1;
    const x = (i: number) => M + pad + i / (n - 1) * (cw - pad * 2);
    const y = (v: number) => top + pad + (1 - (v - lo) / span) * (ch - pad * 2);

    if (showAvg) {
      c.save();
      c.strokeStyle = tone.accent; c.lineWidth = 3; c.setLineDash([12, 9]);
      c.beginPath(); c.moveTo(M + pad, y(d.avg!)); c.lineTo(M + cw - pad, y(d.avg!)); c.stroke();
      c.restore();
    }
    c.strokeStyle = tone.ink; c.lineWidth = 4; c.lineJoin = 'round'; c.beginPath();
    pts.forEach((p, i) => { if (i) c.lineTo(x(i), y(p.v)); else c.moveTo(x(i), y(p.v)); });
    c.stroke();

    // The cost itself, on the line at its right end, on a patch of the card so the line and the
    // price line stop short of it instead of running through the figures.
    if (showAvg) {
      const label = usdAbs(d.avg!), font = `700 26px ${DISPLAY}`;
      c.font = font;
      const w = c.measureText(label).width, ly = y(d.avg!);
      const right = M + cw - pad;
      box(right - w - 16, ly - 20, w + 22, 40, 10, tone.card);
      text(label, right - 5, ly + 9, font, tone.accent, 'right');
    }

    // Same placing as the chart in the app: the last close on or before the trade's market day.
    let buys = 0, sells = 0;
    for (const mk of d.marks) {
      if (mk.d < pts[0].d) continue;
      let i = n - 1;
      while (i > 0 && pts[i].d > mk.d) i--;
      const buy = mk.type === 'Buy';
      if (buy) buys++; else sells++;
      c.beginPath(); c.arc(x(i), y(pts[i].v), 11, 0, Math.PI * 2); c.fillStyle = tone.card; c.fill();
      c.beginPath(); c.arc(x(i), y(pts[i].v), 7.5, 0, Math.PI * 2); c.fillStyle = buy ? tone.accent : tone.honey; c.fill();
    }

    // The key names only what is actually drawn.
    const font = `500 24px ${BODY}`, ky = top + ch + 34;
    const key = (label: string, mark: () => void, w: number) => { mark(); text(label, keyX + w + 10, ky, font, tone.muted); c.font = font; keyX += w + 10 + c.measureText(label).width + 30; };
    const dot = (color: string) => () => { c.beginPath(); c.arc(keyX + 8, ky - 8, 8, 0, Math.PI * 2); c.fillStyle = color; c.fill(); };
    if (buys) key(d.labels.buy, dot(tone.accent), 16);
    if (sells) key(d.labels.sell, dot(tone.honey), 16);
    if (showAvg) key(d.labels.avg, () => { c.save(); c.strokeStyle = tone.accent; c.lineWidth = 3; c.setLineDash([8, 6]); c.beginPath(); c.moveTo(keyX, ky - 8); c.lineTo(keyX + 34, ky - 8); c.stroke(); c.restore(); }, 34);
  }

  // ── The position, in two rows ──
  d.facts.forEach((row, r) => {
    const fw = cw / Math.max(1, row.length), y0 = 812 + r * 116;
    row.forEach((f, i) => {
      const x = M + i * fw, color = f.tone == null ? tone.ink : f.tone >= 0 ? tone.gain : tone.loss, font = `700 44px ${DISPLAY}`;
      text(f.label, x, y0, `500 26px ${BODY}`, tone.muted);
      text(f.value, x, y0 + 54, font, color);
      // The second figure goes under the first, not beside it: three columns leave no room for both on a line.
      if (f.note) text(f.note, x, y0 + 92, `600 26px ${BODY}`, color);
    });
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
