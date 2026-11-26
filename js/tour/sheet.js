// Port of A/tour/StopSheet.kt and TourControls.kt: the three-state stop sheet over the map, and the stop
// content (peek, half, full) that museum mode shows too.
import { t, tIn, plural, isolate, lang } from '../i18n.js';
import { clock } from '../format.js';
import { pos, nextId, narrationText, nextTeaser, walkNo } from '../walk.js';
import { player } from '../player.js';
import { jumpTo, jumpNext, jumpPrev } from '../jump.js';
import { confirm } from '../ui/dialog.js';
import { blaze, icon, esc, trail, picture } from '../ui/marks.js';
import { stopBarHtml, stopBarMode, MODE, plays } from './stop-bar.js';

export const STATES = ['collapsed', 'half', 'full'];
const FLING_PX_S = 125;
const SNAP_MS = 250;
const KEY = 'ts.sheet';

const session = {
  get() { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set(v) { try { sessionStorage.setItem(KEY, v); } catch { /* storage blocked */ } },
};

export const savedSheetState = () => (STATES.includes(session.get()) ? session.get() : 'collapsed');

/**
 * el holds [data-pane=peek|half|full]. geometry() → {H, maxHalf, flat}: the sheet's full height, Half's cap and
 * whether Full reaches the screen top. onChange({h, showing, state, moving}) on every frame.
 */
export function createSheet(el, { initial = 'collapsed', geometry, onChange }) {
  const panes = Object.fromEntries(STATES.map((s, i) => [s, el.querySelector(`[data-pane=${['peek', 'half', 'full'][i]}]`)]));
  let state = initial;
  let anchors = { collapsed: 0, half: 0, full: 0 };
  let h = 0;
  let showing = null;
  let moving = false;
  let anim = 0;
  let entry = !!history.state?.sheet;
  let silentPops = 0;
  let afterPop = null;
  let g = null;
  const href = location.href;

  function measure() {
    const { H, maxHalf } = geometry();
    panes.half.style.maxHeight = `${Math.max(0, maxHalf)}px`;
    const c = Math.min(panes.collapsed.offsetHeight, H);
    anchors = { collapsed: c, half: Math.min(Math.max(panes.half.offsetHeight, c), H), full: H };
  }

  function apply(v) {
    h = v;
    el.style.height = `${v}px`;
    const show = v <= anchors.collapsed + 0.5 ? 'collapsed' : v <= anchors.half + 0.5 ? 'half' : 'full';
    if (show !== showing) {
      showing = show;
      for (const [k, p] of Object.entries(panes)) {
        p.classList.toggle('is-shown', k === show);
        p.inert = k !== show;
      }
    }
    el.classList.toggle('tsheet--flat', geometry().flat && v >= anchors.full - 0.5);
    onChange?.({ h, showing, state, moving });
  }

  function setState(v, fromPop) {
    if (v === state) return;
    state = v;
    session.set(v);
    if (v !== 'collapsed' && !entry) {
      history.pushState({ ...history.state, sheet: 1 }, '');
      entry = true;
    } else if (v === 'collapsed' && entry && !fromPop) {
      entry = false;
      silentPops++;
      history.back();
    }
  }

  function animateTo(v, { fromPop = false, instant = false } = {}) {
    setState(v, fromPop);
    cancelAnimationFrame(anim);
    const from = h;
    if (instant || Math.abs(anchors[v] - from) < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      moving = false;
      return apply(anchors[v]);
    }
    moving = true;
    const t0 = performance.now();
    // The anchor is read every frame: the new stop's content can re-measure while the sheet moves.
    const step = now => {
      const k = Math.min(1, (now - t0) / SNAP_MS);
      if (k >= 1) moving = false;
      apply(from + (anchors[v] - from) * (1 - (1 - k) ** 3));
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  const stepUp = () => state !== 'full' && (animateTo(state === 'collapsed' ? 'half' : 'full'), true);
  const stepDown = opts => state !== 'collapsed' && (animateTo(state === 'full' ? 'half' : 'collapsed', opts), true);

  function onPop() {
    if (silentPops) {
      silentPops--;
      const fn = afterPop;
      afterPop = null;
      return fn?.();
    }
    // A hash navigation pops too, before the router unmounts this screen.
    if (location.href !== href) {
      entry = false;
      return;
    }
    if (!entry || history.state?.sheet) return;
    entry = false;
    stepDown({ fromPop: true });
  }

  function onKey(e) {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (stepDown()) e.preventDefault();
  }

  // Drag: touch through touch events (so a scroll can be refused on the first move), mouse through pointer events.
  function begin(x, y, target, touch) {
    if (target.closest('input[type=range], [data-nodrag]')) return;
    g = { x0: x, y0: y, h0: h, target, touch, decided: false, drag: false, samples: [[performance.now(), y]] };
  }

  function wantsDrag(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) return false;
    const sc = g.target.closest('[data-scroll]');
    if (showing === 'collapsed' || !sc) return true;
    if (showing === 'half') return dy < 0 ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1 : sc.scrollTop <= 0;
    if (!g.touch && g.target.closest('.ts-text')) return false; // a mouse there selects text
    return dy > 0 && sc.scrollTop <= 0;
  }

  function move(x, y, e) {
    if (!g) return;
    const dx = x - g.x0;
    const dy = y - g.y0;
    if (!g.decided) {
      if (Math.hypot(dx, dy) < (g.touch ? 1 : 6)) return;
      g.decided = true;
      g.drag = wantsDrag(dx, dy);
      if (!g.drag) return;
      cancelAnimationFrame(anim);
      moving = true;
      el.classList.add('tsheet--dragging');
    }
    if (!g.drag) return;
    if (e.cancelable) e.preventDefault();
    g.samples.push([performance.now(), y]);
    if (g.samples.length > 5) g.samples.shift();
    apply(Math.min(Math.max(g.h0 - dy, anchors.collapsed), anchors.full));
  }

  function end() {
    const done = g;
    g = null;
    if (!done?.drag) return;
    el.classList.remove('tsheet--dragging');
    if (!done.touch) {
      const stop = e => { e.stopPropagation(); e.preventDefault(); };
      addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', stop, { capture: true }), 0);
    }
    const [[ta, ya], [tb, yb]] = [done.samples[0], done.samples.at(-1)];
    const v = tb > ta ? ((yb - ya) * 1000) / (tb - ta) : 0; // px/s, positive downwards
    let to;
    if (Math.abs(v) > FLING_PX_S) {
      to = v < 0 ? STATES.find(k => anchors[k] > h + 1) ?? 'full' : [...STATES].reverse().find(k => anchors[k] < h - 1) ?? 'collapsed';
    } else {
      to = STATES.reduce((best, k) => (Math.abs(anchors[k] - h) < Math.abs(anchors[best] - h) ? k : best), 'collapsed');
    }
    moving = false;
    animateTo(to);
  }

  const onTouchStart = e => { if (e.touches.length === 1) begin(e.touches[0].clientX, e.touches[0].clientY, e.target, true); else g = null; };
  const onTouchMove = e => g?.touch && move(e.touches[0].clientX, e.touches[0].clientY, e);
  const onPointerDown = e => { if (e.pointerType !== 'touch' && e.button === 0) begin(e.clientX, e.clientY, e.target, false); };
  const onPointerMove = e => g && !g.touch && move(e.clientX, e.clientY, e);
  const onPointerUp = () => g && !g.touch && end();

  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: false });
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
  el.addEventListener('pointerdown', onPointerDown);
  addEventListener('pointermove', onPointerMove);
  addEventListener('pointerup', onPointerUp);
  addEventListener('popstate', onPop);
  document.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => relayout());
  ro.observe(panes.collapsed);
  ro.observe(panes.half);

  function relayout() {
    measure();
    if (!moving && !g) apply(anchors[state]);
  }

  if (state !== 'collapsed' && !entry) {
    history.pushState({ ...history.state, sheet: 1 }, '');
    entry = true;
  }

  return {
    get state() { return state; },
    get showing() { return showing; },
    get height() { return h; },
    anchor: v => anchors[v],
    animateTo,
    stepUp,
    stepDown,
    relayout,
    /** Drops the sheet's own history entry first, so the browser's Back then leaves the page. */
    leave(fn) {
      if (!entry) return fn();
      entry = false;
      silentPops++;
      afterPop = fn;
      history.back();
    },
    destroy() {
      cancelAnimationFrame(anim);
      ro.disconnect();
      removeEventListener('pointermove', onPointerMove);
      removeEventListener('pointerup', onPointerUp);
      removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
    },
  };
}

/** Opening another tour would cut off a playing one: asks first. Resolves false when the walker keeps listening. */
export async function confirmSwitch(id) {
  const s = player.state;
  if (!s.tourId || s.tourId === id || !s.playing) return true;
  return confirm({
    title: t('tour_switch_title'),
    text: t('tour_switch_text', isolate(s.tour?.title ?? s.tourId)),
    ok: t('tour_switch_open'),
    cancel: t('tour_switch_keep'),
  });
}

/* ------------------------------------------------------------ stop content. c: {id, s, settings, hf, loc, landscape, timeLeft} */

const stopOf = c => c.s.stops[c.s.index];
export const nOfM = c => t('stop_n_of_m', pos(c.s.order, c.s.index + 1) + 1, c.s.stops.length);

export function barHtml(c, previous = !c.landscape) {
  return stopBarHtml({
    s: c.s, autoPlay: c.settings.autoPlay, loc: c.loc, previous,
    queuedIndex: c.hf?.phase === 'queued' ? c.hf.targetIndex : null,
  });
}

export function playButton(s, size = 64) {
  const replay = s.ended && !s.playing;
  const label = replay ? t('b_cd_replay', s.index + 1) : t(s.playing ? 'action_pause' : 'action_play');
  return `<button type="button" class="ts-play ts-play--${size}" data-act="toggle" aria-label="${esc(label)}">${icon(replay ? 'replay' : s.playing ? 'pause' : 'play_arrow', 'msr--fill')}</button>`;
}

/** Filled in by tick(): the scrubber must not be re-rendered under a dragging finger. */
export const scrubRow = c => `<div class="ts-scrub" dir="ltr">
    <span class="ts-time" data-pos>0:00</span>
    <input type="range" class="scrubber" min="0" max="1000" step="1" value="0" data-scrub aria-label="${esc(stopOf(c).title)}">
    <span class="ts-time" data-dur>0:00</span></div>`;

const replayIcon = sec => ({ 5: 'replay_5', 10: 'replay_10', 30: 'replay_30' }[sec] ?? 'replay');
const speedText = speed => t('speed_value', new Intl.NumberFormat(lang(), { maximumFractionDigits: 2 }).format(speed));

export function transportRow(c) {
  const sec = c.settings.skipBackSeconds;
  const speed = speedText(c.s.speed);
  return `<div class="ts-transport" dir="ltr">
    <button type="button" class="ts-square" data-act="skip" aria-label="${esc(t('tour_skip_back', sec))}">${icon(replayIcon(sec), 'ts-square__icon')}</button>
    ${playButton(c.s, 64)}
    <button type="button" class="ts-square ts-square--speed" data-act="speed" aria-label="${esc(`${t('tour_playback_speed')} ${speed}`)}">${esc(speed)}</button>
  </div>`;
}

const handle = act => `<button type="button" class="ts-handle" data-act="${act}" aria-label="${esc(t('b_show_more'))}"><span></span></button>`;

const titles = (c, cls, extra = '') => `<span class="ts-titles"><span class="${cls} ts-1line" dir="auto" role="heading" aria-level="2">${esc(stopOf(c).title)}</span>
  <span class="t-body-small">${esc(nOfM(c))}</span>${extra}</span>`;

export function peekHtml(c) {
  const stop = stopOf(c);
  const head = `<button type="button" class="ts-peek__head" data-act="half" aria-label="${esc(`${stop.title}, ${nOfM(c)}. ${t('b_show_more')}`)}">
    ${blaze(walkNo(c.s, stop.id), 'current', 36)}${titles(c, 't-title-medium', c.timeLeft && !c.landscape ? '<span class="t-body-small" data-left></span>' : '')}</button>`;
  if (c.landscape) {
    return `${handle('half')}<div class="ts-peek__row ts-peek__row--compact">${head}${playButton(c.s, 48)}<div class="ts-peek__bar">${barHtml(c, false)}</div></div>`;
  }
  return `${handle('half')}<div class="ts-peek__row">${head}${playButton(c.s, 56)}</div>
    ${c.timeLeft ? '' : scrubRow(c)}<div class="ts-barpad">${barHtml(c)}</div>`;
}

export function pictureHtml(c, height, full = false) {
  const stop = stopOf(c);
  const html = picture(stop.image, c.id, { height, expand: `#/tour/${encodeURIComponent(c.id)}/photo/${stop.id}` });
  return html ? `<div class="ts-pic${full ? ' ts-pic--full' : ''}">${html}</div>` : '';
}

const askButton = () => `<button type="button" class="btn btn--outlined ts-ask" data-act="ask">${icon('contact_support', 'mso')}${esc(t('ask_entry'))}</button>`;

export function halfBody(c) {
  const stop = stopOf(c);
  return `<div class="ts-head">${blaze(walkNo(c.s, stop.id), 'current', 36)}${titles(c, 't-title-large')}</div>
    <div class="ts-pad">${trail(c.s.stops.length, pos(c.s.order, c.s.index + 1), c.s.order)}</div>
    ${pictureHtml(c, 112)}
    ${stop.summary ? `<button type="button" class="ts-summary" data-act="full" dir="auto">${esc(stop.summary)}</button>` : ''}
    <div class="ts-pad">${askButton()}</div>
    ${scrubRow(c)}${transportRow(c)}`;
}

export function halfHtml(c) {
  return `<div class="ts-half__scroll" data-scroll>${handle('full')}${halfBody(c)}</div><div class="ts-barpad">${barHtml(c)}</div>`;
}

/** The narration to read along: never the description when there is a narration; the next stop's teaser last. */
export function narrationHtml(c) {
  const stop = stopOf(c);
  const paras = (narrationText(stop) ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const teaser = nextTeaser(c.s.stops, c.s.order, stop.id);
  if (!paras.length && !teaser) return '';
  return `<h3 class="ts-label">${icon('notes', 'msr--mirror')}${esc(t('tour_narration_text'))}</h3>
    <div class="ts-text" dir="auto">${paras.map(p => `<p dir="auto">${esc(p)}</p>`).join('')}${teaser ? `<p class="ts-text__teaser" dir="auto">${esc(teaser)}</p>` : ''}</div>`;
}

/** The chips use the tour's language, like the Ask sheet's. */
export function askIdeasHtml(code) {
  const ideas = ['ask_chip_shorter', 'ask_chip_child', 'ask_chip_look', 'ask_chip_history'].map(k => tIn(code, k));
  return `<div class="ts-ideas"><h3 class="ts-ideas__title">${icon('contact_support', 'mso')}${esc(t('ask_ideas'))}</h3>
    <div class="ts-ideas__chips">${ideas.map(k => `<button type="button" class="chip" dir="auto" data-act="ask" data-q="${esc(k)}">${esc(k)}</button>`).join('')}</div>
    <button type="button" class="btn btn--text" data-act="ask">${esc(t('ask_own'))}</button></div>`;
}

export function fullHtml(c) {
  const stop = stopOf(c);
  const showBar = c.s.ended && stopBarMode(c.s, { autoPlay: c.settings.autoPlay }) !== MODE.Last;
  const sec = c.settings.skipBackSeconds;
  return `<header class="ts-full__head">
      <button type="button" class="icon-btn" data-act="half" aria-label="${esc(t('tour_collapse'))}">${icon('expand_more')}</button>
      <span class="t-title-medium ts-1line">${esc(nOfM(c))}</span>
      <button type="button" class="icon-btn" data-act="ask" aria-label="${esc(t('ask_entry_cd', walkNo(c.s, stop.id), isolate(stop.title)))}">${icon('contact_support', 'mso')}</button>
      <button type="button" class="icon-btn" data-act="map" aria-label="${esc(t('tour_back_to_map'))}">${icon('map', 'mso')}</button>
    </header>
    <div class="ts-full__scroll" data-scroll>
      ${pictureHtml(c, 250, true)}
      <div class="ts-full__body">
        <div class="ts-head ts-head--full">${blaze(walkNo(c.s, stop.id), 'current', 36)}<h2 class="t-headline-small" dir="auto">${esc(stop.title)}</h2></div>
        ${stop.summary ? `<p class="t-body-large ts-muted" dir="auto">${esc(stop.summary)}</p>` : ''}
        ${narrationHtml(c)}
        ${askIdeasHtml(c.s.tour?.language ?? lang())}
      </div>
    </div>
    ${showBar ? `<div class="ts-full__bar">${barHtml(c)}</div>` : ''}
    <div class="ts-docked">
      <div class="ts-docked__info"><span class="t-title-small ts-1line" dir="auto">${esc(stop.title)}</span>
        <div class="ts-docked__scrub" dir="ltr"><input type="range" class="scrubber" min="0" max="1000" step="1" value="0" data-scrub aria-label="${esc(stop.title)}"><span class="ts-time" data-clock></span></div></div>
      <div class="ts-docked__btns" dir="ltr">
        <button type="button" class="icon-btn" data-act="skip" aria-label="${esc(t('tour_skip_back', sec))}">${icon(replayIcon(sec))}</button>
        ${playButton(c.s, 48)}
      </div>
    </div>`;
}

/** Sets innerHTML only when the markup changed, so focus, scroll and a running animation survive player ticks. */
export function patch(el, html) {
  if (el && el._html !== html) {
    el._html = html;
    el.innerHTML = html;
  }
}

/** Fast-changing player fields: scrubbers, clocks and "1:31 left". */
export function tick(root, s) {
  const pct = s.durationMs > 0 ? Math.min(1, s.positionMs / s.durationMs) : 0;
  const state = t('b_scrub_state', clock(s.positionMs), clock(s.durationMs));
  for (const r of root.querySelectorAll('[data-scrub]')) {
    r.disabled = !(s.durationMs > 0);
    r.setAttribute('aria-valuetext', state);
    if (r._dragging) continue;
    r.value = Math.round(pct * 1000);
    r.style.setProperty('--pct', `${pct * 100}%`);
  }
  for (const e of root.querySelectorAll('[data-pos]')) if (!e.parentElement.querySelector('[data-scrub]')?._dragging) e.textContent = clock(s.positionMs);
  for (const e of root.querySelectorAll('[data-dur]')) e.textContent = clock(s.durationMs);
  for (const e of root.querySelectorAll('[data-clock]')) e.textContent = `${clock(s.positionMs)} / ${clock(s.durationMs)}`;
  for (const e of root.querySelectorAll('[data-left]')) e.textContent = s.durationMs > 0 ? t('b_time_left', clock(Math.max(0, s.durationMs - s.positionMs))) : '';
}

/** Seeks when the finger lifts (A/tour/TourControls.kt Scrubber). */
export function wireScrubbers(root) {
  root.addEventListener('input', e => {
    const r = e.target.closest?.('[data-scrub]');
    if (!r) return;
    r._dragging = true;
    const frac = r.value / 1000;
    r.style.setProperty('--pct', `${frac * 100}%`);
    const p = r.parentElement.querySelector('[data-pos]');
    if (p) p.textContent = clock(frac * player.state.durationMs);
  });
  root.addEventListener('change', e => {
    const r = e.target.closest?.('[data-scrub]');
    if (!r) return;
    r._dragging = false;
    player.seekTo((r.value / 1000) * player.state.durationMs);
  });
}

/** Player and stop-bar buttons shared by the tour and museum screens; true when handled. */
export function playerAction(act, target) {
  const s = player.state;
  const next = nextId(s.order, s.index + 1);
  if (act === 'bar-next') { if (next) jumpTo(next - 1, { play: plays(target.dataset.mode) || s.playing }); }
  else if (act === 'bar-prev' || act === 'sr-prev') jumpPrev();
  else if (act === 'sr-next') jumpNext();
  else if (act === 'toggle') player.toggle();
  else if (act === 'skip') player.skipBack();
  else if (act === 'speed') player.cycleSpeed();
  else if (act === 'ask') import('../views/ask.js').then(m => m.openAsk?.(s.index, target.dataset.q ?? '')).catch(e => console.error(e));
  else return false;
  return true;
}

export const stopsLabel = n => plural('stops_count', n);
