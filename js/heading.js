// Compass heading (0 = north, clockwise), ref-counted. Falls back to the GPS course when there is no compass.
import { subscribe as onLocation } from './location.js';

const SMOOTHING = 0.2;
const MIN_CHANGE_DEG = 2;
const COMPASS_STALE_MS = 3000;

/** Signed shortest turn from a to b, in (-180, 180]. */
export function angleDiff(a, b) {
  const d = (((b - a) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

/** Low-pass along the shortest arc. */
export const smooth = (prev, next, k = SMOOTHING) => (prev == null ? next : (prev + k * angleDiff(prev, next) + 360) % 360);

const listeners = new Set();
let refs = 0;
let heading = null;
let emitted = null;
let compassAt = 0;
// Some Android Chrome builds expose requestPermission too, but have the absolute event and need no tap.
const askable = () => typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function' && !('ondeviceorientationabsolute' in window);
let granted = !askable();
let attached = false;
let stopGps = null;

export const state = { heading: null, needsCalibration: false };

function emit() {
  state.heading = heading;
  for (const fn of [...listeners]) fn(state);
}

function feed(deg, fromCompass) {
  if (fromCompass) compassAt = Date.now();
  heading = fromCompass ? smooth(heading, deg) : deg;
  if (emitted == null || Math.abs(angleDiff(emitted, heading)) >= MIN_CHANGE_DEG) {
    emitted = heading;
    emit();
  }
}

function onAbsolute(e) {
  if (e.alpha == null) return;
  feed((360 - e.alpha + (screen.orientation?.angle ?? 0) + 360) % 360, true);
}

function onIos(e) {
  if (e.webkitCompassHeading == null) return;
  const calib = e.webkitCompassAccuracy < 0 || e.webkitCompassAccuracy > 30;
  if (calib !== state.needsCalibration) { state.needsCalibration = calib; emit(); }
  feed(e.webkitCompassHeading, true);
}

function attach() {
  if (attached || !granted || typeof window === 'undefined') return;
  attached = true;
  if ('ondeviceorientationabsolute' in window) addEventListener('deviceorientationabsolute', onAbsolute);
  else addEventListener('deviceorientation', onIos);
  stopGps = onLocation(({ fix }) => {
    if (fix?.heading != null && Date.now() - compassAt > COMPASS_STALE_MS) feed(fix.heading, false);
  });
}

function detach() {
  attached = false;
  removeEventListener('deviceorientationabsolute', onAbsolute);
  removeEventListener('deviceorientation', onIos);
  stopGps?.();
}

/** iOS asks before giving the compass; requestPermission() must then run from a tap. */
export function needsPermission() {
  return askable() && !granted;
}

export async function requestPermission() {
  try {
    granted = (await DeviceOrientationEvent.requestPermission()) === 'granted';
  } catch {
    granted = false;
  }
  if (granted && refs > 0) attach();
  return granted;
}

/** fn({heading, needsCalibration}); returns stop(). */
export function watch(fn) {
  listeners.add(fn);
  if (refs++ === 0) attach();
  if (heading != null) fn(state);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    listeners.delete(fn);
    if (--refs === 0) detach();
  };
}
