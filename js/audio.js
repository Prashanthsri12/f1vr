// Shared audio: the WebAudio context, team radio playback and short sound effects.
// Browsers (the Quest browser included) only start audio after a user gesture, so
// unlockAudio() runs synchronously in the Enter / Preview click.
//
// Team radio clips (OpenF1 recording_url, livetiming.formula1.com mp3s) are served
// without CORS headers, so they play through a plain <audio> element (no crossOrigin,
// not routed through the AudioContext, which would only output silence).
import { getSettings } from './settings.js';

let ctx = null;

/**
 * Create or resume the AudioContext and play one silent sample. Call it inside a click
 * handler, before any await. Never throws. Also primes the radio element so later
 * autoplay (outside a gesture) is allowed.
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
  primeRadio();
  return ctx;
}

// 8 samples of silence (16-bit mono WAV). Playing it once inside the click "blesses" the
// shared radio element, so later autoplay (outside a gesture) is allowed under strict
// autoplay policies (Android-style Chromium, which the Quest browser may follow).
const SILENCE = 'data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA';
let primed = false;

function primeRadio() {
  if (primed) return;
  try {
    const a = radioEl();
    if (radioState.url) return; // a clip is already playing
    primed = true;
    a.src = SILENCE;
    const p = a.play();
    if (p && p.catch) p.catch(() => { primed = false; });
  } catch (_) { primed = false; }
}

/** @returns {AudioContext|null} the unlocked context, or null before unlockAudio() */
export function getAudioContext() {
  return ctx;
}

// ---------- team radio ----------

let el = null;
const radioState = { url: null, playing: false };
const radioListeners = new Set();

function notify() {
  for (const cb of radioListeners) { try { cb(radioState); } catch (_) { /* ignore */ } }
}

function setState(url, playing) {
  if (radioState.url === url && radioState.playing === playing) return;
  radioState.url = url;
  radioState.playing = playing;
  notify();
}

function radioEl() {
  if (el) return el;
  el = new Audio();
  el.preload = 'auto';
  // Events with no clip set come from the silent priming sample: ignore them.
  el.addEventListener('playing', () => { if (radioState.url) setState(radioState.url, true); });
  el.addEventListener('pause', () => { if (radioState.url) setState(radioState.url, false); });
  el.addEventListener('ended', () => { if (radioState.url) setState(null, false); });
  el.addEventListener('error', () => {
    if (!radioState.url) return;
    console.warn('[f1vr] team radio clip failed to load', radioState.url);
    setState(null, false);
  });
  return el;
}

/**
 * Play one team radio clip, stopping any clip that is playing. Manual play (the main
 * screen's Radio tab) ignores the radio setting; autoplay checks it before calling.
 * @param {string} url recording_url
 */
export function playRadio(url) {
  if (!url) return;
  let a;
  try { a = radioEl(); } catch (_) { return; }
  a.pause();
  radioState.url = url;
  a.src = url;
  const p = a.play();
  if (p && p.catch) {
    p.catch((err) => {
      if (radioState.url === url) {
        console.warn('[f1vr] team radio play blocked', err && err.name);
        setState(null, false);
      }
    });
  }
  notify(); // url changed (playing follows on 'playing')
}

/** Stop the current clip (no-op when nothing plays). */
export function stopRadio() {
  if (el) {
    el.pause();
    el.removeAttribute('src');
    el.load();
  }
  setState(null, false);
}

/** @returns {{url: string|null, playing: boolean}} live state object (do not mutate) */
export function getRadioState() {
  return radioState;
}

/**
 * @param {(state: {url: string|null, playing: boolean}) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onRadioChange(cb) {
  radioListeners.add(cb);
  return () => radioListeners.delete(cb);
}

// ---------- sound effects (generated, no audio files) ----------

const SFX_GAIN = 0.06;
let noise = null;
/** Counts per effect actually played (dev / tests via ?debug). */
export const sfxStats = { chime: 0, whoosh: 0, beep: 0, click: 0 };

function tone(freq, start, dur, peak, type = 'sine') {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

function whoosh(start) {
  if (!noise) {
    noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.5), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(350, start);
  f.frequency.exponentialRampToValueAtTime(2200, start + 0.35);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(SFX_GAIN * 1.4, start + 0.12);
  g.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(start);
  src.stop(start + 0.5);
}

/**
 * Short, quiet effect. No-op when the sfx setting is off or audio isn't unlocked.
 * @param {'chime'|'whoosh'|'beep'|'click'} name
 */
export function playSfx(name) {
  if (!ctx || !getSettings().sfx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t = ctx.currentTime + 0.01;
    if (name === 'chime') {
      tone(880, t, 0.5, SFX_GAIN);
      tone(1318.5, t + 0.12, 0.6, SFX_GAIN * 0.8);
    } else if (name === 'whoosh') {
      whoosh(t);
    } else if (name === 'beep') {
      tone(1568, t, 0.12, SFX_GAIN * 0.7, 'triangle');
      tone(1568, t + 0.16, 0.12, SFX_GAIN * 0.7, 'triangle');
    } else if (name === 'click') {
      tone(2400, t, 0.035, SFX_GAIN * 0.45, 'triangle'); // 9.13: soft UI tick
    } else {
      return;
    }
    sfxStats[name]++;
  } catch (_) { /* audio unavailable */ }
}

/** UI tick for buttons and panel clicks (9.13); same sfx setting as the other effects. */
export function uiClick() {
  playSfx('click');
}
