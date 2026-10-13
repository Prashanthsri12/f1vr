// Main screen video source (spec §6, "Video"): set on the start page, stored in localStorage.
// A local file can't be stored, so it is kept as an object URL in memory for this page load.
const KEY = 'f1vr.video';
const DEFAULTS = { url: '', offsetSec: 0, sync: false };

let fileUrl = '';
let fileName = '';

function readStored() {
  const out = { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (typeof raw.url === 'string') out.url = raw.url.trim();
    if (typeof raw.offsetSec === 'number' && Number.isFinite(raw.offsetSec)) out.offsetSec = raw.offsetSec;
    if (typeof raw.sync === 'boolean') out.sync = raw.sync;
  } catch { /* no storage: defaults */ }
  return out;
}

/** True for an HLS playlist URL (.m3u8, ignoring the query string). */
export function isHlsUrl(url) {
  return /\.m3u8($|[?#])/i.test(url || '');
}

/**
 * The current video source. A local file picked on this page load wins over the URL.
 * @returns {{kind: 'none'|'url'|'hls'|'file', url: string, name: string, offsetSec: number, sync: boolean}}
 */
export function loadVideoSettings() {
  const s = readStored();
  if (fileUrl) return { kind: 'file', url: fileUrl, name: fileName, offsetSec: s.offsetSec, sync: s.sync };
  if (!s.url) return { kind: 'none', url: '', name: '', offsetSec: s.offsetSec, sync: s.sync };
  return { kind: isHlsUrl(s.url) ? 'hls' : 'url', url: s.url, name: '', offsetSec: s.offsetSec, sync: s.sync };
}

/** @param {{url?: string, offsetSec?: number, sync?: boolean}} patch */
export function saveVideoSettings(patch) {
  const s = { ...readStored(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify({ url: s.url, offsetSec: s.offsetSec, sync: s.sync })); } catch { /* ignore */ }
}

function setFile(file) {
  if (fileUrl) URL.revokeObjectURL(fileUrl);
  fileUrl = file ? URL.createObjectURL(file) : '';
  fileName = file ? file.name : '';
}

/**
 * Wire the start page "Video screen" section (no-op if it is missing).
 * @param {ParentNode} [root]
 */
export function initVideoSettings(root = document) {
  const urlIn = root.querySelector('#video-url');
  const fileIn = root.querySelector('#video-file');
  const offsetIn = root.querySelector('#video-offset');
  const syncIn = root.querySelector('#video-sync');
  const clearBtn = root.querySelector('#video-clear');
  const status = root.querySelector('#video-status');
  if (!urlIn || !offsetIn || !syncIn) return;

  const s = readStored();
  urlIn.value = s.url;
  offsetIn.value = String(s.offsetSec);
  syncIn.checked = s.sync;

  function showStatus() {
    const v = loadVideoSettings();
    if (!status) return;
    status.textContent = v.kind === 'none' ? 'No video source set.'
      : v.kind === 'file' ? `Local file: ${v.name} (kept until this page is reloaded).`
        : v.kind === 'hls' ? 'HLS stream set.' : 'Video URL set.';
  }

  urlIn.addEventListener('change', () => { saveVideoSettings({ url: urlIn.value.trim() }); showStatus(); });
  offsetIn.addEventListener('change', () => {
    const n = Number(offsetIn.value);
    saveVideoSettings({ offsetSec: Number.isFinite(n) ? n : 0 });
  });
  syncIn.addEventListener('change', () => saveVideoSettings({ sync: syncIn.checked }));
  if (fileIn) fileIn.addEventListener('change', () => { setFile(fileIn.files && fileIn.files[0]); showStatus(); });
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      setFile(null);
      if (fileIn) fileIn.value = '';
      urlIn.value = '';
      saveVideoSettings({ url: '' });
      showStatus();
    });
  }
  showStatus();
}
