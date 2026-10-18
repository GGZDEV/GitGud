const $ = (id) => document.getElementById(id);
const FIELDS = [
  "provider", "codexModel", "codexEffort", "claudeCliModel", "anthropicModel", "effort", "openaiModel",
  "anthropicKey", "openaiKey", "personality", "mascot", "language",
  "sttEngine", "whisperModel", "whisperDevice", "ttsEngine", "systemVoice", "ttsVoice", "autoHideSeconds", "deadlockAccountId",
];
const CHECKS = ["webSearch", "useVision", "voiceEnabled", "overlayCompact"];
const RANGES = { overlayScale: (v) => `${Math.round(v * 100)} %`, overlayOpacity: (v) => `${Math.round(v * 100)} %` };

let current;
let hotkeyEditor = null;
let cli = { claude: false, codex: false };

// Affiche uniquement les réglages du moteur choisi.
function refreshVisibility() {
  const provider = $("provider").value;
  document.querySelectorAll("[data-show]").forEach((el) => (el.style.display = el.dataset.show === provider ? "" : "none"));
  document.querySelectorAll("[data-stt]").forEach((el) => (el.style.display = el.dataset.stt === $("sttEngine").value ? "" : "none"));
  document.querySelectorAll("[data-tts]").forEach((el) => (el.style.display = el.dataset.tts === $("ttsEngine").value ? "" : "none"));
  const status = $("cliStatus");
  if (provider === "codex-cli") {
    status.textContent = cli.codex ? "✓ Codex détecté" : "✗ Codex introuvable — npm install -g @openai/codex";
  } else if (provider === "claude-cli") {
    status.textContent = cli.claude ? "✓ Claude Code détecté" : "✗ Claude Code introuvable — npm install -g @anthropic-ai/claude-code";
  } else {
    status.textContent = "";
  }
}

function loadSystemVoices(selected) {
  const sel = $("systemVoice");
  const voices = speechSynthesis.getVoices();
  sel.innerHTML = '<option value="">Automatique (selon la langue)</option>';
  for (const v of voices) {
    const o = document.createElement("option");
    o.value = v.name;
    o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
  }
  sel.value = voices.some((v) => v.name === selected) ? selected : "";
}

async function loadSources(selected) {
  const sources = await window.api.invoke("sources:list");
  const sel = $("target");
  sel.innerHTML = "";
  const opts = [{ id: "screen", name: "Écran entier" }, ...sources];
  if (selected && selected.id !== "screen" && !sources.some((s) => s.id === selected.id || s.name === selected.name)) {
    opts.push(selected); // fenêtre mémorisée mais fermée pour l'instant
  }
  for (const s of opts) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    o.dataset.name = s.name;
    sel.appendChild(o);
  }
  const match = opts.find((s) => s.id === selected?.id) || opts.find((s) => s.name === selected?.name);
  sel.value = match ? match.id : "screen";
}

async function init() {
  const { settings, personalities } = await window.api.invoke("settings:get");
  current = settings;
  for (const [id, p] of Object.entries(personalities)) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = `${p.name} — ${p.tagline}`;
    $("personality").appendChild(o);
  }
  loadSystemVoices(settings.systemVoice);
  speechSynthesis.onvoiceschanged = () => loadSystemVoices($("systemVoice").value || current.systemVoice);
  for (const f of FIELDS) $(f).value = settings[f] ?? "";
  for (const c of CHECKS) $(c).checked = !!settings[c];
  for (const [id, fmt] of Object.entries(RANGES)) {
    $(id).value = settings[id];
    const show = () => ($(id + "Val").textContent = fmt(Number($(id).value)));
    $(id).oninput = show;
    show();
  }
  window.Mascots.picker($("mascotPicker"), settings.mascot, (id) => ($("mascot").value = id));
  hotkeyEditor = await window.HotkeysUI.mount($("hotkeys"));
  cli = await window.api.invoke("cli:status");
  refreshVisibility();
  await loadSources(settings.target);
}

for (const id of ["provider", "sttEngine", "ttsEngine"]) $(id).addEventListener("change", refreshVisibility);

$("refresh").onclick = () => {
  const sel = $("target");
  loadSources({ id: sel.value, name: sel.selectedOptions[0]?.dataset.name });
};

$("save").onclick = async () => {
  const next = {};
  for (const f of FIELDS) next[f] = $(f).value.trim();
  next.autoHideSeconds = Number(next.autoHideSeconds) || 0;
  for (const c of CHECKS) next[c] = $(c).checked;
  for (const id of Object.keys(RANGES)) next[id] = Number($(id).value);
  if (hotkeyEditor) next.hotkeys = hotkeyEditor.get();
  const sel = $("target");
  next.target = { id: sel.value, name: sel.selectedOptions[0]?.dataset.name || "Écran entier" };
  await window.api.invoke("settings:save", next);
  $("saved").style.opacity = 1;
  setTimeout(() => ($("saved").style.opacity = 0), 1500);
};

// Diablo IV : panneau dédié
$("openD4").onclick = () => window.api.invoke("d4:open-panel");

init();
