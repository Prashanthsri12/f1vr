// In-headset "Loading…" card, shown while data and the track load after entering XR
// (the HTML start page is invisible once the immersive session starts).
import { Panel, THEME, font, whenFontsReady } from '../panels/panel-base.js';

class LoadingCard extends Panel {
  constructor() {
    super({ name: 'xr-loading', width: 0.9, height: 0.3 });
    this.text = 'Loading…';
  }

  setText(text) {
    if (text !== this.text) { this.text = text; this.invalidate(); }
  }

  draw(g, w, h) {
    this.clear(g, w, h, 24);
    g.fillStyle = THEME.accent;
    g.fillRect(0, 0, 10, h);
    g.fillStyle = THEME.text;
    g.font = font(44, 700);
    g.textBaseline = 'middle';
    g.fillText('F1 Pit Wall VR', 48, h * 0.34);
    g.fillStyle = THEME.muted;
    g.font = font(34, 600);
    g.fillText(this.text, 48, h * 0.68);
  }
}

/**
 * Show the card 1.5 m ahead at eye height. Returns {setText, update(dt), dispose}.
 * @param {import('three').Scene} scene
 */
export function showXrLoading(scene) {
  const card = new LoadingCard();
  card.mesh.position.set(0, 1.5, -1.5);
  scene.add(card.mesh);
  whenFontsReady().then(() => card.tick(1, null));
  return {
    setText: (t) => card.setText(t),
    update: (dt) => card.tick(dt, null),
    dispose: () => card.dispose(),
  };
}
