// Qualifying engine (13.11). Pure (no DOM, no three.js); unit-tested in tests/quali.test.js.
//
// buildQuali() indexes one qualifying session (Qualifying, or Sprint Qualifying / Shootout) from
// raw OpenF1 arrays: laps, race_control and session_result.
//   - Phases: race control Flag messages carry qualifying_phase 1 / 2 / 3. A phase runs from its
//     first GREEN LIGHT to its last CHEQUERED FLAG (a red flag stops and restarts it).
//   - A lap belongs to the phase it started in (a lap started before the flag still counts).
//   - Deleted times: "CAR 10 (GAS) TIME 1:32.434 DELETED - ... LAP 3 ..." removes the lap with that
//     time from the moment of the message; "... REINSTATED" puts it back. Matched by the time: the
//     message's LAP is the lap the car is on when it is sent (2024 Bahrain: GAS's 1:32.434 is lap 2).
//   - Cut sizes: Q1 keeps 10 + ceil((n − 10) / 2) cars (15 of 20, 16 of 22), Q2 keeps 10.
// qualiAt(model, t) is spoiler-free: only laps finished by t and deletions announced by t count.
// Once a phase is over and session_result is there, its official times and order (which include
// the stewards' decisions) replace the computed ones for that phase.
const DEL_RE = /CAR (\d+) \([A-Z]+\) TIME (\d+):(\d+\.\d+) (DELETED|REINSTATED)\b.*?\bLAP (\d+)/;
const ms = (v) => (v == null ? null : typeof v === 'number' ? v : Date.parse(v));

/**
 * @param {{laps: object[], raceControl: object[], results?: object[], name?: string, start?: number, end?: number}} q
 * @returns {object} model for qualiAt
 */
export function buildQuali(q) {
  const sprint = /sprint/i.test(q.name || '');
  const rc = (q.raceControl || []).map((m) => ({ ...m, t: ms(m.date) })).sort((a, b) => a.t - b.t);
  const phases = [];
  for (const m of rc) {
    const k = m.qualifying_phase;
    if (k == null || m.category !== 'Flag') continue;
    let ph = phases[k - 1];
    if (!ph) ph = phases[k - 1] = { n: k, name: `${sprint ? 'SQ' : 'Q'}${k}`, start: null, end: null };
    if (/GREEN/.test(m.flag || '') || /GREEN LIGHT/.test(m.message || '')) { if (ph.start == null) ph.start = m.t; }
    if (m.flag === 'CHEQUERED') ph.end = m.t;
  }
  for (let i = 0; i < 3; i++) if (!phases[i]) phases[i] = { n: i + 1, name: `${sprint ? 'SQ' : 'Q'}${i + 1}`, start: null, end: null };

  const deletions = [];
  for (const m of rc) {
    const r = DEL_RE.exec(m.message || '');
    if (r) deletions.push({ t: m.t, driver: +r[1], lap: +r[5], time: +r[2] * 60 + +r[3], deleted: r[4] === 'DELETED' });
  }

  const byDriver = new Map();
  for (const l of q.laps || []) {
    const start = ms(l.date_start);
    const dur = l.lap_duration;
    if (start == null || !Number.isFinite(dur) || dur <= 0) continue;
    const rec = { driver: l.driver_number, lap: l.lap_number, start, end: start + dur * 1000, time: dur, phase: phaseOf(phases, start), out: !!l.is_pit_out_lap };
    if (!byDriver.has(rec.driver)) byDriver.set(rec.driver, []);
    byDriver.get(rec.driver).push(rec);
  }
  const results = new Map((q.results || []).map((r) => [r.driver_number, r]));
  const drivers = new Set([...byDriver.keys(), ...results.keys()]);
  const n = Math.max(drivers.size, 10);
  return {
    name: q.name || 'Qualifying', sprint, phases, deletions, byDriver, results, drivers: [...drivers],
    keep: [10 + Math.ceil((n - 10) / 2), 10, 10],
    end: phases[2].end ?? q.end ?? null,
  };
}

function phaseOf(phases, t) {
  let k = 1;
  for (const p of phases) if (p.start != null && t >= p.start) k = p.n;
  return k;
}

function deleted(model, driver, lap, t) {
  let del = false;
  for (const d of model.deletions) {
    if (d.t > t) break;
    if (d.driver === driver && Math.abs(d.time - lap.time) < 0.0015) del = d.deleted;
  }
  return del;
}

/**
 * Qualifying state at t (pass Infinity for the final result).
 * @returns {{phase: number, live: boolean, phases: {n: number, name: string, start: number|null, end: number|null, done: boolean,
 *   keep: number, rows: {driver: number, best: number|null, gap: number|null, pos: number, laps: number, status: string, onLap: boolean}[]}[],
 *   final: {driver: number, pos: number, q: (number|null)[], out: number}[]}}
 *   phase: 0 before Q1, 1–3 running or between, 4 after Q3. status: 'through' | 'out' | 'safe' | 'drop' (in the drop zone now)
 */
export function qualiAt(model, t) {
  const cur = model.phases.reduce((k, p) => (p.start != null && t >= p.start ? p.n : k), 0);
  const allDone = model.end != null && t >= model.end;
  const out = { phase: allDone ? 4 : cur, live: !allDone && cur > 0, phases: [], final: [] };
  let field = model.drivers.slice();
  for (const p of model.phases) {
    const done = p.end != null && t >= p.end;
    const started = p.start != null && t >= p.start;
    const keep = model.keep[p.n - 1];
    const official = done && model.results.size > 0;
    const rows = field.map((driver) => {
      const laps = (model.byDriver.get(driver) || []).filter((l) => l.phase === p.n && l.end <= t);
      let best = null;
      for (const l of laps) if (!deleted(model, driver, l, t) && (best == null || l.time < best)) best = l.time;
      if (official) {
        const r = model.results.get(driver);
        const o = r && Array.isArray(r.duration) ? r.duration[p.n - 1] : null;
        best = Number.isFinite(o) ? o : best;
      }
      const onLap = started && !done && (model.byDriver.get(driver) || []).some((l) => l.phase === p.n && l.start <= t && l.end > t && !l.out);
      return { driver, best, gap: null, pos: 0, laps: laps.length, status: 'safe', onLap };
    });
    // By the phase's best time (official once the phase is over); the classification breaks ties.
    const pos = (d) => model.results.get(d)?.position ?? 99;
    rows.sort((a, b) => (a.best == null) - (b.best == null) || (a.best ?? 0) - (b.best ?? 0) || pos(a.driver) - pos(b.driver));
    const top = rows[0] && rows[0].best;
    rows.forEach((r, i) => {
      r.pos = i + 1;
      r.gap = r.best != null && top != null ? r.best - top : null;
      if (p.n < 3) r.status = done ? (i < keep ? 'through' : 'out') : (started && i >= keep ? 'drop' : 'safe');
    });
    out.phases.push({ n: p.n, name: p.name, start: p.start, end: p.end, done, started, keep, rows });
    if (p.n < 3 && done) field = rows.slice(0, keep).map((r) => r.driver);
    if (!done) {
      // Later phases have not started: list them empty.
      for (let k = p.n + 1; k <= 3; k++) {
        const q = model.phases[k - 1];
        out.phases.push({ n: k, name: q.name, start: q.start, end: q.end, done: false, started: false, keep: model.keep[k - 1], rows: [] });
      }
      break;
    }
  }
  // Final classification (after Q3): official positions, else Q3 then Q2 then Q1 order.
  if (allDone) {
    const seen = new Set();
    const order = [];
    for (let k = out.phases.length - 1; k >= 0; k--) {
      const ph = out.phases[k];
      for (const r of ph.rows) if (!seen.has(r.driver) && (k === out.phases.length - 1 || r.status === 'out')) { seen.add(r.driver); order.push({ driver: r.driver, out: ph.n }); }
    }
    for (const d of model.drivers) if (!seen.has(d)) order.push({ driver: d, out: 1 });
    const pos = (d) => model.results.get(d)?.position;
    if (model.results.size) order.sort((a, b) => (pos(a.driver) ?? 99) - (pos(b.driver) ?? 99));
    out.final = order.map((o, i) => {
      const q = [1, 2, 3].map((k) => out.phases[k - 1]?.rows.find((r) => r.driver === o.driver)?.best ?? null);
      return { driver: o.driver, pos: pos(o.driver) ?? i + 1, q, out: o.out };
    });
  }
  return out;
}

/** "1:29.179" */
export function fmtQ(sec) {
  if (sec == null || !Number.isFinite(sec)) return '–';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
