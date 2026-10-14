// Screen mode (8.3): shows Panel canvases directly in the page instead of as 3D textures.
// Each panel's canvas goes into a tile element, fitted to the tile at the panel's aspect
// ratio, with a backing density that matches the displayed size × devicePixelRatio exactly
// (12.1: also below 1) so text stays sharp. Panels are frameless: the tile is the card.
// 'stretch' panels (the playback bar, 12.2) take the tile's width as their logical width.
// Mouse clicks and hover map from the element to logical canvas pixels and use the panel's
// own hit rects (Panel.hitTestPx), exactly like a VR ray does.
import { containRect } from './screen-layout.js';
import { uiClick } from '../audio.js';

export class PanelHost {
  /** @param {object} ctx the shared PanelContext (time, playback, selected, actions, …) */
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {{panel: import('../panels/panel-base.js').Panel, tile: HTMLElement, anchor: string,
     *   off: () => void, rect: DOMRect|null}[]} */
    this.entries = [];
    this._px = { x: 0, y: 0 };
  }

  /**
   * Show `panel` in `tile`.
   * @param {import('../panels/panel-base.js').Panel} panel
   * @param {HTMLElement} tile
   * @param {{anchor?: 'center'|'top'|'stretch'}} [o] 'top': full tile width, pinned to the top (the
   *   ticker, whose canvas is taller than its collapsed strip); 'stretch': the tile height sets
   *   the scale and the logical width grows to fill the tile (the playback bar)
   */
  add(panel, tile, { anchor = 'center' } = {}) {
    const c = panel.canvas;
    panel.frameless = true;
    c.className = 'f1-dash__canvas';
    tile.appendChild(c);
    const entry = { panel, tile, anchor, off: null };
    const toPx = (e) => {
      const r = c.getBoundingClientRect();
      this._px.x = ((e.clientX - r.left) / Math.max(1, r.width)) * panel.lw;
      this._px.y = ((e.clientY - r.top) / Math.max(1, r.height)) * panel.lh;
      return this._px;
    };
    const onMove = (e) => {
      const p = toPx(e);
      const hit = panel.hitTestPx(p.x, p.y);
      panel.setHover(hit ? hit.id : null);
      c.style.cursor = hit ? 'pointer' : '';
    };
    const onLeave = () => { panel.setHover(null); c.style.cursor = ''; };
    const onClick = (e) => {
      const p = toPx(e);
      const hit = panel.hitTestPx(p.x, p.y);
      if (!hit) return;
      uiClick();
      panel.onHit(hit, this.ctx, { x: p.x, y: p.y });
      panel.invalidate();
    };
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('click', onClick);
    entry.off = () => {
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerleave', onLeave);
      c.removeEventListener('click', onClick);
    };
    this.entries.push(entry);
    return panel;
  }

  /**
   * Fit every canvas to its tile (call after the tiles are sized).
   * @param {number} dpr devicePixelRatio
   */
  layout(dpr) {
    for (const e of this.entries) {
      const w = e.tile.clientWidth;
      const h = e.tile.clientHeight;
      if (e.anchor === 'stretch' && w > 0 && h > 0) e.panel.setLogicalWidth(w * (e.panel.lh / h));
      const aspect = e.panel.lh / e.panel.lw;
      const r = e.anchor === 'top'
        ? { x: 0, y: 0, w, h: w * aspect }
        : containRect({ x: 0, y: 0, w, h }, aspect);
      const st = e.panel.canvas.style;
      st.left = `${r.x}px`;
      st.top = `${r.y}px`;
      st.width = `${r.w}px`;
      st.height = `${r.h}px`;
      if (r.w > 0) e.panel.setDensity((r.w / e.panel.lw) * dpr, true);
    }
  }

  /** Per frame: each panel refreshes / redraws at ≤10 Hz (Panel.tick). */
  update(dt) {
    for (let i = 0; i < this.entries.length; i++) this.entries[i].panel.tick(dt, this.ctx);
  }

  dispose() {
    for (const e of this.entries) {
      e.off();
      e.panel.canvas.remove();
      e.panel.dispose();
    }
    this.entries.length = 0;
  }
}
