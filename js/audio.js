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
