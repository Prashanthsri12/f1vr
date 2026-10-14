// Weather model (13.7). Pure (no DOM, no three.js); unit-tested in tests/weather-model.test.js.
//
// Every OpenF1 weather field, linearly interpolated between the per-minute samples:
// air / track temperature, humidity, pressure, wind speed and direction (degrees the wind
// comes FROM, interpolated the short way round), rainfall (0 / 1, from the sample at or before).
//
// Estimates (labelled "est." wherever they are shown; OpenF1 has no such fields):
//   rainLevel 0..1 - 0 when rainfall is 0. When it rains: 0.25 (drizzle) plus how wet the
//                    field is running: intermediates count 1, full wets 2, over 2 × cars.
//   trackWet       - the field is on intermediates / wets (spray even when rainfall is 0)
//   cloud 0..1     - from humidity, dimmed by a big track–air gap in daylight (sun heats the
//                    track), raised to overcast while it rains
// Time of day: local time from the session's gmt_offset. The sun's height and bearing are a
// rough day curve (OpenF1 has no circuit latitude): rise ~06:10, highest ~12:10, set ~18:10.
import { indexAtOrBefore } from './interp.js';
import { currentLap } from './session-index.js';

const WET = { INTERMEDIATE: 1, WET: 2 };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, f) => (a == null ? b : b == null ? a : a + (b - a) * f);

/** A fresh output object for weatherAt (reuse it: no allocation per call). */
export function newWeather() {
  return {
    ok: false, airTemp: null, trackTemp: null, humidity: null, pressure: null,
    windSpeed: 0, windDir: 0, rainfall: 0, rainLevel: 0, trackWet: false, wetShare: 0, cloud: 0,
    localHour: 12, sunElevation: 45, sunAzimuth: 180, daylight: 1,
  };
}

/** Wind direction interpolation the short way round (350° → 10° passes 0°). */
export function lerpAngle(a, b, f) {
  if (a == null) return b ?? 0;
  if (b == null) return a;
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * f + 360) % 360;
}

/**
 * Local time of day in hours (0..24) and the rough sun position.
 * @param {number} t UTC ms
 * @param {number|null} gmtOffsetMin
 */
export function sunAt(t, gmtOffsetMin, out) {
  const local = new Date(t + (gmtOffsetMin ?? 0) * 60000);
  const h = local.getUTCHours() + local.getUTCMinutes() / 60 + local.getUTCSeconds() / 3600;
  const RISE = 6.15, SET = 18.15, PEAK = 62; // an equinox-like 12 h day: night races (Bahrain, Qatar, Singapore) start at dusk or later
  const f = (h - RISE) / (SET - RISE);                  // 0 at sunrise, 1 at sunset
  out.localHour = h;
  // Below the horizon it sinks ~12° an hour, to at most 30° down.
  const night = f < 0 ? -f : f - 1;
  out.sunElevation = f >= 0 && f <= 1 ? PEAK * Math.sin(Math.PI * f) : -Math.min(30, night * (SET - RISE) * 12);
  out.sunAzimuth = 90 + 180 * clamp01(f);               // east in the morning, west in the evening
  out.daylight = clamp01((out.sunElevation + 6) / 16);   // civil twilight to ~10° up
  return out;
}

/**
 * Share of running cars on wet-weather tyres at t: (inters + 2 × wets) / (2 × cars with a known compound).
 * @param {object} data SessionData
 */
export function wetShareAt(data, t) {
  let n = 0, wet = 0;
  for (const d of data.drivers) {
    const lap = currentLap(data.getDriverLaps(d.number), t);
    if (!lap) continue;
    const stint = data.getDriverStints(d.number).find((s) => lap.lap_number >= s.lap_start && lap.lap_number <= (s.lap_end ?? Infinity));
    if (!stint || !stint.compound) continue;
    n++;
    wet += WET[stint.compound] || 0;
  }
  return n ? wet / (2 * n) : 0;
}

/**
 * Cloud cover estimate 0..1.
 * @param {{humidity: number|null, airTemp: number|null, trackTemp: number|null, rainfall: number, rainLevel: number, daylight: number}} w
 */
export function cloudEstimate(w) {
  let c = w.humidity == null ? 0.3 : clamp01((w.humidity - 35) / 55) * 0.7;
  if (w.daylight > 0.5 && w.airTemp != null && w.trackTemp != null) {
    c -= clamp01((w.trackTemp - w.airTemp - 6) / 14) * 0.45; // strong sun on the track: clearer sky
  }
  if (w.rainfall > 0) c = Math.max(c, 0.72 + 0.28 * w.rainLevel);
  return clamp01(c);
}

/**
 * Weather at t into `out`.
 * @param {object} data SessionData (getWeatherSeries or getWeatherAt, drivers, laps, stints, session)
 * @param {number} t UTC ms
 * @param {ReturnType<typeof newWeather>} out
 * @param {{wetShare?: number}} [o] pass a cached wet share to skip the tyre scan
 */
export function weatherAt(data, t, out, { wetShare } = {}) {
  const series = data.getWeatherSeries ? data.getWeatherSeries() : null;
  let a = null, b = null, f = 0;
  if (series && series.times.length) {
    const i = indexAtOrBefore(series.times, t);
    a = series.items[Math.max(0, i)];
    b = series.items[Math.min(series.items.length - 1, i + 1)];
    if (i >= 0 && b !== a) f = clamp01((t - a.date) / (b.date - a.date));
    if (i < 0) b = a;
  } else {
    a = b = data.getWeatherAt ? data.getWeatherAt(t) : null;
  }
  sunAt(t, data.session ? data.session.gmtOffsetMin : 0, out);
  out.ok = !!a;
  if (!a) return out;
  out.airTemp = lerp(a.air_temperature, b.air_temperature, f);
  out.trackTemp = lerp(a.track_temperature, b.track_temperature, f);
  out.humidity = lerp(a.humidity, b.humidity, f);
  out.pressure = lerp(a.pressure, b.pressure, f);
  out.windSpeed = lerp(a.wind_speed, b.wind_speed, f) ?? 0;
  out.windDir = lerpAngle(a.wind_direction, b.wind_direction, f);
  out.rainfall = a.rainfall > 0 ? 1 : 0;
  const share = wetShare ?? wetShareAt(data, t);
  out.wetShare = share;
  out.trackWet = share > 0.15;
  out.rainLevel = out.rainfall ? clamp01(0.25 + 0.75 * share) : 0;
  out.cloud = cloudEstimate(out);
  return out;
}

/** Compass label for a wind direction in degrees. */
export function compass(deg) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/** Short rain label: Light rain / Rain / Heavy rain (est.), Wet track, or Dry. */
export function rainLabel(w) {
  if (w.rainfall > 0) return w.rainLevel < 0.4 ? 'Light rain' : w.rainLevel < 0.75 ? 'Rain' : 'Heavy rain';
  return w.trackWet ? 'Wet track' : 'Dry';
}

/** Sky label from the estimates: Night, Sunny, Partly cloudy, Cloudy or Overcast. */
export function skyLabel(w) {
  if (w.daylight < 0.25) return w.cloud > 0.6 ? 'Cloudy night' : 'Night';
  return w.cloud < 0.25 ? 'Sunny' : w.cloud < 0.5 ? 'Partly cloudy' : w.cloud < 0.75 ? 'Cloudy' : 'Overcast';
}

/** Local time "HH:MM" for a weather output. */
export function localTime(w) {
  const h = Math.floor(w.localHour);
  const m = Math.floor((w.localHour - h) * 60);
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}
