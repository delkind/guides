// Pieces the explore package's views share: covers, the search field, a popup menu, stop titles for search,
// nearest-first ordering and location that never prompts by itself.
import { t, lang, addStrings } from '../i18n.js';
import { stops as loadStops, coverUrl } from '../data.js';
import { getSettings } from '../store.js';
import { watch, permissionState, STATUS } from '../location.js';
import { player } from '../player.js';
import { navigate } from '../app.js';
import { show as snackbar } from '../ui/snackbar.js';
import { esc, icon } from '../ui/marks.js';
import { localizedCountry, nearestFirst } from '../explore-filter.js';

// Android's onboarding_body without its offline sentence: the web app has no downloads.
addStrings({
  en: { web_onboarding_body: '%1$d audio tours in %2$d cities, from Kraków and Prague to Tbilisi and Jerusalem.' },
  ru: { web_onboarding_body: '%1$d аудиоэкскурсий в %2$d городах, от Кракова и Праги до Тбилиси и Иерусалима.' },
  he: { web_onboarding_body: '%1$d סיורים קוליים ב־%2$d ערים, מקרקוב ופראג ועד טביליסי וירושלים.' },
});

export const countryName = english => localizedCountry(english, lang());

/** "Russian" in the app's language (A/data/Format.kt languageName). */
export function languageName(code) {
  const key = `language_name_${code}`;
  const s = t(key);
  return s === key ? code : s;
}

export const tourHref = id => `#/tour/${encodeURIComponent(id)}`;
/** Without stopId a new walk starts at the stop nearest the walker. */
export const playHref = (id, stopId) => `${tourHref(id)}/play${stopId ? `?stop=${stopId}` : ''}`;

/**
 * Continue / mini player Play: plays from this tap, then shows the tour. stopId is where saved progress points
 * (the next stop once one has ended). A tour not loaded yet restores its saved position instead of starting at 0.
 */
export async function resumeAndPlay(tourId, stopId) {
  try {
    await (player.state.tourId === tourId ? player.open(tourId, { stopId }) : player.open(tourId));
  } catch {
    snackbar({ text: t(navigator.onLine === false ? 'c_error_offline' : 'c_error_play') });
    return;
  }
  player.play();
  navigate(playHref(tourId, player.state.index + 1));
}

export function cover(tour, cls = '') {
  const src = coverUrl(tour);
  return `<span class="ex-cover ${cls}">${src ? `<img src="${esc(src)}" alt="${esc(tour.cover?.alt ?? '')}" loading="lazy" decoding="async">` : ''}</span>`;
}

export function searchField(query, cls = '') {
  return `<label class="ex-search ${cls}">${icon('search')}
    <input type="search" enterkeyhint="search" autocomplete="off" dir="auto" value="${esc(query)}" placeholder="${esc(t('explore_search_hint'))}" aria-label="${esc(t('explore_search_hint'))}">
    <button type="button" class="icon-btn ex-search__clear" aria-label="${esc(t('explore_clear_search'))}"${query ? '' : ' hidden'}>${icon('close')}</button></label>`;
}

export function wireSearch(root, onQuery) {
  const input = root.querySelector('.ex-search input');
  const clear = root.querySelector('.ex-search__clear');
  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    onQuery(input.value);
  });
  clear.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    onQuery('');
    input.focus();
  });
}

/** Stop titles per tour id, loaded only once the walker searches (one data.js request per tour). */
export const stopTitles = {};
const loading = new Set();

export function loadStopTitles(tours, onLoaded) {
  for (const tour of tours) {
    if (stopTitles[tour.id] || loading.has(tour.id)) continue;
    loading.add(tour.id);
    loadStops(tour.id)
      .then(list => { stopTitles[tour.id] = list.map(s => s.title); onLoaded(); })
      .catch(() => {})
      .finally(() => loading.delete(tour.id));
  }
}

const FRESH = [STATUS.Good, STATUS.Weak, STATUS.Approximate];

/**
 * location.watch, but only where the site already may use location (granted, or asked before where the browser
 * cannot tell): Explore never raises the permission prompt by itself. fn({fix, status}); returns stop().
 */
export function watchIfAllowed(fn) {
  let stop = null;
  let live = true;
  permissionState().then(p => {
    if (live && (p === 'granted' || (p == null && getSettings().locationAsked))) stop = watch(fn);
  });
  return () => { live = false; stop?.(); };
}

export const usableFix = ({ fix, status }) => (fix && FRESH.includes(status) ? fix : null);

/**
 * A city's tours nearest start first, once both a fresh fix and the first stops are known. The order is taken once
 * then, so the list does not shuffle (nor the map renumber) as the walker moves. onChange runs when it is taken.
 */
export function nearest(onChange) {
  let key = null;
  let starts = null;
  let anchor = null;
  let fix = null;
  let stopWatch = null;
  const maybe = () => {
    if (anchor || !starts || !fix) return;
    anchor = fix;
    onChange();
  };
  return {
    order(tours) {
      const k = tours.map(x => x.id).join('\n');
      if (k !== key) {
        key = k;
        starts = null;
        anchor = null;
        if (tours.length) {
          stopWatch ??= watchIfAllowed(snap => { fix = usableFix(snap); maybe(); });
          Promise.all(tours.map(x => loadStops(x.id).then(s => [x.id, [s[0].lat, s[0].lon]]).catch(() => null)))
            .then(pairs => {
              if (k !== key) return;
              starts = Object.fromEntries(pairs.filter(Boolean));
              maybe();
            });
        }
      }
      return anchor && starts ? nearestFirst(tours, starts, anchor) : tours;
    },
    dispose() { stopWatch?.(); key = null; },
  };
}

/** A popup menu under anchor (light dismiss through the popover API). items [{label, value, checked, icon}]. */
export function menu(anchor, items, onPick) {
  const m = document.createElement('div');
  m.className = 'ex-menu';
  m.setAttribute('popover', 'auto');
  m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it, i) => `<button type="button" role="menuitem" class="ex-menu__item" data-i="${i}">
    <span class="ex-menu__lead">${it.checked ? icon('check') : it.icon ? icon(it.icon) : ''}</span><span dir="auto">${esc(it.label)}</span></button>`).join('');
  document.body.append(m);
  m.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    m.hidePopover();
    onPick(items[b.dataset.i].value);
  });
  m.addEventListener('toggle', e => { if (e.newState === 'closed') m.remove(); });
  m.showPopover();
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth;
  const rtl = document.documentElement.dir === 'rtl';
  const x = rtl ? r.right - w : r.left;
  m.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
  const below = r.bottom + 4;
  m.style.top = `${below + m.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - 4 - m.offsetHeight) : below}px`;
  m.querySelector('button')?.focus();
  return m;
}
