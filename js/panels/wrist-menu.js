// Left-wrist menu (spec §7): play/pause, speed, compact driver grid, pit wall /
// passthrough, radio audio, sound effects, re-centre, exit to session picker, plus
// "Reset layout" for panels the user has moved (4.18), the room theme (4b.5), the fps counter (6.7),
// the track colours and engine hum (9b), and the analytics view and full-session switch (9d).
// Shown while the left palm faces the user's head (controller grip +X, or the
// hand's wrist joint -Y, per the WebXR specs); operated with the right hand's ray.
import * as THREE from 'three';
import { Panel, THEME, font, roundRect } from './panel-base.js';
import { getSettings, setSetting } from '../settings.js';
import { TRACK_COLOUR_MODES } from '../scene/track-style.js';
import { radioMode, cycleRadioMode, RADIO_LABEL } from '../radio-mode.js';

const W = 0.22;              // metres
const H = 0.39;
const PX_PER_M = 2048;       // viewed at ~35 cm: twice the usual density
const SHOW_DOT = 0.6;        // palm-toward-head cosine to show …
const HIDE_DOT = 0.35;       // … and to hide again (hysteresis)
const LIFT = 0.07;           // metres in front of the palm
const THEME_LABELS = { pitwall: 'Pit wall', studio: 'Studio', night: 'Night' };
const COLOUR_LABELS = { sectors: 'Sectors', minis: 'Mini-sectors', plain: 'Plain' };

export class WristMenu extends Panel {
  /** @param {import('../session-data.js').SessionData} data */
  constructor(data) {
    super({ name: 'wrist-menu', width: W, height: H, pxPerM: PX_PER_M });
    this.data = data;
    this.mesh.visible = false;
    this.mesh.renderOrder = 10;
    this._sig = '';
    this._order = data.drivers.map((d) => d.number);
  }

  /** Always opaque: it is read up close, often against bright passthrough. */
  setPassthrough() {}

  refresh(ctx) {
    if (!this.mesh.visible) return false;
    const lb = this.data.getLeaderboardAt(ctx.time);
    if (lb.length) this._order = lb.map((r) => r.driverNumber);
    const s = getSettings();
    const sig = `${ctx.playback.playing}|${ctx.playback.speed}|${ctx.selected}|${ctx.mode}|${ctx.canPassthrough}|`
      + `${s.radio}|${s.radioAll}|${s.sfx}|${s.theme}|${s.fps}|${s.trackColours}|${s.engine}|${s.screenView}|${s.fullSession}|${!!ctx.actions.recenter}|${!!ctx.actions.resetLayout}|${!!ctx.actions.cycleTheme}|`
      + `${this._order.join(',')}`;
    if (sig === this._sig) return false;
    this._sig = sig;
    return true;
  }

  draw(g, w, h, ctx) {
    this.clear(g, w, h, 28);
    const pad = 18;
    const gap = 10;
    let y = pad;

    // Title strip
    g.save();
    roundRect(g, 0, 0, w, h, 28);
    g.clip();
    g.fillStyle = THEME.accent;
    g.fillRect(0, 0, w, 8);
    g.restore();
    g.fillStyle = THEME.muted;
    g.font = font(22, 700);
    g.textBaseline = 'middle';
    g.fillText('PIT WALL MENU', pad, y + 16);
    y += 40;

    // Row 1: play/pause | − speed +
    const rowH = 62;
    const playW = 120;
    this._button(g, 'play', pad, y, playW, rowH, ctx.playback.playing ? '❚❚' : '▶', { strong: !ctx.playback.playing });
    const sx = pad + playW + gap;
    const sw = w - sx - pad;
    const bw = 62;
    this._button(g, 'slower', sx, y, bw, rowH, '−');
    this._button(g, 'faster', sx + sw - bw, y, bw, rowH, '+');
    g.fillStyle = THEME.text;
    g.font = font(34, 700);
    g.textAlign = 'center';
    g.fillText(`${ctx.playback.speed}x`, sx + sw / 2, y + rowH / 2 + 1);
    g.textAlign = 'left';
    y += rowH + gap;

    // Row 2: pit wall / passthrough (only when the session supports passthrough)
    if (ctx.canPassthrough) {
      const pass = ctx.mode === 'passthrough';
      this._button(g, 'mode', pad, y, w - 2 * pad, 52, pass ? 'Switch to pit wall' : 'Switch to passthrough');
      y += 52 + gap;
    }

    // Driver grid: 5 × 4 by current position
    const cols = 5;
    const rows = Math.ceil(this._order.length / cols);
    const tw = (w - 2 * pad - (cols - 1) * 6) / cols;
    const th = 46;
    for (let i = 0; i < this._order.length; i++) {
      const n = this._order[i];
      const d = this.data.driverByNumber.get(n);
      const x = pad + (i % cols) * (tw + 6);
      const ty = y + Math.floor(i / cols) * (th + 6);
      const id = `drv:${n}`;
      const sel = ctx.selected === n;
      g.fillStyle = sel ? THEME.surfaceHi : THEME.surface;
      roundRect(g, x, ty, tw, th, 8);
      g.fill();
      g.fillStyle = d ? d.teamColour : THEME.muted;
      g.fillRect(x, ty + 6, 6, th - 12);
      if (sel || this.hover === id) {
        g.strokeStyle = sel ? THEME.select : THEME.text;
        g.lineWidth = 3;
        roundRect(g, x + 1.5, ty + 1.5, tw - 3, th - 3, 8);
        g.stroke();
      }
      g.fillStyle = THEME.text;
      g.font = font(22, 700);
      g.textAlign = 'center';
      g.fillText(d ? d.acronym : String(n), x + tw / 2 + 3, ty + th / 2 + 1);
      g.textAlign = 'left';
      this.addHit(id, x, ty, tw, th, n);
    }
    y += rows * (th + 6) - 6 + gap;

    // Radio / sound toggles
    const s = getSettings();
    const half = (w - 2 * pad - gap) / 2;
    const rm = radioMode(s); // 11.1: Off → Driver → All
    this._button(g, 'radio', pad, y, half, 50, `Radio ${RADIO_LABEL[rm].toUpperCase()}`, { on: rm !== 'off' });
    this._button(g, 'sfx', pad + half + gap, y, half, 50, `Sounds ${s.sfx ? 'ON' : 'OFF'}`, { on: s.sfx });
    y += 50 + gap;

    // Room theme / fps counter
    const room = THEME_LABELS[s.theme] || s.theme;
    this._button(g, 'theme', pad, y, half, 50, `Room: ${room}`, { disabled: !ctx.actions.cycleTheme });
    this._button(g, 'fps', pad + half + gap, y, half, 50, `FPS ${s.fps ? 'ON' : 'OFF'}`, { on: s.fps });
    y += 50 + gap;

    // Track colours / engine hum (9b)
    this._button(g, 'colours', pad, y, half, 50, `Track: ${COLOUR_LABELS[s.trackColours] || 'Sectors'}`);
    this._button(g, 'engine', pad + half + gap, y, half, 50, `Engine ${s.engine ? 'ON' : 'OFF'}`, { on: s.engine });
    y += 50 + gap;

    // Analytics view (Screen in VR) / full session (spoilers) (9d)
    this._button(g, 'view', pad, y, half, 50, `Analytics ${s.screenView === 'analytics' ? 'ON' : 'OFF'}`, { on: s.screenView === 'analytics' });
    this._button(g, 'full', pad + half + gap, y, half, 50, `Full session ${s.fullSession ? 'ON' : 'OFF'}`, { on: s.fullSession });
    y += 50 + gap;

    // Re-centre / reset layout, then exit
    this._button(g, 'recenter', pad, y, half, 50, 'Re-centre', { disabled: !ctx.actions.recenter });
    this._button(g, 'layout', pad + half + gap, y, half, 50, 'Reset layout', { disabled: !ctx.actions.resetLayout });
    y += 50 + gap;
    this._button(g, 'exit', pad, y, w - 2 * pad, 50, 'Exit', { danger: true });
  }

  _button(g, id, x, y, w, h, label, { strong = false, on = null, disabled = false, danger = false } = {}) {
    const hover = this.hover === id && !disabled;
    g.fillStyle = strong ? THEME.accent : hover ? THEME.surfaceHi : THEME.surface;
    roundRect(g, x, y, w, h, 10);
    g.fill();
    if (hover || danger) {
      g.strokeStyle = danger ? THEME.accent : THEME.text;
      g.lineWidth = hover ? 3 : 2;
      roundRect(g, x + 1, y + 1, w - 2, h - 2, 10);
      g.stroke();
    }
    if (on !== null) {
      g.fillStyle = on ? THEME.green : THEME.muted;
      g.beginPath();
      g.arc(x + 20, y + h / 2, 7, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = disabled ? THEME.muted : THEME.text;
    g.globalAlpha = disabled ? 0.5 : 1;
    g.font = font(label.length > 12 ? 24 : 30, 700);
    g.textAlign = 'center';
    g.fillText(label, x + w / 2 + (on !== null ? 10 : 0), y + h / 2 + 1);
    g.textAlign = 'left';
    g.globalAlpha = 1;
    if (!disabled) this.addHit(id, x, y, w, h);
  }

  onHit(hit, ctx) {
    const a = ctx.actions;
    switch (hit.id) {
      case 'play': a.togglePlay(); break;
      case 'slower': a.speedDown(); break;
      case 'faster': a.speedUp(); break;
      case 'mode': if (a.togglePassthrough) a.togglePassthrough(); break;
      case 'radio': cycleRadioMode(getSettings(), setSetting); break;
      case 'sfx': setSetting('sfx', !getSettings().sfx); break;
      case 'theme': if (a.cycleTheme) a.cycleTheme(); break;
      case 'fps': setSetting('fps', !getSettings().fps); break;
      case 'colours': {
        const m = getSettings().trackColours;
        setSetting('trackColours', TRACK_COLOUR_MODES[(TRACK_COLOUR_MODES.indexOf(m) + 1) % TRACK_COLOUR_MODES.length]);
        break;
      }
      case 'engine': setSetting('engine', !getSettings().engine); break;
      case 'view': setSetting('screenView', getSettings().screenView === 'analytics' ? 'dashboard' : 'analytics'); break;
      case 'full': setSetting('fullSession', !getSettings().fullSession); break;
      case 'recenter': if (a.recenter) a.recenter(); break;
      case 'layout': if (a.resetLayout) a.resetLayout(); break;
      case 'exit': if (a.exit) a.exit(); break;
      default:
        if (hit.id.startsWith('drv:')) a.selectDriver(hit.payload);
    }
    this._sig = ''; // redraw with the new state
  }
}

const _toHead = new THREE.Vector3();

/**
 * Per frame: show/hide by palm orientation and float the menu above the palm, facing the head.
 * @param {WristMenu} menu
 * @param {boolean} palmOk left palm pose available
 * @param {THREE.Vector3} palmPos
 * @param {THREE.Vector3} palmNormal unit vector out of the palm
 * @param {THREE.Vector3} headPos
 */
export function placeWristMenu(menu, palmOk, palmPos, palmNormal, headPos) {
  const mesh = menu.mesh;
  if (!palmOk) { mesh.visible = false; return; }
  _toHead.subVectors(headPos, palmPos).normalize();
  const facing = palmNormal.dot(_toHead);
  if (mesh.visible ? facing < HIDE_DOT : facing > SHOW_DOT) {
    mesh.visible = !mesh.visible;
    if (mesh.visible) menu.invalidate();
  }
  if (!mesh.visible) return;
  mesh.position.copy(palmPos).addScaledVector(palmNormal, LIFT);
  mesh.lookAt(headPos);
}
