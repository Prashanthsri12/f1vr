// trackStatusAt against real race_control messages (2023 Australian GP race, session 7787:
// SC, VSC and three red flags) plus a few BLUE / Other messages that must be ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackStatusAt } from '../js/panels/race-status.js';

// [time (UTC on 2023-04-02), category, flag, scope, sector, message]
const ROWS = [
["04:20:00","Flag","GREEN","Track",null,"GREEN LIGHT - PIT EXIT OPEN"],
["04:31:48","Flag","YELLOW","Sector",15,"YELLOW IN TRACK SECTOR 15"],
["04:31:50","Flag","DOUBLE YELLOW","Sector",15,"DOUBLE YELLOW IN TRACK SECTOR 15"],
["04:32:22","Flag","YELLOW","Sector",16,"YELLOW IN TRACK SECTOR 16"],
["04:34:02","Flag","DOUBLE YELLOW","Sector",18,"DOUBLE YELLOW IN TRACK SECTOR 18"],
["04:35:18","Flag","CLEAR","Sector",16,"CLEAR IN TRACK SECTOR 16"],
["04:35:36","Flag","YELLOW","Sector",16,"YELLOW IN TRACK SECTOR 16"],
["04:37:08","Flag","CLEAR","Sector",16,"CLEAR IN TRACK SECTOR 16"],
["04:39:31","Flag","CLEAR","Sector",18,"CLEAR IN TRACK SECTOR 18"],
["04:40:14","Flag","CLEAR","Sector",15,"CLEAR IN TRACK SECTOR 15"],
["05:03:18","Flag","GREEN","Track",null,"GREEN LIGHT - PIT EXIT OPEN"],
["05:03:18","SessionStatus",null,null,null,"SESSION STARTED"],
["05:03:46","Flag","YELLOW","Sector",5,"YELLOW IN TRACK SECTOR 5"],
["05:04:25","Flag","DOUBLE YELLOW","Sector",5,"DOUBLE YELLOW IN TRACK SECTOR 5"],
["05:04:27","SafetyCar",null,null,null,"SAFETY CAR DEPLOYED"],
["05:07:27","SafetyCar",null,null,null,"SAFETY CAR IN THIS LAP"],
["05:07:34","Flag","CLEAR","Sector",5,"CLEAR IN TRACK SECTOR 5"],
["05:09:12","Flag","CLEAR","Track",null,"TRACK CLEAR"],
["05:14:12","Flag","YELLOW","Sector",9,"YELLOW IN TRACK SECTOR 9"],
["05:14:24","SafetyCar",null,null,null,"SAFETY CAR DEPLOYED"],
["05:17:02","Flag","RED","Track",null,"RED FLAG"],
["05:17:02","Flag","CLEAR","Sector",9,"CLEAR IN TRACK SECTOR 9"],
["05:17:02","SessionStatus",null,null,null,"SESSION ABORTED"],
["05:32:43","Flag","CLEAR","Track",null,"TRACK CLEAR"],
["05:33:00","SessionStatus",null,null,null,"SESSION STARTED"],
["05:39:29","Flag","CLEAR","Sector",9,"CLEAR IN TRACK SECTOR 9"],
["05:48:36","SafetyCar",null,null,null,"VIRTUAL SAFETY CAR DEPLOYED"],
["05:50:38","SafetyCar",null,null,null,"VIRTUAL SAFETY CAR ENDING"],
["05:50:52","Flag","CLEAR","Track",null,"TRACK CLEAR"],
["06:37:31","Flag","YELLOW","Sector",4,"YELLOW IN TRACK SECTOR 4"],
["06:37:39","Flag","CLEAR","Sector",4,"CLEAR IN TRACK SECTOR 4"],
["06:38:32","SafetyCar",null,null,null,"SAFETY CAR DEPLOYED"],
["06:38:32","Flag","CLEAR","Sector",3,"CLEAR IN TRACK SECTOR 3"],
["06:38:32","Flag","CLEAR","Sector",4,"CLEAR IN TRACK SECTOR 4"],
["06:41:07","Flag","RED","Track",null,"RED FLAG"],
["06:41:07","SessionStatus",null,null,null,"SESSION ABORTED"],
["06:51:10","Flag","CLEAR","Track",null,"TRACK CLEAR"],
["06:56:00","SessionStatus",null,null,null,"SESSION STARTED"],
["07:00:14","Flag","YELLOW","Sector",2,"YELLOW IN TRACK SECTOR 2"],
["07:00:22","Flag","YELLOW","Sector",4,"YELLOW IN TRACK SECTOR 4"],
["07:00:26","Flag","RED","Track",null,"RED FLAG"],
["07:00:26","Flag","CLEAR","Sector",2,"CLEAR IN TRACK SECTOR 2"],
["07:00:26","Flag","CLEAR","Sector",4,"CLEAR IN TRACK SECTOR 4"],
["07:00:26","SessionStatus",null,null,null,"SESSION ABORTED"],
["07:23:16","Flag","CLEAR","Track",null,"TRACK CLEAR"],
["07:33:00","SessionStatus",null,null,null,"SESSION STARTED"],
["07:35:57","SessionStatus",null,null,null,"SESSION FINISHED"],
["07:35:58","Flag","CHEQUERED","Track",null,"CHEQUERED FLAG"],
["07:37:06","Flag","RED","Track",null,"RED FLAG"],
["07:55:05","Flag","DOUBLE YELLOW","Sector",11,"DOUBLE YELLOW IN TRACK SECTOR 11"],
["07:55:08","Flag","CLEAR","Sector",11,"CLEAR IN TRACK SECTOR 11"],
["05:20:00","Flag","BLUE","Driver",null,"WAVED BLUE FLAG FOR CAR 2 (SAR) TIMED AT 15:20:00"],
["05:21:00","Other",null,null,null,"FIA STEWARDS: INCIDENT NOTED"]
];

function fakeData(rows) {
  const items = rows.map(([hms, category, flag, scope, sector, message]) => ({
    date: Date.parse(`2023-04-02T${hms}Z`), category, flag, scope, sector, message,
    lap_number: null, driver_number: null,
  })).sort((a, b) => a.date - b.date);
  let calls = 0;
  return {
    items,
    get calls() { return calls; },
    getRaceControlAt(t, n = 5) {
      calls++;
      const out = [];
      for (let i = items.length - 1; i >= 0 && out.length < n; i--) if (items[i].date <= t) out.push(items[i]);
      return out;
    },
  };
}

const at = (hms) => Date.parse(`2023-04-02T${hms}Z`);
const data = fakeData(ROWS);
const st = (hms) => trackStatusAt(data, at(hms));

test('green before any message and after pit exit opens', () => {
  assert.equal(trackStatusAt(data, at('03:00:00')).status, 'GREEN');
  assert.equal(st('04:25:00').status, 'GREEN');
});

test('sector yellows: yellow until every sector is cleared, double yellow label', () => {
  assert.equal(st('04:31:49').status, 'YELLOW');
  assert.equal(st('04:31:49').label, 'YELLOW');
  assert.equal(st('04:31:55').label, 'DOUBLE YELLOW');
  assert.equal(st('04:39:40').status, 'YELLOW'); // sector 15 still double yellow
  assert.equal(st('04:40:20').status, 'GREEN');
});

test('safety car: deployed, in this lap, ended by TRACK CLEAR', () => {
  const s = st('05:05:00');
  assert.deepEqual([s.status, s.label, s.colour], ['SC', 'SAFETY CAR', '#ff8a00']);
  assert.equal(st('05:08:00').label, 'SC ENDING');
  assert.equal(st('05:08:00').status, 'SC');
  assert.equal(st('05:10:00').status, 'GREEN');
});

test('red flag overrides SC and clears on TRACK CLEAR', () => {
  assert.equal(st('05:15:00').status, 'SC');
  assert.equal(st('05:17:02').status, 'RED');
  assert.equal(st('05:25:00').label, 'RED FLAG');
  assert.equal(st('05:35:00').status, 'GREEN');
});

test('virtual safety car and VSC ending', () => {
  assert.deepEqual([st('05:49:00').status, st('05:49:00').label], ['VSC', 'VSC']);
  assert.deepEqual([st('05:50:40').status, st('05:50:40').label], ['VSC', 'VSC ENDING']);
  assert.equal(st('05:51:00').status, 'GREEN');
});

test('blue flags and Other messages do not change status', () => {
  assert.equal(st('05:20:30').status, 'RED');
  assert.equal(st('05:21:30').status, 'RED');
});

test('late-race SC -> red, red -> red, then chequered sticks through post-race red/yellow', () => {
  assert.equal(st('06:39:00').status, 'SC');
  assert.equal(st('06:45:00').status, 'RED');
  assert.equal(st('07:00:24').status, 'YELLOW');
  assert.equal(st('07:10:00').status, 'RED');
  assert.equal(st('07:34:00').status, 'GREEN');
  assert.equal(st('07:36:30').status, 'CHEQUERED');
  assert.equal(st('07:40:00').status, 'CHEQUERED');
  assert.equal(st('07:55:06').status, 'CHEQUERED');
});

test('qualifying: chequered ends a part, next GREEN starts the next', () => {
  const q = fakeData([
    ['10:00:00', 'Flag', 'GREEN', 'Track', null, 'GREEN LIGHT - PIT EXIT OPEN'],
    ['10:18:00', 'Flag', 'CHEQUERED', 'Track', null, 'CHEQUERED FLAG'],
    ['10:25:00', 'Flag', 'GREEN', 'Track', null, 'GREEN LIGHT - PIT EXIT OPEN'],
    ['10:30:00', 'Flag', 'RED', 'Track', null, 'RED FLAG'],
    ['10:40:00', 'Flag', 'GREEN', 'Track', null, 'GREEN LIGHT - PIT EXIT OPEN'],
  ]);
  const s = (hms) => trackStatusAt(q, at(hms)).status;
  assert.deepEqual(['10:10:00', '10:20:00', '10:26:00', '10:31:00', '10:41:00'].map(s),
    ['GREEN', 'CHEQUERED', 'GREEN', 'RED', 'GREEN']);
});

test('cached: repeated queries with the same newest message reuse the result', () => {
  const d = fakeData(ROWS);
  const a = trackStatusAt(d, at('05:05:00'));
  const before = d.calls;
  for (let i = 0; i < 100; i++) assert.equal(trackStatusAt(d, at('05:05:00') + i), a);
  assert.equal(d.calls - before, 100); // one getRaceControlAt(t, 1) per call, no replays
});

test('rebuilds when a new message appears (live source)', () => {
  const d = fakeData(ROWS.slice(0, 3));
  assert.equal(trackStatusAt(d, at('04:31:49')).status, 'YELLOW');
  d.items.push({ date: at('08:00:00'), category: 'SafetyCar', flag: null, scope: null, sector: null,
    message: 'VIRTUAL SAFETY CAR DEPLOYED' });
  assert.equal(trackStatusAt(d, at('08:00:01')).status, 'VSC');
});
