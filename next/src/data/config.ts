// Account config. Shared with the original app on purpose: same origin, same localStorage key, so a
// device already set up there needs no setup here, and a profile added in either shows up in both.

export interface Profile {
  id: string;
  profileName: string;
  sheetId: string;
  recordUrl?: string;   // Apps Script web app, needed for writes
  writeKey?: string;
  /** Optional Google Gemini key: turns on the question box in the symbol window. */
  geminiKey?: string;
  /** From a ?sheet= link: used for this visit only, never written to storage. */
  ephemeral?: boolean;
}
interface Config { profiles: Profile[]; activeProfileId: string }

const KEY = 'portfolioConfig.v1';
const SHEET_ID = /^[A-Za-z0-9_-]{20,}$/;

function read(): Config | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw) return null;
    if (Array.isArray(raw.profiles)) return raw;
    // the original single-profile shape
    if (raw.sheetId) return { profiles: [{ id: 'p1', profileName: raw.profileName || 'Portfolio', ...raw }], activeProfileId: 'p1' };
  } catch { /* unreadable storage reads as "not set up" */ }
  return null;
}

/** `?sheet=<id>&name=<name>` opens someone's sheet read-only without touching saved profiles. */
function linkProfile(): Profile | null {
  const sp = new URLSearchParams(location.search);
  const id = sp.get('sheet');
  if (!id || !SHEET_ID.test(id)) return null;
  return { id: 'link', profileName: sp.get('name') || 'Portfolio', sheetId: id, ephemeral: true };
}

export function listProfiles(): Profile[] {
  const link = linkProfile();
  return [...(link ? [link] : []), ...(read()?.profiles || [])];
}

export function activeProfile(): Profile | null {
  const link = linkProfile();
  if (link) return link;
  const cfg = read();
  return cfg?.profiles.find(p => p.id === cfg.activeProfileId) || cfg?.profiles[0] || null;
}

export function setActiveProfile(id: string) {
  const cfg = read();
  if (!cfg || !cfg.profiles.some(p => p.id === id)) return;
  localStorage.setItem(KEY, JSON.stringify({ ...cfg, activeProfileId: id }));
}

/** Accepts a bare id or a full Google Sheets URL. */
export function parseSheetId(input: string): string | null {
  const s = input.trim();
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(s);
  const id = m ? m[1] : s;
  return SHEET_ID.test(id) ? id : null;
}

export function addProfile(p: Omit<Profile, 'id'>): Profile {
  const cfg = read() || { profiles: [], activeProfileId: '' };
  const profile = { ...p, id: 'p' + Date.now() };
  localStorage.setItem(KEY, JSON.stringify({ profiles: [...cfg.profiles, profile], activeProfileId: profile.id }));
  return profile;
}

export const canWrite = (p: Profile | null) => !!(p?.recordUrl && p.writeKey);

/** Change a saved account's details in place. */
export function updateProfile(id: string, patch: Omit<Profile, 'id'>): Profile | null {
  const cfg = read();
  if (!cfg || !cfg.profiles.some(p => p.id === id)) return null;
  const next = { ...cfg.profiles.find(p => p.id === id)!, ...patch, id };
  localStorage.setItem(KEY, JSON.stringify({ ...cfg, profiles: cfg.profiles.map(p => p.id === id ? next : p) }));
  return next;
}

/** Forget an account on this device. The sheet itself is untouched. Returns the account to show next, if any. */
export function removeProfile(id: string): Profile | null {
  const cfg = read();
  if (!cfg) return null;
  const profiles = cfg.profiles.filter(p => p.id !== id);
  const active = cfg.activeProfileId === id ? profiles[0]?.id ?? '' : cfg.activeProfileId;
  localStorage.setItem(KEY, JSON.stringify({ profiles, activeProfileId: active }));
  return profiles.find(p => p.id === active) ?? null;
}
