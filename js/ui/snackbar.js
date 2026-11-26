// One snackbar at a time in #snackbar-host, above var(--snackbar-bottom) which views set.
import { esc } from './marks.js';

let current = null;

/** Returns dismiss(). onAction runs when the action is tapped; the bar then closes. */
export function show({ text, action, onAction, ms = 4000 }) {
  const host = document.getElementById('snackbar-host');
  if (!host) return () => {};
  current?.();
  const el = document.createElement('div');
  el.className = 'snackbar';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="snackbar__text" dir="auto">${esc(text)}</span>${action ? `<button type="button" class="snackbar__action">${esc(action)}</button>` : ''}`;
  host.append(el);
  let timer = setTimeout(dismiss, ms);
  function dismiss() {
    clearTimeout(timer);
    if (current === dismiss) current = null;
    el.classList.add('snackbar--out');
    setTimeout(() => el.remove(), 200);
  }
  el.querySelector('.snackbar__action')?.addEventListener('click', () => {
    dismiss();
    onAction?.();
  });
  // A reader still reading keeps the undo available.
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => { timer = setTimeout(dismiss, ms); });
  current = dismiss;
  return dismiss;
}
