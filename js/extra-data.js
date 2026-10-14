// Phase 13 extra datasets, loaded in the background after the replay starts (13.2):
//   - overtakes (race / sprint): the OpenF1 `overtakes` records
//   - the weekend's qualifying sessions (Qualifying, Sprint Qualifying / Shootout): laps, race
//     control (phases, deleted times), results and the starting grid (keyed by the quali session)
//   - the season so far: the year's race and sprint sessions, and the drivers' and teams'
//     championship after each of them (one ranged request each, up to this meeting)
// Everything goes through api.js (cached, rate-limited) at a low priority so the replay's own
// chunks come first. Each part settles on its own; listeners are told when anything arrives.
// Not live-ready: a live source would push these instead.

const PRIORITY = -2;
const QUALI_NAMES = ['Qualifying', 'Sprint Qualifying', 'Sprint Shootout'];

const toMs = (v) => (v == null ? null : Date.parse(v));

/**
 * @param {import('./session-data.js').SessionData} data
 * @param {{fetchJson?: Function, currentYear?: number}} [o] fetchJson is injectable for tests
 */
export function createExtraData(data, { fetchJson = null, currentYear = new Date().getUTCFullYear() } = {}) {
  const s = data.session;
  const listeners = new Set();
  let disposed = false;
  const out = {
    /** 'loading' | 'ok' | 'none' | 'error' per part */
    status: { overtakes: 'loading', quali: 'loading', season: 'loading' },
    /** @type {object[]} raw overtakes, sorted by time (ms in `t`) */
    overtakes: [],
    /** @type {{key: number, name: string, start: number, end: number, laps: object[], raceControl: object[], results: object[], grid: object[]}[]} */
    qualis: [],
    /** @type {{rounds: object[], drivers: object[], teams: object[]}} */
    season: { rounds: [], drivers: [], teams: [] },
    version: 0,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    dispose() { disposed = true; listeners.clear(); },
  };
  const changed = () => {
    if (disposed) return;
    out.version++;
    for (const cb of listeners) { try { cb(out); } catch (e) { console.warn('[f1vr] extra-data listener', e); } }
  };

  const get = async (endpoint, params, cache = true) => {
    const fj = fetchJson || (await import('./api.js')).fetchJson;
    const r = await fj(endpoint, params, { priority: PRIORITY, cache });
    return Array.isArray(r) ? r : [];
  };
  const past = (s.year ?? currentYear) < currentYear;

  async function loadOvertakes() {
    if (!data.hasIntervals) { out.status.overtakes = 'none'; return; }
    const raw = await get('overtakes', { session_key: s.key });
    out.overtakes = raw.map((r) => ({ ...r, t: toMs(r.date) })).filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
    out.status.overtakes = out.overtakes.length ? 'ok' : 'none';
  }

  async function loadQuali() {
    if (s.meetingKey == null) { out.status.quali = 'none'; return; }
    const sessions = await get('sessions', { meeting_key: s.meetingKey }, past);
    const qs = sessions.filter((x) => QUALI_NAMES.includes(x.session_name))
      .sort((a, b) => toMs(a.date_start) - toMs(b.date_start));
    const grid = qs.length ? await get('starting_grid', { meeting_key: s.meetingKey }) : [];
    for (const q of qs) {
      if (disposed) return;
      // The main Qualifying first: it is the one the Quali tab opens on.
      const [laps, raceControl, results] = await Promise.all([
        get('laps', { session_key: q.session_key }),
        get('race_control', { session_key: q.session_key }),
        get('session_result', { session_key: q.session_key }),
      ]);
      out.qualis.push({
        key: q.session_key, name: q.session_name, start: toMs(q.date_start), end: toMs(q.date_end),
        laps, raceControl, results, grid: grid.filter((g) => g.session_key === q.session_key),
      });
      out.qualis.sort((a, b) => (a.name === 'Qualifying' ? -1 : b.name === 'Qualifying' ? 1 : a.start - b.start));
      changed();
    }
    out.status.quali = out.qualis.length ? 'ok' : 'none';
  }

  async function loadSeason() {
    if (s.year == null || s.meetingKey == null) { out.status.season = 'none'; return; }
    const sessions = await get('sessions', { year: s.year }, past);
    const rounds = sessions.filter((x) => x.session_type === 'Race' && !x.is_cancelled && x.meeting_key <= s.meetingKey)
      .map((x) => ({
        key: x.session_key, meetingKey: x.meeting_key, name: x.session_name, sprint: x.session_name !== 'Race',
        circuit: x.circuit_short_name, country: x.country_name, countryCode: x.country_code, start: toMs(x.date_start), end: toMs(x.date_end),
      }))
      .sort((a, b) => a.start - b.start);
    if (!rounds.length) { out.status.season = 'none'; return; }
    const range = { 'meeting_key>=': rounds[0].meetingKey, 'meeting_key<=': s.meetingKey };
    const [drivers, teams] = await Promise.all([get('championship_drivers', range, past), get('championship_teams', range, past)]);
    out.season = { rounds, drivers, teams };
    out.status.season = drivers.length || teams.length ? 'ok' : 'none';
  }

  const part = (name, fn) => fn().then(() => changed(), (err) => {
    if (disposed) return;
    console.warn(`[f1vr] ${name} unavailable`, err);
    out.status[name] = 'error';
    changed();
  });
  out.ready = Promise.all([part('overtakes', loadOvertakes), part('quali', loadQuali), part('season', loadSeason)]);
  return out;
}
