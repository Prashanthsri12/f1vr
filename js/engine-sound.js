// Engine hum (9.13, optional, off by default): a quiet synthesised tone that follows the
// selected driver's RPM and throttle from car_data. No recorded audio. The firing frequency
// of a V6 is rpm / 60 × 3; the hum plays an octave below that so it stays soft. Silent while
// paused, buffering, above 2x, without telemetry, or before audio is unlocked by a click.
import { getAudioContext } from './audio.js';

const MAX_GAIN = 0.035;
const GLIDE = 0.06;    // s, frequency / gain smoothing
const MAX_RATE = 2;    // playback speeds above this mute the hum

export function createEngineSound() {
  let nodes = null;    // { osc, sub, filter, gain }
  let level = 0;

  function build(ctx) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain).connect(ctx.destination);
    osc.start();
    sub.start();
    return { osc, sub, filter, gain };
  }

  return {
    /**
     * @param {boolean} on setting enabled and playback running at ≤ 2x
     * @param {number} rate playback speed
     * @param {{rpm: number, throttle: number}|null} tel telemetry at the playhead, or null
     */
    update(on, rate, tel) {
      const ctx = getAudioContext();
      if (!ctx) return;
      const want = on && rate <= MAX_RATE && tel && tel.rpm > 0;
      if (!want && !nodes) return;
      if (!nodes) nodes = build(ctx);
      const t = ctx.currentTime;
      const target = want ? MAX_GAIN * (0.35 + 0.65 * Math.min(1, Math.max(0, tel.throttle / 100))) : 0;
      if (Math.abs(target - level) > 1e-4) {
        nodes.gain.gain.setTargetAtTime(target, t, GLIDE);
        level = target;
      }
      if (want) {
        const f = (tel.rpm / 60) * 3 * 0.5;
        nodes.osc.frequency.setTargetAtTime(f, t, GLIDE);
        nodes.sub.frequency.setTargetAtTime(f * 0.5, t, GLIDE);
        nodes.filter.frequency.setTargetAtTime(500 + 900 * Math.min(1, tel.throttle / 100), t, GLIDE);
      }
    },
    dispose() {
      if (!nodes) return;
      try { nodes.osc.stop(); nodes.sub.stop(); nodes.gain.disconnect(); } catch (_) { /* already stopped */ }
      nodes = null;
    },
  };
}
