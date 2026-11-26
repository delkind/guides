// Port of A/onboarding/OnboardingScreen.kt with two pages: the web app has no offline page.
import { t, browserLang } from '../i18n.js';
import { catalogue } from '../data.js';
import { setSettings } from '../store.js';
import { languageName as endonym } from '../format.js';
import { esc, icon, creditPill } from '../ui/marks.js';
import { navigate } from '../app.js';
import { LANGUAGES, defaultLanguages, toggleLanguage } from '../explore-filter.js';
import { cover } from './explore-ui.js';

const PAGES = 2;

export function mount(el) {
  let live = true;
  let page = 0;
  let tours = [];
  let picked = null;

  const counts = () => tours.reduce((m, x) => ({ ...m, [x.language]: (m[x.language] ?? 0) + 1 }), {});
  const preset = () => defaultLanguages(browserLang(), counts());
  const languages = () => picked ?? preset().languages;

  function finish() {
    setSettings({ languages: languages(), onboardingDone: true });
    navigate('#/', { replace: true });
  }

  function render() {
    const hero = tours.filter(x => x.cover)[page] ?? tours.find(x => x.cover);
    const c = counts();
    const dots = Array.from({ length: PAGES }, (_, i) => `<span class="ob-dot${i === page ? ' ob-dot--on' : ''}"></span>`).join('');
    const body = page === 0
      ? `<h1 class="t-headline-medium">${esc(t('onboarding_title'))}</h1>
        <p class="t-body-large ex-muted">${esc(t('web_onboarding_body', tours.length, new Set(tours.map(x => x.city)).size))}</p>
        <h2 class="t-title-small ob-question">${esc(t('onboarding_languages_question'))}</h2>
        <div class="ob-chips">${LANGUAGES.map(code => {
          const on = languages().includes(code);
          return `<button type="button" class="chip" data-lang="${code}" aria-pressed="${on}">${on ? icon('check') : ''}<span>${esc(endonym(code))}</span><span class="ob-count">${c[code] ?? 0}</span></button>`;
        }).join('')}</div>
        <p class="t-body-small">${esc(t(preset().fallback && !picked ? 'onboarding_languages_fallback' : 'onboarding_languages_hint'))}</p>`
      : `<h1 class="t-headline-medium">${esc(t('onboarding_handsfree_title'))}</h1>
        <p class="t-body-large ex-muted">${esc(t('onboarding_handsfree_body'))}</p>
        <p class="notice">${icon('info')}<span>${esc(t('web_autoplay_optin_note'))}</span></p>`;
    el.innerHTML = `<div class="ob">
      <div class="ob-hero">${hero ? cover(hero, 'ob-hero__img') : ''}<span class="ob-hero__shade"></span>
        ${creditPill(hero?.cover?.credit).replace('credit-pill', 'credit-pill ob-hero__credit')}</div>
      <div class="ob-body"><div class="ob-dots" role="img" aria-label="${esc(t('onboarding_page_of', page + 1, PAGES))}">${dots}</div>${body}</div>
      <div class="ob-actions">
        <button type="button" class="btn btn--text" data-skip>${esc(t('action_skip'))}</button>
        <button type="button" class="btn btn--filled" data-next>${esc(t('action_next'))}</button>
      </div></div>`;
  }

  const onClick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.skip != null) return finish();
    if (b.dataset.next != null) {
      if (page === PAGES - 1) return finish();
      page++;
      return render();
    }
    if (b.dataset.lang) {
      const next = toggleLanguage(languages(), b.dataset.lang);
      if (next) { picked = next; render(); }
    }
  };
  // el is the shared #view: the listener must not outlive this view.
  el.addEventListener('click', onClick);
  render();
  catalogue().then(list => { if (live) { tours = list; render(); } }).catch(() => {});
  return () => {
    live = false;
    el.removeEventListener('click', onClick);
  };
}
