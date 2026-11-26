// Port of A/explore/CityMap.kt: city plates, edge tabs for far cities, and an opened city's tours as areas.
import { t, plural, isolate } from '../i18n.js';
import { stops as loadStops } from '../data.js';
import { tourMeta } from '../format.js';
import { convexHull, areaCentre, toLngLat } from '../geo.js';
import { createMap, addYouDot } from '../map/base.js';
import { STATUS } from '../location.js';
import { getSettings } from '../store.js';
import { esc, icon, plate } from '../ui/marks.js';
import { navigate } from '../app.js';
import { filterTours, groupByCity, homeCities, routeColor, firstFree, edgeTab } from '../explore-filter.js';
import { cover, countryName, languageName, searchField, wireSearch, stopTitles, loadStopTitles, nearest, watchIfAllowed, tourHref } from './explore-ui.js';

const HIDDEN_KEY = 'ts.explore.hidden';
const AROUND_ME_M = 300;
const AREA_OPACITY = 0.25;
const SOURCE = 'ex-areas';
// Survive switching to the list and back, like rememberSaveable.
let allLanguages = false;
let expanded = true;

function readHidden() {
  try { return new Set(JSON.parse(sessionStorage.getItem(HIDDEN_KEY)) ?? []); } catch { return new Set(); }
}
function writeHidden(set) {
  try { sessionStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch { /* blocked */ }
}

/** The ground a walk covers: its stops, its default routes and every leg. */
function areaOf(stops) {
  const pts = [];
  for (const s of stops) {
    pts.push([s.lat, s.lon], ...(s.geometry ?? []));
    for (const leg of Object.values(s.legs ?? {})) pts.push(...leg);
  }
  return convexHull(pts.map(p => [p[0], p[1]]));
}

const mark = (n, cls = '') => `<span class="ex-mark ${cls}" style="background:${routeColor(n)}">${n}</span>`;

export function mount(el, { tours, state, setAsMap }) {
  el.innerHTML = `<div class="ex-map">
    <div class="ex-map__canvas" role="region" aria-label="${esc(t('explore_map_title'))}"></div>
    <div class="ex-map__labels" dir="ltr"></div>
    <div class="ex-map__top">
      ${searchField(state.query, 'ex-search--map')}
      <div class="ex-map__chips"><button type="button" class="chip ex-chip ex-chip--map" data-all></button></div>
    </div>
    <div class="ex-map__fabs"></div>
    <div class="ex-map__bottom">
      <button type="button" class="fab ex-fab ex-fab--inline" data-list>${icon('list', 'msr--mirror')}<span>${esc(t('explore_show_list'))}</span></button>
      <div class="ex-sheet" hidden></div>
    </div>
  </div>`;
  const $ = s => el.querySelector(s);
  const labels = $('.ex-map__labels');
  const home = homeCities(groupByCity(tours));
  const map = createMap($('.ex-map__canvas'), { rotate: false });
  const you = addYouDot(map);
  const near = nearest(() => update());
  const areas = new Map(); // tour id → area, or null while loading
  let hidden = readHidden();
  let view = {}; // what update() derived: cities, matching, open, openTours, routes
  let framedKey = null;
  let located = null;
  let stopLocation = null;
  let raf = 0;
  let live = true;
  // map.isStyleLoaded() turns false while tiles load, long after 'load' fired: keep our own flag.
  let styled = false;
  let pendingAreas = null;

  if (home.length > 1) {
    const b = new maplibregl.LngLatBounds();
    for (const c of home) b.extend([c.lon, c.lat]);
    map.fitBounds(b, { padding: { top: 160, bottom: 160, left: 80, right: 80 }, animate: false });
  } else if (home.length) {
    map.jumpTo({ center: [home[0].lon, home[0].lat], zoom: 9 });
  }

  const insets = () => {
    const top = $('.ex-map__top');
    return { top: top.offsetTop + top.offsetHeight, bottom: $('.ex-map__bottom').offsetHeight, w: labels.clientWidth, h: labels.clientHeight };
  };

  function fitPoints(points) {
    const { top, bottom, h } = insets();
    const b = new maplibregl.LngLatBounds();
    for (const p of points) b.extend(toLngLat(p));
    // On a short screen the sheet and the search bar would leave no room at all.
    const padTop = Math.min(top + 32, h * 0.4);
    const padBottom = Math.min(bottom + 32, Math.max(32, h - padTop - 80));
    map.fitBounds(b, { padding: { top: padTop, bottom: padBottom, left: 32, right: 32 }, duration: 700 });
  }

  function frameCity() {
    const { open, routes } = view;
    const points = routes.flatMap(r => r.area);
    if (new Set(points.map(String)).size < 2) map.flyTo({ center: [open.lon, open.lat], zoom: 12, duration: 700 });
    else fitPoints(points);
  }

  function frameHome() {
    if (home.length > 1) {
      const b = new maplibregl.LngLatBounds();
      for (const c of home) b.extend([c.lon, c.lat]);
      map.fitBounds(b, { padding: { top: 160, bottom: 160, left: 80, right: 80 }, duration: 700 });
    } else if (home.length) {
      map.flyTo({ center: [home[0].lon, home[0].lat], zoom: 9, duration: 700 });
    }
  }

  function setAreas() {
    const shown = view.routes.filter(r => !hidden.has(r.tour.id) && r.area.length >= 3);
    const data = {
      type: 'FeatureCollection',
      features: shown.map(r => ({
        type: 'Feature', properties: { color: routeColor(r.number) },
        geometry: { type: 'Polygon', coordinates: [[...r.area, r.area[0]].map(toLngLat)] },
      })),
    };
    pendingAreas = () => {
      if (!live) return;
      if (map.getSource(SOURCE)) return map.getSource(SOURCE).setData(data);
      map.addSource(SOURCE, { type: 'geojson', data });
      map.addLayer({ id: `${SOURCE}-fill`, type: 'fill', source: SOURCE, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': AREA_OPACITY } });
      map.addLayer({ id: `${SOURCE}-line`, type: 'line', source: SOURCE, layout: { 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 2 } });
    };
    if (styled) pendingAreas();
  }

  function renderLabels() {
    raf = 0;
    const { top, bottom, w, h } = insets();
    const html = [];
    const project = (lat, lon) => map.project([lon, lat]);
    if (view.open) {
      for (const r of view.routes) {
        if (hidden.has(r.tour.id) || !r.area.length) continue;
        const [lat, lon] = areaCentre(r.area);
        const p = project(lat, lon);
        html.push(`<button type="button" class="ex-num" style="left:${p.x}px;top:${p.y}px" data-tour="${esc(r.tour.id)}" aria-label="${esc(r.tour.title)}">${mark(r.number)}</button>`);
      }
      labels.innerHTML = html.join('');
      return;
    }
    // Sizes are estimated, not measured, as on Android: good enough to decide what would overlap.
    const taken = [];
    const off = [];
    for (const city of view.cities) {
      const p = project(city.lat, city.lon);
      if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) {
        off.push([city, p]);
        continue;
      }
      const count = view.matching.get(city.city)?.length || city.tours.length;
      const pw = 60 + city.city.length * 9;
      const rect = { left: p.x - pw / 2, top: p.y - 40, right: p.x + pw / 2, bottom: p.y };
      html.push(`<span class="ex-dot" style="left:${p.x}px;top:${p.y}px"></span>`);
      if (!taken.some(r => r.left < rect.right && rect.left < r.right && r.top < rect.bottom && rect.top < r.bottom)) {
        taken.push(rect);
        html.push(`<button type="button" class="ex-pin" style="left:${p.x}px;top:${p.y - 14}px" data-open="${esc(city.city)}"
          aria-label="${esc(plural('city_tours', count, city.city, count))}">${plate(city.city, true)}<span class="ex-pin__count">${count}</span></button>`);
        continue;
      }
      const label = t('explore_city_count', city.city, count);
      const lw = 16 + label.length * 7;
      const lh = 22;
      const spot = firstFree([
        { left: p.x - 6 - lw, top: p.y - 4 - lh, right: p.x - 6, bottom: p.y - 4 },
        { left: p.x + 6, top: p.y - 4 - lh, right: p.x + 6 + lw, bottom: p.y - 4 },
        { left: p.x - 6 - lw, top: p.y + 4, right: p.x - 6, bottom: p.y + 4 + lh },
        { left: p.x + 6, top: p.y + 4, right: p.x + 6 + lw, bottom: p.y + 4 + lh },
      ], taken);
      if (!spot) continue; // no room at this zoom: the dot stays, and zooming in brings the plate back
      taken.push(spot);
      html.push(`<button type="button" class="ex-count" style="left:${spot.left}px;top:${spot.top}px" data-zoom="${esc(city.city)}"
        aria-label="${esc(t('explore_zoom_to', city.city))}">${esc(label)}</button>`);
    }
    const gap = 12;
    for (const left of [true, false]) {
      off.filter(([, p]) => (p.x < w / 2) === left).sort((a, b) => a[1].y - b[1].y).forEach(([city, p]) => {
        const count = view.matching.get(city.city)?.length || city.tours.length;
        const label = t('explore_city_count', city.city, count);
        const tw = 48 + label.length * 8;
        const spot = edgeTab(p.y, { width: tw, height: 48 + gap }, left ? 0 : w - tw, top + 8, h - bottom, 4, taken);
        taken.push(spot);
        html.push(`<button type="button" class="ex-tab ex-tab--${left ? 'left' : 'right'}" style="top:${spot.top + gap / 2}px" data-fly="${esc(city.city)}">
          ${left ? icon('west') : ''}<span>${esc(label)}</span>${left ? '' : icon('east')}</button>`);
      });
    }
    labels.innerHTML = html.join('');
  }
  const scheduleLabels = () => { if (!raf) raf = requestAnimationFrame(renderLabels); };

  function renderSheet() {
    const sheet = $('.ex-sheet');
    const { open, openTours } = view;
    sheet.hidden = !open;
    if (!open) return sheet.replaceChildren();
    const langs = [...new Set(openTours.map(x => x.language))];
    const country = isolate(countryName(open.country));
    const summary = langs.length === 1
      ? plural('city_tours_in_language', openTours.length, country, openTours.length, languageName(langs[0]))
      : plural('city_tours', openTours.length, country, openTours.length);
    sheet.innerHTML = `<button type="button" class="ex-sheet__handle" aria-expanded="${expanded}"
        aria-label="${esc(t(expanded ? 'city_sheet_collapse' : 'city_sheet_expand'))}"><span></span></button>
      <div class="ex-sheet__head">${plate(open.city, true)}<span class="t-body-medium ex-muted ex-sheet__summary">${esc(summary)}</span>
        <button type="button" class="icon-btn" data-close aria-label="${esc(t('action_close'))}">${icon('close')}</button></div>
      <div class="ex-sheet__actions">
        <button type="button" class="btn btn--text" data-show="1">${icon('visibility')}${esc(t('city_show_all'))}</button>
        <button type="button" class="btn btn--text" data-show="0">${icon('visibility_off')}${esc(t('city_hide_all'))}</button></div>
      <ul class="ex-sheet__list"${expanded ? '' : ' hidden'}>${openTours.map((x, i) => `<li class="ex-sheet__row" data-row="${esc(x.id)}">
        <a class="ex-sheet__link" href="${tourHref(x.id)}">${mark(i + 1, 'ex-mark--row')}${cover(x, 'ex-sheet__cover')}
          <span class="ex-sheet__text"><span class="t-title-medium ex-ellipsis" dir="auto">${esc(x.title)}</span>
          <span class="t-body-small">${esc(tourMeta(x))}</span></span></a>
        <button type="button" class="icon-btn" data-eye="${esc(x.id)}" aria-label="${esc(t('city_tour_on_map', x.title))}"></button></li>`).join('')}</ul>`;
    syncHidden();
  }

  function syncHidden() {
    const sheet = $('.ex-sheet');
    const ids = view.openTours?.map(x => x.id) ?? [];
    sheet.querySelectorAll('[data-row]').forEach(row => {
      const shown = !hidden.has(row.dataset.row);
      row.querySelector('.ex-mark').classList.toggle('ex-mark--hidden', !shown);
      const eye = row.querySelector('[data-eye]');
      eye.setAttribute('aria-pressed', String(shown));
      eye.innerHTML = icon(shown ? 'visibility' : 'visibility_off');
    });
    const all = sheet.querySelector('[data-show="1"]');
    if (!all) return;
    all.disabled = !ids.some(id => hidden.has(id));
    sheet.querySelector('[data-show="0"]').disabled = !ids.some(id => !hidden.has(id));
  }

  function renderFabs() {
    const box = $('.ex-map__fabs');
    box.style.bottom = `${$('.ex-map__bottom').offsetHeight}px`;
    box.innerHTML = view.open ? `${located ? `<button type="button" class="fab ex-fab--surface" data-me aria-label="${esc(t('center_on_me'))}">${icon('my_location', 'ex-you')}</button>` : ''}
      <button type="button" class="fab ex-fab--surface" data-whole aria-label="${esc(t('city_show_whole'))}">${icon('location_city')}</button>` : '';
  }

  function update() {
    if (!live) return;
    const langs = allLanguages ? [] : getSettings().languages;
    if (state.query.trim()) loadStopTitles(tours.filter(x => !langs.length || langs.includes(x.language)), update);
    const anyLanguage = filterTours(tours, { query: state.query }, stopTitles);
    const cities = groupByCity(anyLanguage);
    const matching = new Map(groupByCity(filterTours(anyLanguage, { languages: langs })).map(s => [s.city, s.tours]));
    const open = cities.find(c => c.city === state.city) ?? null;
    const openTours = near.order(open ? matching.get(open.city) ?? [] : []);
    for (const x of openTours) {
      if (areas.has(x.id)) continue;
      areas.set(x.id, null);
      loadStops(x.id).then(s => { areas.set(x.id, areaOf(s)); update(); }).catch(() => areas.delete(x.id));
    }
    const routes = openTours.map((x, i) => ({ tour: x, number: i + 1, area: areas.get(x.id) })).filter(r => r.area);
    view = { cities, matching, open, openTours, routes };

    const chip = $('[data-all]');
    chip.setAttribute('aria-pressed', String(allLanguages));
    chip.innerHTML = `${allLanguages ? icon('check') : ''}${esc(t('filter_all_languages'))}`;
    renderSheet();
    renderFabs();
    setAreas();
    renderLabels();

    if (open && !stopLocation) {
      stopLocation = watchIfAllowed(snap => {
        const had = !!located;
        located = snap.fix;
        you(snap.fix, !(snap.status === STATUS.Good || snap.status === STATUS.Approximate));
        if (had !== !!located) renderFabs();
      });
    } else if (!open && stopLocation) {
      stopLocation();
      stopLocation = null;
      located = null;
      you(null);
    }

    const key = open ? `${open.city}|${routes.map(r => `${r.tour.id}:${r.number}`).join()}` : null;
    if (key !== framedKey) {
      if (key) frameCity(); else if (framedKey) frameHome();
      framedKey = key;
    }
  }

  const openCity = name => {
    if (!view.matching.get(name)?.length) allLanguages = true;
    state.city = name;
    update();
  };
  const closeCity = () => {
    state.city = null;
    update();
  };

  labels.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const city = name => view.cities.find(c => c.city === name);
    if (b.dataset.open) openCity(b.dataset.open);
    else if (b.dataset.zoom) { const c = city(b.dataset.zoom); map.flyTo({ center: [c.lon, c.lat], zoom: map.getZoom() + 2 }); }
    else if (b.dataset.fly) { const c = city(b.dataset.fly); map.flyTo({ center: [c.lon, c.lat], zoom: 9 }); }
    else if (b.dataset.tour) navigate(tourHref(b.dataset.tour));
  });
  $('.ex-sheet').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.close != null) return closeCity();
    if (b.classList.contains('ex-sheet__handle')) {
      expanded = !expanded;
      renderSheet();
      renderFabs();
      return view.open && frameCity();
    }
    const ids = view.openTours.map(x => x.id);
    if (b.dataset.show != null) ids.forEach(id => (b.dataset.show === '1' ? hidden.delete(id) : hidden.add(id)));
    else if (b.dataset.eye) hidden[hidden.has(b.dataset.eye) ? 'delete' : 'add'](b.dataset.eye);
    else return;
    writeHidden(hidden);
    syncHidden();
    setAreas();
    renderLabels();
  });
  $('.ex-map__fabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b?.dataset.whole != null) frameCity();
    else if (b?.dataset.me != null && located) {
      const dLat = AROUND_ME_M / 111_320;
      const dLon = dLat / Math.cos((located.lat * Math.PI) / 180);
      fitPoints([[located.lat - dLat, located.lon - dLon], [located.lat + dLat, located.lon + dLon]]);
    }
  });
  $('[data-all]').addEventListener('click', () => {
    allLanguages = !allLanguages;
    update();
  });
  $('[data-list]').addEventListener('click', () => setAsMap(false));
  wireSearch(el, q => {
    state.query = q;
    update();
  });
  map.on('move', scheduleLabels);
  map.on('resize', scheduleLabels);
  map.once('load', () => {
    styled = true;
    pendingAreas?.();
    scheduleLabels();
  });
  update();

  return () => {
    live = false;
    cancelAnimationFrame(raf);
    near.dispose();
    stopLocation?.();
    map.remove();
  };
}
