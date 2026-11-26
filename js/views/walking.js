// Walking mode #/tour/<id>/walk (A/handsfree/WalkingModeScreen.kt, WalkMap.kt, TurnGuide.kt): the next stop, which
// way and how far, the next turn spoken as the walker nears it, the controls, and the docked arrival card.
import { t, plural, isolate } from '../i18n.js';
import { player } from '../player.js';
import { jumpTo, dismissJumpUndo } from '../jump.js';
import * as location from '../location.js';
import * as compass from '../heading.js';
import { getSettings, setSettings, subscribe as onStore } from '../store.js';
import { distanceM, bearingDeg } from '../geo.js';
import { distance as fmtDistance, etaMinutes, eta, relative, directionKey, clock } from '../format.js';
import { legM, legInto, prevId, walkNo } from '../walk.js';
import { fetchFootRoute } from '../route.js';
import { createMap, addYouDot } from '../map/base.js';
import { esc, icon, blaze } from '../ui/marks.js';
import { back } from '../app.js';
import * as hf from '../handsfree.js';
import { headingIndex, MAX_FIX_AGE_MS } from '../arrival.js';
import { walkRoute, TurnCalls, Rerouter, stepText, stepIcon, FAR_FROM_TOUR_M, ROUTE_MAX_ACCURACY_M } from '../turns.js';

const DIM_AFTER_MS = 30_000;
const WALK_ZOOM = 17;
// Turning a map with every compass reading is wasteful; the camera follows in 5° steps, at most every 250 ms.
const BEARING_STEP = 5;
const CAMERA_EVERY_MS = 250;
const GUIDE_EVERY_MS = 2000;
const { STATUS } = location;

export function mount(el, { id }) {
  el.innerHTML = `<div class="hf-walk">
    <header class="hf-walk__top">
      <button type="button" class="icon-btn" data-act="close" aria-label="${esc(t('action_close'))}">${icon('close')}</button>
      <h1 class="t-title-medium hf-walk__title">${esc(t('walking_title'))}</h1>
      <span class="hf-pill" data-screen hidden>${icon('light_mode', 'mso')}<span>${esc(t('walking_screen_on'))}</span></span>
    </header>
    <div class="hf-walk__next" data-next></div>
    <div class="hf-turn" data-turn hidden></div>
    <div class="hf-walk__centre">
      <div class="hf-walk__map" data-map hidden></div>
      <div class="hf-compass" data-compass hidden></div>
      <div class="hf-walk__nogps" data-nogps hidden></div>
      <p class="t-title-medium hf-walk__calib" data-calib hidden>${esc(t('walking_calibrate'))}</p>
      <button type="button" class="btn btn--tonal hf-walk__use-compass" data-act="compass" hidden>${icon('explore')}${esc(t('web_use_compass'))}</button>
    </div>
    <div class="hf-walk__dist" data-dist hidden><div class="hf-walk__metres tabular" data-metres></div><div class="hf-walk__eta" data-eta></div></div>
    <div class="hf-now" data-now></div>
    <div class="hf-controls" dir="ltr">
      <button type="button" class="hf-ctl hf-ctl--side" data-act="replay">${icon('replay_10')}</button>
      <button type="button" class="hf-ctl hf-ctl--play" data-act="toggle"></button>
      <button type="button" class="hf-ctl hf-ctl--side" data-act="next">${icon('skip_next', 'msr--fill')}</button>
    </div>
    <label class="hf-switch-row"><span dir="auto">${esc(t('walking_autoplay'))}</span><input type="checkbox" role="switch" class="hf-switch" data-auto></label>
    <div class="hf-walk__spacer" data-spacer></div>
  </div>
  <div class="hf-walk__card" data-card hidden></div>
  <div class="hf-dim" data-dim hidden></div>`;
  const $ = sel => el.querySelector(sel);
  const shown = (node, on) => { if (node.hidden === on) node.hidden = !on; };
  const html = (node, s) => { if (node.innerHTML !== s) node.innerHTML = s; };

  let live = true;
  let fix = null;
  let status = location.current().status;
  let head = { heading: null, needsCalibration: false };
  let route = null;
  let routeFor = null;
  let fetching = false;
  let calls = new TurnCalls();
  let rerouter = new Rerouter();
  let say = null;
  let frame = 0;
  let map = null;
  let you = null;
  let nextMarker = null;
  let turnMarker = null;
  let camera = '';

  hf.start(id);
  if (player.state.tourId !== id) player.open(id).catch(() => {});
  const keepOn = () => getSettings().keepScreenOnWalking;
  if (keepOn()) hf.holdWakeLock(true);

  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (live) render(); }); };
  const offs = [
    player.on('change', schedule),
    hf.on('change', schedule),
    location.watch(({ fix: f, status: st }) => { fix = f; status = st; schedule(); }),
    compass.watch(h => { head = { ...h }; schedule(); }),
    onStore(e => {
      if (e.kind !== 'settings') return;
      hf.holdWakeLock(keepOn());
      schedule();
    }),
    hf.mountArrivalCard($('[data-card]'), { docked: true }),
  ];
  addEventListener('online', schedule);
  addEventListener('offline', schedule);

  const tourLang = () => player.state.tour?.language;
  let sayLang = null;

  // ---------------------------------------------------------------- dimming: the first touch only wakes the screen
  let lastTouch = Date.now();
  let dimmed = false;
  let swallowClick = false;
  const dimEl = $('[data-dim]');
  const onDown = e => {
    lastTouch = Date.now();
    if (!dimmed) return;
    dimmed = false;
    shown(dimEl, false);
    swallowClick = true;
    e.preventDefault();
    e.stopPropagation();
  };
  const onClickCapture = e => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  };
  const onKey = () => { lastTouch = Date.now(); if (dimmed) { dimmed = false; shown(dimEl, false); } };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('keydown', onKey, true);
  const dimTimer = setInterval(() => {
    const dim = keepOn() && Date.now() - lastTouch >= DIM_AFTER_MS && document.visibilityState === 'visible';
    if (dim !== dimmed) { dimmed = dim; shown(dimEl, dim); }
  }, 1000);

  // ---------------------------------------------------------------- the turn guide (A TurnGuide.follow)
  function guide() {
    const s = player.state;
    const hi = s.tourId === id ? headingIndex(s) : null;
    if (hi == null) return;
    if (hi !== routeFor) {
      routeFor = hi;
      route = null;
      calls = new TurnCalls();
      rerouter = new Rerouter();
    }
    const now = Date.now();
    const f = fix && now - fix.timeMs <= MAX_FIX_AGE_MS && fix.accuracy <= ROUTE_MAX_ACCURACY_M ? fix : null;
    if (!f) return;
    const target = s.stops[hi];
    if (!fetching && distanceM(f.lat, f.lon, target.lat, target.lon) <= FAR_FROM_TOUR_M && rerouter.due(route, f, now)) {
      fetching = true;
      fetchFootRoute(f, target)
        .then(r => { if (live && routeFor === hi) { route = walkRoute(hi, r); schedule(); } })
        .catch(() => {})
        .finally(() => { fetching = false; });
    }
    // Turns are spoken in the tour's language, which is known once the player has loaded the tour.
    if (tourLang() && tourLang() !== sayLang) {
      sayLang = tourLang();
      say = null;
      hf.tourT(sayLang).then(tr => { if (sayLang === tourLang()) say = tr; });
    }
    const n = route?.next(f.lat, f.lon);
    if (n && calls.due(n[0], n[1])) speak(stepText(n[0], say ?? t));
  }

  function speak(text) {
    const synth = globalThis.speechSynthesis;
    if (!synth || document.visibilityState !== 'visible') return;
    const u = new SpeechSynthesisUtterance(text);
    if (say) u.lang = sayLang;
    synth.cancel();
    synth.speak(u);
  }
  const guideTimer = setInterval(() => { if (live) guide(); }, GUIDE_EVERY_MS);

  // ---------------------------------------------------------------- the map (A WalkMap)
  function ensureMap(f) {
    if (map || typeof maplibregl === 'undefined') return map;
    map = createMap($('[data-map]'), { interactive: false, center: [f.lon, f.lat], zoom: WALK_ZOOM });
    you = addYouDot(map);
    map.on('load', () => {
      // A small map: the attribution starts folded to its (i) button.
      $('[data-map] .maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
      // Under the you-dot.
      const below = map.getLayer('ts-you-acc-fill') ? 'ts-you-acc-fill' : undefined;
      const layout = { 'line-cap': 'round', 'line-join': 'round' };
      map.addSource('hf-walk-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'hf-walk-route-casing', type: 'line', source: 'hf-walk-route', layout, paint: { 'line-color': '#ffffff', 'line-width': 9 } }, below);
      map.addLayer({ id: 'hf-walk-route', type: 'line', source: 'hf-walk-route', layout, paint: { 'line-color': '#1D4F9F', 'line-width': 5 } }, below);
      schedule();
    });
    return map;
  }

  let routeKey = '';
  function drawMap(s, hi, f, step) {
    if (!ensureMap(f)) return false;
    you(f, false);
    const next = s.stops[hi];
    if (!nextMarker) {
      const m = document.createElement('div');
      nextMarker = new maplibregl.Marker({ element: m });
    }
    if (nextMarker._hfId !== next.id) {
      nextMarker.getElement().innerHTML = blaze(walkNo(s, next.id), 'ahead', 30);
      nextMarker._hfId = next.id;
    }
    nextMarker.setLngLat([next.lon, next.lat]).addTo(map);
    const line = route?.stopIndex === hi ? route.points
      : hi !== s.index ? legInto(s.stops, hi + 1, s.index + 1).coords : [[f.lat, f.lon], [next.lat, next.lon]];
    const key = `${hi}|${line.length}|${line[0]}`;
    const src = map.getSource('hf-walk-route');
    if (src && key !== routeKey) {
      routeKey = key;
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line.map(([la, lo]) => [lo, la]) } });
    }
    if (step) {
      if (!turnMarker) {
        const m = document.createElement('div');
        m.className = 'hf-turn-mark';
        turnMarker = new maplibregl.Marker({ element: m });
      }
      turnMarker.getElement().innerHTML = icon(stepIcon(step));
      turnMarker.setLngLat([step.lon, step.lat]).addTo(map);
    } else {
      turnMarker?.remove();
    }
    return true;
  }

  const cameraTimer = setInterval(() => {
    if (!map || $('[data-map]').hidden || !fix) return;
    const b = head.heading != null ? Math.round(head.heading / BEARING_STEP) * BEARING_STEP : fix.heading != null ? Math.round(fix.heading / BEARING_STEP) * BEARING_STEP : null;
    const h = $('[data-map]').clientHeight;
    const k = `${fix.lat},${fix.lon},${b},${h}`;
    if (k === camera) return;
    camera = k;
    // The walker sits low, so most of the map shows what lies ahead.
    map.jumpTo({ center: [fix.lon, fix.lat], zoom: WALK_ZOOM, bearing: b ?? map.getBearing(), padding: { top: h * 0.4, bottom: 0, left: 0, right: 0 } });
  }, CAMERA_EVERY_MS);

  // ---------------------------------------------------------------- compass (offline, A Compass)
  function drawCompass(bearing) {
    const h = head.heading ?? 0;
    const rel = relative(bearing, h);
    return `<span class="hf-compass__n" style="transform: rotate(${-h}deg)"><span>${esc(t('compass_north'))}</span></span>
      <span class="hf-compass__arrow" role="img" aria-label="${esc(t(directionKey(rel)))}" style="transform: rotate(${rel}deg)">${icon('navigation', 'msr--fill')}</span>`;
  }

  // ---------------------------------------------------------------- render
  function render() {
    const s = player.state;
    shown($('[data-screen]'), hf.state.wakeLock);
    const auto = $('[data-auto]');
    auto.checked = getSettings().autoPlay && status !== STATUS.NoPermission && status !== STATUS.Denied;
    // Room for the docked arrival card, so it never covers the controls.
    const card = $('[data-card]');
    $('[data-spacer]').style.height = card.hidden ? '0' : `${card.offsetHeight}px`;
    if (s.tourId !== id || !s.stops.length) return;
    const cur = s.stops[s.index];
    const hi = headingIndex(s);
    const next = hi != null ? s.stops[hi] : null;

    html($('[data-next]'), next
      ? `<p class="t-title-small hf-muted">${esc(t('walking_next_stop'))}</p>
         <div class="hf-walk__next-row">${blaze(walkNo(s, next.id), 'ahead', 44)}<h2 class="t-headline-medium hf-clamp2" dir="auto">${esc(next.title)}</h2></div>`
      : `<h2 class="t-headline-medium">${esc(t('c_walking_last_stop'))}</h2>`);

    const usable = fix && Date.now() - fix.timeMs <= MAX_FIX_AGE_MS ? fix : null;
    const d = next && usable ? distanceM(usable.lat, usable.lon, next.lat, next.lon) : null;
    const bearing = next && usable ? bearingDeg(usable.lat, usable.lon, next.lat, next.lon) : null;
    const step = usable && d != null && d <= FAR_FROM_TOUR_M && route?.stopIndex === hi ? route.next(usable.lat, usable.lon) : null;

    shown($('[data-turn]'), !!step);
    if (step) {
      const [st, m] = step;
      html($('[data-turn]'), `${icon(stepIcon(st), 'hf-turn__icon')}<div><p class="t-title-large" dir="auto">${esc(stepText(st))}</p>${m > 3 ? `<p class="t-body-large">${esc(t('step_in', fmtDistance(m)))}</p>` : ''}</div>`);
    }

    // Centre: the map, the compass offline, or why there is no arrow.
    const mode = !next ? 'none' : bearing == null ? 'nogps' : !navigator.onLine || typeof maplibregl === 'undefined' ? 'compass' : 'map';
    const calibrate = head.heading != null && head.needsCalibration && mode !== 'nogps' && mode !== 'none';
    const mapEl = $('[data-map]');
    const wasHidden = mapEl.hidden;
    shown(mapEl, mode === 'map' && drawMap(s, hi, usable, step?.[0]));
    if (wasHidden && !mapEl.hidden) { map?.resize(); camera = ''; }
    shown($('[data-compass]'), mode === 'compass' && !calibrate);
    if (mode === 'compass') html($('[data-compass]'), drawCompass(bearing));
    shown($('[data-calib]'), calibrate);
    shown($('[data-act=compass]'), mode !== 'none' && mode !== 'nogps' && compass.needsPermission());
    shown($('[data-nogps]'), mode === 'nogps');
    if (mode === 'nogps') {
      const p = prevId(s.order, hi + 1);
      const from = p ? s.stops[p - 1] : cur;
      const minutes = Math.max(1, p ? etaMinutes(legM(s.stops, hi + 1, p)) : 1);
      const reason = status === STATUS.NoPermission
        ? `<p class="hf-muted" dir="auto">${esc(t('walking_need_location'))}</p><button type="button" class="btn btn--filled" data-act="locate">${esc(t('show_my_location'))}</button>`
        : status === STATUS.Denied
          ? `<p class="hf-muted" dir="auto">${esc(t('web_perm_blocked'))}</p>`
          : `<p class="hf-muted" dir="auto">${esc(t('walking_finding_location'))}</p>`;
      html($('[data-nogps]'), `<p class="t-headline-small" dir="auto">${esc(t('walking_no_gps', isolate(next.title), plural('minutes_left', minutes), isolate(from.title)))}</p>${reason}`);
    }

    shown($('[data-dist]'), d != null);
    if (d != null) {
      $('[data-metres]').textContent = fmtDistance(d);
      const e = d > FAR_FROM_TOUR_M ? t('walking_far') : eta(d);
      const h = head.heading;
      $('[data-eta]').textContent = h != null && !head.needsCalibration && d <= FAR_FROM_TOUR_M
        ? t('walking_eta_direction', e, t(directionKey(relative(bearing, h)))) : e;
    }

    const dur = s.durationMs;
    const f = dur > 0 ? Math.min(1, s.positionMs / dur) : 0;
    html($('[data-now]'), `<div class="hf-now__row"><span class="hf-now__title" dir="auto">${esc(t('walking_now_playing', cur.id, cur.title))}</span>
      ${dur > 0 ? `<span class="t-body-small tabular">${esc(t('walking_time_left', clock(dur - s.positionMs)))}</span>` : ''}</div>
      <div class="hf-now__track" dir="ltr"><span class="hf-now__fill" style="width:${(f * 100).toFixed(1)}%"></span><span class="hf-now__thumb" style="left:calc(${(f * 100).toFixed(1)}% - 2px)"></span></div>`);

    const toggle = $('[data-act=toggle]');
    html(toggle, icon(s.playing ? 'pause' : 'play_arrow', 'msr--fill'));
    toggle.setAttribute('aria-label', t(s.playing ? 'action_pause' : 'action_play'));
    $('[data-act=replay]').setAttribute('aria-label', t('tour_skip_back', getSettings().skipBackSeconds));
    const nextBtn = $('[data-act=next]');
    nextBtn.disabled = !next;
    nextBtn.setAttribute('aria-label', !next ? t('tour_next_stop') : d != null
      ? t('b_cd_next', walkNo(s, next.id), isolate(next.title), isolate(fmtDistance(d))) : t('b_cd_next_here', walkNo(s, next.id), isolate(next.title)));
  }

  el.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const s = player.state;
    if (act === 'close') back(`#/tour/${encodeURIComponent(id)}/play`);
    else if (act === 'replay') player.skipBack();
    else if (act === 'toggle') player.toggle();
    else if (act === 'next') {
      const hi = headingIndex(s);
      if (hi === s.index) player.play();
      else if (hi != null) jumpTo(hi, { reason: 'tap' });
    } else if (act === 'locate') hf.askLocation().then(schedule);
    else if (act === 'compass') compass.requestPermission().then(schedule);
  });
  $('[data-auto]').addEventListener('change', e => {
    if (!e.target.checked) setSettings({ autoPlay: false });
    else if (status !== STATUS.NoPermission && status !== STATUS.Denied) setSettings({ autoPlay: true, autoPlayOffered: true });
    else {
      e.target.checked = false;
      hf.openOptIn();
    }
  });

  render();
  return () => {
    live = false;
    dismissJumpUndo();
    cancelAnimationFrame(frame);
    for (const off of offs) off();
    for (const tm of [dimTimer, guideTimer, cameraTimer]) clearInterval(tm);
    removeEventListener('online', schedule);
    removeEventListener('offline', schedule);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('keydown', onKey, true);
    globalThis.speechSynthesis?.cancel();
    map?.remove();
    hf.holdWakeLock(false);
    hf.stop();
  };
}
