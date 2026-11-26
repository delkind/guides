// The single-page shell: hash router, bottom bar / navigation rail, mini player. Views export
// mount(el, params) returning unmount().
import { init, applyLang, onLangChange, t } from './i18n.js';
import { getSettings } from './store.js';
import { tour as loadTour } from './data.js';
import { icon, esc } from './ui/marks.js';
import './jump.js'; // media-key previous/next

const VIEWS = {
  explore: () => import('./views/explore.js'),
  mytours: () => import('./views/mytours.js'),
  settings: () => import('./views/settings.js'),
  onboarding: () => import('./views/onboarding.js'),
  'tour-detail': () => import('./views/tour-detail.js'),
  tour: () => import('./views/tour.js'),
  museum: () => import('./views/museum.js'),
  walking: () => import('./views/walking.js'),
  photo: () => import('./views/photo.js'),
  'mini-player': () => import('./views/mini-player.js'),
};

const TABS = [
  ['explore', '#/', 'explore', 'nav_explore'],
  ['mytours', '#/mytours', 'headphones', 'nav_my_tours'],
  ['settings', '#/settings', 'tune', 'nav_settings'],
];

/** '#/tour/x/play?stop=3' → {name: 'tour', params: {id: 'x', stop: 3}, root, overlay}; null for an unknown route. */
export function parseRoute(hash) {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(query);
  const r = (name, params = {}, extra = {}) => ({ name, params, root: false, overlay: false, ...extra });
  if (seg.length === 0) return r('explore', {}, { root: true });
  if (seg.length === 1 && (seg[0] === 'mytours' || seg[0] === 'settings')) return r(seg[0], {}, { root: true });
  if (seg.length === 1 && seg[0] === 'onboarding') return r('onboarding');
  if (seg[0] === 'tour' && seg[1]) {
    const id = seg[1];
    if (seg.length === 2) return r('tour-detail', { id });
    if (seg.length === 3 && seg[2] === 'play') {
      const stop = parseInt(q.get('stop'), 10);
      return r('tour', { id, stop: stop > 0 ? stop : null });
    }
    if (seg.length === 3 && seg[2] === 'walk') return r('walking', { id });
    if (seg.length === 4 && seg[2] === 'photo' && parseInt(seg[3], 10) > 0) return r('photo', { id, stopId: parseInt(seg[3], 10) }, { overlay: true });
  }
  return null;
}

// history.state.n numbers this session's entries, so back() knows whether there is an in-app page to return to.
let prevN = 0;
let replacing = true;

function trackHistory() {
  if (!history.state?.n) history.replaceState({ n: replacing ? Math.max(1, prevN) : prevN + 1 }, '');
  prevN = history.state.n;
  replacing = false;
}

export function navigate(hash, { replace = false } = {}) {
  if (replace) {
    replacing = true;
    location.replace(hash);
  } else {
    location.hash = hash;
  }
}

/** The browser's Back when it stays in the app, else the fallback route. */
export function back(fallback = '#/') {
  if ((history.state?.n ?? 1) > 1) history.back();
  else navigate(fallback, { replace: true });
}

const $ = id => document.getElementById(id);
const slots = { base: null, overlay: null, mini: null };
let token = 0;

async function mountInto(slot, el, name, params, key) {
  slots[slot]?.unmount();
  slots[slot] = { key, unmount: () => {} };
  const current = () => slots[slot]?.key === key;
  let mod;
  try {
    mod = await VIEWS[name]();
  } catch (e) {
    console.error(e);
    if (current()) el.innerHTML = `<div class="notice">${esc(t('c_error_play'))}</div>`;
    return;
  }
  if (!current()) return;
  el.replaceChildren();
  const unmount = mod.mount(el, params) ?? (() => {});
  slots[slot] = { key, unmount: () => { unmount(); el.replaceChildren(); } };
}

function unmountSlot(slot) {
  slots[slot]?.unmount();
  slots[slot] = null;
}

function renderBar(route) {
  const bar = $('bottom-bar');
  bar.hidden = !route.root;
  document.body.classList.toggle('has-bar', route.root);
  if (!route.root) return;
  bar.innerHTML = `<nav class="nav" aria-label="${esc(t('nav_explore'))}">${TABS.map(([name, href, ic, label]) => `
    <a class="nav__item" href="${href}"${route.name === name ? ' aria-current="page"' : ''}>
      <span class="nav__pill">${icon(ic)}</span><span class="nav__label">${esc(t(label))}</span>
    </a>`).join('')}</nav>`;
}

async function render() {
  const route = parseRoute(location.hash);
  if (!route) return navigate('#/', { replace: true });
  if (route.root && !getSettings().onboardingDone) return navigate('#/onboarding', { replace: true });
  trackHistory();
  const my = ++token;
  renderBar(route);

  if (route.root) {
    if (!slots.mini) mountInto('mini', $('mini-player'), 'mini-player', {}, 'mini');
  } else if (slots.mini) {
    unmountSlot('mini');
  }

  if (route.overlay) {
    if (slots.base?.key.split(':')[1] !== route.params.id) unmountSlot('base');
    $('overlay').hidden = false;
    return mountInto('overlay', $('overlay'), route.name, route.params, `${route.name}:${JSON.stringify(route.params)}`);
  }
  unmountSlot('overlay');
  $('overlay').hidden = true;

  let name = route.name;
  if (name === 'tour') {
    const tour = await loadTour(route.params.id).catch(() => null);
    if (my !== token) return;
    if (tour?.museum_mode) name = 'museum';
  }
  const key = `${name === 'museum' ? 'tour' : name}:${route.params.id ?? ''}:${JSON.stringify(route.params)}`;
  if (slots.base?.key === key) return;
  document.title = t('app_name');
  scrollTo(0, 0);
  return mountInto('base', $('view'), name, route.params, key);
}

function rerenderAll() {
  for (const slot of Object.keys(slots)) unmountSlot(slot);
  render();
}

async function boot() {
  try {
    const r = await fetch(document.documentElement.dataset.strings || 'js/strings.json');
    init(await r.json());
  } catch (e) {
    console.error('strings', e); // keys show instead of text
  }
  applyLang();
  onLangChange(rerenderAll);
  addEventListener('hashchange', render);
  render();
}

if (typeof document !== 'undefined' && document.getElementById('view')) boot();
