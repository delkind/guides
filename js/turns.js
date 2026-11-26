// Pure port of A/tour/WalkRoute.kt (locate/next on the polyline) and A/handsfree/TurnGuide.kt + TurnVoice.kt (TurnCalls,
// step wording, reroute backoff). Street names are OSRM's own step names.
import { distanceM } from './geo.js';
import { t as tr } from './i18n.js';

const M_PER_DEG = 111_320;
const KEEP_PAST_M = 50;
export const SAY_WITHIN_M = 25;
const SAME_TURN_M = 15;
const LATE_M = 5;
export const OFF_ROUTE_M = 35;
export const REROUTE_EVERY_MS = 15_000;
export const REROUTE_MAX_MS = 60_000;
// Beyond this a walking time is meaningless: the walker is at home, not on the tour.
export const FAR_FROM_TOUR_M = 20_000;
// A fix this rough would route from the wrong street.
export const ROUTE_MAX_ACCURACY_M = 100;

/** One OSRM maneuver as A/tour/RouteStep: {lat, lon, type, modifier, name}. */
export const routeStep = s => ({
  lat: s.location[0], lon: s.location[1], type: s.maneuver?.type ?? '', modifier: s.maneuver?.modifier ?? null, name: s.name ?? '',
});

/** route.fetchFootRoute's result as a WalkRoute towards stops[stopIndex]. points are [lat, lon]. */
export function walkRoute(stopIndex, { coords, distanceM: dist = 0, durationS = 0, steps = [] }) {
  return makeRoute(stopIndex, coords, steps.map(routeStep), dist, durationS);
}

export function makeRoute(stopIndex, points, steps = [], dist = 0, durationS = 0) {
  const along = [0];
  for (let i = 1; i < points.length; i++) along[i] = along[i - 1] + distanceM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  // OSRM puts every maneuver on a vertex of the route, so the nearest vertex gives its distance along it.
  const stepAlong = steps.map(st => {
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const d = distanceM(p[0], p[1], st.lat, st.lon);
      if (d < bestD) { bestD = d; best = i; }
    });
    return along[best];
  });

  /** [metres from the route, metres along it to the nearest point on it]. Flat-earth, fine at walking scale. */
  function locate(lat, lon) {
    const mx = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
    let best = [Infinity, 0];
    for (let i = 0; i < points.length - 1; i++) {
      const ax = (points[i][1] - lon) * mx;
      const ay = (points[i][0] - lat) * M_PER_DEG;
      const dx = (points[i + 1][1] - lon) * mx - ax;
      const dy = (points[i + 1][0] - lat) * M_PER_DEG - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
      const off = Math.hypot(ax + t * dx, ay + t * dy);
      if (off < best[0]) best = [off, along[i] + t * (along[i + 1] - along[i])];
    }
    return best;
  }

  /**
   * [step, metres to it along the route (negative once past)] for the maneuver the walker heads to or has just made,
   * or null past the last one. A turn stays until KEEP_PAST_M beyond it; the next takes over halfway when closer.
   */
  function next(lat, lon) {
    const at = locate(lat, lon)[1];
    const ahead = steps.map((_, i) => i).filter(i => steps[i].type !== 'depart');
    const k = ahead.findIndex((i, j) => {
      const gap = j + 1 < ahead.length ? stepAlong[ahead[j + 1]] - stepAlong[i] : Infinity;
      return at < stepAlong[i] + Math.min(KEEP_PAST_M, gap / 2);
    });
    if (k < 0) return null;
    const i = ahead[k];
    return [steps[i], stepAlong[i] - at];
  }

  return { stopIndex, points, steps, distanceM: dist, durationS, locate, next };
}

/** Each real turn once, as the walker comes within SAY_WITHIN_M of it. */
export class TurnCalls {
  constructor() {
    this.said = [];
  }

  due(step, metersTo) {
    // Already past it (a route fetched after the corner): saying it now would send the walker back.
    if (step.type === 'arrive' || step.modifier == null || step.modifier === 'straight' || metersTo < -LATE_M || metersTo > SAY_WITHIN_M) return false;
    // A reroute gives the same corner again with slightly different coordinates.
    if (this.said.some(s => distanceM(s.lat, s.lon, step.lat, step.lon) < SAME_TURN_M)) return false;
    this.said.push(step);
    return true;
  }
}

/** The string key of a step's verb (A stepAction). */
export function stepKey(step) {
  if (step.type === 'arrive') return 'step_arrive';
  const m = step.modifier;
  if (m === 'uturn') return 'step_uturn';
  if (m === 'sharp left') return 'step_sharp_left';
  if (m === 'sharp right') return 'step_sharp_right';
  if (m === 'slight left') return 'step_slight_left';
  if (m === 'slight right') return 'step_slight_right';
  if (m === 'left') return 'step_left';
  if (m === 'right') return 'step_right';
  return 'step_straight';
}

/** "Turn left onto Rustaveli Ave"; t is a translator (the UI's by default, the tour language's for speech). */
export function stepText(step, t = tr) {
  const verb = t(stepKey(step));
  return step.name?.trim() && step.type !== 'arrive' ? t('step_onto', verb, step.name) : verb;
}

/** Material Symbol for a step. Never mirrored: left is the walker's left in Hebrew too. */
export const stepIcon = step => ({
  step_arrive: 'flag', step_uturn: 'u_turn_left', step_sharp_left: 'turn_sharp_left', step_sharp_right: 'turn_sharp_right',
  step_slight_left: 'turn_slight_left', step_slight_right: 'turn_slight_right', step_left: 'turn_left', step_right: 'turn_right',
}[stepKey(step)] ?? 'straight');

/**
 * Reroute when the walker is more than max(OFF_ROUTE_M, accuracy) off the route (or has none). Still off after a
 * reroute, each retry waits twice as long, up to REROUTE_MAX_MS.
 */
export class Rerouter {
  constructor() {
    this.lastTry = -Infinity;
    this.wait = REROUTE_EVERY_MS;
  }

  /** route: the current WalkRoute or null; true when a new route should be fetched now. */
  due(route, fix, nowMs) {
    const off = route ? route.locate(fix.lat, fix.lon)[0] > Math.max(OFF_ROUTE_M, fix.accuracy) : true;
    if (!off) {
      this.wait = REROUTE_EVERY_MS;
      return false;
    }
    if (nowMs - this.lastTry < this.wait) return false;
    if (this.lastTry > -Infinity) this.wait = Math.min(this.wait * 2, REROUTE_MAX_MS);
    this.lastTry = nowMs;
    return true;
  }
}
