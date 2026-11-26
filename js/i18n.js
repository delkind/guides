import { getSettings, setSettings } from './store.js';

export const LANGS = ['en', 'ru', 'he'];

const table = { en: {}, ru: {}, he: {} };
let current = 'en';
const langListeners = new Set();

/** Loads strings.json ({en, ru, he}); app.js fetches it from the versioned URL. */
export function init(strings) {
  addStrings(strings);
}

/** Stage-2 views register their own web-only strings here instead of editing strings.json. */
export function addStrings(extra) {
  for (const l of LANGS) Object.assign(table[l], extra?.[l]);
}

export function browserLang() {
  const nav = globalThis.navigator;
  for (const tag of nav?.languages ?? [nav?.language ?? '']) {
    const c = String(tag).slice(0, 2).toLowerCase();
    const code = c === 'iw' ? 'he' : c;
    if (LANGS.includes(code)) return code;
  }
  return 'en';
}

export const lang = () => current;
export const dir = () => (current === 'he' ? 'rtl' : 'ltr');

/** Resolves the UI language from settings (else the browser) and applies it to <html>. */
export function applyLang(code = getSettings().uiLang) {
  current = LANGS.includes(code) ? code : browserLang();
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current;
    document.documentElement.dir = dir();
  }
  return current;
}

/** Persists the choice and re-renders the current route (app.js listens through onLangChange). */
export function setLang(code) {
  setSettings({ uiLang: LANGS.includes(code) ? code : null });
  applyLang();
  for (const fn of [...langListeners]) fn(current);
}

export function onLangChange(fn) {
  langListeners.add(fn);
  return () => langListeners.delete(fn);
}

export const isolate = s => `⁨${s}⁩`;

function entry(key) {
  return table[current]?.[key] ?? table.en[key];
}

function num(v, digits) {
  return new Intl.NumberFormat(current, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(v);
}

/** Android format specifiers: %1$s %2$d %1$.1f %s %d %%. */
export function format(s, args) {
  let i = 0;
  return s.replace(/%(?:(\d+)\$)?(?:\.(\d+))?([sdf%])/g, (m, pos, prec, type) => {
    if (type === '%') return '%';
    const v = args[pos ? pos - 1 : i++];
    if (type === 'f') return num(Number(v), prec == null ? 6 : Number(prec));
    return String(v ?? '');
  });
}

export function t(key, ...args) {
  const e = entry(key);
  if (e == null) return key;
  return format(typeof e === 'string' ? e : e.other ?? key, args);
}

/** t() in another loaded language (a tour's), falling back to the UI's. */
export function tIn(code, key, ...args) {
  const e = table[code]?.[key];
  return e == null ? t(key, ...args) : format(typeof e === 'string' ? e : e.other ?? key, args);
}

/** plural('stops_count', 3) → "3 stops"; extra args replace the default [n]. */
export function plural(key, n, ...args) {
  const e = entry(key);
  if (e == null) return key;
  const a = args.length ? args : [n];
  if (typeof e === 'string') return format(e, a);
  let cat = 'other';
  try { cat = new Intl.PluralRules(current).select(n); } catch { /* unknown locale */ }
  return format(e[cat] ?? e.other ?? key, a);
}
