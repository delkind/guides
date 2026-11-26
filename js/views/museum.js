// Port of A/tour/MuseumScreen.kt: an indoor tour. No map and no location; the stop list is the navigation.
import { t, plural, lang } from '../i18n.js';
import { player } from '../player.js';
import { jumpTo, dismissJumpUndo } from '../jump.js';
import { getSettings, subscribe as onStore } from '../store.js';
import { nextId, blazeKind } from '../walk.js';
import { mediaUrl } from '../data.js';
import { back } from '../app.js';
import { blaze, icon, esc } from '../ui/marks.js';
import { confirmSwitch, halfBody, barHtml, narrationHtml, askIdeasHtml, patch, tick, wireScrubbers, playerAction } from '../tour/sheet.js';

// Per tour for this browser session; not worth a setting (Android keeps it for the app process).
const autoKey = id => `ts.museum.autonext.${id}`;
const getAuto = id => { try { return sessionStorage.getItem(autoKey(id)) === '1'; } catch { return false; } };
const setAuto = (id, on) => { try { sessionStorage.setItem(autoKey(id), on ? '1' : '0'); } catch { /* storage blocked */ } };

/** "#": the stop whose number is on the sign. Resolves the 0-based index, or null. */
function jumpDialog(stops) {
  const d = document.createElement('dialog');
  d.className = 'dialog';
  d.setAttribute('aria-label', t('museum_jump'));
  d.innerHTML = `<form method="dialog" novalidate>
    <h2 class="dialog__title">${esc(t('museum_jump'))}</h2>
    <label class="ts-field"><span class="t-body-small">${esc(t('museum_jump_hint'))}</span>
      <input name="n" inputmode="numeric" autocomplete="off" maxlength="4" required></label>
    <p class="ts-field__error" role="alert" hidden></p>
    <div class="dialog__actions"><button type="button" class="btn btn--text" data-cancel>${esc(t('action_cancel'))}</button>
      <button class="btn btn--text" disabled>${esc(t('museum_jump_go'))}</button></div></form>`;
  (document.getElementById('dialog-root') ?? document.body).append(d);
  const input = d.querySelector('input');
  const go = d.querySelector('button:not([data-cancel])');
  const error = d.querySelector('.ts-field__error');
  return new Promise(resolve => {
    let picked = null;
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
      go.disabled = !input.value;
      error.hidden = true;
      input.removeAttribute('aria-invalid');
    });
    d.querySelector('form').addEventListener('submit', e => {
      const n = parseInt(input.value, 10);
      const i = stops.findIndex(s => s.id === n);
      if (i >= 0) {
        picked = i;
        return;
      }
      e.preventDefault();
      if (!n) return;
      error.textContent = t('museum_jump_missing', n);
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    });
    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => { d.remove(); resolve(picked); });
    d.showModal();
  });
}

export function mount(el, { id, stop }) {
  el.innerHTML = `<div class="museum">
    <header class="museum__top">
      <button type="button" class="icon-btn" data-act="back" aria-label="${esc(t('action_back'))}">${icon('arrow_back', 'msr--mirror')}</button>
      <div class="museum__titles"><span class="t-title-medium ts-1line" dir="auto" data-title></span><span class="t-body-small" data-sub></span></div>
      <button type="button" class="icon-btn museum__hash" data-act="jump" aria-label="${esc(t('museum_jump'))}" disabled><span aria-hidden="true">#</span></button>
    </header>
    <div class="museum__body"><div class="tour__status"><div class="spinner" role="progressbar"></div></div></div>
  </div>`;
  const root = el.firstElementChild;
  const body = root.querySelector('.museum__body');
  const fallback = `#/tour/${encodeURIComponent(id)}`;
  let live = true;
  let failed = false;
  let auto = getAuto(id);
  let prevEnded = false;

  const ready = () => player.state.tourId === id && player.state.stops.length > 0;

  function row(s, sid) {
    const stop = s.stops[sid - 1];
    const now = sid === s.index + 1;
    const kind = blazeKind(s.order, s.index + 1, sid);
    const thumb = stop.image ? `<img class="museum__thumb" src="${esc(mediaUrl(id, stop.image.thumb ?? stop.image.src))}" alt="" loading="lazy">` : '';
    return `<li><button type="button" class="ts-list__row${now ? ' is-current' : ''}" data-id="${sid}"${now ? ' aria-current="step"' : ''}>
      ${blaze(sid, kind, 30)}${thumb}<span class="t-title-small ts-2lines" dir="auto">${esc(stop.title)}</span>
      ${now ? `<span class="t-label-medium museum__now">${esc(t('museum_playing'))}</span>` : kind === 'done' ? icon('check_circle', 'mso museum__done') : ''}
    </button></li>`;
  }

  function render() {
    if (!live) return;
    if (!ready()) {
      patch(body, failed
        ? `<div class="tour__status"><div class="ts-failed"><p class="t-body-large">${esc(t('tour_load_failed'))}</p>
            <button type="button" class="btn btn--text" data-act="retry">${esc(t('action_retry'))}</button></div></div>`
        : '<div class="tour__status"><div class="spinner" role="progressbar"></div></div>');
      return;
    }
    const s = player.state;
    const c = { id, s, settings: getSettings(), hf: null, loc: null, landscape: false, timeLeft: false };
    root.querySelector('[data-title]').textContent = s.tour?.title ?? '';
    root.querySelector('[data-sub]').textContent = t('museum_subtitle', plural('stops_count', s.stops.length));
    root.querySelector('[data-act=jump]').disabled = false;
    patch(body, `<section class="museum__stop">${halfBody(c)}<div class="ts-barpad">${barHtml(c)}</div></section>
      <label class="museum__auto"><span class="museum__auto-text"><span class="t-title-small">${esc(t('museum_autoplay'))}</span>
        <span class="t-body-small">${esc(t('museum_autoplay_note'))}</span></span>
        <input type="checkbox" role="switch" class="museum__switch" data-auto${auto ? ' checked' : ''}></label>
      <div class="museum__text">${narrationHtml(c)}${askIdeasHtml(c.s.tour?.language ?? lang())}</div>
      <h2 class="t-title-small museum__list-head">${esc(t('tour_stop_list'))}</h2>
      <ul class="museum__list">${s.order.map(sid => row(s, sid)).join('')}</ul>`);
    tick(body, s);
  }

  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-act], [data-id]');
    if (!b || b.disabled) return;
    if (b.dataset.id) return void jumpTo(Number(b.dataset.id) - 1);
    if (playerAction(b.dataset.act, b)) return;
    if (b.dataset.act === 'back') back(fallback);
    else if (b.dataset.act === 'retry') load();
    else if (b.dataset.act === 'full') root.querySelector('.museum__text')?.scrollIntoView({ behavior: 'smooth' });
    else if (b.dataset.act === 'jump' && ready()) {
      const i = await jumpDialog(player.state.stops);
      if (i != null && live) jumpTo(i);
    }
  });
  root.addEventListener('change', e => {
    if (!e.target.matches('[data-auto]')) return;
    auto = e.target.checked;
    setAuto(id, auto);
  });
  wireScrubbers(root);

  const offs = [
    player.on('change', s => {
      if (s.tourId !== id) return;
      const justEnded = s.ended && !prevEnded;
      prevEnded = s.ended;
      render();
      // Auto-next plays on whatever the global auto-play setting, which jumpTo otherwise follows.
      const n = nextId(s.order, s.index + 1);
      if (justEnded && auto && n && jumpTo(n - 1, { play: true }) && !player.state.playing) player.play();
    }),
    onStore(({ kind }) => { if (kind === 'settings') render(); }),
  ];

  async function load() {
    failed = false;
    render();
    if (!(await confirmSwitch(id))) return live && back(fallback);
    try {
      await player.open(id, { stopId: stop });
    } catch (e) {
      console.error(e);
      failed = true;
    }
    prevEnded = player.state.ended;
    render();
    return undefined;
  }
  load();

  return () => {
    live = false;
    dismissJumpUndo();
    for (const off of offs) off();
  };
}
