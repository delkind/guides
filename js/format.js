// Port of A/data/Format.kt and A/handsfree/WalkMath.kt: every screen says "2 h 25 min", "90 m", "0:56" the same way.
import { t, plural } from './i18n.js';

export const WALK_SPEED_MPS = 1.3;
const NBSP = ' ';

/** Metres under 1 km, rounded to 10 m (at least 10); else kilometres with one decimal. */
export function distance(meters) {
  const s = meters < 1000
    ? t('unit_m', Math.max(10, Math.round(meters / 10) * 10))
    : t('unit_km_decimal', meters / 1000);
  return s.replace(' ', NBSP);
}

export function duration(minutes) {
  return minutes < 60 ? t('unit_min', minutes) : t('unit_h_min', Math.floor(minutes / 60), minutes % 60);
}

export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = n => String(n).padStart(2, '0');
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
    : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** "5 km · 2 h 25 min · 10 stops" from a tours.json entry. */
export function tourMeta(tour) {
  return [t('unit_km', tour.length), duration(tour.duration), plural('stops_count', tour.stops_count)].join(' · ');
}

/** 0 when it is less than a minute's walk. */
export function etaMinutes(meters) {
  const seconds = meters / WALK_SPEED_MPS;
  return seconds < 60 ? 0 : Math.round(seconds / 60);
}

/** "less than a minute" / "about 4 minutes". */
export function eta(meters) {
  const m = etaMinutes(meters);
  return m === 0 ? t('c_walking_under_minute') : plural('walking_eta', m);
}

/** Bearing relative to where the phone points, in (-180, 180]; negative is to the left. */
export function relative(bearingDeg, headingDeg) {
  const r = (((bearingDeg - headingDeg) % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
}

export function directionKey(relativeDeg) {
  const a = Math.abs(relativeDeg);
  const right = relativeDeg > 0;
  if (a <= 20) return 'walking_dir_ahead';
  if (a <= 60) return right ? 'walking_dir_ahead_right' : 'walking_dir_ahead_left';
  if (a <= 120) return right ? 'walking_dir_right' : 'walking_dir_left';
  return 'walking_dir_behind';
}

/** The language's own name ("Русский"), whatever the UI language. */
export function languageName(code) {
  const key = `language_endonym_${code}`;
  const s = t(key);
  return s === key ? code : s;
}
