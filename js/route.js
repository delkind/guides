// Walking directions from the public OSRM foot server (the endpoint the old map.js used).
const OSRM = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';

/**
 * from/to {lat, lon} → {coords [[lat, lon]], distanceM, durationS, steps [{maneuver, name, distanceM, location [lat, lon]}]}.
 * Throws when offline or when there is no route.
 */
export async function fetchFootRoute(from, to, { signal } = {}) {
  const url = `${OSRM}${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`route: HTTP ${r.status}`);
  const j = await r.json();
  const route = j.routes?.[0];
  if (j.code !== 'Ok' || !route) throw new Error(`route: ${j.code ?? 'no route'}`);
  return {
    coords: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    distanceM: route.distance,
    durationS: route.duration,
    steps: (route.legs ?? []).flatMap(l => l.steps ?? []).map(s => ({
      maneuver: s.maneuver,
      name: s.name ?? '',
      distanceM: s.distance,
      location: [s.maneuver.location[1], s.maneuver.location[0]],
    })),
  };
}
