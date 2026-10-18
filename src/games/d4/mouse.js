// Déplacement de souris par SendInput (comme D4LF) : Diablo IV ne voit pas un simple
// SetCursorPos. Trajet en quelques étapes avec ralenti, pour un survol naturel.
const koffi = require("koffi");

const user32 = koffi.load("user32.dll");
const MOUSEINPUT = koffi.struct("MOUSEINPUT", {
  dx: "long", dy: "long", mouseData: "uint32", dwFlags: "uint32", time: "uint32", dwExtraInfo: "uintptr_t",
});
// INPUT = type + union { MOUSEINPUT, KEYBDINPUT, HARDWAREINPUT } : MOUSEINPUT est le plus grand (40 octets en x64)
const INPUT = koffi.struct("INPUT", { type: "uint32", mi: MOUSEINPUT });
const SendInput = user32.func("uint32 __stdcall SendInput(uint32 count, INPUT *inputs, int size)");
const GetSystemMetrics = user32.func("int __stdcall GetSystemMetrics(int index)");
koffi.struct("POINT", { x: "long", y: "long" });
const GetCursorPos = user32.func("bool __stdcall GetCursorPos(_Out_ POINT *p)");

const INPUT_MOUSE = 0;
const MOUSEEVENTF_MOVE = 0x0001;
const MOUSEEVENTF_ABSOLUTE = 0x8000;
const MOUSEEVENTF_VIRTUALDESK = 0x4000;
const SM_XVIRTUALSCREEN = 76, SM_YVIRTUALSCREEN = 77, SM_CXVIRTUALSCREEN = 78, SM_CYVIRTUALSCREEN = 79;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Position du curseur en pixels physiques (bureau virtuel, tous écrans)
function cursor() {
  const p = {};
  GetCursorPos(p);
  return { x: p.x, y: p.y };
}

function moveAbsolute(x, y) {
  const vx = GetSystemMetrics(SM_XVIRTUALSCREEN), vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const vw = GetSystemMetrics(SM_CXVIRTUALSCREEN), vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  const input = {
    type: INPUT_MOUSE,
    mi: {
      dx: Math.round(((x - vx) * 65535) / (vw - 1)),
      dy: Math.round(((y - vy) * 65535) / (vh - 1)),
      mouseData: 0,
      dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
      time: 0,
      dwExtraInfo: 0,
    },
  };
  return SendInput(1, [input], koffi.sizeof(INPUT)) === 1;
}

// Glisse jusqu'à (x, y) en pixels physiques, en ~steps étapes
async function glideTo(x, y, { steps = 6, stepMs = 8 } = {}) {
  const from = cursor();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = 1 - Math.pow(1 - t, 3); // ralenti à l'arrivée
    moveAbsolute(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await sleep(stepMs);
  }
  return cursor();
}

module.exports = { glideTo, cursor, sleep };
