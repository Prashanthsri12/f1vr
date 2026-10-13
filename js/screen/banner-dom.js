// Race moment banner over the desktop track tile (9.11): a slanted slab that slides in,
// holds and slides out (CSS animation in css/dashboard.css; reduced motion only fades).
import { bannerStyle, BANNER_MS } from '../banner-style.js';

/**
 * @param {HTMLElement} tile the track tile
 * @returns {{show: (ev: {kind: string, title: string, sub: string}) => void, dispose: () => void}}
 */
export function createBannerDom(tile) {
  const wrap = document.createElement('div');
  wrap.className = 'f1-banner';
  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');
  tile.append(wrap);
  let timer = 0;

  function show(ev) {
    const st = bannerStyle(ev.kind);
    const slab = document.createElement('div');
    slab.className = 'f1-banner__slab' + (st.bg === 'check' ? ' f1-banner__slab--check' : '');
    if (st.bg !== 'check') slab.style.setProperty('--c', st.bg);
    slab.style.color = st.fg;
    slab.style.animationDuration = `${BANNER_MS}ms`;
    const t = document.createElement('div');
    t.className = 'f1-banner__title';
    t.textContent = ev.title;
    const s = document.createElement('div');
    s.className = 'f1-banner__sub';
    s.textContent = ev.sub;
    slab.append(t, s);
    wrap.replaceChildren(slab);
    clearTimeout(timer);
    timer = setTimeout(() => wrap.replaceChildren(), BANNER_MS + 50);
  }

  return {
    show,
    dispose() { clearTimeout(timer); wrap.remove(); },
  };
}
