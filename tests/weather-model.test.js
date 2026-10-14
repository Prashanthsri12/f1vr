// Weather model (js/weather-model.js, 13.7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newWeather, weatherAt, lerpAngle, sunAt, cloudEstimate, compass } from '../js/weather-model.js';

const T0 = Date.parse('2024-03-02T15:00:00Z'); // Bahrain, +03:00 -> 18:00 local
const sample = (min, o) => ({ date: T0 + min * 60000, air_temperature: 20, track_temperature: 30, humidity: 60, pressure: 1010, wind_speed: 2, wind_direction: 350, rainfall: 0, ...o });

function fakeData({ samples, compounds = {} }) {
  const times = Float64Array.from(samples.map((s) => s.date));
  const drivers = Object.keys(compounds).map((n) => ({ number: +n }));
  return {
    session: { gmtOffsetMin: 180 },
    drivers,
    getWeatherSeries: () => ({ times, items: samples }),
    getDriverLaps: () => [{ lap_number: 5, date_start: T0 - 1 }],
    getDriverStints: (n) => [{ lap_start: 1, lap_end: 20, compound: compounds[n] }],
  };
}

test('fields interpolate between samples; wind turns the short way', () => {
  const d = fakeData({ samples: [sample(0), sample(1, { air_temperature: 22, wind_direction: 10 })] });
  const w = weatherAt(d, T0 + 30000, newWeather());
  assert.ok(w.ok);
  assert.equal(w.airTemp, 21);
  assert.equal(Math.round(w.windDir), 0);
  assert.equal(lerpAngle(350, 10, 0.25), 355);
});

test('rain level: 0 when dry, drizzle on slicks, heavier as the field goes wet', () => {
  const dry = weatherAt(fakeData({ samples: [sample(0)], compounds: { 1: 'SOFT' } }), T0, newWeather());
  assert.equal(dry.rainLevel, 0);
  const drizzle = weatherAt(fakeData({ samples: [sample(0, { rainfall: 1 })], compounds: { 1: 'SOFT', 2: 'MEDIUM' } }), T0, newWeather());
  assert.equal(drizzle.rainLevel, 0.25);
  assert.equal(drizzle.trackWet, false);
  const heavy = weatherAt(fakeData({ samples: [sample(0, { rainfall: 1 })], compounds: { 1: 'WET', 2: 'WET' } }), T0, newWeather());
  assert.equal(heavy.rainLevel, 1);
  assert.ok(heavy.cloud >= 0.95);
  const wetTrack = weatherAt(fakeData({ samples: [sample(0)], compounds: { 1: 'INTERMEDIATE', 2: 'INTERMEDIATE' } }), T0, newWeather());
  assert.equal(wetTrack.rainLevel, 0);
  assert.equal(wetTrack.trackWet, true);
});

test('sun: up at local noon, set at night; daylight follows', () => {
  const o = newWeather();
  sunAt(Date.parse('2024-03-02T10:00:00Z'), 180, o); // 13:00 local
  assert.ok(o.sunElevation > 55 && o.daylight === 1);
  sunAt(Date.parse('2024-03-02T18:00:00Z'), 180, o); // 21:00 local
  assert.ok(o.sunElevation < -20 && o.daylight === 0);
  sunAt(Date.parse('2024-03-02T23:30:00Z'), 180, o); // 02:30 local
  assert.equal(o.sunElevation, -30);
});

test('cloud estimate: a hot track in daylight means clearer sky', () => {
  const base = { humidity: 60, airTemp: 25, rainfall: 0, rainLevel: 0, daylight: 1 };
  assert.ok(cloudEstimate({ ...base, trackTemp: 45 }) < cloudEstimate({ ...base, trackTemp: 27 }));
  assert.equal(compass(350), 'N');
  assert.equal(compass(135), 'SE');
});
