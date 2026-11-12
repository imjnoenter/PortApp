// The target editor's rules. Targets are percentages of one portfolio and may total at most 100;
// what is left over is planned cash. A locked row is never moved by anything, its own controls
// included. Every function returns new rows and mutates none.

export interface AllocRow {
  symbol: string;
  name: string | null;
  /** Current weight, percent of the portfolio's investable total. */
  now: number;
  /** The target as last saved, and as being edited. Percent. */
  saved: number;
  target: number;
  locked: boolean;
  category: string | null;
  custom: string | null;
  myGroup: string | null;
}

const round = (v: number) => Math.round(v * 100) / 100;
export const allocTotal = (rows: readonly AllocRow[]) => rows.reduce((s, r) => s + r.target, 0);
/** The most this row can be set to without the total passing 100. */
export const allocRoom = (rows: readonly AllocRow[], symbol: string) => Math.max(0, 100 - rows.reduce((s, r) => s + (r.symbol === symbol ? 0 : r.target), 0));

/** Set one row. It stops at the room left: no other row is moved to make space. */
export function allocSet(rows: readonly AllocRow[], symbol: string, value: number): AllocRow[] {
  const row = rows.find(r => r.symbol === symbol);
  if (!row || row.locked || !Number.isFinite(value)) return rows as AllocRow[];
  const v = round(Math.min(Math.max(0, value), allocRoom(rows, symbol)));
  return rows.map(r => r === row ? { ...r, target: v } : r);
}

/** Give the unlocked rows named a new combined total, keeping their proportions (or evenly, if all are zero). */
export function allocScale(rows: readonly AllocRow[], members: readonly string[], total: number): AllocRow[] {
  const free = rows.filter(r => members.includes(r.symbol) && !r.locked);
  if (!free.length || !Number.isFinite(total)) return rows as AllocRow[];
  const fixed = rows.filter(r => members.includes(r.symbol) && r.locked).reduce((s, r) => s + r.target, 0);
  const others = rows.filter(r => !members.includes(r.symbol)).reduce((s, r) => s + r.target, 0);
  const want = Math.max(0, Math.min(total, 100 - others) - fixed);
  const have = free.reduce((s, r) => s + r.target, 0);
  const set = new Map(free.map(r => [r.symbol, round(have > 0 ? r.target / have * want : want / free.length)]));
  return rows.map(r => set.has(r.symbol) ? { ...r, target: set.get(r.symbol)! } : r);
}

const unlockedBudget = (rows: readonly AllocRow[]) => Math.max(0, 100 - rows.filter(r => r.locked).reduce((s, r) => s + r.target, 0));
function spread(rows: readonly AllocRow[], weights: Map<string, number>, budget: number): AllocRow[] {
  const sum = [...weights.values()].reduce((s, w) => s + w, 0);
  return rows.map(r => weights.has(r.symbol) ? { ...r, target: sum > 0 ? round(weights.get(r.symbol)! / sum * budget) : 0 } : r);
}

/** Every unlocked row to its current weight, scaled down together if that would pass 100. */
export function allocMatchCurrent(rows: readonly AllocRow[]): AllocRow[] {
  const free = rows.filter(r => !r.locked);
  const sum = free.reduce((s, r) => s + r.now, 0), budget = unlockedBudget(rows);
  return spread(rows, new Map(free.map(r => [r.symbol, r.now])), Math.min(sum, budget));
}

/** The unlocked rows that are held or already have a target share what is not locked, equally. */
export function allocEqual(rows: readonly AllocRow[]): AllocRow[] {
  const free = rows.filter(r => !r.locked && (r.now > 0 || r.target > 0));
  return spread(rows.map(r => r.locked || free.includes(r) ? r : { ...r, target: 0 }), new Map(free.map(r => [r.symbol, 1])), unlockedBudget(rows));
}

/** Hand the unallocated remainder to the unlocked rows that have a target, in proportion. */
export function allocFillRest(rows: readonly AllocRow[]): AllocRow[] {
  const free = rows.filter(r => !r.locked && r.target > 0);
  if (!free.length) return rows as AllocRow[];
  const others = rows.filter(r => !free.includes(r)).reduce((s, r) => s + r.target, 0);
  return spread(rows, new Map(free.map(r => [r.symbol, r.target])), Math.max(0, 100 - others));
}

/** Unlocked rows back to what is saved. */
export const allocReset = (rows: readonly AllocRow[]): AllocRow[] => rows.map(r => r.locked ? r : { ...r, target: r.saved });

/** What a save has to send: fractions, for the rows that differ from what is saved. */
export function allocChanges(rows: readonly AllocRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (Math.abs(r.target - r.saved) > 1e-9) out[r.symbol] = round(r.target) / 100;
  return out;
}

export interface AllocGroup { key: string; members: string[]; target: number; now: number; locked: boolean }
export function allocGroups(rows: readonly AllocRow[], field: 'category' | 'custom' | 'myGroup'): AllocGroup[] {
  const by = new Map<string, AllocGroup>();
  for (const r of rows) {
    const key = r[field] || 'Other';
    let g = by.get(key);
    if (!g) by.set(key, g = { key, members: [], target: 0, now: 0, locked: true });
    g.members.push(r.symbol); g.target += r.target; g.now += r.now;
    if (!r.locked) g.locked = false;
  }
  return [...by.values()].sort((a, b) => b.target - a.target || b.now - a.now || a.key.localeCompare(b.key));
}
