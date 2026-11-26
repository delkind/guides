// Port of A/playback/MiniPlayer.kt. On the root tabs while a tour is loaded, or while saved progress can be resumed.
import { t } from '../i18n.js';
import { player } from '../player.js';
import { catalogue, stops as loadStops, mediaUrl } from '../data.js';
import { latest, setProgress, subscribe } from '../store.js';
import { nextId, walkNo, walkNumber } from '../walk.js';
import { esc, icon, blaze } from '../ui/marks.js';
import { navigate } from '../app.js';
import { playHref, resumeAndPlay } from './explore-ui.js';

/** The stop Play starts: the next one in the walk while paused at the end of a stop, else the current one. */
export function shownIndex(s) {
  const n = s.ended ? nextId(s.order, s.index + 1) : null;
  return n ? n - 1 : s.index;
}

export function mount(el) {
  let live = true;
  let saved = null; // {tourId, tour, stops} for saved progress, loaded once per tour
  let key = null;

  function view() {
    const s = player.state;
    if (s.tourId) {
      const i = shownIndex(s);
      return {
        tourId: s.tourId, tourTitle: s.tour?.title ?? '', stop: s.stops[i], no: walkNo(s, s.stops[i].id), playing: s.playing,
        progress: i === s.index && s.durationMs > 0 ? Math.min(1, s.positionMs / s.durationMs) : 0,
      };
    }
    const p = latest();
    if (!p) return null;
    if (saved?.tourId !== p.tourId) {
      saved = { tourId: p.tourId };
      Promise.all([catalogue(), loadStops(p.tourId)]).then(([list, stops]) => {
        if (saved?.tourId !== p.tourId) return;
        Object.assign(saved, { tour: list.find(x => x.id === p.tourId), stops });
        render();
      }).catch(() => {});
    }
    const stop = saved.stops?.[p.stopIndex];
    return stop && { tourId: p.tourId, tourTitle: saved.tour?.title ?? '', stop, no: walkNumber(p.order, stop.id, saved.stops.length), playing: false, progress: 0 };
  }

  function render() {
    if (!live) return;
    const v = view();
    el.hidden = !v;
    document.body.classList.toggle('has-mini', !!v);
    if (!v) {
      key = null;
      return el.replaceChildren();
    }
    const k = `${v.tourId}:${v.stop.id}:${v.tourTitle}`;
    if (k !== key) {
      key = k;
      const img = v.stop.image && mediaUrl(v.tourId, v.stop.image.thumb ?? v.stop.image.src);
      el.innerHTML = `<div class="mp"><span class="mp__bar" dir="ltr"><span class="mp__fill"></span></span>
        <div class="mp__row" role="button" tabindex="0" aria-label="${esc(t('c_mini_open'))}">
          ${img ? `<img class="mp__thumb" src="${esc(img)}" alt="" decoding="async">` : blaze(v.no, 'current', 44)}
          <span class="mp__text"><span class="t-title-small ex-ellipsis" dir="auto">${esc(v.stop.title)}</span>
            <span class="t-body-small ex-ellipsis" dir="auto">${esc(v.tourTitle)}</span></span>
          <span class="mp__controls" dir="ltr">
            <button type="button" class="icon-btn mp__play" data-play></button>
            <button type="button" class="icon-btn" data-end aria-label="${esc(t('notif_end_tour'))}">${icon('close')}</button>
          </span></div></div>`;
    }
    el.querySelector('.mp__fill').style.width = `${v.progress * 100}%`;
    const play = el.querySelector('[data-play]');
    const label = t(v.playing ? 'action_pause' : 'action_play');
    if (play.getAttribute('aria-label') !== label) {
      play.setAttribute('aria-label', label);
      play.innerHTML = icon(v.playing ? 'pause' : 'play_arrow', 'msr--fill');
    }
  }

  const current = () => {
    const s = player.state;
    if (s.tourId) return { tourId: s.tourId, stopId: shownIndex(s) + 1 };
    const p = latest();
    return p && { tourId: p.tourId, stopId: p.stopIndex + 1 };
  };

  el.onclick = e => {
    const c = current();
    if (!c) return;
    if (e.target.closest('[data-end]')) {
      if (player.state.tourId) player.close();
      else setProgress(c.tourId, { closed: true });
    } else if (e.target.closest('[data-play]')) {
      const s = player.state;
      if (s.tourId && c.stopId - 1 !== s.index) player.selectStop(c.stopId - 1, { play: true });
      else if (s.tourId) player.toggle();
      else resumeAndPlay(c.tourId, c.stopId);
    } else if (e.target.closest('.mp__row')) {
      navigate(playHref(c.tourId, c.stopId));
    }
  };
  el.onkeydown = e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('mp__row')) {
      e.preventDefault();
      const c = current();
      if (c) navigate(playHref(c.tourId, c.stopId));
    }
  };

  const offPlayer = player.on('change', render);
  const offStore = subscribe(({ kind }) => { if (kind === 'progress' && !player.state.tourId) render(); });
  render();
  return () => {
    live = false;
    offPlayer();
    offStore();
    el.onclick = el.onkeydown = null;
    el.hidden = true;
    document.body.classList.remove('has-mini');
  };
}
