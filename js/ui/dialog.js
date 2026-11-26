// Dialogs and modal sheets on the native <dialog> (focus trap, Escape) inside #dialog-root.
import { esc } from './marks.js';
import { t } from '../i18n.js';

function open(className, html, label) {
  const d = document.createElement('dialog');
  d.className = className;
  if (label) d.setAttribute('aria-label', label);
  d.innerHTML = html;
  (document.getElementById('dialog-root') ?? document.body).append(d);
  d.addEventListener('close', () => d.remove());
  // A tap on the scrim (the dialog box itself, outside its content) closes it.
  d.addEventListener('click', e => { if (e.target === d) d.close(''); });
  d.showModal();
  return d;
}

function buttons(list) {
  return `<div class="dialog__actions">${list.map(([v, label, cls]) =>
    `<button type="button" class="btn ${cls}" value="${esc(v)}">${esc(label)}</button>`).join('')}</div>`;
}

function result(d, read) {
  return new Promise(resolve => {
    d.addEventListener('click', e => {
      const b = e.target.closest('button[value]');
      if (b) d.close(b.value);
    });
    d.addEventListener('close', () => resolve(read(d.returnValue)));
  });
}

const head = (title, text) =>
  `${title ? `<h2 class="dialog__title" dir="auto">${esc(title)}</h2>` : ''}${text ? `<p class="dialog__text" dir="auto">${esc(text)}</p>` : ''}`;

/** Resolves true on OK. */
export function confirm({ title, text, ok = t('action_continue'), cancel = t('action_cancel'), danger = false }) {
  const d = open('dialog', `${head(title, text)}${buttons([['0', cancel, 'btn--text'], ['1', ok, danger ? 'btn--text btn--danger' : 'btn--text']])}`, title);
  return result(d, v => v === '1');
}

export function alert({ title, text, ok = t('action_close') }) {
  const d = open('dialog', `${head(title, text)}${buttons([['1', ok, 'btn--text']])}`, title);
  return result(d, () => undefined);
}

/**
 * options [{value, label}]; radios resolve the chosen value, checkboxes (multiple) an array.
 * Resolves null when cancelled.
 */
export function choice({ title, options, value, multiple = false, ok = t('settings_done'), cancel = t('action_cancel') }) {
  const type = multiple ? 'checkbox' : 'radio';
  const chosen = new Set(multiple ? value ?? [] : [value]);
  const rows = options.map(o => `<label class="dialog__option">
      <input type="${type}" name="choice" value="${esc(o.value)}" ${chosen.has(o.value) ? 'checked' : ''}>
      <span dir="auto">${esc(o.label)}</span></label>`).join('');
  const d = open('dialog', `${head(title)}<div class="dialog__options">${rows}</div>${buttons([['0', cancel, 'btn--text'], ['1', ok, 'btn--text']])}`, title);
  return result(d, v => {
    if (v !== '1') return null;
    const picked = [...d.querySelectorAll('input:checked')].map(i => options.find(o => String(o.value) === i.value).value);
    return multiple ? picked : picked[0] ?? null;
  });
}

/** A bottom sheet holding contentEl; returns close(). */
export function modalSheet(contentEl, { label, onClose } = {}) {
  const d = open('sheet', '<div class="sheet__handle" aria-hidden="true"></div>', label);
  d.append(contentEl);
  d.addEventListener('close', () => onClose?.());
  return () => d.open && d.close('');
}
