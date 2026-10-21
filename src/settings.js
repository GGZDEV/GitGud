const $ = (id) => document.getElementById(id);
const FIELDS = [
  "provider", "codexModel", "codexEffort", "claudeCliModel", "anthropicModel", "effort", "openaiModel",
  "anthropicKey", "openaiKey", "mascot", "language",
  "sttEngine", "whisperModel", "whisperDevice", "ttsEngine", "systemVoice", "ttsVoice", "autoHideSeconds", "deadlockAccountId",
  "claudeFastModel", "codexFastModel", "codexFastEffort", "anthropicFastModel", "openaiFastModel",
];
const CHECKS = ["webSearch", "useVision", "voiceEnabled", "overlayCompact", "fastLane", "memoryEnabled", "annotations"];
const RANGES = { overlayScale: (v) => `${Math.round(v * 100)} %`, overlayOpacity: (v) => `${Math.round(v * 100)} %` };

let current;
let hotkeyEditor = null;
let cli = { claude: false, codex: false };
let personas = {};

// Onglets de navigation (le dernier ouvert est retenu pour la session).
function showTab(tab) {
  document.querySelectorAll("nav [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("on", p.dataset.panel === tab));
  try {
    sessionStorage.setItem("tab", tab);
  } catch {}
}
document.querySelectorAll("nav [data-tab]").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// Portrait du personnage choisi, en haut de la navigation.
function showWho(id, state = "idle") {
  const p = personas[id] || {};
  window.Mascots.render($("who"), id, state);
  $("whoName").innerHTML = "";
  $("whoName").append(p.name || "", Object.assign(document.createElement("em"), { textContent: "." }));
  $("whoTag").textContent = (p.title || "").toLowerCase();
}

// Extrait de voix du personnage, avec le moteur de synthèse choisi.
async function playSample(id, btn) {
  const p = personas[id];
  const engine = $("ttsEngine").value;
  showWho(id, "speaking");
  const done = () => showWho($("mascot").value, "idle");
  if (engine === "piper") {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "…";
    const r = await window.api.invoke("setup:voice-sample", { mascot: id, language: $("language").value, text: p.sample });
    btn.disabled = false;
    btn.textContent = label;
    if (r.ok) {
      const a = new Audio(URL.createObjectURL(new Blob([r.wav], { type: "audio/wav" })));
      a.preservesPitch = false;
      a.playbackRate = r.pitch;
      a.onended = done;
      return a.play();
    }
    done();
    return alert("Voix locale : " + r.error);
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(p.sample);
  u.pitch = p.systemVoice?.pitch ?? 1;
  u.rate = p.systemVoice?.rate ?? 1;
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find((v) => v.name === $("systemVoice").value) || voices.find((v) => v.lang.startsWith("fr")) || null;
  u.onend = done;
  speechSynthesis.speak(u);
}

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
  const { settings, personalities, version } = await window.api.invoke("settings:get");
  current = settings;
  personas = personalities;
  $("ver").textContent = `v${version} · ONLINE`;
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
  window.Mascots.picker(
    $("mascotPicker"),
    settings.mascot,
    (id) => {
      $("mascot").value = id;
      showWho(id);
    },
    { personas, onVoice: playSample },
  );
  showWho(settings.mascot);
  let tab = "perso";
  try {
    tab = sessionStorage.getItem("tab") || tab;
  } catch {}
  showTab(tab);
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

const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});

// Modules de jeu : intégrés (code ou JSON) et ajoutés dans le dossier perso
async function loadGames() {
  const { games, errors } = await window.api.invoke("games:list");
  const box = $("gameList");
  box.innerHTML = "";
  for (const g of games) {
    const row = el("div", "item");
    row.append(el("span", "k", g.origin), el("span", "t", g.name + (g.description ? ` — ${g.description}` : "")));
    const extras = [g.live && "données en direct", g.timers && `${g.timers} minuteur${g.timers > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
    if (extras) row.append(el("span", "m", extras));
    box.append(row);
  }
  for (const e of errors) box.append(el("div", "item err", "⚠ " + e));
}
$("openGames").onclick = () => window.api.invoke("games:open-folder");
$("reloadGames").onclick = loadGames;

// Mémoire : souvenirs par jeu, supprimables un par un
function ago(ts) {
  const d = Math.floor((Date.now() - ts) / 86400000);
  return d <= 0 ? "aujourd'hui" : d === 1 ? "hier" : `il y a ${d} j`;
}

function renderMemory(groups) {
  const box = $("memoryList");
  box.innerHTML = "";
  const withFacts = groups.filter((g) => g.facts.length);
  if (!withFacts.length) {
    box.append(el("div", "empty", "Rien pour l'instant. Parle de tes objectifs ou de ce qui te bloque pendant une partie."));
    return;
  }
  for (const g of withFacts) {
    box.append(el("h3", null, g.name));
    for (const f of g.facts) {
      const row = el("div", "item");
      const del = el("button", "ghost small", "✕");
      del.type = "button";
      del.title = "Oublier";
      del.onclick = async () => renderMemory(await window.api.invoke("memory:delete", f.id));
      row.append(el("span", "k", f.label), el("span", "t", f.text), el("span", "m", ago(f.at) + (f.count > 1 ? ` · ×${f.count}` : "")), del);
      box.append(row);
    }
  }
}
$("memoryClear").onclick = async () => {
  if (confirm("Effacer toute la mémoire de GitGud (souvenirs et questions passées) ?")) renderMemory(await window.api.invoke("memory:clear"));
};
document.querySelector('nav [data-tab="memoire"]').addEventListener("click", async () => renderMemory(await window.api.invoke("memory:list")));
document.querySelector('nav [data-tab="jeux"]').addEventListener("click", loadGames);
window.api.invoke("memory:list").then(renderMemory);
loadGames();

init();
