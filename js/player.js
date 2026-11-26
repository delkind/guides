// The one <audio id=player> (iOS unlocks only that element). Port of A/playback/TourPlayer.kt semantics:
// playback pauses at the end of every stop; in the new format the next stop's teaser plays first.
import { stops as loadStops, tour as loadTour, mediaUrl } from './data.js';
import { getSettings, setSettings, getProgress, setProgress } from './store.js';
import { walkOrder, isOrder, nextId, teaserAudio, nearestStopId } from './walk.js';
import { freshFix } from './location.js';
import { FAR_FROM_TOUR_M } from './turns.js';
import { t } from './i18n.js';
import { show as snackbar } from './ui/snackbar.js';

export const SPEEDS = [0.8, 1, 1.2, 1.5];
export const nextSpeed = s => SPEEDS.find(x => x > s + 0.01) ?? SPEEDS[0];
const SAVE_EVERY_MS = 10_000;
// Enough for a phone that just had a fix; without one the walk starts at stop 1 rather than wait.
const NEAREST_WAIT_MS = 3_000;

const IDLE = Object.freeze({
  tourId: null, tour: null, stops: [], order: [], index: 0, playing: false, positionMs: 0, durationMs: 0,
  ended: false, inTeaser: false, speed: 1, lastCompletedIndex: null, error: null,
});

/** Progress for a state: once the narration is over (teaser or ended) it points at the next stop, at 0. */
export function progressOf(s) {
  if (s.ended || s.inTeaser) {
    const n = nextId(s.order, s.index + 1);
    return n
      ? { stopIndex: n - 1, positionMs: 0, lastCompletedIndex: s.index, finished: false }
      : { stopIndex: s.index, positionMs: 0, lastCompletedIndex: s.index, finished: true };
  }
  return { stopIndex: s.index, positionMs: Math.round(s.positionMs), lastCompletedIndex: s.lastCompletedIndex, finished: false };
}

/** The URL of what plays after the narration of stops[index]: the next stop's teaser, or null. */
export function afterNarration(tourId, stops, order, index) {
  const a = teaserAudio(stops, order, index + 1);
  return a ? mediaUrl(tourId, a) : null;
}

/** Where open() lands. A walk's order is chosen when it starts; a stored one is kept. */
export function startPoint(stops, progress, stopId) {
  const n = stops.length;
  const clamp = i => Math.min(Math.max(0, i | 0), n - 1);
  const p = progress && !progress.finished ? progress : null;
  const kept = p && isOrder(p.order, n) ? p.order : null;
  if (stopId) {
    const index = clamp(stopId - 1);
    return { index, positionMs: p && clamp(p.stopIndex) === index ? p.positionMs ?? 0 : 0, order: kept ?? walkOrder(stops, index + 1), lastCompletedIndex: p?.lastCompletedIndex ?? null };
  }
  if (p) return { index: clamp(p.stopIndex), positionMs: p.positionMs ?? 0, order: kept ?? walkOrder(stops, 1), lastCompletedIndex: p.lastCompletedIndex ?? null };
  return { index: 0, positionMs: 0, order: walkOrder(stops, 1), lastCompletedIndex: null };
}

const listeners = new Set();
let el = null;
let srcKind = null; // 'narration' | 'teaser'
let narrationMs = 0;
let lastSave = 0;
let loadToken = 0;
let openToken = 0;
let replaying = false; // a replay plays the narration only

function set(patch) {
  player.state = { ...player.state, ...patch };
  for (const fn of [...listeners]) fn(player.state);
}

function save(extra = {}) {
  const s = player.state;
  if (!s.tourId) return;
  lastSave = Date.now();
  setProgress(s.tourId, { ...progressOf(s), order: s.order, closed: false, ...extra });
}

function loadNarration(index, positionMs = 0) {
  const a = audio();
  const s = player.state;
  const token = ++loadToken;
  srcKind = 'narration';
  narrationMs = 0;
  a.src = mediaUrl(s.tourId, s.stops[index].audio);
  a.defaultPlaybackRate = a.playbackRate = s.speed;
  if (positionMs > 0) {
    const seek = () => { if (token === loadToken) a.currentTime = positionMs / 1000; };
    if (a.readyState >= 1) seek(); else a.addEventListener('loadedmetadata', seek, { once: true });
  }
}

function finishStop() {
  const s = player.state;
  if (!s.tourId || s.ended) return;
  replaying = false;
  set({ inTeaser: false, ended: true, playing: false, positionMs: narrationMs, durationMs: narrationMs, lastCompletedIndex: s.index });
  if (!el.paused) el.pause();
  save();
  updateMeta();
}

function onEnded() {
  const s = player.state;
  if (!s.tourId) return;
  if (srcKind === 'teaser' || replaying) return finishStop();
  const url = afterNarration(s.tourId, s.stops, s.order, s.index);
  if (!url) return finishStop();
  srcKind = 'teaser';
  ++loadToken;
  set({ inTeaser: true, lastCompletedIndex: s.index, positionMs: 0, durationMs: 0 });
  el.src = url;
  el.defaultPlaybackRate = el.playbackRate = s.speed;
  el.play().catch(() => finishStop());
  save();
  updateMeta();
}

function onError() {
  const s = player.state;
  if (!s.tourId || !el.getAttribute('src')) return;
  if (srcKind === 'teaser') return finishStop(); // a missing teaser never blocks the walk
  set({ error: el.error?.code ?? 0, playing: false });
  snackbar({ text: t(navigator.onLine === false ? 'c_error_offline' : 'c_error_play') });
}

function positionState() {
  try {
    const s = player.state;
    if (s.durationMs > 0) navigator.mediaSession?.setPositionState({ duration: s.durationMs / 1000, playbackRate: s.speed, position: Math.min(s.positionMs, s.durationMs) / 1000 });
  } catch { /* unsupported */ }
}

function updateMeta() {
  if (!('mediaSession' in navigator)) return;
  const s = player.state;
  const stop = s.stops[s.index];
  if (!s.tourId || !stop) {
    navigator.mediaSession.metadata = null;
    return;
  }
  const next = s.inTeaser ? s.stops[nextId(s.order, s.index + 1) - 1] : null;
  const img = stop.image && new URL(mediaUrl(s.tourId, stop.image.thumb ?? stop.image.src), location.href).href;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: next ? `${t('next_stop_announcement')}: ${next.title}` : stop.title,
    artist: s.tour?.title ?? '',
    album: s.tour?.title ?? '',
    artwork: img ? [{ src: img }] : [],
  });
}

function audio() {
  if (el) return el;
  el = document.getElementById('player');
  el.addEventListener('play', () => { if (player.state.tourId) set({ playing: true, error: null }); });
  el.addEventListener('pause', () => {
    if (!player.state.tourId || el.ended) return; // a natural end: 'ended' follows
    set({ playing: false });
    if (player.state.inTeaser) finishStop();
    else save();
  });
  el.addEventListener('timeupdate', () => {
    const s = player.state;
    if (!s.tourId || s.ended) return;
    set({ positionMs: el.currentTime * 1000 });
    if (s.playing && Date.now() - lastSave >= SAVE_EVERY_MS) save();
  });
  el.addEventListener('durationchange', () => {
    const d = Number.isFinite(el.duration) ? el.duration * 1000 : 0;
    if (!player.state.tourId || player.state.ended) return;
    if (srcKind === 'narration') narrationMs = d;
    set({ durationMs: d });
    positionState();
  });
  el.addEventListener('seeked', positionState);
  el.addEventListener('ended', onEnded);
  el.addEventListener('error', onError);
  addEventListener('pagehide', () => save());
  const handlers = {
    play: () => player.play(),
    pause: () => player.pause(),
    seekbackward: () => player.skipBack(),
    seekto: d => player.seekTo(d.seekTime * 1000),
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { navigator.mediaSession?.setActionHandler(action, fn); } catch { /* unsupported action */ }
  }
  return el;
}

export const player = {
  state: { ...IDLE },

  on(event, fn) {
    if (event !== 'change') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Restores the saved stop and position, or starts a walk at the nearest stop; with stopId, that stop from 0. Never starts playing. */
  async open(tourId, { stopId } = {}) {
    const cur = player.state;
    if (cur.tourId === tourId) {
      if (stopId && stopId - 1 !== cur.index) player.selectStop(stopId - 1);
      return player.state;
    }
    const token = ++openToken;
    const [stops, tour] = await Promise.all([loadStops(tourId), loadTour(tourId).catch(() => null)]);
    if (token !== openToken) return player.state;
    const progress = getProgress(tourId);
    // A new walk starts at the stop nearest the walker.
    const near = stopId || (progress && !progress.finished) ? null : nearestStopId(stops, await freshFix(NEAREST_WAIT_MS), FAR_FROM_TOUR_M);
    if (token !== openToken) return player.state;
    save();
    audio().pause();
    const sp = startPoint(stops, progress, stopId ?? near ?? undefined);
    replaying = false;
    player.state = {
      ...IDLE, tourId, tour, stops, order: sp.order, index: sp.index, positionMs: sp.positionMs,
      speed: getSettings().speed, lastCompletedIndex: sp.lastCompletedIndex,
    };
    loadNarration(sp.index, sp.positionMs);
    save();
    set({});
    updateMeta();
    return player.state;
  },

  /** jump.js calls this for a walker's stop change, the mini player to start the stop it shows. Lands paused at positionMs unless play. */
  selectStop(index, { play = false, positionMs = 0 } = {}) {
    const s = player.state;
    if (!s.tourId || index < 0 || index >= s.stops.length) return;
    if (!audio().paused) el.pause();
    replaying = false;
    set({ index, ended: false, inTeaser: false, playing: false, positionMs, durationMs: 0, error: null });
    loadNarration(index, positionMs);
    save();
    updateMeta();
    if (play) player.play();
  },

  /** At the end of a stop, Play replays it (the narration only). */
  play() {
    const s = player.state;
    if (!s.tourId) return;
    const a = audio();
    if (s.ended || srcKind !== 'narration') {
      replaying = s.ended;
      set({ ended: false, inTeaser: false, positionMs: 0 });
      loadNarration(s.index, 0);
      updateMeta();
    }
    a.play().catch(e => { if (e.name !== 'AbortError') set({ playing: false }); });
  },

  pause() {
    if (player.state.inTeaser) finishStop();
    else el?.pause();
  },

  toggle() {
    if (player.state.playing) player.pause();
    else player.play();
  },

  /** Back by settings.skipBackSeconds; from the teaser's first seconds, back into the narration. */
  skipBack() {
    const s = player.state;
    if (!s.tourId) return;
    const backMs = getSettings().skipBackSeconds * 1000;
    const a = audio();
    if (s.inTeaser && a.currentTime * 1000 < backMs) {
      const wasPlaying = s.playing;
      const into = Math.max(0, narrationMs - (backMs - a.currentTime * 1000));
      set({ inTeaser: false, positionMs: into, durationMs: narrationMs });
      loadNarration(s.index, into);
      updateMeta();
      if (wasPlaying) player.play();
      return;
    }
    player.seekTo(Math.max(0, (s.ended ? narrationMs : a.currentTime * 1000) - backMs));
  },

  seekTo(ms) {
    const s = player.state;
    if (!s.tourId) return;
    if (s.ended) {
      replaying = true;
      set({ ended: false, positionMs: ms });
      loadNarration(s.index, ms);
      updateMeta();
      return;
    }
    audio().currentTime = ms / 1000;
    set({ positionMs: ms });
  },

  /** Global and saved in settings. */
  setSpeed(x) {
    const a = audio();
    a.defaultPlaybackRate = a.playbackRate = x;
    setSettings({ speed: x });
    set({ speed: x });
  },

  cycleSpeed() {
    player.setSpeed(nextSpeed(player.state.speed));
  },

  /** "End tour": the Continue card then leaves this tour out. */
  close() {
    if (!player.state.tourId) return;
    const a = audio();
    a.pause();
    save({ closed: true });
    srcKind = null;
    replaying = false;
    ++loadToken;
    a.removeAttribute('src');
    a.load();
    player.state = { ...IDLE, speed: player.state.speed };
    set({});
    updateMeta();
  },
};
