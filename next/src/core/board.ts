// The "Today Plan" board: zones (columns) the user names and colours, each holding symbol cards in
// an order. Pure data and the moves on it; the page stores it and draws it.

export interface Zone { id: string; name: string; color: number; cards: string[] }
export interface Board { zones: Zone[] }

/** How many zone colours there are. A zone keeps an index, so each theme maps it to its own tint. */
export const ZONE_COLORS = 6;

export const newBoard = (): Board => ({
  zones: [
    { id: 'z1', name: 'Waiting to buy', color: 0, cards: [] },
    { id: 'z2', name: 'Bought', color: 1, cards: [] },
    { id: 'z3', name: 'Watching', color: 2, cards: [] },
    { id: 'z4', name: 'Waiting to sell', color: 3, cards: [] },
  ],
});

/** A board read back from storage, with anything malformed dropped rather than trusted. */
export function readBoard(raw: unknown): Board {
  const z = (raw as Board | null)?.zones;
  if (!Array.isArray(z)) return newBoard();
  const seen = new Set<string>();
  const zones = z.filter(x => x && typeof x.id === 'string').map((x, i) => ({
    id: x.id,
    name: typeof x.name === 'string' ? x.name.slice(0, 40) : `Zone ${i + 1}`,
    color: Number.isInteger(x.color) ? ((x.color % ZONE_COLORS) + ZONE_COLORS) % ZONE_COLORS : i % ZONE_COLORS,
    // A symbol is on the board once; a duplicate is dropped.
    cards: Array.isArray(x.cards) ? x.cards.filter(s => typeof s === 'string' && !seen.has(s) && (seen.add(s), true)) : [],
  }));
  return { zones };
}

export const onBoard = (b: Board) => new Set(b.zones.flatMap(z => z.cards));

/** Put a symbol into a zone at a position, taking it out of wherever it was. */
export function moveCard(b: Board, sym: string, zoneId: string, index: number): Board {
  if (!b.zones.some(z => z.id === zoneId)) return b;
  const zones = b.zones.map(z => ({ ...z, cards: z.cards.filter(s => s !== sym) }));
  const to = zones.find(z => z.id === zoneId)!;
  to.cards.splice(Math.max(0, Math.min(index, to.cards.length)), 0, sym);
  return { zones };
}

export const removeCard = (b: Board, sym: string): Board => ({ zones: b.zones.map(z => ({ ...z, cards: z.cards.filter(s => s !== sym) })) });

export function addZone(b: Board, name: string): Board {
  const used = new Set(b.zones.map(z => z.color));
  const color = [...Array(ZONE_COLORS).keys()].find(c => !used.has(c)) ?? b.zones.length % ZONE_COLORS;
  return { zones: [...b.zones, { id: 'z' + Date.now().toString(36), name, color, cards: [] }] };
}

export const updateZone = (b: Board, id: string, patch: Partial<Pick<Zone, 'name' | 'color'>>): Board =>
  ({ zones: b.zones.map(z => z.id === id ? { ...z, ...patch } : z) });

/** Delete a zone. Its cards are not lost: they move to the first zone left, or off the board if none is. */
export function removeZone(b: Board, id: string): Board {
  const gone = b.zones.find(z => z.id === id);
  const zones = b.zones.filter(z => z.id !== id).map(z => ({ ...z, cards: [...z.cards] }));
  if (gone && zones.length) zones[0].cards.push(...gone.cards);
  return { zones };
}

export function shiftZone(b: Board, id: string, by: -1 | 1): Board {
  const i = b.zones.findIndex(z => z.id === id), j = i + by;
  if (i < 0 || j < 0 || j >= b.zones.length) return b;
  const zones = [...b.zones];
  [zones[i], zones[j]] = [zones[j], zones[i]];
  return { zones };
}
