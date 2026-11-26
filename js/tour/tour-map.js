// Port of A/tour/TourMap.kt and TourGeometry.kt: the full-screen map with the walk's legs and a blaze per stop.
import { createMap, focus as focusMap, setSatellite, addYouDot, whenStyled } from '../map/base.js';
import { groupSharedPoints, shownIndex, toLngLat } from '../geo.js';
import { legInto, blazeKind, pos, walkNumber } from '../walk.js';
import * as heading from '../heading.js';
import { t } from '../i18n.js';
import { blaze, esc } from '../ui/marks.js';

export const STOP_ZOOM = 16.5;
const MIN_FOCUS_ZOOM = 15.5;
// The map is light in both themes, so the route keeps the light palette (A/tour/TourMap.kt).
const CURRENT = '#C8102E';
const AHEAD = '#1D4F9F';

/**
 * The walk into each stop after the first of the order: [{to, kind walked|current|ahead, straight, coords}].
 * The leg into the first stop is never drawn; a leg of one repeated point is dropped.
 */
export function routeLegs(stops, order, currentId) {
  const cur = pos(order, currentId);
  const legs = [];
  for (let i = 1; i < order.length; i++) {
    const leg = legInto(stops, order[i], order[i - 1]);
    const [a, b] = [leg.coords[0], leg.coords.at(-1)];
    if (leg.coords.length === 2 && a[0] === b[0] && a[1] === b[1]) continue;
    legs.push({ to: order[i], kind: i < cur ? 'walked' : i === cur ? 'current' : 'ahead', straight: leg.straight, coords: leg.coords });
  }
  return legs;
}

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const line = coords => ({ type: 'LineString', coordinates: coords.map(toLngLat) });
const EMPTY = { type: 'FeatureCollection', features: [] };

/**
 * el: the container. onMarker(index) on a blaze tap; onBearing(deg) on every turn; onFollowEnd() when a
 * gesture stops follow-heading. Returns the controller.
 */
export function createTourMap(el, { onMarker, onBearing, onFollowEnd }) {
  const map = createMap(el, { rotate: true });
  let ready = false;
  let pendingLegs = null;
  let markers = [];
  let following = false;
  let stopHeading = null;

  whenStyled(map, () => {
    map.addSource('ts-legs', { type: 'geojson', data: EMPTY });
    map.addSource('ts-walk', { type: 'geojson', data: EMPTY });
    const kinds = [['walked', cssVar('--map-walked'), 4], ['ahead', AHEAD, 5], ['current', CURRENT, 5]];
    for (const [kind, color, width] of kinds) {
      for (const dotted of [false, true]) {
        // Ahead legs are always dotted; a straight fallback leg is dotted whatever its kind.
        if (kind === 'ahead' && !dotted) continue;
        map.addLayer({
          id: `ts-leg-${kind}${dotted ? '-dot' : ''}`, type: 'line', source: 'ts-legs',
          filter: kind === 'ahead' ? ['==', ['get', 'kind'], kind] : ['all', ['==', ['get', 'kind'], kind], ['==', ['get', 'straight'], dotted]],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': color, 'line-width': width, ...(dotted ? { 'line-dasharray': [0, 1.8] } : {}) },
        });
      }
    }
    map.addLayer({
      id: 'ts-walk', type: 'line', source: 'ts-walk',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': cssVar('--you'), 'line-width': 5, 'line-dasharray': [2, 1.2] },
    });
    ready = true;
    if (pendingLegs) map.getSource('ts-legs').setData(pendingLegs);
  });
  const you = addYouDot(map);

  map.on('rotate', () => onBearing?.(map.getBearing()));
  map.on('rotatestart', e => { if (e.originalEvent && following) { follow(false); onFollowEnd?.(); } });

  function setRoute(stops, order, index) {
    const fc = {
      type: 'FeatureCollection',
      features: routeLegs(stops, order, index + 1).map(l => ({ type: 'Feature', geometry: line(l.coords), properties: { kind: l.kind, straight: l.straight } })),
    };
    if (ready) map.getSource('ts-legs').setData(fc);
    else pendingLegs = fc;

    if (!markers.length) {
      markers = groupSharedPoints(stops).map(g => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ts-marker';
        btn.addEventListener('click', e => {
          e.stopPropagation();
          onMarker?.(shownIndex(g, btn._current));
        });
        return { g, btn, marker: new maplibregl.Marker({ element: btn, anchor: 'center' }).setLngLat([g.lon, g.lat]).addTo(map) };
      });
    }
    for (const { g, btn } of markers) {
      const shown = shownIndex(g, index);
      const stop = stops[shown];
      const kind = blazeKind(order, index + 1, stop.id);
      const more = g.indices.length - 1;
      const label = t('tour_marker', walkNumber(order, stop.id, stops.length), stop.title);
      btn._current = index;
      btn.setAttribute('aria-label', more ? t('tour_marker_more', label, more) : label);
      btn.innerHTML = `${blaze(walkNumber(order, stop.id, stops.length), kind, kind === 'current' ? 36 : 26)}${more ? `<span class="ts-marker__more">${esc(t('tour_shared_point_more', more))}</span>` : ''}`;
      // The current stop sits on top of its neighbours.
      btn.style.zIndex = kind === 'current' ? 2 : 1;
    }
  }

  function follow(on) {
    following = on;
    stopHeading?.();
    stopHeading = on ? heading.watch(({ heading: h }) => { if (h != null) map.rotateTo(h, { duration: 250 }); }) : null;
  }

  return {
    map,
    setRoute,
    first(stop, padding) {
      map.jumpTo({ center: [stop.lon, stop.lat], zoom: STOP_ZOOM, padding });
    },
    focus(lat, lon, padding) {
      focusMap(map, [lon, lat], Math.max(map.getZoom(), MIN_FOCUS_ZOOM), padding);
    },
    fit(coords, padding) {
      const b = new maplibregl.LngLatBounds();
      for (const p of coords) b.extend(toLngLat(p));
      const side = 96;
      map.fitBounds(b, {
        bearing: map.getBearing(), duration: 600, maxZoom: 18,
        padding: { top: padding.top + side, bottom: padding.bottom + side, left: padding.left + side, right: padding.right + side },
      });
    },
    setWalk(coords) {
      whenStyled(map, () => map.getSource('ts-walk')?.setData(coords?.length >= 2 ? { type: 'Feature', geometry: line(coords), properties: {} } : EMPTY));
    },
    you,
    satellite: on => setSatellite(map, on),
    bearing: () => map.getBearing(),
    northUp: () => map.rotateTo(0, { duration: 300 }),
    follow,
    following: () => following,
    destroy() {
      follow(false);
      map.remove();
    },
  };
}
