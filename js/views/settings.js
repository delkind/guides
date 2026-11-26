// Port of A/settings/SettingsScreen.kt for the web: no theme, Wi-Fi or storage rows; App language added.
import { t, plural, lang, setLang, LANGS } from '../i18n.js';
import { getSettings, setSettings, subscribe } from '../store.js';
import { player, SPEEDS } from '../player.js';
import { languageName as endonym } from '../format.js';
import { askLocation } from '../handsfree.js';
import { STATUS } from '../location.js';
import { choice } from '../ui/dialog.js';
import { show as snackbar } from '../ui/snackbar.js';
import { esc, icon } from '../ui/marks.js';
import { LANGUAGES } from '../explore-filter.js';

const SKIP_BACK = [5, 10, 15, 30];
const ARRIVAL = [15, 25, 40];
const LICENSES = [
  ['MapLibre GL JS', 'BSD-3-Clause'],
  ['OpenFreeMap', 'MIT; map data © OpenStreetMap contributors, ODbL'],
  ['Rubik', 'SIL Open Font License 1.1'],
  ['Material Symbols', 'Apache License 2.0'],
];
const VERSION = document.documentElement.dataset.version || 'dev';

const speedLabel = v => t('speed_value', new Intl.NumberFormat(lang(), { maximumFractionDigits: 1 }).format(v));

const row = (ic, title, summary, attrs = '', trailing = '') => `<${attrs ? 'button type="button"' : 'div'} class="st-row" ${attrs}>
  ${icon(ic, 'st-row__icon')}<span class="st-row__text"><span class="t-body-large">${esc(title)}</span>
  ${summary ? `<span class="t-body-medium ex-muted">${esc(summary)}</span>` : ''}</span>${trailing}</${attrs ? 'button' : 'div'}>`;

const switchRow = (ic, title, summary, key, on) => `<label class="st-row">
  ${icon(ic, 'st-row__icon')}<span class="st-row__text"><span class="t-body-large">${esc(title)}</span>
  ${summary ? `<span class="t-body-medium ex-muted">${esc(summary)}</span>` : ''}</span>
  <input type="checkbox" role="switch" class="st-switch" data-switch="${key}"${on ? ' checked' : ''}></label>`;

const chevron = icon('chevron_right', 'msr--mirror st-row__chevron');

export function mount(el) {
  el.innerHTML = '<section class="ex-page st"></section>';
  const page = el.firstChild;

  function render() {
    const s = getSettings();
    const chosen = s.languages.length ? LANGUAGES.filter(c => s.languages.includes(c)) : LANGUAGES;
    page.innerHTML = `<h1 class="t-headline-small ex-title">${esc(t('settings_title'))}</h1>
      <h2 class="st-group t-title-small">${esc(t('settings_listening'))}</h2>
      ${row('language', t('settings_tour_languages'), t('settings_languages_summary', chosen.map(endonym).join(', ')), 'data-pick="languages"', chevron)}
      <div class="st-row st-row--top">${icon('speed', 'st-row__icon')}<span class="st-row__text"><span class="t-body-large">${esc(t('settings_speed'))}</span>
        <span class="st-chips">${SPEEDS.map(v => `<button type="button" class="chip" data-speed="${v}" aria-pressed="${Math.abs(s.speed - v) < 0.01}">${esc(speedLabel(v))}</button>`).join('')}</span></span></div>
      ${row('replay_10', t('settings_skip_back'), plural('skip_back_seconds', s.skipBackSeconds), 'data-pick="skip"', chevron)}
      <h2 class="st-group t-title-small">${esc(t('settings_walking'))}</h2>
      ${switchRow('sensors', t('settings_autoplay'), t('web_autoplay_visible'), 'autoPlay', s.autoPlay)}
      ${row('directions_walk', t('settings_arrival_distance'), t('settings_arrival_value', s.arrivalDistanceM), 'data-pick="arrival"', chevron)}
      ${switchRow('light_mode', t('settings_keep_screen_on'), t('settings_keep_screen_on_summary'), 'keepScreenOnWalking', s.keepScreenOnWalking)}
      <h2 class="st-group t-title-small">${esc(t('settings_app_language'))}</h2>
      ${row('translate', t('settings_app_language'), endonym(s.uiLang ?? lang()), 'data-pick="ui"', chevron)}
      <h2 class="st-group t-title-small">${esc(t('settings_about'))}</h2>
      ${row('shield', t('settings_privacy'), '')}
      ${row('map', `${t('settings_map_attribution')} · Esri`, '')}
      <details class="st-details"><summary class="st-row">${icon('description', 'st-row__icon')}<span class="st-row__text t-body-large">${esc(t('settings_licenses'))}</span>${icon('expand_more', 'st-row__chevron')}</summary>
        <ul class="st-licenses">${LICENSES.map(([name, lic]) => `<li><span class="t-body-large">${esc(name)}</span><span class="t-body-medium ex-muted">${esc(lic)}</span></li>`).join('')}</ul></details>
      ${row('info', t('settings_version', VERSION), '')}`;
  }

  async function pick(kind) {
    const s = getSettings();
    if (kind === 'languages') {
      const p = choice({
        title: t('settings_tour_languages'), multiple: true,
        options: LANGUAGES.map(c => ({ value: c, label: endonym(c) })),
        value: s.languages.length ? s.languages : LANGUAGES,
      });
      // At least one stays on: unchecking the last one is undone on the spot.
      const d = document.querySelector('#dialog-root dialog:last-of-type');
      d?.addEventListener('change', e => { if (!d.querySelector('input:checked')) e.target.checked = true; });
      const v = await p;
      if (v?.length) setSettings({ languages: LANGUAGES.filter(c => v.includes(c)) });
    } else if (kind === 'skip') {
      const v = await choice({ title: t('settings_skip_back'), options: SKIP_BACK.map(n => ({ value: n, label: plural('skip_back_seconds', n) })), value: s.skipBackSeconds });
      if (v != null) setSettings({ skipBackSeconds: v });
    } else if (kind === 'arrival') {
      const v = await choice({ title: t('settings_arrival_distance'), options: ARRIVAL.map(n => ({ value: n, label: t('settings_arrival_value', n) })), value: s.arrivalDistanceM });
      if (v != null) setSettings({ arrivalDistanceM: v });
    } else if (kind === 'ui') {
      const v = await choice({ title: t('settings_app_language'), options: LANGS.map(c => ({ value: c, label: endonym(c) })), value: s.uiLang ?? lang() });
      if (v != null && v !== lang()) setLang(v);
    }
  }

  page.addEventListener('click', e => {
    const b = e.target.closest('[data-pick], [data-speed]');
    if (b?.dataset.pick) pick(b.dataset.pick);
    else if (b?.dataset.speed) player.setSpeed(Number(b.dataset.speed));
  });
  page.addEventListener('change', async e => {
    const key = e.target.dataset.switch;
    if (!key) return;
    if (key === 'autoPlay' && e.target.checked) {
      e.target.checked = false;
      const status = await askLocation();
      if (status === STATUS.Denied) return snackbar({ text: t('web_perm_blocked') });
      setSettings({ autoPlay: true });
      return;
    }
    setSettings({ [key]: e.target.checked });
  });
  const off = subscribe(({ kind }) => { if (kind === 'settings') render(); });
  render();
  return off;
}
