// Overtake warnings on the desktop (13.6): small stacked toasts at the top right of the track
// tile. Each appears ≥10 s before the swap with a countdown ring ("HAM → RUS · fight for P5"),
// turns into "HAM takes P5" when it happens and fades a few seconds later. A quick re-pass says
// so. Click a toast to select the attacking driver. render() runs at 10 Hz and only touches
// the DOM for toasts that appear, change or go.
import { LEAD_MS, LINGER_MS } from '../overtake-alerts.js';

const MAX = 4;
const R = 13;
const C = 2 * Math.PI * R;

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/**
 * @param {{data: object, tile: HTMLElement, selectDriver: (n: number) => void}} o
 * @returns {{render: (alerts: object[], time: number) => void, dispose: () => void}}
 */
export function createOvertakeToasts({ data, tile, selectDriver }) {
  const box = el('div', 'f1-ot', tile);
  box.setAttribute('aria-live', 'polite');
  const live = new Map(); // event -> {node, ring, secs, state}
  const drv = (n) => data.driverByNumber.get(n) || { acronym: `#${n}`, teamColour: '#888888' };

  function make(e) {
    const a = drv(e.a), b = drv(e.b);
    const node = el('button', 'f1-ot__toast', box);
    node.type = 'button';
    node.style.setProperty('--ca', a.teamColour);
    node.style.setProperty('--cb', b.teamColour);
    node.title = `Select ${a.acronym}`;
    node.addEventListener('click', () => selectDriver(e.a));
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'f1-ot__ring');
    svg.setAttribute('viewBox', '0 0 32 32');
    const bg = document.createElementNS(ns, 'circle');
    const ring = document.createElementNS(ns, 'circle');
    for (const c of [bg, ring]) { c.setAttribute('cx', '16'); c.setAttribute('cy', '16'); c.setAttribute('r', String(R)); svg.appendChild(c); }
    bg.setAttribute('class', 'f1-ot__ringbg');
    ring.setAttribute('stroke-dasharray', String(C));
    node.appendChild(svg);
    const secs = el('span', 'f1-ot__secs', node);
    const text = el('span', 'f1-ot__text', node);
    const head = el('span', 'f1-ot__head', text, e.kind === 'repass' ? `Re-pass · P${e.pos}` : `Fight for P${e.pos}`);
    const names = el('span', 'f1-ot__names', text);
    el('b', 'f1-ot__a', names, a.acronym);
    el('i', 'f1-ot__arrow', names, '▶');
    el('b', 'f1-ot__b', names, b.acronym);
    requestAnimationFrame(() => node.classList.add('is-in'));
    return { node, ring, secs, head, state: '', e, a, b };
  }

  return {
    render(alerts, time) {
      // Newest first in the stack, at most MAX (the soonest swaps win).
      const want = new Set(alerts.slice(0, MAX));
      for (const [e, t] of live) {
        if (want.has(e)) continue;
        live.delete(e);
        t.node.classList.add('is-out');
        setTimeout(() => t.node.remove(), 300);
      }
      for (const e of want) {
        let t = live.get(e);
        if (!t) { t = make(e); live.set(e, t); }
        const left = e.t - time;
        if (left > 0) {
          const sec = Math.ceil(left / 1000);
          if (t.state !== `w${sec}`) {
            t.state = `w${sec}`;
            t.secs.textContent = `${sec}s`;
            t.ring.setAttribute('stroke-dashoffset', String(C * (1 - Math.min(1, left / LEAD_MS))));
          }
        } else if (t.state !== 'done') {
          t.state = 'done';
          t.node.classList.add('is-done');
          t.secs.textContent = '✓';
          t.ring.setAttribute('stroke-dashoffset', '0');
          t.head.textContent = e.kind === 'repass' ? `${t.a.acronym} takes it back` : `${t.a.acronym} takes P${e.pos}`;
        }
        if (left < -LINGER_MS + 600) t.node.classList.add('is-fading');
      }
    },
    dispose() { box.remove(); live.clear(); },
  };
}
