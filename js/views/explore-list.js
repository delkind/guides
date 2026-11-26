// Port of A/explore/ExploreScreen.kt ExploreList: search, filters, the Continue card and the cities' tours.
import { t, plural, isolate } from '../i18n.js';
import { stops as loadStops } from '../data.js';
import { getSettings, setSettings, latest, setProgress, subscribe } from '../store.js';
import { player } from '../player.js';
import { walkNumber } from '../walk.js';
import { tourMeta, languageName as endonym } from '../format.js';
import { esc, icon, plate } from '../ui/marks.js';
import { LANGUAGES, filterTours, groupByCity, emptyStateFix, toggleLanguage } from '../explore-filter.js';
import { cover, countryName, searchField, wireSearch, stopTitles, loadStopTitles, nearest, menu, tourHref, resumeAndPlay } from './explore-ui.js';

export function tourCard(tour, wide = false) {
  return `<a class="ex-card${wide ? ' ex-card--wide' : ''}" href="${tourHref(tour.id)}">
    <span class="ex-card__media">${cover(tour)}<span class="ex-card__lang">${esc(tour.language.toUpperCase())}</span></span>
    <span class="ex-card__text"><span class="ex-card__title t-title-medium" dir="auto">${esc(tour.title)}</span>
    <span class="t-body-small">${esc(tourMeta(tour))}</span></span></a>`;
}

function cityHeader(section, seeAll) {
  return `<div class="ex-city">
    <div class="ex-city__names">${plate(section.city)}
      <span class="t-body-medium ex-muted">${esc(plural('city_tours', section.tours.length, isolate(countryName(section.country)), section.tours.length))}</span></div>
    ${seeAll ? `<button type="button" class="icon-btn" data-city="${esc(section.city)}" aria-label="${esc(t('explore_see_city', section.city))}">${icon('chevron_right', 'msr--mirror')}</button>` : ''}
  </div>`;
}

export function mount(el, { tours, state, setAsMap }) {
  el.innerHTML = `<div class="ex-page">
    <h1 class="t-headline-small ex-title">${esc(t('explore_title'))}</h1>
    ${searchField(state.query, 'ex-search--pad')}
    <div class="ex-filters"></div>
    <div class="ex-continue"></div>
    <div class="ex-sections"></div>
  </div>
  <button type="button" class="fab ex-fab">${icon('map')}<span>${esc(t('explore_show_map'))}</span></button>`;
  const $ = s => el.querySelector(s);
  const near = nearest(() => renderSections());
  let continueKey = null;

  const filter = () => ({ query: state.query, city: state.city, languages: getSettings().languages });
  const setFilter = f => {
    state.query = f.query;
    state.city = f.city;
    $('.ex-search input').value = f.query;
    $('.ex-search__clear').hidden = !f.query;
    if (String(f.languages) !== String(getSettings().languages)) setSettings({ languages: f.languages });
    else render();
  };

  function renderFilters() {
    const f = filter();
    const cities = [...new Set(filterTours(tours, { languages: f.languages }).map(x => x.city))].sort();
    $('.ex-filters').innerHTML = `<button type="button" class="chip ex-chip" aria-haspopup="menu" aria-pressed="${f.city != null}" data-menu>
        <span dir="auto">${esc(f.city ?? t('filter_city'))}</span>${icon('arrow_drop_down')}</button>
      ${LANGUAGES.map(code => {
        const on = !f.languages.length || f.languages.includes(code);
        return `<button type="button" class="chip ex-chip" aria-pressed="${on}" data-lang="${code}">${on ? icon('check') : ''}${esc(endonym(code))}</button>`;
      }).join('')}`;
    $('[data-menu]').addEventListener('click', e => {
      menu(e.currentTarget, [{ label: t('filter_all_cities'), value: null, checked: f.city == null },
        ...cities.map(c => ({ label: c, value: c, checked: f.city === c }))], city => setFilter({ ...filter(), city }));
    });
  }

  function renderContinue() {
    const p = latest();
    const tour = p && tours.find(x => x.id === p.tourId);
    const key = tour ? `${p.tourId}:${p.stopIndex}` : '';
    if (key === continueKey) return;
    continueKey = key;
    const box = $('.ex-continue');
    if (!tour) return box.replaceChildren();
    const n = p.stopIndex + 1;
    const shown = walkNumber(p.order, n, tour.stops_count);
    box.innerHTML = `<div class="ex-continue__card" role="button" tabindex="0">
      ${cover(tour, 'ex-continue__cover')}
      <span class="ex-continue__text">
        <span class="t-label-medium">${esc(t('continue_title'))}</span>
        <span class="t-title-small ex-ellipsis" dir="auto">${esc(tour.title)}</span>
        <span class="t-body-small ex-continue__sub" dir="auto">${esc(t('stop_n_of_m', shown, tour.stops_count))}</span>
      </span>
      <span class="ex-continue__play" aria-hidden="true">${icon('play_arrow', 'msr--fill')}</span>
      <button type="button" class="icon-btn ex-continue__end" aria-label="${esc(t('notif_end_tour'))}">${icon('close')}</button>
    </div>`;
    loadStops(tour.id).then(list => {
      const title = list[p.stopIndex]?.title;
      if (title && continueKey === key) box.querySelector('.ex-continue__sub').textContent = t('continue_subtitle', shown, tour.stops_count, title);
    }).catch(() => {});
    const card = box.querySelector('.ex-continue__card');
    card.setAttribute('aria-label', `${t('mytours_resume')}: ${tour.title}`);
    const go = () => resumeAndPlay(tour.id, n);
    card.addEventListener('click', e => { if (!e.target.closest('.ex-continue__end')) go(); });
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    box.querySelector('.ex-continue__end').addEventListener('click', () => {
      if (player.state.tourId === tour.id) player.close();
      else setProgress(tour.id, { closed: true });
    });
  }

  function renderSections() {
    const f = filter();
    if (f.query.trim()) loadStopTitles(tours.filter(x => !f.languages.length || f.languages.includes(x.language)), renderSections);
    const sections = groupByCity(filterTours(tours, f, stopTitles));
    const chosen = f.city != null && sections.length === 1 ? sections[0] : null;
    const box = $('.ex-sections');
    if (!sections.length) {
      const fix = emptyStateFix(tours, f, stopTitles);
      box.innerHTML = `<div class="ex-empty"><p class="t-body-large ex-muted">${esc(t('explore_empty'))}</p>
        ${fix ? `<button type="button" class="btn btn--text" data-fix>${esc(t(fix === 'showAllLanguages' ? 'explore_show_all_languages' : 'explore_clear_filters'))}</button>` : ''}</div>`;
      box.querySelector('[data-fix]')?.addEventListener('click', () =>
        setFilter(fix === 'showAllLanguages' ? { ...f, languages: LANGUAGES } : { query: '', city: null, languages: LANGUAGES }));
      near.order([]);
      return;
    }
    if (chosen) {
      box.innerHTML = `<section class="ex-section">${cityHeader(chosen, false)}
        <div class="ex-column">${near.order(chosen.tours).map(x => tourCard(x, true)).join('')}</div></section>`;
      return;
    }
    near.order([]);
    box.innerHTML = sections.map(s => `<section class="ex-section">${cityHeader(s, true)}
      <div class="ex-row">${s.tours.map(x => tourCard(x)).join('')}</div></section>`).join('');
    box.querySelectorAll('[data-city]').forEach(b => b.addEventListener('click', () => setFilter({ ...filter(), city: b.dataset.city })));
  }

  function render() {
    renderFilters();
    renderContinue();
    renderSections();
  }

  $('.ex-filters').addEventListener('click', e => {
    const b = e.target.closest('[data-lang]');
    if (!b) return;
    const next = toggleLanguage(getSettings().languages, b.dataset.lang);
    if (next) setSettings({ languages: next });
  });
  wireSearch(el, q => {
    state.query = q;
    renderSections();
  });
  $('.ex-fab').addEventListener('click', () => setAsMap(true));
  const off = subscribe(({ kind }) => {
    if (kind === 'progress') renderContinue();
    else render();
  });
  render();

  return () => {
    off();
    near.dispose();
  };
}
