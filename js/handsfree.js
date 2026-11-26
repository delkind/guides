// Hands-free (A/handsfree/HandsFree.kt, WalkService.kt, ArrivalCard.kt, AutoPlayOptIn.kt) within web limits: the
// arrival engine runs only while a tour or walking screen has called start(), the page is visible and auto-play is on.
import { player } from './player.js';
import { jumpTo } from './jump.js';
import * as location from './location.js';
import { getSettings, setSettings, subscribe as onStore } from './store.js';
import { t, addStrings, format, isolate } from './i18n.js';
import { mediaUrl } from './data.js';
import { nextId, legInto, pos, walkNo } from './walk.js';
import { ArrivalEngine, COUNTDOWN_MS, finished } from './arrival.js';
import { modalSheet } from './ui/dialog.js';
import { show as snackbar } from './ui/snackbar.js';
import { esc, icon, blaze } from './ui/marks.js';

addStrings({
  en: { web_autoplay_body: 'Auto-play starts the next narration as you reach it.', web_autoplay_turn_on: 'Yes, turn it on' },
  ru: { web_autoplay_body: 'Автозапуск включает следующий рассказ, когда вы подходите.', web_autoplay_turn_on: 'Да, включить' },
  he: { web_autoplay_body: 'הפעלה אוטומטית מתחילה את הקריינות הבאה כשאתם מגיעים.', web_autoplay_turn_on: 'כן, להפעיל' },
});

const { STATUS } = location;
const listeners = new Set();

/** phase: 'idle' | 'countdown' | 'queued' | 'dismissed'; targetIndex: 0-based stop; secondsLeft in the countdown. */
export const state = { phase: 'idle', targetIndex: null, secondsLeft: 0, prompt: null, wakeLock: false };

export function on(event, fn) {
  if (event !== 'change') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of [...listeners]) fn(state);
}

const engine = new ArrivalEngine();
let users = 0;
let tourId = null;
let running = false;
let fix = null;
let stopWatch = null;
let timer = null;
let offPlayer = null;
let offStore = null;
let offLocation = null;
let approximateShown = false;
const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/** Ref-counted: the tour screen and walking mode each start and stop it. */
export function start(id) {
  users++;
  tourId = id;
  if (users === 1) {
    offPlayer = player.on('change', () => {
      sync();
      maybeOfferAutoPlay();
      kick();
    });
    offStore = onStore(e => { if (e.kind === 'settings') sync(); });
    offLocation = location.subscribe(({ status }) => {
      if (status === STATUS.Approximate && !approximateShown) {
        approximateShown = true;
        snackbar({ text: t('location_approximate') });
      }
    });
  }
  sync();
  if (!getSettings().locationAsked) {
    location.permissionState().then(p => {
      if (p !== 'granted' && users > 0 && !getSettings().locationAsked) askLocation();
    });
  }
}

export function stop() {
  if (users === 0 || --users > 0) return;
  for (const off of [offPlayer, offStore, offLocation]) off?.();
  offPlayer = offStore = offLocation = null;
  tourId = null;
  sync();
}

function shouldRun() {
  const s = player.state;
  return users > 0 && visible() && getSettings().autoPlay && s.tourId != null && s.tourId === tourId &&
    !s.tour?.museum_mode && !finished(s);
}

function sync() {
  const run = shouldRun();
  if (run && !running) {
    running = true;
    stopWatch = location.watch(({ fix: f }) => {
      fix = f;
      kick();
    });
    kick();
  } else if (!run && running) {
    running = false;
    stopWatch?.();
    stopWatch = null;
    clearTimeout(timer);
    timer = null;
    engine.reset();
    setPrompt(null);
  }
  autoWake = running;
  applyWakeLock();
}

/** Ticks soon, outside whatever callback asked: a jump made inside a tick must not re-enter the engine. */
function kick() {
  if (!running) return;
  clearTimeout(timer);
  timer = setTimeout(tick, 0);
}

function tick() {
  timer = null;
  if (!running) return;
  const s = player.state;
  const o = engine.update({
    tourId: s.tourId, stops: s.stops, order: s.order, currentIndex: s.index, isPlaying: s.playing, blocked: false,
    lastCompletedIndex: s.lastCompletedIndex, fix, arrivalDistanceM: getSettings().arrivalDistanceM, nowMs: Date.now(),
    positionMs: s.positionMs,
  });
  setPrompt(o.prompt);
  if (o.arrived != null) alert(o.prompt?.deadlineMs != null);
  if (o.start != null) begin(o.start);
  if (running && timer == null) timer = setTimeout(tick, state.prompt ? 250 : 1000);
}

function begin(index) {
  if (index === player.state.index) player.play();
  // Refused by jump.js's double-tap guard: forget the start so the next tick decides again.
  else if (!jumpTo(index, { reason: 'arrival', play: true })) engine.reset();
}

function setPrompt(p) {
  const phase = running ? engine.phase : 'idle';
  const secondsLeft = p?.deadlineMs ? Math.ceil(Math.max(0, p.deadlineMs - Date.now()) / 1000) : 0;
  const same = phase === state.phase && secondsLeft === state.secondsLeft && JSON.stringify(p) === JSON.stringify(state.prompt);
  Object.assign(state, { phase, targetIndex: p?.index ?? null, secondsLeft, prompt: p });
  if (!same) emit();
}

export function playNow() {
  engine.playNow();
  kick();
}

export function notYet() {
  engine.notYet();
  setPrompt(null);
}

// ============================================================ vibration and chime

let audioCtx = null;

/** Browsers start Web Audio only from a gesture: every tap creates or resumes the context. */
function unlockAudio() {
  try {
    audioCtx ??= new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
    if (audioCtx.state !== 'running') audioCtx.resume();
  } catch { /* no Web Audio */ }
}

function chime() {
  const c = audioCtx;
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  for (const [hz, at] of [[880, 0], [1318.5, 0.16]]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.25, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.35);
    osc.connect(gain).connect(c.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.4);
  }
}

function alert(withChime) {
  // Before any tap Chrome refuses vibrate() and logs an error for it.
  if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(180);
  if (withChime) chime();
}

// ============================================================ wake lock

let lock = null;
let requesting = false;
let manualWake = false;
// Auto-play on the web works only with the page open and the screen on, so it holds the lock while it runs.
let autoWake = false;

/** Screen Wake Lock; the browser drops it when the page hides, so it is taken again on return. Resolves whether held. */
export function holdWakeLock(on) {
  manualWake = on;
  return applyWakeLock();
}

export const wakeLockHeld = () => lock != null;

async function applyWakeLock() {
  if (!(manualWake || autoWake)) {
    const l = lock;
    lock = null;
    await l?.release().catch(() => {});
    held();
    return false;
  }
  if (lock || requesting || typeof navigator === 'undefined' || !navigator.wakeLock || !visible()) return lock != null;
  requesting = true;
  try {
    const l = await navigator.wakeLock.request('screen');
    l.addEventListener('release', () => {
      if (lock === l) lock = null;
      held();
    });
    lock = l;
  } catch { /* denied or unsupported */ }
  requesting = false;
  if (!(manualWake || autoWake)) return applyWakeLock();
  held();
  return lock != null;
}

function held() {
  if (state.wakeLock === (lock != null)) return;
  state.wakeLock = lock != null;
  emit();
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', unlockAudio, true);
  document.addEventListener('visibilitychange', () => {
    sync();
    if (visible()) kick();
  });
}

// ============================================================ location explainer (A LocationSheet)

let asking = null;

/** From a tap or on first open: the explainer, then the browser's prompt from its Continue tap. Resolves the status. */
export function askLocation() {
  asking ??= locationSheet().finally(() => { asking = null; });
  return asking;
}

async function locationSheet() {
  const perm = await location.permissionState();
  if (perm === 'granted') return location.request();
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'hf-perm';
    let result = null;
    const render = blocked => {
      el.innerHTML = `
        <div class="hf-perm__tile">${icon('location_on', 'mso')}</div>
        <h2 class="t-headline-small" dir="auto">${esc(t('perm_ask_title'))}</h2>
        ${blocked
          ? `<p class="hf-perm__body" dir="auto">${esc(t('web_perm_blocked'))}</p>`
          : `<p class="hf-perm__body" dir="auto">${esc(t('perm_ask_body'))}</p>
             <div class="hf-perm__info">${icon('info', 'mso')}<span dir="auto">${esc(t('perm_ask_body2'))}</span></div>`}
        <div class="hf-perm__actions">
          ${blocked ? '' : `<button type="button" class="btn btn--filled hf-big" data-act="go">${esc(t('action_continue'))}</button>`}
          <button type="button" class="btn btn--text" data-act="later">${esc(t('action_not_now'))}</button>
          ${blocked ? '' : `<p class="hf-perm__hint" dir="auto">${esc(t('web_perm_hint'))}</p>`}
        </div>`;
    };
    render(perm === 'denied');
    const close = modalSheet(el, { label: t('perm_ask_title'), onClose: () => resolve(result ?? location.current().status) });
    el.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      setSettings({ locationAsked: true });
      if (act === 'later') return close();
      // request() inside the tap: that is what lets the browser show its prompt.
      result = await location.request();
      if (result === STATUS.Denied) render(true);
      else close();
    });
  });
}

// ============================================================ auto-play opt-in (A AutoPlayOptIn.kt)

let optInShown = false;

/** After the first stop of a tour ends, with a fix, until the walker has answered once. Safe to call any time. */
export function maybeOfferAutoPlay() {
  const s = player.state;
  const st = getSettings();
  if (optInShown || !s.tourId || s.lastCompletedIndex == null || st.autoPlayOffered || st.autoPlay ||
    s.tour?.museum_mode || !location.current().fix) return false;
  optInShown = true;
  openOptIn();
  return true;
}

/** The full-screen explainer; resolves whether auto-play ended up on. */
export function openOptIn() {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'hf-optin';
    d.setAttribute('aria-label', t('bg_title'));
    d.innerHTML = `
      <button type="button" class="icon-btn hf-optin__close" data-act="manual" aria-label="${esc(t('action_close'))}">${icon('close')}</button>
      <div class="hf-optin__scroll">
        ${ringSketch()}
        <h2 class="t-headline-small" dir="auto">${esc(t('bg_title'))}</h2>
        <p class="hf-optin__body" dir="auto">${esc(t('web_autoplay_body'))}</p>
        <p class="hf-optin__note" dir="auto">${esc(t('web_autoplay_optin_note'))}</p>
      </div>
      <div class="hf-optin__actions">
        <button type="button" class="btn btn--filled hf-big" data-act="on">${esc(t('web_autoplay_turn_on'))}</button>
        <button type="button" class="btn btn--text" data-act="manual">${esc(t('bg_keep_manual'))}</button>
      </div>`;
    (document.getElementById('dialog-root') ?? document.body).append(d);
    let enabled = false;
    d.addEventListener('close', () => {
      d.remove();
      if (!enabled) setSettings({ autoPlayOffered: true });
      resolve(enabled);
    });
    d.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'manual') return d.close();
      if (act !== 'on') return;
      // Without a fix the location prompt may still be needed: request() inside this tap.
      const status = location.current().fix ? location.current().status : await location.request();
      if (status === STATUS.Denied || status === STATUS.NoPermission) {
        d.close();
        snackbar({ text: t('web_perm_blocked') });
        return;
      }
      enabled = true;
      unlockAudio();
      setSettings({ autoPlay: true, autoPlayOffered: true }); // sync() then holds the wake lock while it runs
      d.close();
      snackbar({ text: t('bg_confirmed') });
    });
    d.showModal();
  });
}

/** The route around the next stop with its arrival ring, drawn from the stops (A RingSketch). */
function ringSketch() {
  const s = player.state;
  const W = 320;
  const H = 150;
  const cx = W * 0.68;
  const cy = H * 0.45;
  const mPerPx = 1.3;
  const order = s.order?.length ? s.order : s.stops.map((_, i) => i + 1);
  const targetPos = Math.max(0, pos(order, nextId(order, s.index + 1) ?? s.index + 1));
  const centre = s.stops[order[targetPos] - 1];
  const proj = ([lat, lon]) => {
    if (!centre) return [cx, cy];
    const dx = (lon - centre.lon) * 111_320 * Math.cos((centre.lat * Math.PI) / 180);
    const dy = (lat - centre.lat) * 110_540;
    return [(cx + dx / mPerPx).toFixed(1), (cy - dy / mPerPx).toFixed(1)];
  };
  const streets = [0, 1, 2, 3, 4].map(i => {
    const y = H * (0.15 + i * 0.2);
    return `<line x1="0" y1="${y + 15}" x2="${W}" y2="${y - 15}" class="hf-sketch__street"/>`;
  }).join('');
  const legs = order.slice(1).map((id, k) => {
    const pts = legInto(s.stops, id, order[k]).coords.map(proj).map(p => p.join(',')).join(' ');
    return `<polyline points="${pts}" class="hf-sketch__route${k + 1 < targetPos ? ' hf-sketch__route--walked' : ''}"/>`;
  }).join('');
  return `<svg class="hf-sketch" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <rect width="${W}" height="${H}" class="hf-sketch__land"/>${streets}${legs}
    <circle cx="${cx}" cy="${cy}" r="${30 / mPerPx}" class="hf-sketch__ring"/>
    <circle cx="${cx}" cy="${cy}" r="7" class="hf-sketch__blaze"/>
    <circle cx="${cx - 64}" cy="${cy + 22}" r="15" class="hf-sketch__you-halo"/>
    <circle cx="${cx - 64}" cy="${cy + 22}" r="9" fill="#fff"/>
    <circle cx="${cx - 64}" cy="${cy + 22}" r="6" class="hf-sketch__you"/>
  </svg>`;
}

// ============================================================ arrival card (A ArrivalCard.kt)

/** "Starts by itself in 4 s. St. Mary's Basilica has finished." or "Starts when St. Mary's Basilica finishes." */
export function arrivalLine(p, s, nowMs = Date.now()) {
  if (p.queuedBehind != null) return t('arrival_queued', isolate(s.stops[p.queuedBehind]?.title ?? ''));
  const countdown = t('arrival_countdown', Math.ceil(Math.max(0, (p.deadlineMs ?? nowMs) - nowMs) / 1000));
  const done = p.finishedIndex != null ? s.stops[p.finishedIndex] : null;
  return done ? `${countdown} ${t('arrival_previous_finished', isolate(done.title))}` : countdown;
}

/** The arrival card; docked = walking mode's bottom card rather than floating. Returns unmount(). */
export function mountArrivalCard(el, { docked = false } = {}) {
  let key = null;
  let ticker = null;
  const stopTicker = () => { clearInterval(ticker); ticker = null; };

  function update() {
    const p = state.prompt;
    if (!p || !key) return;
    const line = el.querySelector('.hf-card__line');
    const text = arrivalLine(p, player.state);
    if (line.textContent !== text) line.textContent = text;
    const bar = el.querySelector('.hf-card__bar');
    if (bar) bar.style.transform = `scaleX(${Math.min(1, Math.max(0, 1 - (p.deadlineMs - Date.now()) / COUNTDOWN_MS))})`;
  }

  function render() {
    const p = state.prompt;
    const s = player.state;
    const stop = p && s.tourId === tourId ? s.stops[p.index] : null;
    // Queued behind the stop playing now, the next stop is announced by the stop bar instead.
    const inBar = !docked && p?.queuedBehind != null && nextId(s.order, s.index + 1) === p.index + 1;
    if (!stop || inBar) {
      el.hidden = true;
      el.replaceChildren();
      key = null;
      stopTicker();
      return;
    }
    const k = `${p.index}|${p.deadlineMs}|${p.queuedBehind}`;
    if (k !== key) {
      key = k;
      const img = stop.image;
      el.hidden = false;
      el.innerHTML = `<section class="hf-card${docked ? ' hf-card--docked' : ''}" aria-label="${esc(t('arrival_title'))}">
        <span class="hf-chip">${icon('trip_origin', 'mso')}<span>${esc(t('arrival_title'))}</span></span>
        <div class="hf-card__body">
          ${img ? `<img class="hf-card__pic" src="${esc(mediaUrl(s.tourId, img.thumb ?? img.src))}" alt="">` : ''}
          <div class="hf-card__text">
            <div class="hf-card__head">${blaze(walkNo(player.state, stop.id), 'current', 26)}<h2 class="t-title-large hf-card__title" dir="auto">${esc(stop.title)}</h2></div>
            ${stop.summary ? `<p class="t-body-medium hf-card__summary" dir="auto">${esc(stop.summary)}</p>` : ''}
          </div>
        </div>
        <div class="hf-card__actions">
          <button type="button" class="btn btn--filled hf-big hf-card__play" data-act="play">${icon('play_arrow', 'msr--fill')}<span>${esc(t('arrival_play_now'))}</span>
            ${p.deadlineMs ? '<span class="hf-card__bar" aria-hidden="true"></span>' : ''}</button>
          <button type="button" class="btn btn--outlined hf-big" data-act="later">${esc(t('arrival_not_yet'))}</button>
        </div>
        <p class="t-body-small hf-card__line" aria-live="polite" dir="auto"></p>
      </section>`;
      stopTicker();
      if (p.deadlineMs) ticker = setInterval(update, 100);
    }
    update();
  }

  const onClick = e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'play') playNow();
    else if (act === 'later') notYet();
  };
  el.addEventListener('click', onClick);
  const offState = on('change', render);
  const offPlayerCard = player.on('change', render);
  render();
  return () => {
    stopTicker();
    offState();
    offPlayerCard();
    el.removeEventListener('click', onClick);
    el.replaceChildren();
  };
}

// ============================================================ strings in the tour's language

let allStrings = null;

/** A t() in another language (the tour's), for the AI prompt and spoken turns; falls back to the UI's t(). */
export async function tourT(code) {
  allStrings ??= fetch(document.documentElement.dataset.strings || 'js/strings.json').then(r => r.json()).catch(() => null);
  const all = await allStrings;
  return (key, ...args) => {
    const e = all?.[code]?.[key] ?? all?.en?.[key];
    return e == null ? t(key, ...args) : format(typeof e === 'string' ? e : e.other, args);
  };
}
