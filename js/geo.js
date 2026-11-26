// Port of A/data/Geo.kt, A/tour/TourGeometry.kt and the CityMap cover area. Points are [lat, lon].
const EARTH_RADIUS_M = 6_371_000;
const M_PER_DEG = 111_320;
const rad = d => (d * Math.PI) / 180;

export function distanceM(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing in degrees, 0 = north, clockwise. */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const dLon = rad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function lengthM(path) {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += distanceM(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
  return m;
}

/** Metres from a point to a [lat, lon] polyline; flat-earth, fine for a walking leg. */
export function distanceToLineM(lat, lon, line) {
  const mx = M_PER_DEG * Math.cos(rad(lat));
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const ax = (line[i][1] - lon) * mx;
    const ay = (line[i][0] - lat) * M_PER_DEG;
    const b = line[i + 1];
    const bx = b ? (b[1] - lon) * mx : ax;
    const by = b ? (b[0] - lat) * M_PER_DEG : ay;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Stops at one spot share one marker: [{lat, lon, indices}] with 0-based indices. 1e-5 deg is about a metre. */
export function groupSharedPoints(stops) {
  const groups = new Map();
  stops.forEach((s, i) => {
    const key = `${Math.round(s.lat * 1e5)},${Math.round(s.lon * 1e5)}`;
    if (!groups.has(key)) groups.set(key, { lat: s.lat, lon: s.lon, indices: [] });
    groups.get(key).indices.push(i);
  });
  return [...groups.values()];
}

/** The stop a shared marker shows: the current one when it is in the group. */
export const shownIndex = (group, current) => (group.indices.includes(current) ? current : group.indices[0]);

/** Convex hull of [lat, lon] points, counter-clockwise; under 3 corners when they all lie on one line. */
export function convexHull(points) {
  const seen = new Set();
  const p = points
    .filter(q => { const k = `${q[0]},${q[1]}`; return !seen.has(k) && seen.add(k); })
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const hull = [];
  for (const pass of [p, [...p].reverse()]) {
    const start = hull.length;
    for (const q of pass) {
      while (hull.length >= start + 2 && cross(hull[hull.length - 2], hull[hull.length - 1], q) <= 0) hull.pop();
      hull.push(q);
    }
    hull.pop();
  }
  return hull;
}

export const coverArea = convexHull;

/** Where an area's label goes: its centre of mass, which is inside a convex area. */
export function areaCentre(area) {
  const [oy, ox] = area[0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < area.length; i++) {
    const [y0, x0] = [area[i][0] - oy, area[i][1] - ox];
    const n = area[(i + 1) % area.length];
    const [y1, x1] = [n[0] - oy, n[1] - ox];
    const k = x0 * y1 - x1 * y0;
    a += k;
    cx += (x0 + x1) * k;
    cy += (y0 + y1) * k;
  }
  if (a === 0) {
    const avg = j => area.reduce((s, q) => s + q[j], 0) / area.length;
    return [avg(0), avg(1)];
  }
  return [oy + cy / (3 * a), ox + cx / (3 * a)];
}

/** MapLibre wants [lon, lat]. */
export const toLngLat = ([lat, lon]) => [lon, lat];
