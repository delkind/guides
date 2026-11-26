// Port of A/tour/StopBar.kt over the walk order: Previous square and the "Next stop" bar, pinned to the sheet's bottom.
import { t, dir, isolate } from '../i18n.js';
import { distance } from '../format.js';
import { distanceM } from '../geo.js';
import { nextId, prevId, legM, walkNo } from '../walk.js';
import { STATUS, FRESH_MS } from '../location.js';
import { blaze, icon, esc } from '../ui/marks.js';

export const MODE = Object.freeze({ Next: 'Next', SamePlace: 'SamePlace', Queued: 'Queued', PlayNext: 'PlayNext', Last: 'Last' });

/** Tapping the bar starts the next stop rather than keeping the play state. */
export const plays = mode => mode === MODE.PlayNext || mode === MODE.Queued;

/**
 * s: player state {stops, order, index, ended}. autoPlay off makes an ended stop's bar only move on.
 * queuedIndex: handsfree's queued target (0-based) or null.
 */
export function stopBarMode(s, { autoPlay = false, queuedIndex = null } = {}) {
  const next = nextId(s.order, s.index + 1);
  if (!next) return MODE.Last;
  if (s.ended && autoPlay) return MODE.PlayNext;
  if (queuedIndex != null && queuedIndex === next - 1) return MODE.Queued;
  if (legM(s.stops, next, s.index + 1) < 5) return MODE.SamePlace;
  return MODE.Next;
}

/** Live metres to the next stop with a good, fresh fix; null otherwise or when it is here (< 5 m). */
export function nextDistanceM(s, loc, nowMs = Date.now()) {
  const next = nextId(s.order, s.index + 1);
  const fix = loc?.fix;
  if (!next || loc?.status !== STATUS.Good || !fix || nowMs - fix.timeMs > FRESH_MS) return null;
  const stop = s.stops[next - 1];
  const d = distanceM(fix.lat, fix.lon, stop.lat, stop.lon);
  return d >= 5 ? d : null;
}

/**
 * The row, always laid out left to right; only the bar's own text follows the language.
 * ctx: {s, autoPlay, queuedIndex, loc, previous}.
 */
export function stopBarHtml({ s, autoPlay, queuedIndex, loc, previous = true }) {
  const prev = prevId(s.order, s.index + 1);
  const prevStop = prev && s.stops[prev - 1];
  const square = previous && prevStop
    ? `<button type="button" class="ts-square" data-act="bar-prev" aria-label="${esc(t('b_cd_prev', walkNo(s, prev), isolate(prevStop.title)))}">${icon('skip_previous', 'ts-square__icon')}</button>`
    : '';
  const mode = stopBarMode(s, { autoPlay, queuedIndex });
  const next = nextId(s.order, s.index + 1);
  if (mode === MODE.Last) {
    return `<div class="ts-barrow" dir="ltr">${square}<div class="ts-bar ts-bar--last" dir="${dir()}">${esc(t('b_bar_last'))}</div></div>`;
  }
  const stop = s.stops[next - 1];
  const d = nextDistanceM(s, loc);
  const dist = d != null ? isolate(distance(d)) : null;
  const eyebrow = s.inTeaser ? t('next_stop_announcement')
    : mode === MODE.PlayNext ? t('b_bar_play_next')
      : mode === MODE.Queued ? t('b_bar_queued')
        : mode === MODE.SamePlace ? t('b_bar_same_place')
          : dist ? t('b_bar_next', dist) : t('tour_next_stop');
  const title = isolate(stop.title);
  let cd = dist && mode !== MODE.SamePlace ? t('b_cd_next', walkNo(s, next), title, dist) : t('b_cd_next_here', walkNo(s, next), title);
  if (mode === MODE.SamePlace) cd += `, ${t('b_same_place')}`;
  if (mode === MODE.Queued) cd += `, ${t('b_bar_queued')}`;
  return `<div class="ts-barrow" dir="ltr">${square}<button type="button" class="ts-bar${mode === MODE.PlayNext ? ' ts-bar--solid' : ''}"
      data-act="bar-next" data-mode="${mode}" dir="${dir()}" aria-label="${esc(cd)}">
      ${blaze(walkNo(s, next), 'ahead', 26)}
      <span class="ts-bar__text"><span class="ts-bar__eyebrow">${esc(eyebrow)}</span><span class="ts-bar__title" dir="auto">${esc(stop.title)}</span></span>
      ${icon(plays(mode) ? 'play_arrow' : 'skip_next', 'msr--fill')}
    </button></div>`;
}
