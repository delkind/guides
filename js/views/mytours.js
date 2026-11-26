// A/mytours/MyToursScreen.kt for the web: the tours this browser has started, most recent first. No downloads.
import { t } from '../i18n.js';
import { catalogue } from '../data.js';
import { allProgress, clearProgress, setProgress, subscribe } from '../store.js';
import { player } from '../player.js';
import { walkNumber } from '../walk.js';
import { esc, icon } from '../ui/marks.js';
import { show as snackbar } from '../ui/snackbar.js';
import { cover, menu, tourHref, playHref } from './explore-ui.js';

export function mount(el) {
  let live = true;
  let tours = [];
  el.innerHTML = `<section class="ex-page"><h1 class="t-headline-small ex-title">${esc(t('my_tours_title'))}</h1><div class="mt-body"></div></section>`;
  const body = el.querySelector('.mt-body');

  function render() {
    const progress = allProgress();
    const rows = Object.entries(progress)
      .map(([id, p]) => [tours.find(x => x.id === id), p])
      .filter(([tour]) => tour)
      .sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0));
    if (!rows.length) {
      body.innerHTML = `<div class="ex-empty"><p class="t-body-large ex-muted">${esc(t('mytours_empty'))}</p>
        <a class="btn btn--filled" href="#/">${esc(t('nav_explore'))}</a></div>`;
      return;
    }
    body.innerHTML = `<ul class="mt-list">${rows.map(([tour, p]) => `<li class="mt-row">
      <a class="mt-row__link" href="${tourHref(tour.id)}">${cover(tour, 'mt-row__cover')}
        <span class="mt-row__text"><span class="t-title-medium ex-ellipsis" dir="auto">${esc(tour.title)}</span>
        <span class="t-body-small">${esc(t('stop_n_of_m', walkNumber(p.order, p.stopIndex + 1, tour.stops_count), tour.stops_count))}</span></span></a>
      ${p.finished ? '' : `<a class="btn btn--tonal" href="${playHref(tour.id, p.stopIndex + 1)}">${esc(t('mytours_resume'))}</a>`}
      <button type="button" class="icon-btn" data-more="${esc(tour.id)}" aria-label="${esc(t('action_more'))}" aria-haspopup="menu">${icon('more_vert')}</button>
    </li>`).join('')}</ul>`;
  }

  function remove(id) {
    const wasOpen = !allProgress()[id]?.closed;
    if (player.state.tourId === id) player.close();
    // close() marks the progress closed; undo brings back the Continue card if it was showing.
    const saved = { ...allProgress()[id], closed: !wasOpen };
    clearProgress(id);
    const title = tours.find(x => x.id === id)?.title ?? id;
    snackbar({
      text: `${t('mytours_remove')}: ${title}`, action: t('action_undo'),
      // shortcut: setProgress stamps a new updatedAt, so an undone row moves to the top.
      onAction: () => setProgress(id, saved),
    });
  }

  body.addEventListener('click', e => {
    const b = e.target.closest('[data-more]');
    if (b) menu(b, [{ label: t('mytours_remove'), value: b.dataset.more, icon: 'delete' }], remove);
  });
  const off = subscribe(({ kind }) => { if (kind === 'progress' && live) render(); });
  catalogue().then(list => {
    if (!live) return;
    tours = list;
    render();
  }).catch(() => {
    if (live) body.innerHTML = `<div class="notice">${esc(t('needs_connection'))}</div>`;
  });

  return () => {
    live = false;
    off();
  };
}
