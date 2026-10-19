const $ = (id) => document.getElementById(id);
const card = $("card");
const log = $("log");
const statusEl = $("status");
const chip = $("chip");
const meter = $("meter");
const askForm = $("ask");
const askInput = $("askInput");
const mascotEl = $("mascot");

const STATUS = {
  idle: "[ PRÊT ]",
  listening: "[ ● REC ]",
  transcribing: "[ STT ]",
  thinking: "[ SCAN ]",
  speaking: "[ OUTPUT ]",
};
const PENDING = { thinking: "scan en cours", transcribing: "transcription" };

let config = { mascot: "slime", autoHideSeconds: 20, context: "" };
let state = "idle";
let current = null; // bulle de réponse en cours
let recorder = null;
let chunks = [];
let audio = null;
let hideTimer = null;
let meterStop = null;

// ---------- Apparence ----------

function applyConfig(c) {
  config = { ...config, ...c };
  const root = document.documentElement.style;
  $("name").innerHTML = "";
  $("name").append(config.name || "KIN", Object.assign(document.createElement("em"), { textContent: "." }));
  $("context").textContent = config.context ? "src: " + config.context.toLowerCase().replace(/\s+/g, "_") : "";
  if (config.version) $("ver").textContent = `v${config.version} · ONLINE`;
  if (config.hotkeys) {
    $("hkPtt").textContent = config.hotkeys.ptt;
    $("hkText").textContent = config.hotkeys.text;
    $("hkHide").textContent = config.hotkeys.hide;
  }
  document.body.classList.toggle("pinned", !!config.pinned);
  document.body.classList.toggle("compact", !!config.compact);
  root.setProperty("--bg-alpha", String(config.opacity ?? 0.9));
  if (config.pinned) clearTimeout(hideTimer);
  else if (state === "idle") setState("idle"); // relance le masquage automatique
  window.Mascots.render(mascotEl, config.mascot, state);
  // L'icône de la zone de notification suit la mascotte.
  window.Mascots.iconDataUrl(config.mascot, 64).then((url) => window.api.send("tray:icon", url)).catch(() => {});
}

window.api.invoke("overlay:config").then(applyConfig);
window.api.on("config", applyConfig);

// Petite animation d'entrée à chaque apparition de l'overlay.
const wrap = $("wrap");
function popIn() {
  wrap.classList.remove("shown");
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add("shown")));
}
document.addEventListener("visibilitychange", () => !document.hidden && popIn());
popIn();

for (let i = 0; i < 24; i++) meter.appendChild(document.createElement("span"));

// ---------- Survol et déplacement ----------
// La fenêtre laisse passer la souris vers le jeu, sauf au-dessus de la carte.
card.addEventListener("mouseenter", () => window.api.send("overlay:hover", true));
card.addEventListener("mouseleave", () => window.api.send("overlay:hover", false));

const handle = $("handle");
handle.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  handle.setPointerCapture(e.pointerId);
  document.body.classList.add("dragging");
  window.api.send("overlay:drag", "start");
});
handle.addEventListener("pointermove", (e) => {
  if (handle.hasPointerCapture(e.pointerId)) window.api.send("overlay:drag", "move");
});
const endDrag = (e) => {
  if (!handle.hasPointerCapture(e.pointerId)) return;
  handle.releasePointerCapture(e.pointerId);
  document.body.classList.remove("dragging");
  window.api.send("overlay:drag", "end");
};
handle.addEventListener("pointerup", endDrag);
handle.addEventListener("pointercancel", endDrag);

// Points animés tant que la réponse n'a pas commencé (Codex répond d'un bloc).
function showPending(on) {
  let el = log.querySelector(".pending");
  if (on && !current) {
    if (!el) {
      el = document.createElement("div");
      el.className = "msg pending";
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
    }
    el.innerHTML = (PENDING[state] || PENDING.thinking) + "<i></i><i></i><i></i>";
  } else if (!on && el) {
    el.remove();
  }
}

function setState(s) {
  // La voix continue après la fin de la réponse : on reste « En direct » jusqu'au bout.
  if (s === "idle" && (speechSynthesis.speaking || (audio && !audio.paused && !audio.ended))) return;
  state = s;
  showPending(s === "thinking" || s === "transcribing");
  chip.className = s;
  statusEl.textContent = STATUS[s] || s;
  window.Mascots.render(mascotEl, config.mascot, s);
  clearTimeout(hideTimer);
  if (s === "idle" && config.autoHideSeconds > 0 && !config.pinned) {
    hideTimer = setTimeout(() => window.api.send("overlay:autohide"), config.autoHideSeconds * 1000);
  }
}

// ---------- Messages ----------

function addMsg(kind, text) {
  showPending(false);
  // Les échanges précédents restent visibles mais estompés.
  if (kind === "user") log.querySelectorAll(".msg").forEach((m) => m.classList.add("old"));
  const el = document.createElement("div");
  el.className = "msg " + kind;
  el.textContent = text;
  log.appendChild(el);
  while (log.children.length > 8) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  return el;
}

function showError(message) {
  addMsg("error", message);
  window.Mascots.render(mascotEl, config.mascot, "error");
  setTimeout(() => window.Mascots.render(mascotEl, config.mascot, state), 900);
}

window.api.on("state", setState);
window.api.on("user-text", (t) => {
  addMsg("user", t);
  current = null;
});
window.api.on("assistant-delta", (d) => {
  if (!current) current = addMsg("assistant typing", "");
  current.textContent += d;
  log.scrollTop = log.scrollHeight;
});
// Sépare le texte de la réponse et les liens cités (affichés en pastilles cliquables).
function splitSources(text) {
  const urls = [...new Set((text.match(/https?:\/\/[^\s)\]>"']+/g) || []).map((u) => u.replace(/[.,;:]+$/, "")))];
  const body = text
    .replace(/\n*\s*(sources?|références?)\s*:[\s\S]*$/i, "")
    .replace(/\[([^\]]+)\]\(https?:[^)]+\)/g, "$1")
    .replace(/\(?https?:\/\/[^\s)]+\)?/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim();
  return { body: body || text, urls };
}

window.api.on("assistant-done", (t) => {
  if (!current) current = addMsg("assistant", "");
  const { body, urls } = splitSources(t);
  current.textContent = body;
  current.classList.remove("typing");
  if (urls.length) {
    const box = document.createElement("div");
    box.className = "msg sources";
    for (const url of urls.slice(0, 4)) {
      const a = document.createElement("a");
      a.textContent = "↗ " + new URL(url).hostname.replace(/^www\./, "");
      a.title = url;
      a.onclick = () => window.api.send("open-url", url);
      box.appendChild(a);
    }
    current.after(box);
  }
  current = null;
});
window.api.on("error", showError);

// Petite information discrète qui disparaît seule (ex. rien entendu).
window.api.on("notice", (message) => {
  const el = addMsg("notice", message);
  setTimeout(() => el.remove(), 4000);
});
window.api.on("reset", () => (log.innerHTML = ""));
window.api.on("stop-all", () => {
  stopAudio();
  if (recorder && recorder.state !== "inactive") recorder.stop();
});

window.api.on("download", ({ kind, progress }) => {
  statusEl.textContent = progress < 100 ? `${kind === "voice" ? "Voix" : "Whisper"} ${progress}%` : STATUS[state];
});

// ---------- Micro (push-to-talk) ----------

// Décode l'enregistrement et le rééchantillonne en mono 16 kHz (format attendu par Whisper).
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

// Barres de niveau du micro pendant l'écoute.
function startMeter(stream) {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 64;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const bars = [...meter.children];
  let raf;
  const draw = () => {
    analyser.getByteFrequencyData(data);
    bars.forEach((b, i) => (b.style.height = 4 + (data[i + 1] / 255) * 24 + "px"));
    // La mascotte réagit à ta voix : halo et petit sursaut selon le volume.
    let sum = 0;
    for (let i = 1; i < 12; i++) sum += data[i];
    mascotEl.style.setProperty("--level", Math.min(1, sum / 11 / 160).toFixed(3));
    raf = requestAnimationFrame(draw);
  };
  meter.classList.add("on");
  mascotEl.classList.add("driven");
  draw();
  return () => {
    cancelAnimationFrame(raf);
    ctx.close();
    meter.classList.remove("on");
    mascotEl.classList.remove("driven");
    mascotEl.style.setProperty("--level", "0");
  };
}

window.api.on("ptt-start", async () => {
  stopAudio();
  setState("listening");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    meterStop = startMeter(stream);
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      meterStop?.();
      meterStop = null;
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: "audio/webm" });
      if (blob.size < 2000) return setState("idle"); // appui trop court
      try {
        window.api.invoke("audio:question", await toPcm16k(blob));
      } catch (err) {
        showError("Audio illisible : " + err.message);
        setState("idle");
      }
    };
    recorder.start();
  } catch (err) {
    showError("Micro indisponible : " + err.message);
    setState("idle");
  }
});

window.api.on("ptt-stop", () => {
  if (recorder && recorder.state !== "inactive") recorder.stop();
});

// ---------- Voix ----------

function stopAudio() {
  mouthStop?.();
  if (audio) {
    audio.pause();
    audio = null;
  }
  speechSynthesis.cancel();
}

window.api.on("tts-audio", ({ data, type, pitch }) => {
  stopAudio();
  audio = new Audio(URL.createObjectURL(new Blob([data], { type })));
  if (pitch && pitch !== 1) {
    audio.preservesPitch = false; // voix plus aiguë ou plus grave selon le personnage
    audio.playbackRate = pitch;
  }
  audio.onended = () => {
    mouthStop?.();
    setState("idle");
  };
  setState("speaking");
  mouthStop = driveMouth(audio);
  audio.play();
});

// La bouche de la mascotte suit le volume réel de la voix (synchronisation labiale simple).
let mouthStop = null;
function driveMouth(el) {
  mouthStop?.();
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  const src = ctx.createMediaElementSource(el);
  src.connect(analyser);
  analyser.connect(ctx.destination);
  const data = new Uint8Array(analyser.fftSize);
  let raf;
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += (v - 128) * (v - 128);
    const rms = Math.sqrt(sum / data.length) / 128;
    mascotEl.style.setProperty("--talk", (0.4 + Math.min(1, rms * 5) * 1.6).toFixed(2));
    raf = requestAnimationFrame(tick);
  };
  mascotEl.classList.add("driven");
  tick();
  return () => {
    cancelAnimationFrame(raf);
    ctx.close();
    mascotEl.classList.remove("driven");
    mouthStop = null;
  };
}

// Voix Windows installées (gratuites, hors ligne).
window.api.on("tts-system", ({ text, voice, language, pitch, rate }) => {
  stopAudio();
  const u = new SpeechSynthesisUtterance(text);
  u.pitch = pitch ?? 1;
  u.rate = rate ?? 1;
  const voices = speechSynthesis.getVoices();
  const lang = language && language !== "auto" ? language : (navigator.language || "fr").slice(0, 2);
  u.voice = voices.find((v) => v.name === voice) || voices.find((v) => v.lang.startsWith(lang)) || null;
  if (u.voice) u.lang = u.voice.lang;
  u.onend = () => setState("idle");
  setState("speaking");
  speechSynthesis.speak(u);
});

// ---------- Question écrite ----------

window.api.on("text-input", () => {
  askForm.style.display = "block";
  askInput.value = "";
  askInput.focus();
});

askForm.addEventListener("submit", (e) => {
  e.preventDefault();
  askForm.style.display = "none";
  window.api.send("text:question", askInput.value);
});

askInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    askForm.style.display = "none";
    window.api.send("text:cancel");
  }
});
