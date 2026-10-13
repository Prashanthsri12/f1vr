// Driver picker (spec §3): an arc of small tiles at waist height, one Panel per driver.
// Tiles show team colour, number, acronym and current position; tapping selects.
// Tile order is fixed at construction (grid order) so tiles never reshuffle.
import * as THREE from 'three';
import { Panel, THEME, font, roundRect } from './panel-base.js';
import { LAYOUT } from './layout.js';

const L = LAYOUT.driverPicker;
const DEG = Math.PI / 180;

/** Relative luminance of '#rrggbb' (0..1). */
function luminance(hex) {
  const n = parseInt((hex || '#888888').slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Shared per-time leaderboard lookup so 20 tiles cost one getLeaderboardAt per playhead time. */
class StandingsCache {
  constructor(data) {
    this.data = data;
    this.t = NaN;
    this.byNumber = new Map();
  }

  /** @returns {{position:number|null, retired:boolean}|undefined} */
  get(number, t) {
    if (t !== this.t) {
      this.t = t;
      this.byNumber.clear();
      for (const row of this.data.getLeaderboardAt(t)) this.byNumber.set(row.driverNumber, row);
    }
    return this.byNumber.get(number);
  }
}

export class DriverTile extends Panel {
  constructor(driver, standings) {
    super({ name: `driver:${driver.number}`, width: L.tile, height: L.tile, maxHz: 4 });
    this.driver = driver;
    this.standings = standings;
    this.fg = luminance(driver.teamColour) > 0.45 ? '#111318' : '#ffffff';
    this._shown = { selected: null, position: undefined, retired: null };
  }

  refresh(ctx) {
    const row = this.standings.get(this.driver.number, ctx.time);
    const position = row ? row.position : null;
    const retired = !!(row && row.retired);
    const selected = ctx.selected === this.driver.number;
    const s = this._shown;
    if (s.selected === selected && s.position === position && s.retired === retired) return false;
    s.selected = selected; s.position = position; s.retired = retired;
    return true;
  }

  onHit(hit, ctx) {
    if (hit.id === 'tile') ctx.actions.selectDriver(this.driver.number);
  }

  draw(g, w, h) {
    const d = this.driver;
    const { selected, position, retired } = this._shown;
    const hov = this.hover === 'tile';
    g.clearRect(0, 0, w, h);
    // team colour body
    g.fillStyle = d.teamColour || '#888888';
    roundRect(g, 0, 0, w, h, 14);
    g.fill();
    // darker footer band for the acronym
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, h - 34, w, 34);

    g.textBaseline = 'alphabetic';
    // position, top-left
    g.fillStyle = this.fg;
    g.textAlign = 'left';
    g.font = font(24, 700);
    g.fillText(retired ? 'OUT' : position ? `P${position}` : '', 14, 32);
    // number, big
    g.textAlign = 'center';
    g.font = font(54, 700);
    g.fillText(String(d.number), w / 2, 80);
    // acronym
    g.fillStyle = '#ffffff';
    g.font = font(26, 700);
    g.fillText(d.acronym || '', w / 2, h - 10);

    if (retired) {
      g.fillStyle = 'rgba(13,16,22,0.62)';
      roundRect(g, 0, 0, w, h, 14);
      g.fill();
    }
    if (selected) {
      g.strokeStyle = THEME.accent;
      g.lineWidth = 9;
      roundRect(g, 4.5, 4.5, w - 9, h - 9, 11);
      g.stroke();
    } else if (hov) {
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 6;
      roundRect(g, 3, 3, w - 6, h - 6, 12);
      g.stroke();
    }
    this.addHit('tile', 0, 0, w, h);
  }
}

export class DriverPicker {
  /** @param {import('../session-data.js').SessionData} data */
  constructor(data) {
    this.data = data;
    this.standings = new StandingsCache(data);
    // Fixed order: grid / start order (positions at the race start); unknowns by number.
    const t0 = Number.isFinite(data.raceStartTime) ? data.raceStartTime : data.dataStartTime;
    const pos = (n) => data.getPositionAt(n, t0) ?? 99;
    const drivers = [...data.drivers].sort((a, b) => pos(a.number) - pos(b.number) || a.number - b.number);
    this.tiles = drivers.map((d) => new DriverTile(d, this.standings));
    // All tiles move as one unit (panel-grab): a group at the front-centre of the arc, facing +Z.
    this.group = new THREE.Group();
    this.group.name = 'driver-picker';
    this.group.position.set(0, L.y, -L.radius);
  }

  /**
   * Place the tiles in two rows of an arc centred on the user (LAYOUT.driverPicker).
   * 20 tiles of 0.12 m do not fit one 120° arc at 0.62 m (1.3 m of arc for 2.7 m of tiles),
   * so the first half (P1…) goes on the upper/back row and the rest on the lower/front row,
   * which together span ~112°. Columns line up (same angular step for both rows).
   * @param {{add: Function}} manager PanelManager (only add() is used)
   */
  addTo(manager) {
    manager.group.add(this.group);
    const n = this.tiles.length;
    const perRow = Math.ceil(n / 2);
    const pitch = L.tile + L.gap;
    const stepDeg = Math.min(perRow > 1 ? L.spanDeg / (perRow - 1) : 0, (pitch / L.radius) / DEG);
    // Back row sits one tile pitch "up" the tilted console surface.
    const tilt = L.tiltDeg * DEG;
    const rows = [
      { r: L.radius + pitch * Math.sin(tilt), y: L.y + pitch * Math.cos(tilt) },
      { r: L.radius, y: L.y },
    ];
    for (let i = 0; i < n; i++) {
      const row = rows[i < perRow ? 0 : 1];
      const col = i < perRow ? i : i - perRow;
      const count = i < perRow ? perRow : n - perRow;
      const az = (col - (count - 1) / 2) * stepDeg * DEG;
      const position = { x: row.r * Math.sin(az), y: row.y, z: -row.r * Math.cos(az) };
      manager.add(this.tiles[i], position, { tiltDeg: L.tiltDeg, parent: this.group });
      this.tiles[i].mesh.position.sub(this.group.position); // rig-local -> group-local (no rotation yet)
    }
  }

  dispose() {
    for (const t of this.tiles) t.dispose();
    this.tiles.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
