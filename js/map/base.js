// MapLibre GL JS (global maplibregl, pinned 4.7.1 in the shell) with the OpenFreeMap liberty style.
// The map stays light in dark mode, like the app.
import { lang, dir } from '../i18n.js';
import { toLngLat } from '../geo.js';
import { APPROXIMATE_ACCURACY_M } from '../location.js';

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

// A/map/MapConfig.kt SATELLITE_STYLE_JSON.
const SATELLITE = {
  source: {
    type: 'raster', tileSize: 256, maxzoom: 19,
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  },
  layer: { id: 'ts-satellite', type: 'raster', source: 'ts-satellite' },
};

const baseLayers = new WeakMap();

/** A/map/MapLabels.kt: labels in the app's language, else English, else the local name. */
export function localizeLabels(map, code = lang()) {
  const name = ['coalesce', ['get', `name:${code}`], ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
  for (const l of map.getStyle().layers) {
    if (l.type !== 'symbol') continue;
    const field = map.getLayoutProperty(l.id, 'text-field');
    if (field && JSON.stringify(field).includes('name')) map.setLayoutProperty(l.id, 'text-field', name);
  }
}

/** opts: center [lon, lat], zoom, rotate (two-finger rotation), interactive. */
export function createMap(el, { rotate = false, interactive = true, center = [0, 20], zoom = 1 } = {}) {
  const map = new maplibregl.Map({
    container: el, style: STYLE_URL, center, zoom, interactive,
    attributionControl: false, pitchWithRotate: false, dragRotate: rotate, touchPitch: false, maxPitch: 0,
  });
  if (!rotate) map.touchZoomRotate?.disableRotation();
  map.addControl(new maplibregl.AttributionControl({ compact: true }), dir() === 'rtl' ? 'bottom-right' : 'bottom-left');
  // MapLibre opens the compact credits once they arrive and folds them only on a drag; Android starts folded.
  map.once('idle', () => {
    const credits = el.querySelector('.maplibregl-ctrl-attrib');
    credits?.removeAttribute('open');
    credits?.classList.remove('maplibregl-compact-show');
  });
  map.on('style.load', () => {
    baseLayers.set(map, new Set(map.getStyle().layers.map(l => l.id)));
    localizeLabels(map);
  });
  return map;
}

// Not map.isStyleLoaded(): it turns false while tiles load, long after 'load' fired, and a once('load') then never runs.
export function whenStyled(map, fn) {
  if (baseLayers.has(map)) fn();
  else map.once('style.load', fn);
}

/** Esri World Imagery under every layer the app added (routes, markers, you-dot). */
export function setSatellite(map, on) {
  whenStyled(map, () => {
    if (!on) {
      if (map.getLayer(SATELLITE.layer.id)) map.removeLayer(SATELLITE.layer.id);
      return;
    }
    if (map.getLayer(SATELLITE.layer.id)) return;
    if (!map.getSource(SATELLITE.layer.source)) map.addSource(SATELLITE.layer.source, SATELLITE.source);
    const base = baseLayers.get(map) ?? new Set();
    const firstOwn = map.getStyle().layers.find(l => !base.has(l.id))?.id;
    map.addLayer(SATELLITE.layer, firstOwn);
  });
}

/** Fits [lat, lon] points. padding: a number or {top, bottom, left, right}. */
export function fitPoints(map, pts, padding = 48, { maxZoom = 17, animate = false } = {}) {
  if (!pts.length) return;
  if (pts.length === 1) return focus(map, toLngLat(pts[0]), maxZoom, padding);
  const b = new maplibregl.LngLatBounds();
  for (const p of pts) b.extend(toLngLat(p));
  map.fitBounds(b, { padding, maxZoom, animate });
}

export function focus(map, lngLat, zoom = map.getZoom(), padding = 0) {
  map.easeTo({ center: lngLat, zoom, padding: typeof padding === 'number' ? { top: padding, bottom: padding, left: padding, right: padding } : padding });
}

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function circle([lat, lon], radiusM, steps = 48) {
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + (radiusM * Math.sin(a)) / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + (radiusM * Math.cos(a)) / 110_540]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
}

const EMPTY = { type: 'FeatureCollection', features: [] };

/** The walker's dot. Returns update({lat, lon, accuracy} | null, stale). */
export function addYouDot(map) {
  let pending = null;
  let ready = false;
  whenStyled(map, () => {
    map.addSource('ts-you', { type: 'geojson', data: EMPTY });
    map.addSource('ts-you-acc', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'ts-you-acc-fill', type: 'fill', source: 'ts-you-acc', paint: { 'fill-color': cssVar('--you'), 'fill-opacity': 0.15 } });
    map.addLayer({ id: 'ts-you-acc-line', type: 'line', source: 'ts-you-acc', paint: { 'line-color': cssVar('--you'), 'line-opacity': 0.5, 'line-width': 1 } });
    map.addLayer({ id: 'ts-you-halo', type: 'circle', source: 'ts-you', paint: { 'circle-radius': 18, 'circle-color': cssVar('--you'), 'circle-opacity': 0.18 } });
    map.addLayer({ id: 'ts-you-ring', type: 'circle', source: 'ts-you', paint: { 'circle-radius': 12, 'circle-color': '#ffffff' } });
    map.addLayer({ id: 'ts-you-dot', type: 'circle', source: 'ts-you', paint: { 'circle-radius': 9, 'circle-color': cssVar('--you') } });
    ready = true;
    if (pending) update(...pending);
  });
  function update(fix, stale = false) {
    if (!ready) { pending = [fix, stale]; return; }
    const pt = fix && [fix.lat, fix.lon];
    map.getSource('ts-you').setData(pt ? { type: 'Feature', geometry: { type: 'Point', coordinates: toLngLat(pt) }, properties: {} } : EMPTY);
    map.getSource('ts-you-acc').setData(pt && fix.accuracy > APPROXIMATE_ACCURACY_M ? circle(pt, fix.accuracy) : EMPTY);
    const color = cssVar(stale ? '--done' : '--you');
    map.setPaintProperty('ts-you-dot', 'circle-color', color);
    map.setPaintProperty('ts-you-halo', 'circle-color', color);
    map.setPaintProperty('ts-you-halo', 'circle-radius', stale ? 26 : 18);
  }
  return update;
}
