// Shared WebAudio context. Browsers (the Quest browser included) only start audio
// after a user gesture, so unlockAudio() runs synchronously in the Enter / Preview
// click. Phase 6 adds the sound effects and team radio playback on this context.

let ctx = null;

/**
 * Create or resume the AudioContext and play one silent sample. Call it inside a click
 * handler, before any await. Never throws.
 * @returns {AudioContext|null}
 */
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => { /* still locked */ });
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  } catch (_) { /* audio unavailable */ }
  return ctx;
}

/** @returns {AudioContext|null} the unlocked context, or null before unlockAudio() */
export function getAudioContext() {
  return ctx;
}

// ---- Team radio playback (contract: CONTRACTS.md "Audio"). Minimal version added by the
// Phase 5 screen work; the Phase 4b audio work owns this block and may replace it. ----

let radioEl = null;
let radioUrl = null;
const radioListeners = new Set();

function emitRadio() {
  const st = getRadioState();
  for (const cb of radioListeners) { try { cb(st); } catch (_) { /* ignore */ } }
}

/** Play one team radio clip (stops the current one). Manual play ignores the radio setting. */
export function playRadio(url) {
  if (!url) return;
  try {
    if (!radioEl) {
      radioEl = new Audio();
      radioEl.preload = 'auto';
      for (const ev of ['playing', 'pause', 'ended', 'error']) radioEl.addEventListener(ev, emitRadio);
    }
    radioEl.pause();
    radioUrl = url;
    radioEl.src = url;
    const p = radioEl.play();
    if (p && p.catch) p.catch(() => emitRadio());
  } catch (_) { /* audio unavailable */ }
  emitRadio();
}

export function stopRadio() {
  if (radioEl) radioEl.pause();
  radioUrl = null;
  emitRadio();
}

/** @returns {{url: string|null, playing: boolean}} */
export function getRadioState() {
  return { url: radioUrl, playing: !!(radioEl && radioUrl && !radioEl.paused && !radioEl.ended) };
}

/** @returns {() => void} unsubscribe */
export function onRadioChange(cb) {
  radioListeners.add(cb);
  return () => radioListeners.delete(cb);
}
