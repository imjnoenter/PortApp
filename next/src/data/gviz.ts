// Google Sheets "gviz" read API: every tab of a link-shared sheet as JSON, no key, no OAuth.

type Cell = { v: unknown; f?: string } | null;
interface RawTable { cols: { label?: string }[]; rows: { c: Cell[] | null }[] }

export class Table {
  private idx = new Map<string, number>();
  readonly rows: Cell[][];

  constructor(raw: RawTable) {
    raw.cols.forEach((c, i) => { const k = (c.label || '').trim().toLowerCase(); if (k && !this.idx.has(k)) this.idx.set(k, i); });
    this.rows = raw.rows.map(r => r.c || []);
  }

  /** Column index for the first of these labels that exists (case-insensitive), else -1. */
  col(...labels: string[]): number {
    for (const l of labels) { const i = this.idx.get(l.toLowerCase()); if (i != null) return i; }
    return -1;
  }
  get length() { return this.rows.length; }
}

export const raw = (row: Cell[], i: number): unknown => i < 0 ? null : row[i]?.v ?? null;

export function str(row: Cell[], i: number): string | null {
  const v = raw(row, i);
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function num(row: Cell[], i: number): number | null {
  const v = raw(row, i);
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[,$%\s]/g, ''));
  return isFinite(n) ? n : null;
}

export const bool = (row: Cell[], i: number) => { const v = raw(row, i); return v === true || v === 'TRUE'; };

const parts = (v: unknown) => typeof v === 'string' && v.startsWith('Date(') ? v.slice(5, -1).split(',').map(Number) : null;

/** gviz dates arrive as the string `Date(y,m,d[,h,mi,s])` with a 0-based month. */
export function date(row: Cell[], i: number): string | null {
  const v = raw(row, i);
  if (v == null || v === '') return null;
  const p = parts(v);
  if (p) return new Date(Date.UTC(p[0], p[1], p[2])).toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

export function time(row: Cell[], i: number): string {
  const v = raw(row, i);
  if (v == null) return '';
  const p = parts(v);
  const pad = (n: number) => String(n || 0).padStart(2, '0');
  return p ? `${pad(p[3])}:${pad(p[4])}:${pad(p[5])}` : String(v);
}

/**
 * Read one tab. `fresh` adds a cache-buster: Google's CDN otherwise serves a copy up to ~30s old,
 * which matters right after a write and not at all on a routine refresh.
 */
export async function fetchTable(sheetId: string, tab: string, fresh = false): Promise<Table> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}` + (fresh ? '&_=' + Date.now() : '');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheet "${tab}" returned ${res.status}`);
  const text = await res.text();
  const start = text.indexOf('('), end = text.lastIndexOf(')');
  if (start < 0 || end < 0) throw new Error(`Sheet "${tab}" is not readable. Is it shared as "anyone with the link"?`);
  const json = JSON.parse(text.substring(start + 1, end));
  if (json.status === 'error') throw new Error(json.errors?.[0]?.detailed_message || `Sheet "${tab}" could not be read`);
  return new Table(json.table);
}
