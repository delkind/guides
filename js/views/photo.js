// Photo viewer #/tour/<id>/photo/<stopId> (A/tour/PhotoViewerScreen.kt): the stop's picture uncropped on black, with
// pinch / wheel / double-tap zoom, swipe-to-close at 1x, caption, credit links and the narration still in reach.
import { t, isolate } from '../i18n.js';
import { stops as loadStops, mediaUrl } from '../data.js';
import { player } from '../player.js';
import { clock } from '../format.js';
import { esc, icon, creditLinks } from '../ui/marks.js';
import { show as snackbar } from '../ui/snackbar.js';
import { back } from '../app.js';

const MAX_SCALE = 5;
const TAP_SCALE = 2.5;

export function mount(el, { id, stopId }) {
  el.innerHTML = `<div class="hf-photo">
    <div class="hf-photo__stage" data-stage><img class="hf-photo__img" data-img alt="" draggable="false"></div>
    <header class="hf-photo__top" data-chrome>
      <button type="button" class="icon-btn" data-act="close" aria-label="${esc(t('action_close'))}">${icon('close')}</button>
      <h1 class="t-title-medium hf-photo__title" dir="auto" data-title></h1>
      <button type="button" class="icon-btn" data-act="share" aria-label="${esc(t('tour_photo_share'))}" hidden>${icon('share')}</button>
    </header>
    <footer class="hf-photo__bottom" data-chrome>
      <p class="t-body-medium hf-photo__alt" dir="auto" data-alt hidden></p>
      <div class="hf-photo__credit" data-credit></div>
      <div class="hf-still" data-still hidden></div>
    </footer>
  </div>`;
  const $ = sel => el.querySelector(sel);
  const stage = $('[data-stage]');
  const img = $('[data-img]');
  const chrome = [...el.querySelectorAll('[data-chrome]')];
  let live = true;
  let stop = null;

  const close = () => back(`#/tour/${encodeURIComponent(id)}/play?stop=${stopId}`);

  loadStops(id).then(list => {
    stop = list[stopId - 1];
    if (!live || !stop) return;
    $('[data-title]').textContent = stop.title;
    const pic = stop.image;
    if (!pic) return;
    if (pic.preview) stage.style.backgroundImage = `url("${pic.preview}")`;
    img.src = mediaUrl(id, pic.src);
    img.alt = pic.alt ?? '';
    img.addEventListener('load', () => { stage.style.backgroundImage = ''; }, { once: true });
    $('[data-act=share]').hidden = false;
    if (pic.alt?.trim()) {
      $('[data-alt]').textContent = pic.alt;
      $('[data-alt]').hidden = false;
    }
    $('[data-credit]').innerHTML = creditLinks(pic.credit);
  }).catch(() => {});

  // ---------------------------------------------------------------- zoom and swipe-to-close
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let dragY = 0;
  let dismissing = false;
  const pointers = new Map();
  let pinch = null;
  let last = null;
  let startPt = null;

  function clampOffset() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const mx = (w * (scale - 1)) / 2;
    const my = (h * (scale - 1)) / 2;
    ox = Math.min(mx, Math.max(-mx, ox));
    oy = Math.min(my, Math.max(-my, oy));
  }

  function apply(animate = false) {
    img.style.transition = animate ? 'transform .2s ease' : 'none';
    img.style.transform = `translate(${ox}px, ${oy + dragY}px) scale(${scale})`;
    const a = Math.min(1, Math.max(0, 1 - Math.abs(dragY) / 600));
    for (const c of chrome) c.style.opacity = a;
  }

  const mid = () => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) tapped = true;
    if (pointers.size === 2) {
      tapped = false;
      pinch = { ...mid(), scale };
      dismissing = false;
      dragY = 0;
    } else {
      last = startPt = { x: e.clientX, y: e.clientY };
    }
  });
  stage.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2 && pinch) {
      const m = mid();
      scale = Math.min(MAX_SCALE, Math.max(1, (pinch.scale * m.d) / pinch.d));
      ox += m.x - pinch.x;
      oy += m.y - pinch.y;
      pinch = { ...pinch, x: m.x, y: m.y };
      clampOffset();
      return apply();
    }
    if (Math.hypot(e.clientX - startPt.x, e.clientY - startPt.y) > 10) tapped = false;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    if (scale > 1) {
      ox += dx;
      oy += dy;
      clampOffset();
    } else if (dismissing || Math.abs(e.clientY - startPt.y) > Math.abs(e.clientX - startPt.x) + 4) {
      dismissing = true;
      dragY += dy;
    }
    apply();
  });
  // Double tap from pointer events: iOS Safari sends no dblclick for touch.
  let lastTap = 0;
  let tapped = true;
  function toggleZoom(e) {
    if (scale > 1) {
      scale = 1;
      ox = oy = 0;
    } else {
      const r = stage.getBoundingClientRect();
      scale = TAP_SCALE;
      ox = (r.width / 2 - (e.clientX - r.left)) * (TAP_SCALE - 1);
      oy = (r.height / 2 - (e.clientY - r.top)) * (TAP_SCALE - 1);
      clampOffset();
    }
    apply(true);
  }
  const up = e => {
    if (pointers.size === 1 && tapped && pointers.has(e.pointerId)) {
      const now = performance.now();
      if (now - lastTap < 300) { lastTap = 0; toggleZoom(e); } else lastTap = now;
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) last = startPt = [...pointers.values()][0];
    if (pointers.size || !dismissing) return;
    dismissing = false;
    if (Math.abs(dragY) > stage.clientHeight * 0.18) return close();
    dragY = 0;
    apply(true);
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const next = Math.min(MAX_SCALE, Math.max(1, scale * Math.exp(-e.deltaY * 0.002)));
    // Zoom about the cursor.
    const cx = e.clientX - r.left - r.width / 2;
    const cy = e.clientY - r.top - r.height / 2;
    ox = cx - ((cx - ox) * next) / scale;
    oy = cy - ((cy - oy) * next) / scale;
    scale = next;
    if (scale === 1) ox = oy = 0;
    clampOffset();
    apply();
  }, { passive: false });

  // ---------------------------------------------------------------- chrome
  async function share() {
    const pic = stop?.image;
    if (!pic) return;
    // The Commons page carries the licence and author the CC licences require to travel with the picture.
    const source = pic.credit?.source?.trim() || new URL(mediaUrl(id, pic.src), location.href).href;
    const text = t('tour_photo_share_text', stop.title, source);
    try {
      if (navigator.share) return await navigator.share({ text });
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      snackbar({ text: t('web_copied') });
    } catch { /* clipboard blocked */ }
  }

  el.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'share') share();
    else if (act === 'toggle') player.toggle();
  });
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const still = $('[data-still]');
  still.innerHTML = `${icon('headphones')}<span class="hf-still__text" data-still-text></span>
    <button type="button" class="icon-btn hf-still__btn" data-act="toggle"></button>`;
  let stillKey = '';
  function renderStill() {
    const s = player.state;
    const on = s.tourId === id && s.stops.length > 0;
    still.hidden = !on;
    if (!on) return;
    $('[data-still-text]').textContent = t(s.playing ? 'photo_still_playing' : 'tour_photo_paused', isolate(clock(s.positionMs)), isolate(clock(s.durationMs)));
    if (stillKey === String(s.playing)) return;
    stillKey = String(s.playing);
    const btn = still.querySelector('[data-act=toggle]');
    btn.innerHTML = icon(s.playing ? 'pause' : 'play_arrow', 'msr--fill');
    btn.setAttribute('aria-label', t(s.playing ? 'action_pause' : 'action_play'));
  }
  const offPlayer = player.on('change', renderStill);
  renderStill();

  return () => {
    live = false;
    offPlayer();
    document.removeEventListener('keydown', onKey);
  };
}
