// Port of A/tour/StopJump.kt: the one way the walker changes stop (bar, Previous, marker, list, walking mode,
// media keys). Each jump offers Undo.
import { player } from './player.js';
import { getSettings } from './store.js';
import { nextId, prevId, pos } from './walk.js';
import { t, isolate } from './i18n.js';
import { show as snackbar } from './ui/snackbar.js';

export const GUARD_MS = 700;
const UNDO_MS = 6000;

let changedAt = -Infinity;
let lastKey = null;
let dismissUndo = () => {};
const now = () => performance.now();

// A double tap or a glove bounce within GUARD_MS of any stop change (auto-play included) must not skip a second stop.
player.on('change', s => {
  const key = `${s.tourId}/${s.index}`;
  if (key !== lastKey) {
    lastKey = key;
    changedAt = now();
  }
});

/**
 * Moves to stops[index]. Lands playing when `play` (default: audio was playing), except that with auto-play
 * off a jump always lands paused. Returns the undo point, or null when the jump was ignored.
 */
export function jumpTo(index, { reason = 'tap', play } = {}) {
  const s = player.state;
  if (!s.tourId || index === s.index || index < 0 || index >= s.stops.length || now() - changedAt < GUARD_MS) return null;
  const undo = { index: s.index, positionMs: s.positionMs, playing: s.playing, ended: s.ended };
  player.selectStop(index, { play: (play ?? s.playing) && getSettings().autoPlay });
  const stop = s.stops[index];
  dismissUndo = snackbar({
    text: t('b_now_at', pos(s.order, stop.id) + 1, isolate(stop.title)),
    action: t('b_undo'),
    ms: UNDO_MS,
    onAction: () => {
      changedAt = now();
      player.selectStop(undo.index, { positionMs: undo.ended ? 0 : undo.positionMs });
      if (undo.playing) player.play();
    },
  });
  return { ...undo, reason };
}

/** The Undo belongs to the screen that jumped; it leaves with it. */
export const dismissJumpUndo = () => dismissUndo();

/** The next / previous stop in the walk's order; null at the ends. */
export function jumpNext(opts) {
  const s = player.state;
  const n = s.tourId && nextId(s.order, s.index + 1);
  return n ? jumpTo(n - 1, opts) : null;
}

export function jumpPrev(opts) {
  const s = player.state;
  const p = s.tourId && prevId(s.order, s.index + 1);
  return p ? jumpTo(p - 1, opts) : null;
}

if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('nexttrack', () => jumpNext({ reason: 'media' }));
    navigator.mediaSession.setActionHandler('previoustrack', () => jumpPrev({ reason: 'media' }));
  } catch { /* unsupported action */ }
}
