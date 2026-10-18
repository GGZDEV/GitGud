// Raccourcis globaux personnalisables (clavier ou boutons de souris), captés au niveau
// système avec uiohook : ils marchent même quand le jeu a le focus, et permettent le
// « maintenir pour parler » (appui / relâchement), impossible avec globalShortcut.
let uiohook = null;
try {
  uiohook = require("uiohook-napi");
} catch {}

const { Gamepad, padLabel } = require("./gamepad");

const K = uiohook?.UiohookKey || {};
const KEY_NAMES = Object.fromEntries(Object.entries(K).map(([name, code]) => [code, name]));
const MODIFIERS = new Set([K.Alt, K.AltRight, K.Ctrl, K.CtrlRight, K.Shift, K.ShiftRight, K.Meta, K.MetaRight].filter((x) => x !== undefined));

// Codes uiohook (scancodes) : V=47, T=20, X=45, O=24
const DEFAULT_HOTKEYS = {
  ptt: { type: "key", keycode: 47, alt: true },
  text: { type: "key", keycode: 20, alt: true },
  hide: { type: "key", keycode: 45, alt: true },
  toggle: { type: "key", keycode: 24, alt: true },
  d4scan: { type: "key", keycode: 66 }, // F8
};

const ACTION_LABELS = {
  ptt: "Parler (maintenir)",
  text: "Question écrite",
  hide: "Fermer l'overlay et couper la réponse",
  toggle: "Afficher / masquer l'overlay",
  d4scan: "Diablo IV : scanner équipement + inventaire",
};

const MOUSE_NAMES = { 3: "Clic molette", 4: "Souris 4", 5: "Souris 5" };

function label(b) {
  if (!b) return "—";
  const parts = [];
  if (b.ctrl) parts.push("Ctrl");
  if (b.alt) parts.push("Alt");
  if (b.shift) parts.push("Maj");
  if (b.meta) parts.push("Win");
  if (b.type === "pad") return padLabel(b.button);
  if (b.type === "mouse") parts.push(MOUSE_NAMES[b.button] || `Souris ${b.button}`);
  else parts.push((KEY_NAMES[b.keycode] || `Touche ${b.keycode}`).replace(/^Numpad/, "Pavé num. "));
  return parts.join(" + ");
}

const mods = (e) => ({ alt: !!e.altKey, ctrl: !!e.ctrlKey, shift: !!e.shiftKey, meta: !!e.metaKey });
const sameMods = (b, e) => !!b.alt === !!e.altKey && !!b.ctrl === !!e.ctrlKey && !!b.shift === !!e.shiftKey && !!b.meta === !!e.metaKey;

// Touche de modificateur correspondant à une option de raccourci (pour le relâchement du PTT).
function isModifierOf(b, keycode) {
  return (
    (b.alt && (keycode === K.Alt || keycode === K.AltRight)) ||
    (b.ctrl && (keycode === K.Ctrl || keycode === K.CtrlRight)) ||
    (b.shift && (keycode === K.Shift || keycode === K.ShiftRight)) ||
    (b.meta && (keycode === K.Meta || keycode === K.MetaRight))
  );
}

class Hotkeys {
  // handlers : { pttDown, pttUp, text, hide, toggle }
  constructor(handlers) {
    this.handlers = handlers;
    this.bindings = { ...DEFAULT_HOTKEYS };
    this.capturing = null; // { resolve, timer }
    this.pttHeld = false;
    this.available = !!uiohook;
    this.gamepad = new Gamepad();
    this.gamepad.on("down", (input) => this.onDown(input, {}));
    this.gamepad.on("up", (input) => this.onUp(input));
  }

  setBindings(b) {
    this.bindings = { ...DEFAULT_HOTKEYS, ...(b || {}) };
  }

  labels() {
    return Object.fromEntries(Object.keys(DEFAULT_HOTKEYS).map((a) => [a, label(this.bindings[a])]));
  }

  start() {
    this.gamepad.start();
    if (!uiohook) return false;
    const { uIOhook } = uiohook;
    uIOhook.on("keydown", (e) => this.onDown({ type: "key", keycode: e.keycode }, e));
    uIOhook.on("keyup", (e) => this.onUp({ type: "key", keycode: e.keycode }));
    uIOhook.on("mousedown", (e) => this.onDown({ type: "mouse", button: e.button }, e));
    uIOhook.on("mouseup", (e) => this.onUp({ type: "mouse", button: e.button }));
    uIOhook.start();
    return true;
  }

  stop() {
    this.gamepad.stop();
    try {
      uiohook?.uIOhook.stop();
    } catch {}
  }

  matches(b, input, e) {
    if (!b || b.type !== input.type) return false;
    if (input.type === "key" ? b.keycode !== input.keycode : b.button !== input.button) return false;
    return input.type === "pad" || sameMods(b, e);
  }

  onDown(input, e) {
    if (this.capturing) return this.captureInput(input, e);
    if (input.type === "key" && input.keycode === K.Escape) this.handlers.escape?.();
    const b = this.bindings;
    if (this.matches(b.ptt, input, e)) {
      if (!this.pttHeld) {
        this.pttHeld = true;
        this.handlers.pttDown();
      }
    } else if (this.matches(b.text, input, e)) this.handlers.text();
    else if (this.matches(b.hide, input, e)) this.handlers.hide();
    else if (this.matches(b.toggle, input, e)) this.handlers.toggle();
    else if (this.matches(b.d4scan, input, e)) this.handlers.d4scan?.();
  }

  onUp(input) {
    if (!this.pttHeld) return;
    const b = this.bindings.ptt;
    const main = input.type === b.type && (input.type === "key" ? input.keycode === b.keycode : input.button === b.button);
    if (main || (input.type === "key" && isModifierOf(b, input.keycode))) {
      this.pttHeld = false;
      this.handlers.pttUp();
    }
  }

  // Attend la prochaine touche (hors modificateur seul) ou bouton de souris 3-5.
  // Échap annule. Résout avec le raccourci, ou null.
  capture() {
    this.cancelCapture();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finishCapture(null), 15000);
      this.capturing = { resolve, timer };
    });
  }

  captureInput(input, e) {
    if (input.type === "key") {
      if (input.keycode === K.Escape) return this.finishCapture(null);
      if (MODIFIERS.has(input.keycode)) return; // on attend la touche principale
    } else if (input.type === "mouse" && input.button < 3) {
      return; // clic gauche / droit : réservés
    }
    if (input.type === "pad") return this.finishCapture({ type: "pad", button: input.button });
    this.finishCapture({ ...input, ...mods(e) });
  }

  finishCapture(binding) {
    const c = this.capturing;
    if (!c) return;
    clearTimeout(c.timer);
    this.capturing = null;
    c.resolve(binding);
  }

  cancelCapture() {
    this.finishCapture(null);
  }
}

module.exports = { Hotkeys, DEFAULT_HOTKEYS, ACTION_LABELS, label };
