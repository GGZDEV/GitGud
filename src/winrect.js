// Rectangle d'une fenêtre à l'écran (pixels physiques), pour placer les annotations de l'IA
// sur le jeu. Les sources de desktopCapturer portent le HWND : « window:<hwnd>:0 ».
let api = null;

function load() {
  if (api !== null) return api;
  try {
    const koffi = require("koffi");
    const dwm = koffi.load("dwmapi.dll");
    const user32 = koffi.load("user32.dll");
    const RECT = koffi.struct("GG_RECT", { left: "long", top: "long", right: "long", bottom: "long" });
    api = {
      RECT,
      koffi,
      // DWMWA_EXTENDED_FRAME_BOUNDS = 9 : la zone réellement visible, sans l'ombre (comme la capture)
      DwmGetWindowAttribute: dwm.func("long __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32 attr, _Out_ GG_RECT *rect, uint32 size)"),
      GetWindowRect: user32.func("bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ GG_RECT *rect)"),
      IsIconic: user32.func("bool __stdcall IsIconic(intptr_t hwnd)"),
    };
  } catch (err) {
    console.warn("winrect :", err.message);
    api = false;
  }
  return api;
}

// sourceId : identifiant desktopCapturer → { x, y, width, height } en pixels physiques, ou null
function windowRect(sourceId) {
  const hwnd = Number(String(sourceId || "").match(/^window:(\d+)/)?.[1]);
  const a = hwnd && load();
  if (!a) return null;
  try {
    if (a.IsIconic(hwnd)) return null;
    const r = {};
    const ok = a.DwmGetWindowAttribute(hwnd, 9, r, a.koffi.sizeof(a.RECT)) === 0 || a.GetWindowRect(hwnd, r);
    if (!ok || r.right <= r.left || r.bottom <= r.top) return null;
    return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  } catch {
    return null;
  }
}

module.exports = { windowRect };
