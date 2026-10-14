// Team radio mode (11.1) from the two settings: radio (on / off) and radioAll (every driver).
// Shared by the desktop Radio button and the VR wrist menu. Pure: no DOM, no three.

/** @typedef {'off'|'driver'|'all'} RadioMode */

export const RADIO_LABEL = { off: 'Off', driver: 'Driver', all: 'All' };

/** @param {{radio: boolean, radioAll: boolean}} s settings @returns {RadioMode} */
export function radioMode(s) {
  return !s.radio ? 'off' : s.radioAll ? 'all' : 'driver';
}

/**
 * Off → Driver → All → Off.
 * @param {{radio: boolean, radioAll: boolean}} s current settings
 * @param {(key: string, value: boolean) => void} set
 * @returns {RadioMode} the new mode
 */
export function cycleRadioMode(s, set) {
  const next = { off: 'driver', driver: 'all', all: 'off' }[radioMode(s)];
  set('radio', next !== 'off');
  set('radioAll', next === 'all');
  return next;
}
