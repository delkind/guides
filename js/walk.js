// The new data.js format contract. Pure functions; ids are 1-based, indices 0-based.
import { lengthM, distanceM } from './geo.js';

const range = n => Array.from({ length: n }, (_, i) => i + 1);

/** A permutation of 1..n; anything else (a rebuilt tour, old data) is not an order. */
export function isOrder(order, n) {
  return Array.isArray(order) && order.length === n && new Set(order).size === n && order.every(i => Number.isInteger(i) && i >= 1 && i <= n);
}

/** Id of the stop nearest fix, where a walk can start at any stop and the walker is within maxM of it; else null. */
export function nearestStopId(stops, fix, maxM) {
  if (!fix || !stops.length || !stops.every(s => isOrder(s.order, stops.length))) return null;
  let best = null;
  for (const s of stops) {
    const m = distanceM(fix.lat, fix.lon, s.lat, s.lon);
    if (m <= maxM && (!best || m < best.m)) best = { id: s.id, m };
  }
  return best?.id ?? null;
}

/** The best walk starting at startId; 1..n for old data. */
export function walkOrder(stops, startId) {
  const o = stops[startId - 1]?.order;
  return isOrder(o, stops.length) ? o : range(stops.length);
}

export const pos = (order, id) => order.indexOf(id);

/** The 1-based place of stop id in a saved walk (the tour screen's "Stop N of M"); id itself without a valid order. */
export const walkNumber = (order, id, n) => (isOrder(order, n) ? pos(order, id) + 1 : id);
/** The number a stop shows in player state s: its place in the walk, as Android numbers stops. */
export const walkNo = (s, id) => walkNumber(s.order, id, s.stops.length);

export function nextId(order, id) {
  const i = order.indexOf(id);
  return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
}

export function prevId(order, id) {
  const i = order.indexOf(id);
  return i > 0 ? order[i - 1] : null;
}

/** id comes earlier in the walk than currentId. */
export const isDone = (order, currentId, id) => order.indexOf(id) < order.indexOf(currentId);

/** 'current' | 'done' | 'ahead', for ui/marks.js blaze(). */
export const blazeKind = (order, currentId, id) => (id === currentId ? 'current' : isDone(order, currentId, id) ? 'done' : 'ahead');

/** The stop whose route ends in `geometry`: tours are loops, so stop 1's comes from the last. */
export const defaultPrevId = (id, n) => (id === 1 ? n : id - 1);

/** The walking route from fromId into toId: {coords [[lat, lon]], straight}. */
export function legInto(stops, toId, fromId) {
  const to = stops[toId - 1];
  const from = stops[fromId - 1];
  const leg = to.legs?.[fromId];
  if (leg?.length >= 2) return { coords: leg, straight: false };
  if (fromId === defaultPrevId(toId, stops.length) && to.geometry?.length >= 2) return { coords: to.geometry, straight: false };
  return { coords: [[from.lat, from.lon], [to.lat, to.lon]], straight: true };
}

export const legM = (stops, toId, fromId) => lengthM(legInto(stops, toId, fromId).coords);

export const narrationText = stop => stop.narration ?? stop.description;

export function nextTeaser(stops, order, id) {
  const n = nextId(order, id);
  return n ? stops[n - 1].teaser ?? null : null;
}

export function teaserAudio(stops, order, id) {
  const n = nextId(order, id);
  return n ? stops[n - 1].teaser_audio ?? null : null;
}
