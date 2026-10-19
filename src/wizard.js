const $ = (id) => document.getElementById(id);
const steps = [...document.querySelectorAll(".step")];
let stepIndex = 0;
let cfg = {}; // réglages en cours de choix, enregistrés à la fin
let detected = null;
let personalitiesInfo = {};
let hotkeyEditor = null;
const tests = {}; // provider → { state: "running" | "ok" | "err", text }

const WHISPER_MODELS = [
  { id: "onnx-community/whisper-base", name: "Base", desc: "rapide (~1,5 s), précision correcte", size: "≈ 145 Mo" },
  { id: "onnx-community/whisper-small", name: "Small", desc: "précis (~4 s) · recommandé", size: "≈ 315 Mo" },
  { id: "onnx-community/whisper-large-v3-turbo", name: "Large v3 Turbo", desc: "très précis, lent sans GPU", size: "≈ 1 Go" },
];
const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];

// ---------- Navigation ----------

$("steps").innerHTML = steps.map(() => "<span></span>").join("");

function showStep(i) {
  stepIndex = i;
  steps.forEach((s, k) => s.classList.toggle("active", k === i));
  [...$("steps").children].forEach((s, k) => s.classList.toggle("done", k <= i));
  $("prev").style.visibility = i === 0 ? "hidden" : "visible";
  $("next").textContent = i === steps.length - 1 ? "Terminer ✓" : "Suivant →";
  if (steps[i].dataset.title === "Prêt") renderSummary();
  // Étape voix : on lance le téléchargement du modèle choisi sans attendre un clic.
  if (steps[i].dataset.title === "Voix" && detected && !detected.whisper?.[cfg.whisperModel] && !$("dlBtn").disabled) $("dlBtn").click();
}

$("prev").onclick = () => showStep(Math.max(0, stepIndex - 1));
$("next").onclick = async () => {
  readForm();
  if (stepIndex === 0 && !providerReady(cfg.provider)) {
    if (!confirm("Ce moteur n'a pas encore fonctionné au test. Continuer quand même ?")) return;
  }
  if (stepIndex < steps.length - 1) return showStep(stepIndex + 1);
  if (hotkeyEditor) cfg.hotkeys = hotkeyEditor.get();
  await window.api.invoke("setup:finish", cfg);
};

// ---------- 1. Moteur IA ----------

function providerReady(p) {
  return tests[p]?.state === "ok";
}

function line(cls, text) {
  return `<span class="${cls}">${text}</span>`;
}

function renderProviders() {
  const d = detected;
  const cards = [
    {
      id: "codex-cli",
      title: "ChatGPT — ton abonnement",
      tag: "via Codex",
      status: d.codex.found
        ? `${line("ok", "✓")} Codex ${d.codex.version} trouvé (${d.codex.source})` +
          (d.codex.others ? ` · ${d.codex.others} autre(s) copie(s) ignorée(s)` : "") +
          "<br>" +
          (d.codex.auth.state === "ok" ? line("ok", "✓ Connecté à ChatGPT") : line("warn", "⚠ Pas connecté"))
        : line("warn", "Codex n'est pas installé."),
      actions: d.codex.found
        ? [d.codex.auth.state !== "ok" && ["Se connecter", () => login("codex")], ["Tester", () => test("codex-cli")]]
        : [[d.npm ? "Installer Codex" : "Télécharger Codex", () => install("codex")]],
    },
    {
      id: "claude-cli",
      title: "Claude — ton abonnement Pro/Max",
      tag: "via Claude Code",
      status: d.claude.found
        ? `${line("ok", "✓")} Claude Code ${d.claude.version} trouvé (${d.claude.source})` +
          (d.claude.others ? ` · ${d.claude.others} autre(s) copie(s) ignorée(s)` : "") +
          "<br>" +
          (d.claude.auth?.state === "missing" ? line("warn", "⚠ " + d.claude.auth.detail) : `Compte : ${d.claude.auth?.detail || "inconnu"}`)
        : line("warn", "Claude Code n'est pas installé."),
      actions: d.claude.found
        ? [["Se connecter", () => login("claude")], ["Tester", () => test("claude-cli")]]
        : [["Installer Claude Code", () => install("claude")]],
      note: "Utilise la réserve de crédits « Agent SDK » incluse dans ton abonnement.",
    },
    {
      id: "anthropic-api",
      title: "Claude — clé API",
      tag: "facturé à l'usage",
      input: { key: "anthropicKey", placeholder: "sk-ant-…" },
      actions: [["Tester", () => test("anthropic-api")]],
    },
    {
      id: "openai-api",
      title: "OpenAI — clé API",
      tag: "facturé à l'usage",
      input: { key: "openaiKey", placeholder: "sk-…" },
      actions: [["Tester", () => test("openai-api")]],
    },
  ];

  const box = $("providers");
  box.innerHTML = "";
  for (const c of cards) {
    const el = document.createElement("div");
    el.className = "card" + (cfg.provider === c.id ? " selected" : "");
    const t = tests[c.id];
    const testLine = !t ? "" : t.state === "running" ? "⏳ Test en cours…" : t.state === "ok" ? line("ok", "✓ " + t.text) : line("err", "✗ " + t.text);
    el.innerHTML = `
      <div class="top"><input type="radio" name="provider" ${cfg.provider === c.id ? "checked" : ""}><span class="title"></span><span class="tag"></span></div>
      <div class="status">${c.status || ""}</div>
      ${c.input ? `<input type="password" style="margin-top:8px">` : ""}
      <div class="status">${testLine}</div>
      ${c.note ? `<div class="hint"></div>` : ""}
      <div class="actions"></div>`;
    el.querySelector(".title").textContent = c.title;
    el.querySelector(".tag").textContent = c.tag;
    if (c.note) el.querySelector(".hint").textContent = c.note;
    if (c.input) {
      const input = el.querySelector("input[type=password]");
      input.placeholder = c.input.placeholder;
      input.value = cfg[c.input.key] || "";
      input.onclick = (e) => e.stopPropagation();
      input.oninput = () => (cfg[c.input.key] = input.value.trim());
    }
    for (const a of c.actions.filter(Boolean)) {
      const b = document.createElement("button");
      b.className = "ghost small";
      b.textContent = a[0];
      b.disabled = t?.state === "running";
      b.onclick = (e) => {
        e.stopPropagation();
        a[1]();
      };
      el.querySelector(".actions").appendChild(b);
    }
    el.onclick = () => {
      cfg.provider = c.id;
      renderProviders();
    };
    box.appendChild(el);
  }
}

async function detect(autoTest) {
  $("detectInfo").textContent = "Détection en cours…";
  detected = await window.api.invoke("setup:detect");
  $("detectInfo").textContent = "";
  renderProviders();
  renderWhisper();
  if (autoTest) {
    // Seul un vrai test prouve qu'une session est valide (Claude Code peut se dire connecté avec une session expirée).
    const runs = [];
    if (detected.codex.found && detected.codex.auth.state === "ok") runs.push(test("codex-cli"));
    if (detected.claude.found && detected.claude.auth?.state !== "missing") runs.push(test("claude-cli"));
    await Promise.all(runs);
    if (!providerReady(cfg.provider)) {
      const firstOk = ["codex-cli", "claude-cli"].find(providerReady);
      if (firstOk) cfg.provider = firstOk;
    }
    renderProviders();
  }
}

async function test(provider) {
  tests[provider] = { state: "running" };
  renderProviders();
  const r = await window.api.invoke("setup:test", {
    provider,
    overrides: { anthropicKey: cfg.anthropicKey, openaiKey: cfg.openaiKey },
  });
  tests[provider] = r.ok ? { state: "ok", text: `Fonctionne (réponse en ${r.seconds.toFixed(1)} s)` } : { state: "err", text: r.error };
  renderProviders();
}

async function login(tool) {
  await window.api.invoke("setup:login", tool);
  $("detectInfo").textContent = "Termine la connexion dans la fenêtre qui s'est ouverte, puis reviens ici.";
  waitForReturn();
}

async function install(tool) {
  await window.api.invoke("setup:install", { tool, npm: detected.npm });
  $("detectInfo").textContent = "Termine l'installation dans la fenêtre ouverte, puis reviens ici.";
  waitForReturn();
}

// Relance la détection quand l'utilisateur revient sur l'assistant après une connexion/installation.
function waitForReturn() {
  window.addEventListener("focus", () => detect(true), { once: true });
}

$("redetect").onclick = () => detect(true);

// ---------- 2. Voix ----------

function renderWhisper() {
  const box = $("whisperModels");
  box.innerHTML = "";
  for (const m of WHISPER_MODELS) {
    const st = detected?.whisper?.[m.id];
    const where = st === "bundled" ? line("ok", "✓ inclus") : st === "cached" ? line("ok", "✓ déjà téléchargé") : `à télécharger (${m.size})`;
    const el = document.createElement("div");
    el.className = "card" + (cfg.whisperModel === m.id ? " selected" : "");
    el.innerHTML = `<div class="top"><input type="radio" ${cfg.whisperModel === m.id ? "checked" : ""}><span class="title"></span><span class="tag">${where}</span></div><div class="status"></div>`;
    el.querySelector(".title").textContent = m.name;
    el.querySelectorAll(".status")[0].textContent = m.desc;
    el.onclick = () => {
      cfg.whisperModel = m.id;
      renderWhisper();
    };
    box.appendChild(el);
  }
  const ready = !!detected?.whisper?.[cfg.whisperModel];
  $("dlBtn").style.display = ready ? "none" : "";
  $("dlInfo").textContent = ready ? "✓ Modèle prêt" : "";
}

$("dlBtn").onclick = async () => {
  $("dlBtn").disabled = true;
  $("dlBar").style.display = "block";
  $("dlInfo").textContent = "Téléchargement…";
  const r = await window.api.invoke("setup:whisper-download", { model: cfg.whisperModel, device: cfg.whisperDevice });
  $("dlBar").style.display = "none";
  $("dlBtn").disabled = false;
  if (!r.ok) $("dlInfo").textContent = "✗ " + r.error;
  detected = await window.api.invoke("setup:detect");
  renderWhisper();
};

let sampleBtn = null; // bouton « Voix » en cours (affiche le téléchargement de la voix)

window.api.on("setup:progress", (p) => {
  if (p.kind === "voice") {
    if (sampleBtn) sampleBtn.textContent = `⬇ ${p.progress}%`;
    return;
  }
  $("dlBar").firstElementChild.style.width = p.progress + "%";
  $("dlInfo").textContent = `Téléchargement… ${p.progress}%`;
});

// Test micro : maintenir le bouton, relâcher pour transcrire.
let recorder = null;
async function toPcm16k(blob) {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close();
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

$("recBtn").onmousedown = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      $("recBtn").classList.remove("rec");
      $("recResult").textContent = "Transcription… (le modèle est chargé la première fois)";
      const pcm = await toPcm16k(new Blob(chunks, { type: "audio/webm" }));
      const r = await window.api.invoke("setup:transcribe", { pcm, model: cfg.whisperModel, device: cfg.whisperDevice, language: cfg.language });
      $("recResult").innerHTML = r.ok
        ? `${line("ok", "✓")} « ${escapeHtml(r.text || "(rien entendu)")} » <span class="hint">en ${r.seconds.toFixed(1)} s</span>`
        : line("err", "✗ " + escapeHtml(r.error));
      detected = await window.api.invoke("setup:detect");
      renderWhisper();
    };
    recorder.start();
    $("recBtn").classList.add("rec");
  } catch (err) {
    $("recResult").innerHTML = line("err", "✗ Micro indisponible : " + escapeHtml(err.message));
  }
};
const stopRec = () => recorder && recorder.state !== "inactive" && recorder.stop();
$("recBtn").onmouseup = stopRec;
$("recBtn").onmouseleave = stopRec;

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function loadVoices() {
  const sel = $("systemVoice");
  const voices = speechSynthesis.getVoices();
  sel.innerHTML = '<option value="">Automatique (selon la langue)</option>';
  for (const v of voices) sel.add(new Option(`${v.name} (${v.lang})`, v.name));
  sel.value = voices.some((v) => v.name === cfg.systemVoice) ? cfg.systemVoice : "";
}
speechSynthesis.onvoiceschanged = loadVoices;

$("ttsVoice").innerHTML = ['<option value="auto">Selon le personnage</option>', ...OPENAI_VOICES.map((v) => `<option>${v}</option>`)].join("");
$("ttsEngine").onchange = () => {
  const engine = $("ttsEngine").value;
  $("systemVoice").style.display = engine === "system" ? "" : "none";
  $("ttsVoice").style.display = engine === "openai" ? "" : "none";
  $("ttsHint").style.display = engine === "piper" ? "" : "none";
};

$("ttsTest").onclick = async () => {
  readForm();
  const text = "Salut ! Je suis prêt à t'aider pendant tes parties.";
  if (cfg.ttsEngine === "piper") {
    return playSample(cfg.mascot, personalitiesInfo[cfg.mascot], $("ttsTest"));
  }
  if (cfg.ttsEngine === "openai") {
    const r = await window.api.invoke("setup:tts-test", { text, voice: cfg.ttsVoice === "auto" ? "alloy" : cfg.ttsVoice, openaiKey: cfg.openaiKey });
    if (!r.ok) return alert("Voix OpenAI : " + r.error);
    new Audio(URL.createObjectURL(new Blob([r.mp3], { type: "audio/mpeg" }))).play();
  } else {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices().find((x) => x.name === cfg.systemVoice) || speechSynthesis.getVoices().find((x) => x.lang.startsWith("fr"));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }
};

// ---------- 3. Jeu ----------

async function playSample(id, perso, btn) {
  const openaiVoice = perso.voice;
  readForm();
  if (cfg.ttsEngine === "piper") {
    const label = btn?.textContent;
    sampleBtn = btn;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "…";
    }
    const r = await window.api.invoke("setup:voice-sample", { mascot: id, language: cfg.language, text: perso.sample });
    sampleBtn = null;
    if (btn) {
      btn.disabled = false;
      btn.textContent = label;
    }
    if (r.ok) {
      const a = new Audio(URL.createObjectURL(new Blob([r.wav], { type: "audio/wav" })));
      a.preservesPitch = false;
      a.playbackRate = r.pitch;
      return a.play();
    }
    alert("Voix locale : " + r.error);
    return;
  }
  if (cfg.ttsEngine === "openai" && cfg.openaiKey) {
    const r = await window.api.invoke("setup:tts-test", { text: perso.sample, voice: openaiVoice || "alloy", openaiKey: cfg.openaiKey });
    if (r.ok) return new Audio(URL.createObjectURL(new Blob([r.mp3], { type: "audio/mpeg" }))).play();
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(perso.sample);
  u.pitch = perso.systemVoice?.pitch ?? 1;
  u.rate = perso.systemVoice?.rate ?? 1;
  const v = speechSynthesis.getVoices().find((x) => x.name === cfg.systemVoice) || speechSynthesis.getVoices().find((x) => x.lang.startsWith("fr"));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

async function loadSources() {
  const sources = await window.api.invoke("sources:list");
  const sel = $("target");
  sel.innerHTML = "";
  for (const s of [{ id: "screen", name: "Écran entier" }, ...sources]) {
    const o = new Option(s.name, s.id);
    o.dataset.name = s.name;
    sel.add(o);
  }
  sel.value = [...sel.options].some((o) => o.value === cfg.target?.id) ? cfg.target.id : "screen";
}
$("refreshTarget").onclick = loadSources;

// ---------- Formulaire ----------

const FIELDS = ["ttsEngine", "systemVoice", "ttsVoice", "mascot", "language"];
const CHECKS = ["voiceEnabled", "useVision", "webSearch"];

function readForm() {
  for (const f of FIELDS) cfg[f] = $(f).value;
  for (const c of CHECKS) cfg[c] = $(c).checked;
  const t = $("target");
  if (t.value) cfg.target = { id: t.value, name: t.selectedOptions[0]?.dataset.name || "Écran entier" };
  cfg.sttEngine = "local";
}

function renderSummary() {
  const names = { "codex-cli": "ChatGPT (abonnement, via Codex)", "claude-cli": "Claude (abonnement, via Claude Code)", "anthropic-api": "Claude (clé API)", "openai-api": "OpenAI (clé API)" };
  const model = WHISPER_MODELS.find((m) => m.id === cfg.whisperModel);
  const rows = [
    ["IA", names[cfg.provider] + (providerReady(cfg.provider) ? " ✓" : " — non testé")],
    ["Reconnaissance vocale", `Whisper ${model?.name} en local` + (detected?.whisper?.[cfg.whisperModel] ? " ✓" : " — sera téléchargé au premier usage")],
    ["Voix", cfg.voiceEnabled ? { piper: "voix neuronale locale du personnage", openai: "OpenAI", system: "Windows" }[cfg.ttsEngine] : "désactivée"],
    ["Fenêtre observée", cfg.target?.name || "Écran entier"],
    ["Personnage", personalitiesInfo[cfg.mascot] && `${personalitiesInfo[cfg.mascot].name} — ${personalitiesInfo[cfg.mascot].tagline}`],
  ];
  $("summary").innerHTML = rows.map(([k, v]) => `<div><b>${k} :</b> ${escapeHtml(v || "")}</div>`).join("");
}

// ---------- Démarrage ----------

(async () => {
  const { settings, personalities } = await window.api.invoke("settings:get");
  cfg = { ...settings };
  personalitiesInfo = personalities;
  loadVoices();
  for (const f of FIELDS) $(f).value = cfg[f] ?? "";
  for (const c of CHECKS) $(c).checked = !!cfg[c];
  window.Mascots.picker($("mascotPicker"), cfg.mascot, (id) => ($("mascot").value = cfg.mascot = id), {
    personas: personalities,
    onVoice: (id, btn) => playSample(id, personalities[id], btn),
  });
  $("ttsEngine").onchange();
  showStep(0);
  hotkeyEditor = await window.HotkeysUI.mount($("hotkeys"));
  await loadSources();
  await detect(true);
})();
