// Boutons de manette (XInput : manettes Xbox et compatibles, PlayStation via Steam Input /
// DS4Windows) lus directement auprès de Windows, pour fonctionner même quand le jeu a le focus.
const { EventEmitter } = require("events");

// Masques XInput, + gâchettes converties en boutons virtuels.
const BUTTONS = {
  0x0001: "Croix haut", 0x0002: "Croix bas", 0x0004: "Croix gauche", 0x0008: "Croix droite",
  0x0010: "Menu", 0x0020: "Vue", 0x0040: "Clic stick gauche", 0x0080: "Clic stick droit",
  0x0100: "LB", 0x0200: "RB", 0x1000: "A", 0x2000: "B", 0x4000: "X", 0x8000: "Y",
  0x10000: "LT", 0x20000: "RT",
};
const TRIGGER_THRESHOLD = 128;
const ERROR_SUCCESS = 0;

class Gamepad extends EventEmitter {
  constructor() {
    super();
    this.getState = null;
    this.timer = null;
    this.previous = [0, 0, 0, 0];
    this.connected = [false, false, false, false];
    this.lastScan = 0;
    try {
      const koffi = require("koffi");
      const lib = koffi.load("xinput1_4.dll");
      const pad = koffi.struct("XINPUT_GAMEPAD", {
        wButtons: "uint16", bLeftTrigger: "uint8", bRightTrigger: "uint8",
        sThumbLX: "int16", sThumbLY: "int16", sThumbRX: "int16", sThumbRY: "int16",
      });
      const state = koffi.struct("XINPUT_STATE", { dwPacketNumber: "uint32", Gamepad: pad });
      this.getState = lib.func("uint32 __stdcall XInputGetState(uint32 idx, _Out_ XINPUT_STATE *state)");
      this.stateType = state;
    } catch {
      this.getState = null; // pas de XInput (autre OS, DLL absente) : manette désactivée
    }
  }

  get available() {
    return !!this.getState;
  }

  // Lecture à 60 Hz des manettes connectées ; les emplacements vides ne sont revérifiés
  // que toutes les 2 s (XInputGetState est lent sur une manette absente).
  start() {
    if (!this.getState || this.timer) return;
    this.timer = setInterval(() => this.poll(), 16);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  poll() {
    const rescan = Date.now() - this.lastScan > 2000;
    if (rescan) this.lastScan = Date.now();
    for (let i = 0; i < 4; i++) {
      if (!this.connected[i] && !rescan) continue;
      const s = {};
      const ok = this.getState(i, s) === ERROR_SUCCESS;
      this.connected[i] = ok;
      const buttons = ok ? buttonsOf(s.Gamepad) : 0;
      this.diff(i, buttons);
    }
  }

  diff(index, buttons) {
    const changed = buttons ^ this.previous[index];
    if (!changed) return;
    for (const mask of Object.keys(BUTTONS).map(Number)) {
      if (!(changed & mask)) continue;
      this.emit(buttons & mask ? "down" : "up", { type: "pad", button: mask, pad: index });
    }
    this.previous[index] = buttons;
  }
}

function buttonsOf(g) {
  let b = g.wButtons;
  if (g.bLeftTrigger > TRIGGER_THRESHOLD) b |= 0x10000;
  if (g.bRightTrigger > TRIGGER_THRESHOLD) b |= 0x20000;
  return b;
}

const padLabel = (mask) => `Manette ${BUTTONS[mask] || mask}`;

module.exports = { Gamepad, padLabel, buttonsOf };
