// Port of A/tour/TourScreen.kt: the map with the top bar, banners, map buttons and the three-state stop sheet.
import { t, dir } from '../i18n.js';
import { player } from '../player.js';
import { jumpTo, dismissJumpUndo } from '../jump.js';
import { getSettings, setSettings, subscribe as onStore } from '../store.js';
import { nextId, pos, blazeKind, walkNo } from '../walk.js';
import { distance, duration } from '../format.js';
import * as location from '../location.js';
import * as heading from '../heading.js';
import * as handsfree from '../handsfree.js';
import { fetchFootRoute } from '../route.js';
import { back, navigate } from '../app.js';
import { modalSheet } from '../ui/dialog.js';
import { blaze, icon, esc } from '../ui/marks.js';
import { createTourMap } from '../tour/tour-map.js';
import {
  createSheet, savedSheetState, confirmSwitch, peekHtml, halfHtml, fullHtml, patch, tick, wireScrubbers, playerAction,
} from '../tour/sheet.js';

const { STATUS } = location;
const FRESH = [STATUS.Good, STATUS.Weak, STATUS.Approximate];
const DESKTOP = '(min-width: 840px)';
const CARD_MARGIN = 16;
const CARD_WIDTH = 440;

/** A/tour/TourGeometry.kt showGpsLost: only once a fresh fix was had on this screen. */
export const showGpsLost = (status, hadFreshFix) => status === STATUS.Weak || (status === STATUS.Searching && hadFreshFix);

const isTurned = bearing => Math.abs(((bearing + 540) % 360) - 180) > 1;

export function mount(el, { id, stop }) {
  const fallback = `#/tour/${encodeURIComponent(id)}`;
  el.innerHTML = `<div class="tour">
    <div class="tour__top">
      <button type="button" class="glass-btn ts-glass" data-act="back" aria-label="${esc(t('action_back'))}">${icon('arrow_back', 'msr--mirror')}</button>
      <div class="ts-pill"><span class="t-title-small ts-1line" dir="auto" data-title></span><span class="t-body-small" data-sub></span></div>
      <button type="button" class="glass-btn ts-glass" data-act="list" aria-label="${esc(t('tour_stop_list'))}" disabled>${icon('list', 'msr--mirror')}</button>
    </div>
    <div class="tour__banners" aria-live="polite"></div>
    <section class="tsheet" hidden>
      <div class="visually-hidden" data-sr></div>
      <div class="tsheet__pane" data-pane="peek"></div>
      <div class="tsheet__pane tsheet__pane--half" data-pane="half"></div>
      <div class="tsheet__pane tsheet__pane--full" data-pane="full"></div>
    </section>
    <div class="tour__arrival"></div>
    <div class="tour__fabs" hidden></div>
    <div class="tour__status"></div>
    <div class="tour__map"></div>
  </div>`;
  const root = el.firstElementChild;
  const $ = sel => root.querySelector(sel);
  const sheetEl = $('.tsheet');
  const panes = { peek: $('[data-pane=peek]'), half: $('[data-pane=half]'), full: $('[data-pane=full]') };

  let live = true;
  let failed = false;
  let tourMap = null;
  let sheet = null;
  let loc = location.current();
  let hadFresh = false;
  let online = navigator.onLine !== false;
  let satellite = false;
  let layersOpen = false;
  let bearing = 0;
  let timeLeft = false;
  let route = { busy: false, failed: false, walk: null };
  let failTimer = 0;
  let shownKey = null;
  let shownIndex = null;
  let shownOrder = null;
  let prev = { ended: false, inTeaser: false };
  let closeList = null;

  const desktop = () => matchMedia(DESKTOP).matches;
  const landscape = () => !desktop() && innerWidth > innerHeight;
  const bottomMargin = () => (desktop() ? CARD_MARGIN : 0);
  const ready = () => player.state.tourId === id && player.state.stops.length > 0;
  const topBarBottom = () => $('.tour__top').getBoundingClientRect().bottom;

  /** The map area the top bar and the sheet leave visible. */
  function padding(state = sheet?.state ?? 'collapsed') {
    const top = topBarBottom();
    if (desktop()) {
      const side = CARD_MARGIN * 2 + CARD_WIDTH;
      return { top, bottom: CARD_MARGIN, left: dir() === 'rtl' ? 0 : side, right: dir() === 'rtl' ? side : 0 };
    }
    return { top, bottom: sheet?.anchor(state) ?? 0, left: 0, right: 0 };
  }

  function onSheet({ h, showing, state, moving }) {
    const fromBottom = h + bottomMargin();
    root.style.setProperty('--ts-sheet-h', `${fromBottom}px`);
    root.style.setProperty('--ts-peek-h', `${(sheet?.anchor('collapsed') ?? h) + bottomMargin()}px`);
    document.documentElement.style.setProperty('--snackbar-bottom', `${fromBottom + 12}px`);
    $('.tour__fabs').hidden = !(state === 'collapsed' && showing === 'collapsed' && !moving);
    // Sticky until the window changes: dropping the scrubber shrinks the peek back under the limit.
    if (!timeLeft && sheet && !landscape() && sheet.anchor('collapsed') > innerHeight * 0.4) {
      timeLeft = true;
      queueMicrotask(render);
    }
    const key = `${showing}/${state}`;
    if (key !== shownKey) {
      shownKey = key;
      queueMicrotask(render);
    }
  }

  function setup() {
    sheetEl.hidden = false;
    sheet = createSheet(sheetEl, {
      initial: savedSheetState(),
      geometry: () => ({
        H: innerHeight - 2 * bottomMargin(),
        maxHalf: innerHeight - bottomMargin() - topBarBottom() - 8,
        flat: !desktop(),
      }),
      onChange: onSheet,
    });
    renderSheet();
    sheet.relayout();
    try {
      tourMap = createTourMap($('.tour__map'), {
        onMarker: index => {
          sheet.animateTo('half');
          jumpTo(index);
        },
        onBearing: b => {
          bearing = b;
          const needle = $('.ts-needle');
          if (needle) needle.style.transform = `rotate(${-b}deg)`;
          if (isTurned(b) !== $('.ts-compass')?.hasAttribute('data-turned')) renderFabs();
        },
        onFollowEnd: renderFabs,
      });
    } catch (e) {
      console.error('map', e); // no MapLibre (the CDN failed): the sheet still plays the tour
    }
    const s = player.state;
    tourMap?.setRoute(s.stops, s.order, s.index);
    // A Full sheet hides the map; frame for the collapsed one it steps down to.
    tourMap?.first(s.stops[s.index], padding(sheet.state === 'full' ? 'collapsed' : sheet.state));
    shownIndex = s.index;
    shownOrder = s.order;
    showYou();
  }

  function onStopChange(s) {
    if (s.index === shownIndex && s.order === shownOrder) return;
    const moved = s.index !== shownIndex;
    shownIndex = s.index;
    shownOrder = s.order;
    tourMap?.setRoute(s.stops, s.order, s.index);
    if (!moved) return;
    const st = s.stops[s.index];
    tourMap?.focus(st.lat, st.lon, padding());
    if (route.walk && route.walk.index !== s.index) {
      route.walk = null;
      tourMap?.setWalk(null);
    }
  }

  function showYou() {
    const shown = loc.fix && loc.status !== STATUS.NoPermission && loc.status !== STATUS.Denied;
    tourMap?.you(shown ? loc.fix : null, ![STATUS.Good, STATUS.Approximate].includes(loc.status));
  }

  const ctx = () => ({
    id, s: player.state, settings: getSettings(), hf: handsfree.state, loc, landscape: landscape(), timeLeft,
  });

  function renderSheet() {
    const c = ctx();
    const s = c.s;
    patch(panes.peek, peekHtml(c));
    patch(panes.half, halfHtml(c));
    patch(panes.full, sheet?.showing === 'full' ? fullHtml(c) : '');
    patch($('[data-sr]'), [
      nextId(s.order, s.index + 1) && `<button type="button" data-act="sr-next">${esc(t('tour_next_stop'))}</button>`,
      pos(s.order, s.index + 1) > 0 && `<button type="button" data-act="sr-prev">${esc(t('tour_previous_stop'))}</button>`,
      sheet?.state !== 'full' && `<button type="button" data-act="expand">${esc(t('b_show_more'))}</button>`,
      sheet?.state !== 'collapsed' && `<button type="button" data-act="collapse">${esc(t('tour_collapse'))}</button>`,
    ].filter(Boolean).join(''));
    tick(sheetEl, s);
  }

  function renderFabs() {
    const s = player.state;
    const fix = loc.fix;
    const following = tourMap?.following();
    const turned = isTurned(bearing);
    const shown = route.walk?.index === s.index;
    const fab = (act, ic, label, extra = '') => `<button type="button" class="ts-fab${extra}" data-act="${act}" aria-label="${esc(t(label))}">${ic}</button>`;
    const radio = on => icon(on ? 'radio_button_checked' : 'radio_button_unchecked');
    const html = [
      tourMap && `<div class="ts-layers">${fab('layers', icon('layers', 'msr--fill'), 'map_layers')}${layersOpen ? `<div class="ts-menu" role="menu" aria-label="${esc(t('map_layers'))}">
          <button type="button" role="menuitemradio" aria-checked="${!satellite}" data-act="layer-map">${radio(!satellite)}${esc(t('map_layer_map'))}</button>
          <button type="button" role="menuitemradio" aria-checked="${satellite}" data-act="layer-sat"${online ? '' : ' disabled'}>${radio(satellite)}${esc(t(online ? 'map_layer_satellite' : 'map_satellite_offline'))}</button>
        </div>` : ''}</div>`,
      tourMap && `<button type="button" class="ts-fab ts-compass${following ? ' ts-compass--on' : ''}" data-act="compass"${turned ? ' data-turned' : ''}
          aria-label="${esc(t(following ? 'map_compass_stop' : turned ? 'map_compass_north' : 'map_compass_follow'))}">
          <svg class="ts-needle" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" style="transform: rotate(${-bearing}deg)">
            <path d="M14 0 L19.04 14 L8.96 14 Z" fill="#C8102E"/><path d="M14 28 L19.04 14 L8.96 14 Z" fill="var(--outline)"/></svg></button>`,
      online && fix && loc.status !== STATUS.Denied && fab('route', icon('directions', 'msr--fill'), shown ? 'tour_route_hide' : 'tour_route_there', shown ? ' ts-fab--you' : ''),
      fab('walk', icon('directions_walk', 'msr--mirror msr--fill'), 'tour_walking_mode'),
      loc.status === STATUS.NoPermission || loc.status === STATUS.Denied
        ? `<button type="button" class="ts-locate" data-act="ask-location">${icon('location_on', 'msr--fill')}${esc(t('show_my_location'))}</button>`
        : fix ? fab('me', icon('my_location'), 'center_on_me', ' ts-fab--big ts-fab--you') : '',
    ].filter(Boolean).join('');
    const fabs = $('.tour__fabs');
    fabs.classList.toggle('tour__fabs--row', innerWidth > innerHeight);
    patch(fabs, html);
  }

  function renderBanners() {
    const chip = text => `<div class="ts-chip">${icon('directions')}<span>${esc(text)}</span></div>`;
    const walk = route.walk;
    patch($('.tour__banners'), [
      loc.status === STATUS.Denied && `<div class="ts-banner">${icon('location_off')}<span>${esc(t('web_perm_blocked'))}</span></div>`,
      showGpsLost(loc.status, hadFresh) && `<div class="ts-banner">${icon('gps_off')}<span>${esc(t('tour_gps_lost'))}</span></div>`,
      route.busy ? chip(t('tour_route_finding'))
        : route.failed ? chip(t('tour_route_failed'))
          : walk && walk.index === player.state.index
            ? chip(t('tour_route_result', distance(walk.distanceM), duration(Math.max(1, Math.ceil(walk.durationS / 60)))))
            : '',
    ].filter(Boolean).join(''));
  }

  function render() {
    if (!live) return;
    const status = $('.tour__status');
    if (!ready()) {
      status.hidden = false;
      patch(status, failed
        ? `<div class="ts-failed">${icon('cloud_off')}<p class="t-body-large">${esc(t('tour_load_failed'))}</p>
            <div class="ts-failed__btns"><button type="button" class="btn btn--outlined" data-act="back">${esc(t('action_back'))}</button>
            <button type="button" class="btn btn--filled" data-act="retry">${esc(t('action_retry'))}</button></div></div>`
        : '<div class="spinner" role="progressbar"></div>');
      return;
    }
    status.hidden = true;
    const s = player.state;
    if (!sheet) setup();
    onStopChange(s);
    $('[data-title]').textContent = s.tour?.title ?? '';
    $('[data-sub]').textContent = t('n_of_m', pos(s.order, s.index + 1) + 1, s.stops.length);
    $('[data-act=list]').disabled = false;
    renderSheet();
    renderFabs();
    renderBanners();
  }

  // The bar pulses once when the next stop's teaser starts.
  function pulse() {
    for (const b of root.querySelectorAll('.ts-bar')) {
      b.classList.remove('ts-bar--pulse');
      void b.offsetWidth;
      b.classList.add('ts-bar--pulse');
      b.addEventListener('animationend', () => b.classList.remove('ts-bar--pulse'), { once: true });
    }
  }

  function openList() {
    const s = player.state;
    const box = document.createElement('div');
    box.className = 'ts-list';
    box.innerHTML = `<h2 class="t-title-medium ts-list__head">${esc(t('tour_stop_list'))}</h2><ul>${s.order.map(sid => {
      const cur = sid === s.index + 1;
      return `<li><button type="button" class="ts-list__row${cur ? ' is-current' : ''}" data-id="${sid}"${cur ? ' aria-current="step"' : ''}>
        ${blaze(walkNo(s, sid), blazeKind(s.order, s.index + 1, sid), 30)}<span class="t-title-small ts-2lines" dir="auto">${esc(s.stops[sid - 1].title)}</span></button></li>`;
    }).join('')}</ul>`;
    closeList = modalSheet(box, { label: t('tour_stop_list'), onClose: () => { closeList = null; } });
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      closeList?.();
      sheet.animateTo('half');
      jumpTo(Number(b.dataset.id) - 1);
    });
    box.querySelectorAll('.ts-list__row')[Math.max(0, pos(s.order, s.index + 1) - 2)]?.scrollIntoView({ block: 'start' });
  }

  async function compass() {
    if (tourMap.following()) {
      tourMap.follow(false);
      tourMap.northUp();
    } else if (isTurned(bearing)) {
      tourMap.northUp();
    } else {
      // iOS gives the compass only from a tap.
      if (heading.needsPermission() && !(await heading.requestPermission())) return;
      tourMap.follow(true);
    }
    renderFabs();
  }

  function walkRoute() {
    const s = player.state;
    if (route.walk?.index === s.index) {
      route.walk = null;
      tourMap?.setWalk(null);
      return render();
    }
    if (route.busy || !loc.fix) return undefined;
    const index = s.index;
    const target = s.stops[index];
    route = { busy: true, failed: false, walk: null };
    clearTimeout(failTimer);
    render();
    return fetchFootRoute({ lat: loc.fix.lat, lon: loc.fix.lon }, { lat: target.lat, lon: target.lon })
      .then(r => {
        if (!live || player.state.index !== index) return;
        route.walk = { index, ...r };
        tourMap?.setWalk(r.coords);
        tourMap?.fit(r.coords, padding());
      })
      .catch(() => {
        if (!live) return;
        route.failed = true;
        failTimer = setTimeout(() => { route.failed = false; render(); }, 4000);
      })
      .finally(() => { route.busy = false; render(); });
  }

  const leave = () => (sheet ? sheet.leave(() => back(fallback)) : back(fallback));

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (layersOpen && !e.target.closest('.ts-layers')) {
      layersOpen = false;
      renderFabs();
    }
    if (!b || b.disabled || playerAction(b.dataset.act, b)) return undefined;
    const s = player.state;
    switch (b.dataset.act) {
      case 'back': return leave();
      case 'retry': return load();
      case 'list': return openList();
      case 'half': return sheet.animateTo('half');
      case 'full': return sheet.animateTo('full');
      case 'expand': return sheet.stepUp();
      case 'collapse': return sheet.stepDown();
      case 'map': {
        sheet.animateTo('collapsed');
        const st = s.stops[s.index];
        return tourMap?.focus(st.lat, st.lon, padding('collapsed'));
      }
      case 'layers':
        layersOpen = !layersOpen;
        return renderFabs();
      case 'layer-map':
      case 'layer-sat':
        satellite = b.dataset.act === 'layer-sat';
        tourMap.satellite(satellite);
        layersOpen = false;
        return renderFabs();
      case 'compass': return compass();
      case 'route': return walkRoute();
      case 'walk': return navigate(`#/tour/${encodeURIComponent(id)}/walk`);
      case 'me': return loc.fix && tourMap?.focus(loc.fix.lat, loc.fix.lon, padding());
      case 'ask-location': return handsfree.askLocation();
      default: return undefined;
    }
  });
  wireScrubbers(root);

  const onKey = e => {
    if (e.key === 'Escape' && layersOpen) {
      layersOpen = false;
      renderFabs();
    }
  };
  const onResize = () => {
    timeLeft = false;
    sheet?.relayout();
    render();
  };
  const onOnline = () => {
    online = navigator.onLine !== false;
    if (!online && satellite) {
      satellite = false;
      tourMap?.satellite(false);
    }
    render();
  };
  document.addEventListener('keydown', onKey);
  addEventListener('resize', onResize);
  addEventListener('online', onOnline);
  addEventListener('offline', onOnline);

  const offs = [
    player.on('change', s => {
      if (s.tourId !== id) return;
      if (s.ended && !prev.ended) handsfree.maybeOfferAutoPlay();
      const teaserStarted = s.inTeaser && !prev.inTeaser;
      prev = { ended: s.ended, inTeaser: s.inTeaser };
      render();
      if (teaserStarted) pulse();
    }),
    handsfree.on('change', render),
    onStore(({ kind }) => { if (kind === 'settings') render(); }),
    location.watch(l => {
      loc = l;
      if (FRESH.includes(l.status)) hadFresh = true;
      showYou();
      render();
    }),
  ];
  handsfree.start(id);
  const unmountCard = handsfree.mountArrivalCard($('.tour__arrival'), { docked: false });

  async function load() {
    failed = false;
    render();
    if (!(await confirmSwitch(id))) return live && back(fallback);
    try {
      await player.open(id, { stopId: stop });
      // ?stop picks the stop on entry only; a reload must restore the saved progress instead.
      if (stop && live) history.replaceState(history.state, '', `${fallback}/play`);
    } catch (e) {
      console.error(e);
      failed = true;
    }
    if (!live) return undefined;
    prev = { ended: player.state.ended, inTeaser: player.state.inTeaser };
    render();
    if (ready() && !getSettings().locationAsked) {
      const p = await location.permissionState();
      if (live && p !== 'granted' && p !== 'denied') {
        setSettings({ locationAsked: true });
        handsfree.askLocation();
      }
    }
    return undefined;
  }
  load();

  return () => {
    live = false;
    dismissJumpUndo();
    for (const off of offs) off();
    clearTimeout(failTimer);
    closeList?.();
    unmountCard?.();
    handsfree.stop();
    sheet?.destroy();
    tourMap?.destroy();
    document.removeEventListener('keydown', onKey);
    removeEventListener('resize', onResize);
    removeEventListener('online', onOnline);
    removeEventListener('offline', onOnline);
    document.documentElement.style.removeProperty('--snackbar-bottom');
  };
}
