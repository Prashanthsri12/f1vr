// Banner look per race moment kind (9.11), shared by the desktop (screen/banner-dom.js) and
// VR (scene/banner-3d.js) banners. Colours match THEME in panels/panel-base.js.
export const BANNER_MS = 3400; // on screen, including the slide in and out

const STYLE = {
  sc: { bg: '#e8790f', fg: '#ffffff' },
  vsc: { bg: '#d9a400', fg: '#1a1400' },
  red: { bg: '#d9152a', fg: '#ffffff' },
  chequered: { bg: 'check', fg: '#ffffff' },
  clear: { bg: '#17a956', fg: '#ffffff' },
  start: { bg: '#d9152a', fg: '#ffffff' },
  retire: { bg: '#4a5468', fg: '#ffffff' },
  pit: { bg: '#2563d9', fg: '#ffffff' },
  overtake: { bg: '#17a956', fg: '#ffffff' },
  fastest: { bg: '#8f2bd9', fg: '#ffffff' },
};

/** @returns {{bg: string, fg: string}} bg 'check' means a chequered pattern */
export function bannerStyle(kind) {
  return STYLE[kind] || STYLE.retire;
}
