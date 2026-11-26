// Every localStorage read and write lives here; a private window or blocked storage must never break the app.
const SETTINGS = 'ts.settings.v1';
const PROGRESS = 'ts.progress.v1';

// Mirrors A/data/SettingsRepository.kt; uiLang null = the browser's language.
export const DEFAULT_SETTINGS = Object.freeze({
  uiLang: null,
  languages: [],
  speed: 1,
  skipBackSeconds: 10,
  autoPlay: false,
  arrivalDistanceM: 25,
  keepScreenOnWalking: true,
  exploreAsMap: false,
  locationAsked: false,
  autoPlayOffered: false,
  onboardingDone: false,
});

const listeners = new Set();
let migrated = false;

const ls = () => globalThis.localStorage;

function read(key) {
  try {
    return JSON.parse(ls().getItem(key)) ?? null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    ls().setItem(key, JSON.stringify(value));
  } catch { /* storage full or blocked */ }
}

function emit(kind) {
  for (const fn of [...listeners]) fn({ kind });
}

/** One-time move of the old per-tour `${id}_stop_no` keys; drops uiLang, theme and filter-*. */
export function migrate() {
  if (migrated) return;
  migrated = true;
  try {
    const s = ls();
    if (!s) return;
    const keys = [];
    for (let i = 0; i < s.length; i++) keys.push(s.key(i));
    const progress = read(PROGRESS) ?? {};
    let changed = false;
    for (const k of keys) {
      const m = /^(.+)_stop_no$/.exec(k);
      if (m) {
        const n = Number(s.getItem(k));
        if (!progress[m[1]] && Number.isInteger(n) && n >= 0) {
          progress[m[1]] = { stopIndex: n, positionMs: 0, order: null, lastCompletedIndex: null, finished: false, closed: false, updatedAt: 0 };
          changed = true;
        }
        s.removeItem(k);
      } else if (k === 'uiLang' || k === 'theme' || k.startsWith('filter-')) {
        s.removeItem(k);
      }
    }
    if (changed) write(PROGRESS, progress);
  } catch { /* storage blocked */ }
}

export function getSettings() {
  migrate();
  return { ...DEFAULT_SETTINGS, ...(read(SETTINGS) ?? {}) };
}

export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write(SETTINGS, next);
  emit('settings');
  return next;
}

export function allProgress() {
  migrate();
  return read(PROGRESS) ?? {};
}

export function getProgress(id) {
  return allProgress()[id] ?? null;
}

export function setProgress(id, patch) {
  const all = allProgress();
  all[id] = { ...all[id], ...patch, updatedAt: Date.now() };
  write(PROGRESS, all);
  emit('progress');
  return all[id];
}

export function clearProgress(id) {
  const all = allProgress();
  delete all[id];
  write(PROGRESS, all);
  emit('progress');
}

/** A/data/ProgressStore.kt `latest`: the newest unfinished tour, or null once the walker closed it. */
export function latest() {
  let best = null;
  for (const [tourId, p] of Object.entries(allProgress())) {
    if (p.finished) continue;
    if (!best || (p.updatedAt ?? 0) > (best.updatedAt ?? 0)) best = { tourId, ...p };
  }
  return best && !best.closed ? best : null;
}

/** fn({kind: 'settings'|'progress'}) on any change, including other tabs; returns unsubscribe. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === SETTINGS) emit('settings');
    else if (e.key === PROGRESS) emit('progress');
  });
}
