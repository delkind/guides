// Port of A/explore/ExploreFilter.kt and MapLayout.kt. Pure: tours are tours.json entries, rects {left, top, right, bottom}.
import { distanceM } from './geo.js';

export const LANGUAGES = ['en', 'ru', 'he'];

/** Lower case without accents, so "krakow" finds "Kraków" and "ojcow" finds "Ojców". */
export const fold = s => String(s ?? '').normalize('NFD').replace(/\p{Mn}+/gu, '').toLowerCase();

/** stopTitles: the tour's stop titles where they are known (loaded for this search). */
export function matches(tour, query, stopTitles = []) {
  const q = fold(query.trim());
  if (!q) return true;
  return [tour.title, tour.city, tour.country, tour.description, ...stopTitles].some(s => fold(s).includes(q));
}

/** f: {query, city, languages}; empty languages means every language. stopTitles: {id: [title]}. */
export function filterTours(tours, { query = '', city = null, languages = [] } = {}, stopTitles = {}) {
  return tours.filter(t =>
    (!languages.length || languages.includes(t.language)) &&
    (city == null || t.city === city) &&
    matches(t, query, stopTitles[t.id] ?? []));
}

/** 'showAllLanguages' when that alone brings tours back, else 'clearFilters'; null for an empty catalogue. */
export function emptyStateFix(tours, f, stopTitles = {}) {
  if (filterTours(tours, { ...f, languages: LANGUAGES }, stopTitles).length) return 'showAllLanguages';
  return tours.length ? 'clearFilters' : null;
}

/** Cities with the most tours first, then by name; inside a city the catalogue order stays. */
export function groupByCity(tours) {
  const by = new Map();
  for (const t of tours) {
    if (!by.has(t.city)) by.set(t.city, { city: t.city, country: t.country, lat: t.city_lat, lon: t.city_lon, tours: [] });
    by.get(t.city).tours.push(t);
  }
  return [...by.values()].sort((a, b) => b.tours.length - a.tours.length || (a.city < b.city ? -1 : a.city > b.city ? 1 : 0));
}

/** Nearest start first; a tour whose start is not known keeps its place, after the rest. firstStops: {id: [lat, lon]}. */
export function nearestFirst(tours, firstStops, fix) {
  const d = t => (firstStops[t.id] ? distanceM(fix.lat, fix.lon, firstStops[t.id][0], firstStops[t.id][1]) : Infinity);
  return tours.map(t => [d(t), t]).sort((a, b) => a[0] - b[0]).map(([, t]) => t);
}

/** The browser's language if tours exist in it, else English; fallback says English was the fallback. */
export function defaultLanguages(browserLang, counts) {
  const code = browserLang === 'iw' ? 'he' : browserLang;
  return (counts[code] ?? 0) > 0 ? { languages: [code], fallback: false } : { languages: ['en'], fallback: true };
}

/** The next language set after tapping code, or null when that would leave none. Empty current = all. */
export function toggleLanguage(current, code) {
  const now = current.length ? current : LANGUAGES;
  const next = now.includes(code) ? now.filter(c => c !== code) : LANGUAGES.filter(c => c === code || now.includes(c));
  return next.length ? next : null;
}

/** Cities near the busiest one: the starting view. Far ones (Tbilisi, Jerusalem) become edge tabs. */
export function homeCities(sections) {
  const a = sections[0];
  return a ? sections.filter(c => distanceM(a.lat, a.lon, c.lat, c.lon) < 1_000_000) : [];
}

export const ROUTE_COLORS = ['#1D4F9F', '#C8102E', '#2E7D32', '#E65100', '#6A1B9A', '#00838F', '#AD1457', '#5D4037'];
export const routeColor = n => ROUTE_COLORS[(n - 1) % ROUTE_COLORS.length];

// tours.json writes the United States as "Usa" (Android matches it as the ISO3 code).
const ALIASES = { usa: 'US', uk: 'GB' };
let regionCodes = null;

/** tours.json names countries in English; this names them in locale where Intl knows the country. */
export function localizedCountry(english, locale) {
  try {
    if (!regionCodes) {
      const en = new Intl.DisplayNames('en', { type: 'region' });
      regionCodes = new Map();
      const A = 65;
      for (let i = 0; i < 26; i++) {
        for (let j = 0; j < 26; j++) {
          const code = String.fromCharCode(A + i, A + j);
          const name = en.of(code);
          if (name && name !== code) regionCodes.set(name.toLowerCase(), code);
        }
      }
    }
    const key = String(english).toLowerCase();
    const code = regionCodes.get(key) ?? ALIASES[key];
    return code ? new Intl.DisplayNames(locale, { type: 'region' }).of(code) : english;
  } catch {
    return english;
  }
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The first candidate rect clear of every taken one, or null. */
export const firstFree = (candidates, taken) => candidates.find(c => !taken.some(r => overlaps(r, c))) ?? null;

/**
 * An edge tab of size {width, height} at x = left, as close as it can be to wanted (its city's direction on screen)
 * inside top..bottom while clear of taken: the wanted spot first, then ever further above and below it. Where the
 * band is full it overlaps rather than disappears.
 */
export function edgeTab(wanted, size, left, top, bottom, step, taken) {
  const maxTop = Math.max(bottom - size.height, top);
  const start = Math.min(Math.max(wanted - size.height / 2, top), maxTop);
  const at = y => ({ left, top: y, right: left + size.width, bottom: y + size.height });
  for (let i = 0; ; i++) {
    const y = start + (i % 2 === 1 ? 1 : -1) * Math.floor((i + 1) / 2) * step;
    if (Math.abs(y - start) > maxTop - top + step) break;
    if (y < top || y > maxTop) continue;
    const r = at(y);
    if (!taken.some(q => overlaps(q, r))) return r;
  }
  return at(start);
}
