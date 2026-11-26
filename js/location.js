// Port of A/location/LocationRules.kt and JumpFilter over navigator.geolocation. A fix is
// {lat, lon, accuracy, heading, speed, timeMs}; status is one of STATUS.
import { distanceM } from './geo.js';

export const STATUS = Object.freeze({
  NoPermission: 'NoPermission', Denied: 'Denied', Searching: 'Searching', Approximate: 'Approximate', Weak: 'Weak', Good: 'Good',
});
export const FRESH_MS = 20_000;
export const WEAK_ACCURACY_M = 50;
// The web has no coarse permission: a fix this rough is what Android calls approximate.
export const APPROXIMATE_ACCURACY_M = 100;

/** perm: 'granted' | 'denied' | 'prompt' | null (unknown). */
export function statusFor(perm, fix, nowMs) {
  if (perm === 'denied') return STATUS.Denied;
  if (!fix && perm !== 'granted') return STATUS.NoPermission;
  if (!fix || nowMs - fix.timeMs > FRESH_MS) return STATUS.Searching;
  if (fix.accuracy > APPROXIMATE_ACCURACY_M) return STATUS.Approximate;
  if (fix.accuracy > WEAK_ACCURACY_M) return STATUS.Weak;
  return STATUS.Good;
}

const SLACK_M = 25;
// Generous for walkers; trams catch up through STALE_MS.
const MAX_SPEED_MPS = 10;
const STALE_MS = 30_000;

/** Drops GPS jumps that last under confirmMs; a return to the old track ends the jump. fix.timeMs drives the clock. */
export class JumpFilter {
  constructor(confirmMs = 10_000) {
    this.confirmMs = confirmMs;
    this.accepted = null;
    this.previous = null;
    this.jumpSince = null;
  }

  accept(f) {
    const prev = this.previous;
    this.previous = f;
    const last = this.accepted;
    if (!last || f.timeMs - last.timeMs > STALE_MS) return this.take(f);
    const since = this.jumpSince;
    if (prev && !plausible(prev, f)) {
      if (since != null && plausible(last, f)) return this.take(f);
      this.jumpSince = f.timeMs;
      return null;
    }
    if (since == null) return this.take(f);
    return f.timeMs - since >= this.confirmMs ? this.take(f) : null;
  }

  take(f) {
    this.accepted = f;
    this.jumpSince = null;
    return f;
  }
}

function plausible(a, b) {
  const dtS = Math.max(0, b.timeMs - a.timeMs) / 1000;
  return distanceM(a.lat, a.lon, b.lat, b.lon) <= SLACK_M + a.accuracy + b.accuracy + MAX_SPEED_MPS * dtS;
}

const geo = () => globalThis.navigator?.geolocation;
const listeners = new Set();
const filter = new JumpFilter();
let fix = null;
let perm = null;
let status = STATUS.NoPermission;
let refs = 0;
let watchId = null;
let ticker = null;

const snapshot = () => ({ fix, status });

function update() {
  status = statusFor(perm, fix, Date.now());
  for (const fn of [...listeners]) fn(snapshot());
}

function onPosition(p) {
  perm = 'granted';
  const c = p.coords;
  const f = filter.accept({
    lat: c.latitude, lon: c.longitude, accuracy: c.accuracy,
    heading: Number.isFinite(c.heading) ? c.heading : null,
    speed: Number.isFinite(c.speed) ? c.speed : null,
    timeMs: p.timestamp || Date.now(),
  });
  if (f) fix = f;
  update();
}

function onError(e) {
  if (e.code === 1) perm = 'denied';
  update();
}

/** Starts (ref-counted) high-accuracy tracking; fn({fix, status}) on every change. Returns stop(). */
export function watch(fn) {
  listeners.add(fn);
  if (refs++ === 0 && geo()) {
    watchId = geo().watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 0 });
    ticker = setInterval(() => { if (statusFor(perm, fix, Date.now()) !== status) update(); }, 5000);
    permissionState();
  }
  fn(snapshot());
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    listeners.delete(fn);
    if (--refs === 0) {
      geo()?.clearWatch(watchId);
      clearInterval(ticker);
      watchId = null;
    }
  };
}

/** Listens without starting tracking (heading.js uses GPS course this way). Returns unsubscribe. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const current = snapshot;

/** One fix, from a user tap: this is what shows the browser's permission prompt. Resolves the status. */
export function request() {
  return new Promise(resolve => {
    if (!geo()) return resolve(status);
    geo().getCurrentPosition(
      p => { onPosition(p); resolve(status); },
      e => { onError(e); resolve(status); },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 10_000 },
    );
  });
}

/** A fix under FRESH_MS old, waiting up to waitMs for one; null without it. Never shows the permission prompt. */
export async function freshFix(waitMs) {
  const fresh = f => f && Date.now() - f.timeMs <= FRESH_MS;
  if (fresh(fix)) return fix;
  if ((await permissionState()) !== 'granted') return null;
  return new Promise(resolve => {
    let stop = null;
    let settled = false;
    const done = f => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // watch() calls back before it returns, so stop may not be set yet.
      queueMicrotask(() => stop?.());
      resolve(f);
    };
    const timer = setTimeout(() => done(null), waitMs);
    stop = watch(s => { if (fresh(s.fix)) done(s.fix); });
  });
}

/** 'granted' | 'denied' | 'prompt', or null where the Permissions API cannot tell (older Safari). */
export async function permissionState() {
  try {
    const r = await navigator.permissions.query({ name: 'geolocation' });
    if (perm !== r.state) { perm = r.state; update(); }
    r.onchange = () => { perm = r.state; update(); };
    return r.state;
  } catch {
    return perm;
  }
}
