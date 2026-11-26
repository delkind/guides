// Port of A/tourdetail/TourDetailScreen.kt without downloads: hero, stats, Start / Resume and the stops.
import { t, plural, isolate } from '../i18n.js';
import { tour as loadTour, stops as loadStops, mediaUrl } from '../data.js';
import { getProgress } from '../store.js';
import { duration } from '../format.js';
import { esc, icon, plate, blaze, creditPill } from '../ui/marks.js';
import { show as snackbar } from '../ui/snackbar.js';
import { back } from '../app.js';
import { cover, countryName, languageName, playHref } from './explore-ui.js';

export function mount(el, { id }) {
  let live = true;
  el.innerHTML = `<div class="td">
    <div class="td-bar">
      <button type="button" class="glass-btn" data-back aria-label="${esc(t('action_back'))}">${icon('arrow_back', 'msr--mirror')}</button>
      <button type="button" class="glass-btn" data-share aria-label="${esc(t('detail_share'))}" hidden>${icon('share')}</button>
    </div>
    <div class="td-content"><div class="ex-loading"><div class="spinner" role="progressbar"></div></div></div>
  </div>`;
  const $ = s => el.querySelector(s);
  $('[data-back]').addEventListener('click', () => back('#/'));

  const failed = retry => {
    $('.td-content').innerHTML = `<div class="page"><div class="notice">${esc(t('needs_connection'))}</div>
      <button type="button" class="btn btn--text" data-retry>${esc(t('action_retry'))}</button></div>`;
    $('[data-retry]').addEventListener('click', retry);
  };

  function renderStops(tour) {
    const box = $('.td-stops');
    box.innerHTML = '<div class="ex-loading"><div class="spinner" role="progressbar"></div></div>';
    loadStops(id).then(stops => {
      if (!live) return;
      const p = getProgress(id);
      const start = p && !p.finished ? p.stopIndex + 1 : undefined;
      $('[data-start]').href = playHref(id, start);
      $('.td-stat--stops').innerHTML = `<span class="t-title-medium">${esc(plural('stops_count', stops.length))}</span>
        <span class="t-body-small">${stops.length ? esc(t('detail_from_to', isolate(stops[0].title), isolate(stops.at(-1).title))) : ''}</span>`;
      box.innerHTML = `<div class="td-stops__head"><h2 class="t-title-medium">${esc(plural('stops_count', stops.length))}</h2>
          <a class="btn btn--text" href="${playHref(id, start)}">${icon('map')}${esc(t('detail_see_route'))}</a></div>
        <ul class="td-list">${stops.map(s => {
          const img = s.image && mediaUrl(id, s.image.thumb ?? s.image.src);
          return `<li><a class="td-stop" href="${playHref(id, s.id)}">${blaze(s.id, 'ahead', 30)}
            <span class="td-stop__text"><span class="t-title-small" dir="auto">${esc(s.title)}</span>
            ${s.summary ? `<span class="t-body-small ex-ellipsis" dir="auto">${esc(s.summary)}</span>` : ''}</span>
            ${img ? `<img class="td-stop__thumb" src="${esc(img)}" alt="" loading="lazy" decoding="async">` : ''}</a></li>`;
        }).join('')}</ul>`;
    }).catch(() => {
      if (!live) return;
      box.innerHTML = `<div class="notice">${esc(t('needs_connection'))}</div>
        <button type="button" class="btn btn--text" data-retry>${esc(t('action_retry'))}</button>`;
      box.querySelector('[data-retry]').addEventListener('click', () => renderStops(tour));
    });
  }

  function render(tour) {
    document.title = tour.title;
    const p = getProgress(id);
    const resume = p && !p.finished;
    $('.td-content').innerHTML = `<div class="td-hero">${cover(tour, 'td-hero__img')}<span class="td-hero__shade"></span>
        ${creditPill(tour.cover?.credit).replace('credit-pill', 'credit-pill td-hero__credit')}</div>
      <div class="td-sheet">
        <div class="td-where">${plate(tour.city, true)}
          <span class="t-body-medium td-where__text">${esc(t('tour_narrated_in', isolate(countryName(tour.country)), languageName(tour.language)))}</span></div>
        <h1 class="t-headline-small" dir="auto">${esc(tour.title)}</h1>
        <div class="td-stats">
          <div class="td-stat"><span class="t-title-medium">${esc(t('unit_km', tour.length))}</span><span class="t-body-small">${esc(t('detail_walk'))}</span></div>
          <div class="td-stat"><span class="t-title-medium">${esc(duration(tour.duration))}</span><span class="t-body-small">${esc(t('detail_easy_pace'))}</span></div>
          <div class="td-stat td-stat--stops"><span class="t-title-medium">${esc(plural('stops_count', tour.stops_count))}</span></div>
        </div>
        <a class="btn btn--filled td-start" data-start href="${playHref(id, resume ? p.stopIndex + 1 : undefined)}">${icon('play_arrow', 'msr--fill')}${esc(t(resume ? 'detail_resume' : 'detail_start'))}</a>
      </div>
      <section class="td-stops"></section>`;
    const share = $('[data-share]');
    share.hidden = false;
    share.onclick = async () => {
      const url = new URL(`${encodeURIComponent(id)}/`, new URL('.', location.href)).href;
      const text = t('detail_share_text', tour.title, url);
      if (navigator.share) {
        try { return await navigator.share({ text }); } catch (e) { if (e.name === 'AbortError') return; }
      }
      try {
        await navigator.clipboard.writeText(url);
        snackbar({ text: t('web_copied') });
      } catch { /* no clipboard: nothing to do */ }
    };
    renderStops(tour);
  }

  const load = () => {
    loadTour(id).then(x => {
      if (!live) return;
      if (x) render(x); else failed(load);
    }).catch(() => { if (live) failed(load); });
  };
  load();
  return () => { live = false; };
}
