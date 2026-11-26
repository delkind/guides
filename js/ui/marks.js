// Brand marks as HTML strings (A/ui/theme/Marks.kt) and the stop picture from the old map.js.
import { t, plural, isolate } from '../i18n.js';
import { mediaUrl } from '../data.js';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const icon = (name, cls = '') => `<span class="msr ${cls}" aria-hidden="true">${name}</span>`;

/** Painted trail blaze carrying the stop number. kind current|ahead|done, size 26|30|36|44. */
export function blaze(n, kind = 'ahead', size = 26) {
  return `<span class="blaze blaze--${kind} blaze--${size}">${esc(n)}</span>`;
}

/** Enamel street-name plate used for city names. */
export function plate(text, small = false) {
  return `<span class="plate${small ? ' plate--small' : ''}"><span class="plate__text" dir="auto">${esc(text)}</span></span>`;
}

/** One segment per stop of the walk: walked, current, ahead. currentPos is the 0-based position in order. */
export function trail(count, currentPos, order = null) {
  const segs = Array.from({ length: count }, (_, i) => {
    const kind = i < currentPos ? 'done' : i === currentPos ? 'current' : 'ahead';
    return `<span class="trail__seg trail__seg--${kind}"${order ? ` data-id="${order[i]}"` : ''}></span>`;
  }).join('');
  return `<div class="trail" role="img" aria-label="${esc(plural('trail_description', count, currentPos + 1, count))}">${segs}</div>`;
}

/** "Photo: author, licence" (CC BY attribution). */
export function creditLine(credit) {
  if (!credit) return '';
  const { author, license } = credit;
  if (author && license) return t('credit_photo', isolate(author), isolate(license));
  if (author) return t('credit_photo_by', isolate(author));
  return license ?? '';
}

export function creditPill(credit) {
  const line = creditLine(credit);
  return line ? `<span class="credit-pill" dir="auto">${esc(line)}</span>` : '';
}

/**
 * A stop picture: the blurred preview, then the image crossfading in, the credit and, when it fails,
 * one line "Picture didn't load. Retry". expand: an href for the full-screen viewer, or falsy.
 */
export function picture(image, tourId, { height, expand } = {}) {
  if (!image) return '';
  const src = mediaUrl(tourId, image.src);
  const style = [image.preview && `background-image:url(&quot;${esc(image.preview)}&quot;)`, height && `height:${Number(height)}px`]
    .filter(Boolean).join(';');
  return `<figure class="pic pic--loading" style="${style}">
    <img class="pic__img" src="${esc(src)}" alt="${esc(image.alt)}" width="${Number(image.width) || ''}" height="${Number(image.height) || ''}" decoding="async">
    ${creditPill(image.credit).replace('credit-pill', 'credit-pill pic__credit')}
    ${expand ? `<a class="pic__zoom glass" href="${esc(expand)}" aria-label="${esc(t('tour_open_picture'))}">${icon('open_in_full')}</a>` : ''}
    <button type="button" class="pic__retry" hidden>${esc(t('picture_retry'))}</button>
  </figure>`;
}

/** The credit list for the photo viewer: author, licence link, source link. */
export function creditLinks(credit) {
  if (!credit) return '';
  const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;
  let source = '';
  try {
    const host = new URL(credit.source).hostname;
    source = host.endsWith('wikimedia.org') ? t('credit_source') : host;
  } catch { /* no source */ }
  return `<ul class="credit-links">${[
    credit.author && `<li dir="auto">${esc(t('credit_photo_by', isolate(credit.author)))}</li>`,
    credit.license && `<li dir="auto">${credit.license_url ? link(credit.license_url, credit.license) : esc(credit.license)}</li>`,
    source && `<li>${link(credit.source, source)}</li>`,
  ].filter(Boolean).join('')}</ul>`;
}

// picture() returns a string, so its load/error/retry behaviour is delegated once for the whole document.
if (typeof document !== 'undefined') {
  document.addEventListener('load', e => {
    if (e.target.classList?.contains('pic__img')) e.target.closest('.pic')?.classList.remove('pic--loading');
  }, true);
  document.addEventListener('error', e => {
    if (!e.target.classList?.contains('pic__img')) return;
    const fig = e.target.closest('.pic');
    fig?.classList.replace('pic--loading', 'pic--failed');
    const retry = fig?.querySelector('.pic__retry');
    if (retry) retry.hidden = false;
  }, true);
  document.addEventListener('click', e => {
    const retry = e.target.closest?.('.pic__retry');
    if (!retry) return;
    const fig = retry.closest('.pic');
    const img = fig.querySelector('.pic__img');
    retry.hidden = true;
    fig.classList.replace('pic--failed', 'pic--loading');
    const u = new URL(img.src);
    u.searchParams.set('retry', Date.now());
    img.src = u.href;
  });
}
