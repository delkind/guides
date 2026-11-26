// "Ask about this stop" (A/ask/AskSheet.kt, HandOff.kt): a ready prompt with the stop's narration and the walker's
// question, handed to whatever AI app they have through the share sheet, or copied.
import { t, isolate, lang as uiLang } from '../i18n.js';
import { player } from '../player.js';
import { narrationText, walkNo } from '../walk.js';
import { esc, icon, blaze } from '../ui/marks.js';
import { modalSheet } from '../ui/dialog.js';
import { show as snackbar } from '../ui/snackbar.js';
import { tourT } from '../handsfree.js';

export const MAX_QUESTION = 500;
export const COUNTER_FROM = 450;
export const MAX_NARRATION = 6_000;
const RESUME_BACK_MS = 3_000;
const RESUME_OFFER_MS = 8_000;
const IDEAS = ['ask_chip_shorter', 'ask_chip_child', 'ask_chip_look', 'ask_chip_history'];

/** Cuts a runaway narration at a sentence end, so a share stays a few KB. */
export function clip(text, max = MAX_NARRATION) {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const end = Math.max(...['.', '!', '?', '…'].map(c => head.lastIndexOf(c)));
  return `${text.slice(0, end > max / 2 ? end + 1 : max).trimEnd()} …`;
}

/** The ask_handoff_prompt, through tr (a t() in the tour's language); titles are bidi-isolated in an rtl prompt. */
export function buildPrompt(tr, s, stopIndex, question, rtl) {
  const stop = s.stops[stopIndex];
  if (!stop) return '';
  const iso = x => (rtl ? isolate(x) : x);
  return tr('ask_handoff_prompt', iso(s.tour?.title ?? s.tourId ?? ''), iso(s.tour?.city ?? ''), stop.id, s.stops.length,
    iso(stop.title), clip((narrationText(stop) ?? '').trim()), question.trim().slice(0, MAX_QUESTION)).trimEnd();
}

/** Opens the sheet for player.state.stops[stopIndex]; the narration pauses while it is open. */
export async function openAsk(stopIndex) {
  const s = player.state;
  const stop = s.stops[stopIndex];
  if (!stop) return;
  const code = s.tour?.language ?? uiLang();
  const tr = await tourT(code);
  const before = { playing: s.playing, tourId: s.tourId, index: s.index };
  if (s.playing) player.pause();
  const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
  const ideas = IDEAS.map(k => tr(k));

  const el = document.createElement('div');
  el.className = 'hf-ask';
  el.innerHTML = `
    <div class="hf-ask__head">${blaze(walkNo(player.state, stop.id), 'current', 36)}
      <div class="hf-ask__titles"><h2 class="t-title-large">${esc(t('ask_entry'))}</h2>
        <p class="t-body-medium hf-muted hf-ask__stop" dir="auto">${esc(`${walkNo(player.state, stop.id)} · ${isolate(stop.title)}`)}</p></div></div>
    <p class="t-body-medium hf-muted" dir="auto">${esc(t('ask_handoff_body'))}</p>
    <label class="hf-field">
      <span class="hf-field__label">${esc(t('ask_field'))}</span>
      <span class="hf-field__box">
        <textarea class="hf-field__input" rows="3" maxlength="${MAX_QUESTION}" dir="auto" lang="${esc(code)}" data-q></textarea>
        ${Recognition ? `<button type="button" class="icon-btn" data-act="mic" aria-pressed="false" aria-label="${esc(t('ask_voice'))}">${icon('mic')}</button>` : ''}
      </span>
      <span class="hf-field__counter t-body-small tabular" data-count hidden></span>
    </label>
    <p class="t-label-medium hf-muted">${esc(t('ask_ideas'))}</p>
    <div class="hf-ask__ideas" lang="${esc(code)}">${ideas.map((idea, i) =>
      `<button type="button" class="chip" aria-pressed="false" data-idea="${i}" dir="auto">${icon('check')}<span>${esc(idea)}</span></button>`).join('')}</div>
    <button type="button" class="btn btn--filled hf-big hf-ask__go" data-act="go">${icon('share')}${esc(t('ask_handoff_go'))}</button>
    <button type="button" class="btn btn--text hf-ask__copy" data-act="copy">${icon('content_copy')}${esc(t('ask_copy'))}</button>
    <p class="t-body-small hf-ask__status" role="status" data-status></p>
    <p class="t-body-small hf-muted hf-ask__note">${icon('pause')}<span dir="auto">${esc(t('ask_handoff_note'))}</span></p>`;
  const q = el.querySelector('[data-q]');
  const count = el.querySelector('[data-count]');
  const status = el.querySelector('[data-status]');
  let rec = null;

  const sync = () => {
    count.hidden = q.value.length < COUNTER_FROM;
    count.textContent = `${q.value.length} / ${MAX_QUESTION}`;
    el.querySelectorAll('[data-idea]').forEach(b => b.setAttribute('aria-pressed', String(q.value.includes(ideas[b.dataset.idea]))));
  };
  const set = v => { q.value = v.slice(0, MAX_QUESTION); sync(); };
  q.addEventListener('input', sync);

  const prompt = () => buildPrompt(tr, player.state.tourId === s.tourId ? player.state : s, stopIndex, q.value, code === 'he');
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt());
      status.textContent = t('ask_copied');
    } catch { /* clipboard blocked */ }
  }

  el.addEventListener('click', async e => {
    const idea = e.target.closest('[data-idea]');
    if (idea) {
      const text = ideas[idea.dataset.idea];
      const v = q.value;
      set(v.includes(text) ? v.replace(text, '').trim() : v.trim() ? `${v.trimEnd()} ${text}` : text);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'copy') copy();
    else if (act === 'go') {
      if (!navigator.share) return copy();
      try {
        await navigator.share({ text: prompt() });
      } catch (err) {
        if (err?.name !== 'AbortError') copy();
      }
    } else if (act === 'mic') {
      if (rec) return rec.stop();
      rec = new Recognition();
      rec.lang = code;
      rec.interimResults = false;
      const btn = e.target.closest('[data-act]');
      btn.setAttribute('aria-pressed', 'true');
      rec.onresult = ev => {
        const heard = ev.results[0]?.[0]?.transcript?.trim();
        if (heard) set(q.value.trim() ? `${q.value.trimEnd()} ${heard}` : heard);
      };
      rec.onend = () => { rec = null; btn.setAttribute('aria-pressed', 'false'); };
      try { rec.start(); } catch { rec.onend(); }
    }
  });

  modalSheet(el, {
    label: t('ask_entry'),
    onClose: () => {
      rec?.abort();
      const now = player.state;
      // Resume only what Ask paused, and only if nothing (an arrival, a media key) changed playback since.
      if (!before.playing || now.playing || now.tourId !== before.tourId || now.index !== before.index) return;
      snackbar({
        text: t('ask_paused'),
        action: t('ask_resume'),
        ms: RESUME_OFFER_MS,
        onAction: () => {
          player.seekTo(Math.max(0, player.state.positionMs - RESUME_BACK_MS));
          player.play();
        },
      });
    },
  });
  sync();
}
