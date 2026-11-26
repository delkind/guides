// Explore: the list of cities and tours, or the city map; the choice is remembered in settings.exploreAsMap.
import { t } from '../i18n.js';
import { catalogue } from '../data.js';
import { getSettings, setSettings } from '../store.js';
import { esc } from '../ui/marks.js';
import * as list from './explore-list.js';
import * as cityMap from './explore-map.js';

// Survives switching tabs and list/map, like Android's rememberSaveable.
const state = { query: '', city: null };

export function mount(el) {
  let live = true;
  let child = null;
  let tours = null;

  const show = () => {
    child?.();
    el.replaceChildren();
    const ctx = {
      tours, state,
      setAsMap(on) {
        setSettings({ exploreAsMap: on });
        show();
      },
    };
    child = (getSettings().exploreAsMap ? cityMap : list).mount(el, ctx);
  };

  const load = () => {
    el.innerHTML = '<div class="ex-loading"><div class="spinner" role="progressbar"></div></div>';
    catalogue()
      .then(all => {
        if (!live) return;
        tours = all;
        show();
      })
      .catch(() => {
        if (!live) return;
        el.innerHTML = `<section class="page"><div class="notice notice--error">${esc(t('needs_connection'))}</div>
          <p><button type="button" class="btn btn--text">${esc(t('action_retry'))}</button></p></section>`;
        el.querySelector('button').addEventListener('click', load);
      });
  };
  load();

  return () => {
    live = false;
    child?.();
  };
}
