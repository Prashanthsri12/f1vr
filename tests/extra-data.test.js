// Extra datasets loader (js/extra-data.js, 13.2) with an injected fetchJson.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtraData } from '../js/extra-data.js';

function fakeFetch(tables) {
  const calls = [];
  const fn = async (endpoint, params, opts) => {
    calls.push({ endpoint, params, opts });
    const f = tables[endpoint];
    return typeof f === 'function' ? f(params) : f ?? [];
  };
  fn.calls = calls;
  return fn;
}

const race = { session: { key: 9472, meetingKey: 1229, year: 2024 }, hasIntervals: true };

test('loads overtakes, the weekend quali sessions and the season, at low priority', async () => {
  const fj = fakeFetch({
    overtakes: [{ date: '2024-03-02T15:10:00Z', overtaking_driver_number: 4, overtaken_driver_number: 14, position: 6 },
      { date: '2024-03-02T15:05:00Z', overtaking_driver_number: 1, overtaken_driver_number: 16, position: 1 }],
    sessions: (p) => (p.meeting_key ? [
      { session_key: 9468, session_name: 'Qualifying', date_start: '2024-03-01T16:00:00Z', date_end: '2024-03-01T17:00:00Z' },
      { session_key: 9472, session_name: 'Race', session_type: 'Race', date_start: '2024-03-02T15:00:00Z' },
    ] : [
      { session_key: 9480, meeting_key: 1230, session_name: 'Race', session_type: 'Race', date_start: '2024-03-09T17:00:00Z' },
      { session_key: 9472, meeting_key: 1229, session_name: 'Race', session_type: 'Race', date_start: '2024-03-02T15:00:00Z' },
    ]),
    starting_grid: [{ session_key: 9468, position: 1, driver_number: 1, lap_duration: 89.179 }],
    laps: [{ driver_number: 1, lap_number: 3 }],
    race_control: [{ qualifying_phase: 1 }],
    session_result: [{ driver_number: 1, position: 1 }],
    championship_drivers: [{ session_key: 9472, driver_number: 1, points_current: 26 }],
    championship_teams: [{ session_key: 9472, team_name: 'Red Bull Racing', points_current: 44 }],
  });
  let changes = 0;
  const x = createExtraData(race, { fetchJson: fj, currentYear: 2026 });
  x.onChange(() => changes++);
  await x.ready;
  assert.deepEqual(x.status, { overtakes: 'ok', quali: 'ok', season: 'ok' });
  assert.deepEqual(x.overtakes.map((o) => o.overtaking_driver_number), [1, 4], 'sorted by time');
  assert.equal(x.qualis.length, 1);
  assert.equal(x.qualis[0].key, 9468);
  assert.equal(x.qualis[0].grid.length, 1);
  assert.deepEqual(x.season.rounds.map((r) => r.key), [9472], 'only rounds up to this meeting');
  const champ = fj.calls.find((c) => c.endpoint === 'championship_drivers');
  assert.deepEqual(champ.params, { 'meeting_key>=': 1229, 'meeting_key<=': 1229 });
  assert.ok(fj.calls.every((c) => c.opts.priority < 0), 'background priority');
  assert.ok(changes >= 3);
});

test('practice sessions skip overtakes; failures are per part', async () => {
  const fj = fakeFetch({
    sessions: () => { throw new Error('offline'); },
  });
  const x = createExtraData({ session: { key: 1, meetingKey: 2, year: 2024 }, hasIntervals: false }, { fetchJson: fj, currentYear: 2026 });
  await x.ready;
  assert.equal(x.status.overtakes, 'none');
  assert.equal(x.status.quali, 'error');
  assert.equal(x.status.season, 'error');
});
