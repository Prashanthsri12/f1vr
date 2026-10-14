// Laps and tyres panel (spec §5): running lap clock, last / personal best / session best,
// last-lap sectors (purple / green / yellow), speed trap and the tyre stint strip,
// all for ctx.selected. Statistics come from the pure LapStats index (lap-stats.js).
import { Panel, THEME, TYRE_COLOURS, font, dfont, rgba, glowStroke, roundRect, fmtLap, panelTitle, sticker } from './panel-base.js';
import { LAYOUT } from './layout.js';
import { LapStats, newLapStatsOut } from './lap-stats.js';
import { getSettings } from '../settings.js';

const PAD = 28;
const SECTOR_FILL = { purple: THEME.purple, green: THEME.green, yellow: THEME.yellow };
const MINI_COLOUR = { 2051: THEME.purple, 2049: THEME.green, 2048: THEME.yellow, 2064: THEME.blue };
const TYRE_INK = { SOFT: '#ffffff', MEDIUM: '#1d1800', HARD: '#111418', INTERMEDIATE: '#06210f', WET: '#ffffff', UNKNOWN: '#111418' };

/** Running clock: m:ss.s (tenths). */
function fmtRun(sec) {
  if (sec == null || !Number.isFinite(sec)) return '–';
  const tenths = Math.floor(sec * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths - m * 600) / 10;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : s.toFixed(1);
}

export class LapsPanel extends Panel {
  constructor(data) {
    super({ name: 'laps', width: LAYOUT.laps.width, height: LAYOUT.laps.height, maxHz: 10 });
    this.data = data;
    this.stats = new LapStats(data);
    this.out = newLapStatsOut();
    this._snap = new Array(13).fill(undefined);
  }

  refresh(ctx) {
    const o = this.stats.compute(ctx.selected, ctx.time, this.out);
    const runTenths = o.running == null ? null : Math.floor(o.running * 10);
    // Everything drawn derives from these (sector colours from the session-best sectors
    // and the last lap); no allocation here.
    this._changed = false;
    this._cmp(0, ctx.selected); this._cmp(1, o.lapNumber); this._cmp(2, runTenths);
    this._cmp(3, o.lastLapNumber); this._cmp(4, o.pb); this._cmp(5, o.sessionBest);
    this._cmp(6, o.sessionBestSectors[0]); this._cmp(7, o.sessionBestSectors[1]);
    this._cmp(8, o.sessionBestSectors[2]); this._cmp(9, o.stintCount); this._cmp(10, o.totalLaps);
    this._cmp(11, o.sessionBestDriver);
    this._cmp(12, getSettings().minis);
    return this._changed;
  }

  _cmp(i, v) {
    if (this._snap[i] !== v) { this._snap[i] = v; this._changed = true; }
  }

  draw(g, w, h, ctx) {
    this.clear(g, w, h);
    const o = this.out;
    const drv = this.data.driverByNumber?.get(ctx.selected);
    g.textBaseline = 'alphabetic';

    // Header: title, driver sticker (10.6), lap counter.
    const titleEnd = panelTitle(g, PAD - 6, 42, 'Laps & tyres', 28);
    if (drv) sticker(g, titleEnd + 18, 24, drv.acronym, { bg: drv.teamColour, px: 22, rot: -3 });
    g.textBaseline = 'alphabetic';
    g.textAlign = 'right';
    g.font = font(26, 600);
    g.fillStyle = THEME.muted;
    const lapTxt = o.lapNumber > 0 ? `LAP ${o.lapNumber}` : 'NOT STARTED';
    const totTxt = o.lapNumber > 0 && this.stats._isRace && this.data.totalLaps ? ` / ${this.data.totalLaps}` : '';
    g.fillText(totTxt, w - PAD, 52);
    const totW = totTxt ? g.measureText(totTxt).width : 0;
    g.fillStyle = THEME.text;
    g.font = dfont(30, 700);
    g.fillText(lapTxt, w - PAD - totW, 53);
    g.fillStyle = THEME.line;
    g.fillRect(PAD, 78, w - 2 * PAD, 2);

    // Left: running clock and the three lap time rows.
    const colR = 560;
    g.textAlign = 'left';
    g.fillStyle = THEME.muted;
    g.font = font(24, 600);
    g.fillText('CURRENT LAP', PAD, 118);
    g.textAlign = 'right';
    g.fillStyle = o.running == null ? THEME.muted : THEME.text;
    g.font = dfont(72, 700);
    g.fillText(fmtRun(o.running), colR, 180);

    const sbHolder = o.sessionBestDriver != null ? this.data.driverByNumber?.get(o.sessionBestDriver) : null;
    const rows = [
      ['LAST LAP', o.lastLap, o.lastLap != null && o.lastLap === o.sessionBest ? THEME.purple
        : o.lastLap != null && o.lastLap === o.pb ? THEME.green : THEME.text, null],
      ['PERSONAL BEST', o.pb, o.pbIsSessionBest ? THEME.purple : THEME.green, null],
      ['SESSION BEST', o.sessionBest, THEME.purple, sbHolder && !o.pbIsSessionBest ? sbHolder.acronym : null],
    ];
    let y = 228;
    for (const [label, val, colour, tag] of rows) {
      g.fillStyle = THEME.surface;
      roundRect(g, PAD - 8, y - 36, colR - PAD + 16, 50, 8);
      g.fill();
      g.textAlign = 'left';
      g.fillStyle = THEME.muted;
      g.font = font(24, 600);
      g.fillText(label, PAD + 6, y);
      if (tag) {
        g.fillStyle = THEME.muted;
        g.font = font(24, 700);
        g.fillText(tag, PAD + 214, y);
      }
      g.textAlign = 'right';
      g.fillStyle = val == null ? THEME.muted : colour;
      g.font = dfont(34, 700);
      g.fillText(fmtLap(val), colR - 6, y + 2);
      y += 58;
    }

    // Right: speed trap.
    const rx = colR + 40;
    const rw = w - PAD - rx;
    g.fillStyle = THEME.surface;
    roundRect(g, rx, 96, rw, 168, 10);
    g.fill();
    g.textAlign = 'left';
    g.fillStyle = THEME.muted;
    g.font = font(24, 600);
    g.fillText('SPEED TRAP', rx + 18, 132);
    g.textAlign = 'right';
    g.fillStyle = o.stSpeed == null ? THEME.muted : THEME.text;
    g.font = dfont(64, 700);
    g.fillText(o.stSpeed == null ? '–' : String(Math.round(o.stSpeed)), rx + rw - 18, 214);
    g.fillStyle = THEME.muted;
    g.font = font(24, 600);
    g.fillText(o.lastLapNumber != null ? `KM/H · LAP ${o.lastLapNumber}` : 'KM/H', rx + rw - 18, 248);

    // Right, lower: current tyre (compound, stint number, age in laps).
    const curStint = o.stintCount > 0 ? o.stints[o.stintCount - 1] : null;
    const ty = 278;
    g.fillStyle = THEME.surface;
    roundRect(g, rx, ty, rw, 170, 10);
    g.fill();
    if (curStint && curStint.current) {
      const cx = rx + 54;
      const cy = ty + 58;
      g.beginPath();
      g.arc(cx, cy, 32, 0, Math.PI * 2);
      glowStroke(g, TYRE_COLOURS[curStint.compound] || TYRE_COLOURS.UNKNOWN, 9, 2);
      g.textAlign = 'center';
      g.fillStyle = THEME.text;
      g.font = font(32, 700);
      g.fillText(curStint.compound[0], cx, cy + 11);
      g.textAlign = 'right';
      g.font = font(30, 700);
      g.fillText(curStint.compound, rx + rw - 18, ty + 52);
      g.font = font(24, 600);
      g.fillStyle = THEME.muted;
      g.fillText(`STINT ${o.stintCount}`, rx + rw - 18, ty + 84);
      g.fillStyle = THEME.line;
      g.fillRect(rx + 18, ty + 110, rw - 36, 2);
      g.textAlign = 'left';
      g.fillStyle = THEME.muted;
      g.fillText('TYRE AGE', rx + 18, ty + 150);
      g.textAlign = 'right';
      g.fillStyle = THEME.text;
      g.font = dfont(30, 700);
      g.fillText(`${curStint.ageEnd} LAPS`, rx + rw - 18, ty + 151);
    } else {
      g.textAlign = 'left';
      g.fillStyle = THEME.muted;
      g.font = font(24, 600);
      g.fillText('TYRE', rx + 18, ty + 44);
      g.textAlign = 'right';
      g.fillText('–', rx + rw - 18, ty + 44);
    }

    // Sectors of the last completed lap.
    const sy = 384;
    const sh = 64;
    const gap = 12;
    const sw = (colR + 8 - (PAD - 8) - 2 * gap) / 3;
    for (let k = 0; k < 3; k++) {
      const sec = o.sectors[k];
      const x = PAD - 8 + k * (sw + gap);
      // Dark card tinted in the sector colour, with a glowing strip and the time in colour.
      const col = sec.cls ? SECTOR_FILL[sec.cls] : null;
      g.fillStyle = THEME.surface;
      roundRect(g, x, sy, sw, sh, 8);
      g.fill();
      if (col) {
        g.fillStyle = rgba(col, 0.18);
        roundRect(g, x, sy, sw, sh, 8);
        g.fill();
        g.fillStyle = rgba(col, 0.35);
        roundRect(g, x, sy, 14, sh, [8, 0, 0, 8]);
        g.fill();
        g.fillStyle = col;
        roundRect(g, x, sy, 7, sh, [8, 0, 0, 8]);
        g.fill();
      }
      g.fillStyle = THEME.muted;
      g.textAlign = 'left';
      g.font = font(24, 700);
      g.fillText(`S${k + 1}`, x + 20, sy + 42);
      g.textAlign = 'right';
      g.fillStyle = col || THEME.muted;
      g.font = dfont(30, 700);
      g.fillText(sec.time == null ? '–' : sec.time.toFixed(3), x + sw - 12, sy + 43);
    }

    this._drawMinis(g, ctx.selected, o, PAD - 8, sy + sh + 10, colR + 8 - (PAD - 8));
    this._drawStrip(g, w, o);
  }

  /**
   * Mini-sectors of the last completed lap (9.10) from OpenF1 segments_sector_1..3:
   * 2051 purple, 2049 green, 2048 yellow, 2064 pit lane (blue); 0 and unknown codes grey.
   */
  _drawMinis(g, n, o, x, y, w) {
    if (o.lastLapNumber == null || !getSettings().minis) return; // 13.4: only when switched on
    const lap = this.data.getDriverLaps(n).find((l) => l.lap_number === o.lastLapNumber);
    if (!lap) return;
    let total = 0;
    for (let k = 1; k <= 3; k++) { const s = lap[`segments_sector_${k}`]; if (Array.isArray(s)) total += s.length; }
    if (!total) return;
    const gap = 3;
    const sectorGap = 9;
    const cw = (w - gap * (total - 1) - sectorGap * 2) / total;
    let cx = x;
    for (let k = 1; k <= 3; k++) {
      const s = lap[`segments_sector_${k}`];
      if (!Array.isArray(s)) continue;
      for (const code of s) {
        g.fillStyle = MINI_COLOUR[code] || THEME.line;
        roundRect(g, cx, y, cw, 12, 3);
        g.fill();
        cx += cw + gap;
      }
      cx += sectorGap - gap;
    }
  }

  _drawStrip(g, w, o) {
    const x0 = PAD;
    const x1 = w - PAD;
    const y = 510;
    const sh = 52;
    const total = Math.max(o.totalLaps, 1);
    const pxPerLap = (x1 - x0) / total;

    g.textAlign = 'left';
    g.fillStyle = THEME.muted;
    g.font = font(24, 600);
    g.fillText('TYRE STINTS', x0, y - 14);
    g.textAlign = 'right';
    g.fillText(this.stats._isRace ? `${total} LAPS` : `LAP ${total}`, x1, y - 14);

    // Track (remaining distance).
    g.fillStyle = THEME.surface;
    roundRect(g, x0, y, x1 - x0, sh, 8);
    g.fill();

    // OpenF1 stints can overlap by a lap (seen in qualifying): draw each block from
    // after the previous one so neighbours stay separated; labels keep the API lap count.
    let prevEnd = 0;
    for (let i = 0; i < o.stintCount; i++) {
      const s = o.stints[i];
      const from = Math.max(s.lapStart, prevEnd + 1);
      prevEnd = Math.max(prevEnd, s.lapEnd);
      const bx = x0 + (from - 1) * pxPerLap;
      const bw = Math.max((s.lapEnd - from + 1) * pxPerLap - 5, 3);
      g.fillStyle = TYRE_COLOURS[s.compound] || TYRE_COLOURS.UNKNOWN;
      roundRect(g, bx, y, bw, sh, 6);
      g.fill();
      const label = `${s.compound[0]} ${s.laps}`;
      g.font = font(26, 700);
      if (g.measureText(label).width + 16 <= bw) {
        g.fillStyle = TYRE_INK[s.compound] || '#111418';
        g.textAlign = 'left';
        g.fillText(label, bx + 10, y + 36);
      } else if (bw >= 26) {
        g.fillStyle = TYRE_INK[s.compound] || '#111418';
        g.textAlign = 'center';
        g.fillText(s.compound[0], bx + bw / 2, y + 36);
      }
      if (s.current) {
        // Current stint: outline plus a red marker at the current lap.
        roundRect(g, bx + 1.5, y + 1.5, bw - 3, sh - 3, 5);
        glowStroke(g, THEME.text, 3, 2.4);
        const mx = bx + bw;
        g.fillStyle = THEME.accent;
        g.fillRect(mx - 2, y - 8, 5, sh + 16);
      }
    }

    // Lap scale: 1, middle and last lap.
    g.fillStyle = THEME.muted;
    g.font = font(24, 600);
    g.textAlign = 'left';
    g.fillText('1', x0, y + sh + 30);
    g.textAlign = 'right';
    g.fillText(String(total), x1, y + sh + 30);
    if (total >= 10) {
      const mid = Math.round(total / 2);
      g.textAlign = 'center';
      g.fillText(String(mid), x0 + (mid - 0.5) * pxPerLap, y + sh + 30);
    }
  }
}
