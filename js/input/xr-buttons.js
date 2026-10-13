// Quest Touch button map (spec §7, xr-standard gamepad layout), split out of xr-input.js:
//   Right A: play/pause      Right B: pit wall / passthrough
//   Left X: previous driver  Left Y: next driver (by position)
//   Right stick ←/→: seek ∓10 s (repeats while held)   Right stick ↑/↓: speed up/down
//   Left stick press: re-centre
//   While a panel is carried, right stick ↑/↓ pushes / pulls it instead (no seek / speed).

const BTN_STICK = 3;
const BTN_AX = 4;              // A on the right controller, X on the left
const BTN_BY = 5;              // B on the right controller, Y on the left
const AXIS_X = 2;
const AXIS_Y = 3;
const STICK_ON = 0.6;          // deflection that triggers an action
const STICK_OFF = 0.3;         // must return below this to re-arm
const SEEK_REPEAT_DELAY = 0.5; // s before a held seek repeats
const SEEK_REPEAT_EVERY = 0.25;
const PUSH_SPEED = 1.5;        // m/s at full right-stick deflection while carrying a panel
const PUSH_DEAD = 0.2;

/**
 * @param {(name: string, ...args: any[]) => void} act runs a named action
 * @param {ReturnType<import('./panel-grab.js').createPanelGrab>|null} panelGrab
 * @param {Array<{id: string}>} hands every pointer (panel pushes apply to whichever holds one)
 * @returns {(h: object, dt: number) => void} per-frame handler for one controller. Allocation-free.
 */
export function createButtonHandler(act, panelGrab, hands) {
  /** True on the frame a button goes down. */
  function pressed(h, pad, i) {
    const b = pad.buttons[i];
    const down = !!(b && b.pressed);
    const edge = down && !h.down[i];
    h.down[i] = down;
    return edge;
  }

  /** Latching stick direction: returns -1/1 once per push, 0 otherwise. */
  function stickEdge(value, latched) {
    if (latched === 0) return value <= -STICK_ON ? -1 : value >= STICK_ON ? 1 : 0;
    return 0;
  }

  function handleButtons(h, dt) {
    const pad = h.source && h.source.gamepad;
    if (!pad || h.isHand) return;
    const right = h.handedness === 'right';
    if (pressed(h, pad, BTN_AX)) act(right ? 'togglePlay' : 'stepDriver', right ? undefined : -1);
    if (pressed(h, pad, BTN_BY)) act(right ? 'togglePassthrough' : 'stepDriver', right ? undefined : 1);
    if (pressed(h, pad, BTN_STICK) && !right) act('recenter');
    if (!right) return;

    const x = pad.axes[AXIS_X] || 0;
    const y = pad.axes[AXIS_Y] || 0;
    // Carrying a panel: stick up pushes it away, down pulls it closer; no seek / speed.
    if (panelGrab && panelGrab.isGrabbing()) {
      h.stickX = 0; h.stickY = 0; h.seekHeld = 0;
      if (Math.abs(y) > PUSH_DEAD) for (const o of hands) panelGrab.adjust(o.id, -y * PUSH_SPEED * dt);
      return;
    }

    // Right stick: dominant axis only, so a diagonal push does one thing.
    const horizontal = Math.abs(x) >= Math.abs(y);

    const ex = horizontal ? stickEdge(x, h.stickX) : 0;
    if (ex) { h.stickX = ex; h.seekHeld = 0; act('seekBy', 10 * ex); }
    if (h.stickX !== 0) {
      if (Math.abs(x) < STICK_OFF) { h.stickX = 0; h.seekHeld = 0; } else {
        // Held: repeat the seek after a short delay.
        const before = h.seekHeld;
        h.seekHeld += dt;
        if (h.seekHeld >= SEEK_REPEAT_DELAY) {
          const n0 = Math.floor((before - SEEK_REPEAT_DELAY) / SEEK_REPEAT_EVERY);
          const n1 = Math.floor((h.seekHeld - SEEK_REPEAT_DELAY) / SEEK_REPEAT_EVERY);
          if (before < SEEK_REPEAT_DELAY || n1 > n0) act('seekBy', 10 * h.stickX);
        }
      }
    }

    const ey = !horizontal ? stickEdge(y, h.stickY) : 0;
    if (ey) { h.stickY = ey; act(ey < 0 ? 'speedUp' : 'speedDown'); } // stick up = negative y
    if (h.stickY !== 0 && Math.abs(y) < STICK_OFF) h.stickY = 0;
  }

  return handleButtons;
}
