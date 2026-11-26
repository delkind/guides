// Pure port of A/handsfree/ArrivalEngine.kt. Indices are 0-based stops; "first", "target" and the look-ahead are
// positions in the walk order (player.state.order, 1-based ids), so "next" is the next stop of the walk, not index + 1.
import { distanceM, distanceToLineM } from './geo.js';
import { isOrder, legInto, nextId } from './walk.js';

export const COUNTDOWN_MS = 5_000;
export const LEAVE_MARGIN_M = 20;
export const MAX_FIX_AGE_MS = 20_000;
export const MAX_ACCURACY_M = 50;
export const MIN_ERROR_M = 5;
export const MAX_ERROR_M = 20;
/** Leaving out one or two stops is common, wandering is not. */
export const MAX_SKIPPED = 2;
/** Well past the browser's own retries, so a slow stream is still waited for. */
export const START_TIMEOUT_MS = 60_000;

const IDLE = 'idle';
const COUNTDOWN = 'countdown';
const QUEUED = 'queued';
const DISMISSED = 'dismissed';
const DONE = 'done';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const range = n => Array.from({ length: n }, (_, i) => i + 1);

/** The stop the walker heads to (A PlayerState.headingIndex): the current one while unheard, else the next in the walk. */
export function headingIndex(s) {
  if (!s.playing && !s.positionMs && s.lastCompletedIndex !== s.index) return s.index;
  const n = nextId(s.order, s.index + 1);
  return n ? n - 1 : null;
}

/** The last stop of the walk has played and the player is still on it. */
export const finished = s => s.stops.length > 0 && s.order.at(-1) === s.index + 1 && s.lastCompletedIndex === s.index;

/**
 * input {tourId, stops, order, currentIndex, isPlaying, blocked, lastCompletedIndex, fix {lat, lon, accuracy, timeMs},
 * arrivalDistanceM, nowMs, positionMs}. update() returns {prompt, arrived, start}: prompt {index, deadlineMs, queuedBehind,
 * finishedIndex} is the arrival card; arrived: the walker just entered that stop's ring (vibrate, chime); start: play it now.
 */
export class ArrivalEngine {
  constructor() {
    this.reset();
  }

  /** idle | countdown | queued | dismissed (Done reads as idle). */
  get phase() {
    return this.p === DONE ? IDLE : this.p;
  }

  playNow() {
    if (this.p === COUNTDOWN || this.p === QUEUED) this.playNowRequested = true;
  }

  notYet() {
    if (this.p === COUNTDOWN || this.p === QUEUED) this.p = DISMISSED;
  }

  reset() {
    this.tourId = null;
    this.orderKey = null;
    this.base = -1;
    this.target = -1;
    this.p = IDLE;
    this.deadlineMs = 0;
    this.playNowRequested = false;
    this.startedIndex = -1;
    this.startedAtMs = 0;
    // A countdown that GPS wobble cancelled comes back without a second vibration and chime.
    this.alertedIndex = -1;
  }

  update(input) {
    const current = input.currentIndex;
    if (input.tourId == null) {
      this.reset();
      return out();
    }
    const { stops, fix, nowMs } = input;
    const n = stops.length;
    const order = isOrder(input.order, n) ? input.order : range(n);
    const key = order.join();
    const newWalk = input.tourId !== this.tourId || key !== this.orderKey;
    if (newWalk || current !== this.base) {
      // The player catching up with a stop we started keeps it marked until it has played.
      if (newWalk || current !== this.startedIndex) this.startedIndex = -1;
      this.tourId = input.tourId;
      this.orderKey = key;
      this.base = current;
      this.target = -1;
      this.p = IDLE;
      this.playNowRequested = false;
      this.alertedIndex = -1;
    }
    const at = pos => order[pos] - 1;
    const positionMs = input.positionMs ?? 0;
    const blocked = !!input.blocked;
    // A stop we started may buffer for a long time on a slow connection, and a stop the walker paused part-way is
    // theirs to resume: either way the next stop waits behind it. A started stop that never plays stops holding the
    // walk back after a while.
    const pending = this.startedIndex === current && nowMs - this.startedAtMs < START_TIMEOUT_MS;
    const busy = input.isPlaying || (input.lastCompletedIndex !== current && (positionMs > 0 || pending));
    // One we started that failed is not retried by itself.
    const unheard = !busy && !blocked && input.lastCompletedIndex !== current && this.startedIndex !== current;
    const curPos = order.indexOf(current + 1);
    const first = unheard ? curPos : curPos + 1;
    const last = n - 1;
    if (curPos < 0 || first > last) {
      this.p = IDLE;
      return out();
    }
    if (this.target < first) this.p = IDLE;
    const radius = input.arrivalDistanceM + clamp(fix?.accuracy ?? 0, MIN_ERROR_M, MAX_ERROR_M);
    const distanceOf = i => distanceTo(stops[i], fix, nowMs);
    const distance = pos => distanceOf(at(pos));
    const inRing = pos => { const d = distance(pos); return d != null && d <= radius; };
    // The route into a stop is the leg from the stop before it in the walk; the first stop of the walk has none.
    const onRouteTo = pos => {
      if (pos === 0 || !fix) return false;
      const leg = legInto(stops, order[pos], order[pos - 1]);
      return !leg.straight && distanceToLineM(fix.lat, fix.lon, leg.coords) <= radius;
    };
    // The official route can pass a later stop's ring before the in-order one's (Florian Gate in Kraków), and one
    // wobbly fix can land outside the finished stop's ring: neither is the walker going ahead.
    const mayJumpTo = k => {
      for (let j = Math.max(first - 1, 0); j < k; j++) {
        const d = distance(j);
        if (!(d != null && d > radius + LEAVE_MARGIN_M && (j < first || j === 0 || !onRouteTo(j)))) return false;
      }
      return true;
    };
    // Back in the ring of a stop the countdown would leave out: the jump ahead was a wobble.
    const skipping = this.p === COUNTDOWN || this.p === QUEUED;
    if (skipping && this.target > first) {
      for (let j = Math.max(first - 1, 0); j < this.target; j++) if (inRing(j)) { this.p = IDLE; break; }
    }
    if (this.p === IDLE) {
      const lastCandidate = Math.min(first + MAX_SKIPPED, last);
      this.target = first;
      for (let k = first; k <= lastCandidate; k++) {
        if (inRing(k) && (k === first || mayJumpTo(k))) { this.target = k; break; }
      }
    }
    if (this.alertedIndex >= 0) {
      const d = distanceOf(this.alertedIndex);
      if (d != null && d > radius + LEAVE_MARGIN_M) this.alertedIndex = -1;
    }
    const targetIndex = at(this.target);
    const d = distance(this.target);
    let arrived = null;

    if (this.playNowRequested) {
      this.playNowRequested = false;
      if (this.p === COUNTDOWN || this.p === QUEUED) return this.start(targetIndex, nowMs);
    }
    switch (this.p) {
      case IDLE:
        if (d != null && d <= radius) {
          if (targetIndex !== this.alertedIndex) arrived = targetIndex;
          this.alertedIndex = targetIndex;
          if (busy || blocked) this.p = QUEUED;
          else this.countdown(nowMs);
        }
        break;
      case DISMISSED:
        if (d != null && d > radius + LEAVE_MARGIN_M) this.p = IDLE;
        break;
      // Without a position "You've arrived" is no longer known to be true: withdraw it, re-prompt on return.
      case QUEUED:
        if (d == null) this.p = IDLE;
        else if (!busy && !blocked) this.countdown(nowMs);
        break;
      case COUNTDOWN:
        if (d == null) this.p = IDLE;
        else if (busy || blocked) this.p = QUEUED;
        // One wobbly fix can land in the ring of a walker waiting just outside it: the next fix cancels it.
        else if (d > radius) this.p = IDLE;
        else if (nowMs >= this.deadlineMs) return this.start(targetIndex, nowMs);
        break;
      default:
        break;
    }
    const finishedIndex = input.lastCompletedIndex === current ? current : null;
    let prompt = null;
    if (this.p === COUNTDOWN) prompt = { index: targetIndex, deadlineMs: this.deadlineMs, queuedBehind: null, finishedIndex };
    else if (this.p === QUEUED) prompt = { index: targetIndex, deadlineMs: null, queuedBehind: current, finishedIndex: null };
    return out(prompt, arrived);
  }

  countdown(nowMs) {
    this.p = COUNTDOWN;
    this.deadlineMs = nowMs + COUNTDOWN_MS;
  }

  start(index, nowMs) {
    this.p = DONE;
    this.startedIndex = index;
    this.startedAtMs = nowMs;
    return out(null, null, index);
  }
}

const out = (prompt = null, arrived = null, start = null) => ({ prompt, arrived, start });

/** Null while location is lost or too vague: auto-play then waits silently. */
function distanceTo(stop, fix, nowMs) {
  if (!fix || nowMs - fix.timeMs > MAX_FIX_AGE_MS || fix.accuracy > MAX_ACCURACY_M) return null;
  return distanceM(fix.lat, fix.lon, stop.lat, stop.lon);
}
