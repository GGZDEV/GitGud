const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  desktopCapturer,
  screen,
  globalShortcut,
  nativeImage,
  session,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const store = require("./src/store");
const { AI } = require("./src/ai");
const { registerSetupIpc, broadcast } = require("./src/setup/ipc");
const { PERSONALITIES, buildSystemPrompt } = require("./src/personalities");
const { voiceFor } = require("./src/tts/voices");
const { speechSeconds, isHallucination } = require("./src/stt/speech-check");
const { Hotkeys, ACTION_LABELS, DEFAULT_HOTKEYS, label } = require("./src/hotkeys");
const { initUpdater } = require("./src/updater");
const { detectGame, gameContext, listGames, configurePacks } = require("./src/games");
const { Memory, GLOBAL } = require("./src/memory");
const { Timers, parseTimerCommand, formatDuration } = require("./src/timers");
const { TagFilter, stripTags } = require("./src/stream/tags");
const { SentenceSplitter } = require("./src/stream/sentences");
const { classify } = require("./src/fastlane");
const { windowRect, foregroundTitle } = require("./src/winrect");
const { D4Manager, EQUIP_SLOTS } = require("./src/games/d4/manager");
const diablo4Game = require("./src/games/diablo4");

const CONVERSATION_TIMEOUT_MS = 5 * 60 * 1000;

// Mode léger : l'overlay (texte, UI) est rendu par le processeur. Ça évite de partager la
// carte graphique avec le jeu et de solliciter ses pilotes pour une fenêtre transparente
// au premier plan. GITGUD_GPU=1 pour réactiver l'accélération (tests).
if (process.env.GITGUD_GPU !== "1") app.disableHardwareAcceleration();

// Profil séparé (tests, ou plusieurs configurations) : GITGUD_DATA=dossier
if (process.env.GITGUD_DATA) app.setPath("userData", process.env.GITGUD_DATA);
else migrateUserData();

// L'app s'appelait GameHelper : on reprend son dossier (%APPDATA%/gamehelper) au premier lancement
// de GitGud, avec réglages, builds Diablo IV, modèles et voix déjà téléchargés.
function migrateUserData() {
  const fs = require("fs");
  const dest = app.getPath("userData");
  const old = path.join(app.getPath("appData"), "gamehelper");
  if (!fs.existsSync(old) || fs.existsSync(path.join(dest, "settings.json"))) return;
  try {
    if (fs.existsSync(dest)) throw new Error("dossier déjà créé");
    fs.renameSync(old, dest); // le plus rapide : rien à copier
    return;
  } catch {}
  // Ancienne app encore ouverte (fichiers verrouillés) : copie élément par élément, sans les
  // caches de Chromium, qui se recréent seuls
  const CACHES = /^(Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|Network|Shared Dictionary|blob_storage|Session Storage)$/;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(old)) {
    if (CACHES.test(entry)) continue;
    try {
      fs.cpSync(path.join(old, entry), path.join(dest, entry), { recursive: true, force: false });
    } catch (err) {
      console.warn(`Migration des données GameHelper (${entry}) :`, err.message);
    }
  }
}

let settings;
let ai;
let overlay;
let settingsWin;
let wizardWin;
let tray;
let history = [];
let lastExchangeAt = 0;
let busy = false;
let recording = false;
let requestSeq = 0;
let memory;
let lastGame = null; // dernier jeu reconnu (minuteurs prédéfinis de son module)
let conversationTimer = null;
const fastBroken = {}; // moteur dont la voie rapide a échoué : coupée jusqu'au prochain enregistrement des réglages
const timers = new Timers();

// ---------- Fenêtres ----------

// Taille de la fenêtre de l'overlay selon les réglages (échelle, mode compact).
function overlaySize() {
  const scale = settings.overlayScale || 1;
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.round((settings.overlayCompact ? 340 : 440) * scale);
  const height = Math.round(Math.min((settings.overlayCompact ? 320 : 640) * scale, workArea.height - 32));
  return { width, height };
}

// Toujours setBounds avec une taille explicite : avec une mise à l'échelle Windows non entière
// (125 %, 150 %), setPosition seul agrandit la fenêtre d'un pixel à chaque déplacement.
function placeOverlay(x, y) {
  overlay.setBounds({ x: Math.round(x), y: Math.round(y), ...overlaySize() });
}

function applyOverlayLook() {
  const [x, y] = overlay.getPosition();
  placeOverlay(x, y);
  overlay.webContents.setZoomFactor(settings.overlayScale || 1);
}

function defaultOverlayPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - overlaySize().width - 16, y: workArea.y + 16 };
}

// Position mémorisée, si elle est encore sur un écran branché (le haut de la carte doit être visible).
function savedOverlayPosition() {
  const pos = settings.overlayPosition;
  if (!pos) return null;
  const visible = screen.getAllDisplays().some(({ workArea: a }) => pos.x + 80 > a.x && pos.x + 80 < a.x + a.width && pos.y >= a.y - 4 && pos.y + 40 < a.y + a.height);
  return visible ? pos : null;
}

function createOverlay() {
  const { x, y } = savedOverlayPosition() || defaultOverlayPosition();
  overlay = new BrowserWindow({
    x,
    y,
    ...overlaySize(),
    frame: false,
    transparent: true,
    hasShadow: false, // pas d'ombre de fenêtre Windows autour de la zone transparente
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  // Exclut l'overlay des captures : l'IA ne voit que le jeu.
  overlay.setContentProtection(true);
  overlay.loadFile(path.join(__dirname, "src", "overlay.html"));
  overlay.webContents.on("did-finish-load", () => overlay.webContents.setZoomFactor(settings.overlayScale || 1));
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 940,
    height: 760,
    minWidth: 520,
    minHeight: 480,
    backgroundColor: "#07090d",
    title: "GitGud — Paramètres",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  settingsWin.setMenu(null); // sinon Alt affiche une barre de menu pendant la capture d'un raccourci
  settingsWin.loadFile(path.join(__dirname, "src", "settings.html"));
}

function openWizard() {
  if (wizardWin && !wizardWin.isDestroyed()) {
    wizardWin.show();
    wizardWin.focus();
    return;
  }
  wizardWin = new BrowserWindow({
    width: 760,
    height: 760,
    title: "GitGud — Configuration",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  wizardWin.setMenu(null);
  wizardWin.loadFile(path.join(__dirname, "src", "wizard.html"));
  if (process.env.GITGUD_SNAPSHOT) snapshotWizard(process.env.GITGUD_SNAPSHOT);
}

// Développement : capture chaque étape de l'assistant en PNG (GITGUD_SNAPSHOT=dossier).
function snapshotWizard(dir) {
  const fs = require("fs");
  wizardWin.webContents.once("did-finish-load", async () => {
    const wc = wizardWin.webContents;
    await new Promise((r) => setTimeout(r, 25000)); // détection + tests automatiques
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 4; i++) {
      await wc.executeJavaScript(`showStep(${i})`);
      await new Promise((r) => setTimeout(r, 800));
      fs.writeFileSync(path.join(dir, `wizard-${i + 1}.png`), (await wc.capturePage()).toPNG());
    }
    app.quit();
  });
}

function trayIcon() {
  // Petit carré violet généré en mémoire (pas de fichier d'icône requis).
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside = x > 1 && x < 14 && y > 1 && y < 14;
      buf[i] = inside ? 0xf0 : 0; // B
      buf[i + 1] = inside ? 0x50 : 0; // G
      buf[i + 2] = inside ? 0x8b : 0; // R
      buf[i + 3] = inside ? 0xff : 0; // A
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

let updater = null;
let updateReady = null; // version téléchargée, installée à la fermeture

function refreshTrayMenu() {
  const labels = hotkeys.labels();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...(updateReady ? [{ label: `Redémarrer pour installer la version ${updateReady}`, click: () => updater.installNow() }, { type: "separator" }] : []),
      { label: `Afficher / masquer l'overlay (${labels.toggle})`, click: toggleOverlay },
      { label: `Poser une question écrite (${labels.text})`, click: () => openTextInput() },
      { label: "Nouvelle conversation", click: () => resetConversation() },
      { label: "Replacer l'overlay à sa position d'origine", click: resetOverlayPosition },
      { type: "separator" },
      { label: "Diablo IV…", click: openD4Panel },
      { label: "Paramètres", click: openSettings },
      { label: "Assistant de configuration", click: openWizard },
      ...(updater ? [{ label: "Rechercher des mises à jour", click: () => updater.check() }] : []),
      { label: "Quitter", click: () => app.quit() },
    ])
  );
  tray.setToolTip(`GitGud — ${labels.ptt} pour parler`);
}

function createTray() {
  tray = new Tray(trayIcon()); // remplacée par la mascotte dès que l'overlay est chargé
  refreshTrayMenu();
  tray.on("click", openSettings);
}

// ---------- Overlay ----------

function resetOverlayPosition() {
  const { x, y } = defaultOverlayPosition();
  placeOverlay(x, y);
  settings.overlayPosition = null;
  store.save(settings);
  showOverlay();
}

// Déplacement : l'overlay ignore la souris (clics transmis au jeu) sauf quand elle survole la carte.
let overlayHover = false;
let textInputOpen = false;
let drag = null;

function updateMouseCapture() {
  const interactive = overlayHover || textInputOpen || !!drag;
  overlay.setIgnoreMouseEvents(!interactive, { forward: true });
}

ipcMain.on("overlay:hover", (_e, on) => {
  overlayHover = on;
  updateMouseCapture();
});

ipcMain.on("overlay:drag", (_e, phase) => {
  const cursor = screen.getCursorScreenPoint();
  if (phase === "start") {
    const [wx, wy] = overlay.getPosition();
    drag = { dx: cursor.x - wx, dy: cursor.y - wy };
  } else if (phase === "move" && drag) {
    placeOverlay(cursor.x - drag.dx, cursor.y - drag.dy);
  } else if (phase === "end" && drag) {
    drag = null;
    const [x, y] = overlay.getPosition();
    settings.overlayPosition = { x, y };
    store.save(settings);
    updateMouseCapture();
  }
});

const send = (channel, payload) => overlay && !overlay.isDestroyed() && overlay.webContents.send(channel, payload);

function showOverlay() {
  if (!overlay.isVisible()) overlay.showInactive();
}

// Affiche l'overlay en continu (sans masquage automatique), ou le masque.
let pinned = false;
function toggleOverlay() {
  if (overlay.isVisible() && pinned) {
    pinned = false;
    send("config", { pinned });
    hideOverlay();
  } else {
    pinned = true;
    send("config", { pinned });
    showOverlay();
  }
}

function hideOverlay() {
  requestSeq++; // annule l'affichage d'une réponse en cours
  if (busy) {
    ai.reset();
    prewarm();
  }
  busy = false;
  if (pinned) {
    pinned = false;
    send("config", { pinned });
  }
  send("stop-all");
  textInputOpen = false;
  overlayHover = false;
  updateMouseCapture();
  overlay.setFocusable(false);
  overlay.hide();
}

function resetConversation() {
  clearTimeout(conversationTimer);
  history = [];
  ai.reset();
  send("reset");
  prewarm();
}

// Prompt système stable (personnage, langue, options) : il garde Claude Code lancé à l'avance.
function systemPrompt() {
  return buildSystemPrompt(settings.mascot, settings.language, {
    memory: settings.memoryEnabled !== false,
    annotations: settings.annotations !== false && settings.useVision,
    timers: true,
  });
}

function prewarm() {
  if (settings.setupDone) ai.prewarm(settings, systemPrompt());
}

function openTextInput() {
  showOverlay();
  overlay.setFocusable(true);
  textInputOpen = true;
  updateMouseCapture();
  overlay.focus();
  send("text-input");
}

// ---------- Capture ----------

// Noms des fenêtres ouvertes (sans image : rapide), pour reconnaître le jeu en cours.
// Fenêtre au premier plan d'abord : un jeu en plein écran exclusif manque parfois à la liste
async function openWindowNames() {
  const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 } });
  return [foregroundTitle(), ...sources.map((s) => s.name)].filter(Boolean);
}

// Jeu en cours : d'après la capture et les fenêtres, sinon Diablo IV si sa liaison (D4LF) est active
// ou s'il vient d'envoyer du texte : le contexte du personnage ne doit jamais manquer.
function currentGame(shot, windows) {
  const game = detectGame(shot?.name || settings.target?.name, windows);
  if (game) return game;
  if (d4 && (d4.bridge.status === "connected" || Date.now() - (d4.lastTooltipAt || 0) < 10 * 60000)) return diablo4Game;
  return null;
}

async function captureTarget() {
  const want = settings.target || { id: "screen" };
  // Images seulement pour le type nécessaire (capturer toutes les fenêtres en grand est coûteux).
  const types = want.id === "screen" ? ["screen"] : ["window", "screen"];
  const sources = await desktopCapturer.getSources({ types, thumbnailSize: { width: 1600, height: 900 } });
  let src = null;
  if (want.id !== "screen") {
    src = sources.find((s) => s.id === want.id) || sources.find((s) => s.name === want.name);
  }
  if (!src) src = sources.find((s) => s.id.startsWith("screen:"));
  if (!src || src.thumbnail.isEmpty()) return null;
  const { width, height } = src.thumbnail.getSize();
  return { name: src.name, jpegB64: src.thumbnail.toJPEG(80).toString("base64"), width, height, rect: sourceRect(src) };
}

// Zone de l'écran couverte par la capture (en DIP), pour y replacer les repères de l'IA.
function sourceRect(src) {
  if (src.id.startsWith("window:")) {
    const r = windowRect(src.id);
    return r ? screen.screenToDipRect(null, r) : null;
  }
  const display = screen.getAllDisplays().find((d) => String(d.id) === String(src.display_id)) || screen.getPrimaryDisplay();
  return display.bounds;
}

// ---------- Pipeline question → réponse ----------

async function ask(question) {
  question = (question || "").trim();
  if (!question) {
    send("state", "idle");
    return;
  }
  // Minuteurs : reconnus en local, sans IA, ils démarrent instantanément.
  const timerCmd = parseTimerCommand(question, lastGame?.timers || []);
  if (timerCmd) return runTimerCommand(question, timerCmd);

  const seq = ++requestSeq;
  busy = true;
  clearTimeout(conversationTimer);
  // (pas à la première question : le process lancé à l'avance est déjà neuf)
  if (lastExchangeAt && Date.now() - lastExchangeAt > CONVERSATION_TIMEOUT_MS) resetConversation();

  const t0 = Date.now();
  const lane = settings.fastLane !== false && !fastBroken[settings.provider] && classify(question) === "fast" ? "fast" : "deep";
  showOverlay();
  send("user-text", question);
  send("lane", lane);
  send("state", "thinking");

  try {
    const [shot, windows] = await Promise.all([settings.useVision ? captureTarget() : null, openWindowNames()]);
    const game = currentGame(shot, windows);
    if (game) lastGame = game;
    send("config", overlayConfig(game ? `${game.name}${game.context ? " · données en direct" : ""}` : shot?.name));
    const where = game?.name || shot?.name || settings.target?.name || "inconnue";
    const gameKey = memoryKey(game, shot);
    const useMemory = settings.memoryEnabled !== false;
    if (useMemory && gameKey) memory.logQuestion(gameKey, game?.name || where, question);
    const context = await gameContext(game, { question, settings });
    const memo = useMemory ? memory.context(gameKey || GLOBAL) : "";
    const prompt = [
      `[Jeu ou fenêtre observée] ${where}`,
      shot && `[Capture jointe : ${shot.width}×${shot.height} px]`,
      context && `[Contexte fourni par GitGud]\n${context}`,
      memo && `[Mémoire]\n${memo}`,
      `[Question du joueur]\n${question}`,
    ].filter(Boolean).join("\n\n");

    let result;
    try {
      result = await answer({ seq, prompt, shot, fast: lane === "fast", t0 });
    } catch (err) {
      // Voie rapide en échec avant le premier mot (modèle ou réglage refusé) : on repasse par
      // le moteur complet, et la voie rapide reste coupée pour ce moteur.
      if (lane !== "fast" || err.started || seq !== requestSeq || /interrompue/i.test(err.message)) throw err;
      console.warn("Voie rapide indisponible :", err.message);
      fastBroken[settings.provider] = true;
      send("lane", "deep");
      result = await answer({ seq, prompt, shot, fast: false, t0 });
    }
    if (seq !== requestSeq) return;

    const { text, tags } = result;
    history.push({ role: "user", text: question }, { role: "assistant", text });
    history = history.slice(-20);
    lastExchangeAt = Date.now();
    // Après 5 min d'inactivité, la conversation est oubliée : on relance aussitôt un process
    // propre et chaud, plutôt qu'au moment de la question suivante.
    conversationTimer = setTimeout(() => !busy && resetConversation(), CONVERSATION_TIMEOUT_MS);
    applyTags(tags, { game, gameKey, shot });
    await result.speech?.end();
  } catch (err) {
    if (seq === requestSeq) send("error", err.message || String(err));
  } finally {
    if (seq === requestSeq) {
      busy = false;
      send("state", "idle");
    }
  }
}

// Envoie la question au moteur et diffuse la réponse au fil de l'eau : texte affiché sans les
// balises, phrases lues dès qu'elles sont complètes.
async function answer({ seq, prompt, shot, fast, t0 }) {
  const filter = new TagFilter();
  const speech = settings.voiceEnabled ? new SpeechStream(seq) : null;
  let started = false;
  const emit = (clean) => {
    if (!clean || seq !== requestSeq) return;
    if (!started) {
      started = true;
      console.log(`[latence] premier texte en ${Date.now() - t0} ms (${fast ? "voie rapide" : "moteur complet"})`);
    }
    send("assistant-delta", clean);
    speech?.push(clean);
  };
  let raw;
  try {
    raw = await ai.chat({
      settings,
      system: systemPrompt(),
      history,
      question: prompt,
      imageJpegB64: shot?.jpegB64,
      fast,
      onDelta: (d) => emit(filter.push(d)),
    });
  } catch (err) {
    speech?.cancel();
    err.started = started;
    throw err;
  }
  emit(filter.flush());
  const { text, tags } = stripTags(raw);
  if (seq === requestSeq) send("assistant-done", text);
  return { text, tags, speech };
}

// Mémoire : par module de jeu, sinon par fenêtre observée (rien pour « Écran entier »).
function memoryKey(game, shot) {
  if (game) return game.id;
  const name = settings.target?.id !== "screen" ? settings.target?.name || shot?.name : null;
  return name ? "win:" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) : null;
}

// Balises glissées par l'IA dans sa réponse.
function applyTags(tags, { game, gameKey, shot }) {
  const marks = [];
  for (const t of tags) {
    if (t.name === "memo" && settings.memoryEnabled !== false) {
      const fact = memory.remember(gameKey, game?.name, { type: t.type, text: t.text });
      if (fact) send("notice", `◆ Noté : ${fact.text}`);
    } else if (t.name === "forget") {
      const n = memory.forget(gameKey, t.text || "");
      send("notice", n ? `◆ Oublié : ${t.text}` : "Rien à oublier.");
    } else if (t.name === "mark") {
      marks.push(t);
    } else if (t.name === "timer") {
      const sec = Math.round(Number(t.seconds));
      if (sec >= 1 && sec <= 24 * 3600) timers.start(sec, (t.label || "Minuteur").slice(0, 32));
    }
  }
  if (marks.length && settings.annotations !== false) showAnnotations(marks, shot);
}

// ---------- Minuteurs ----------

function runTimerCommand(question, cmd) {
  requestSeq++;
  showOverlay();
  send("user-text", question);
  let reply;
  if (cmd.action === "start") {
    timers.start(cmd.seconds, cmd.label);
    reply = `⏱ ${cmd.label} : ${formatDuration(cmd.seconds)}.`;
  } else {
    const n = timers.cancel(cmd.label);
    reply = n ? `Minuteur${n > 1 ? "s" : ""} annulé${n > 1 ? "s" : ""}.` : "Aucun minuteur en cours.";
  }
  send("assistant-done", reply);
  say(reply.replace("⏱", "").replace(/\bmin\b/g, "minutes").replace(/\b(\d+) s\b/g, "$1 secondes").replace(/\bh\b/g, "heure"));
  send("state", "idle");
}

timers.on("update", (list) => send("timers", list));
timers.on("fire", (t) => {
  showOverlay();
  send("timer-fire", t);
  send("notice", `⏱ ${t.label} : c'est l'heure !`);
  say(`${t.label} : c'est l'heure !`);
});
ipcMain.on("timer:cancel", (_e, id) => timers.cancelId(id));

// ---------- Voix ----------

// Phrase courte hors réponse (minuteurs), lue à la suite de ce qui est en cours.
function say(text) {
  if (!settings.voiceEnabled) return;
  const s = new SpeechStream(requestSeq);
  s.push(text);
  s.end();
}

// Lecture en flux : chaque phrase est synthétisée dès qu'elle est complète et part vers
// l'overlay, qui les enchaîne. La voix est choisie une fois pour toute la réponse.
class SpeechStream {
  constructor(seq) {
    this.seq = seq;
    this.split = new SentenceSplitter();
    this.chain = Promise.resolve();
    this.voice = undefined;
    this.cancelled = false;
  }

  live() {
    return !this.cancelled && this.seq === requestSeq;
  }

  push(text) {
    for (const s of this.split.push(text)) this.say(s);
  }

  say(text) {
    this.chain = this.chain.then(async () => {
      if (!this.live()) return;
      const clip = await synthesize(text, this).catch((err) => (console.warn("Voix :", err.message), null));
      if (!this.live()) return;
      if (clip) send("tts-chunk", clip);
      else send("tts-system", { text, voice: settings.systemVoice, language: settings.language, queue: true, ...personality().systemVoice });
    });
  }

  end() {
    for (const s of this.split.flush()) this.say(s);
    return (this.chain = this.chain.then(() => this.live() && send("tts-end")));
  }

  cancel() {
    this.cancelled = true;
  }
}

const personality = () => PERSONALITIES[settings.mascot] || PERSONALITIES.slime;

// → { data, type, pitch }, ou null pour la voix Windows
async function synthesize(text, stream) {
  const p = personality();
  if (settings.ttsEngine === "openai" && settings.openaiKey) {
    const mp3 = await ai.speak({
      settings,
      text,
      voice: settings.ttsVoice === "auto" ? p.voice : settings.ttsVoice,
      instructions: `${p.style} Parle naturellement, comme dans un chat vocal de jeu.`,
    });
    return { data: mp3, type: "audio/mpeg" };
  }
  if (settings.ttsEngine === "system") return null;
  if (stream.voice === undefined) stream.voice = voiceFor(settings.mascot, settings.language, text); // langue d'après la 1re phrase
  if (!stream.voice) return null; // langue sans voix Piper
  const wav = await ai.tts.speak(text, stream.voice);
  return { data: wav, type: "audio/wav", pitch: stream.voice.pitch };
}

// Charge à l'avance la voix de la personnalité, pour que la première réponse soit rapide.
function preloadVoice() {
  if (settings.voiceEnabled && !["system", "openai"].includes(settings.ttsEngine)) {
    const v = voiceFor(settings.mascot, settings.language === "auto" ? "fr" : settings.language, "");
    if (v) ai.tts.preload(v.voice).catch((err) => console.warn("Piper :", err.message));
  }
}

// ---------- Raccourcis ----------

function onPttDown() {
  if (recording) return;
  if (settings.sttEngine === "openai" && !settings.openaiKey) {
    showOverlay();
    send("error", "Transcription OpenAI choisie mais aucune clé OpenAI. Passe sur Whisper local dans les paramètres.");
    return;
  }
  recording = true;
  requestSeq++; // interrompt la réponse en cours
  showOverlay();
  send("ptt-start");
}

function onPttUp() {
  if (!recording) return;
  recording = false;
  send("ptt-stop");
}

const hotkeys = new Hotkeys({
  pttDown: onPttDown,
  pttUp: onPttUp,
  text: openTextInput,
  hide: () => {
    hideMarkers();
    hideAnnotations();
    if (d4?.mode === "scan") d4.abortScan();
    hideOverlay();
  },
  toggle: toggleOverlay,
  d4scan: onD4ScanKey,
  escape: () => d4?.mode === "scan" && d4.abortScan(),
});

// ---------- Diablo IV ----------

let d4 = null;
let markersWin = null;
let markersTimer = null;
let d4CardTimer = null;

function initD4() {
  d4 = new D4Manager(app.getPath("userData"));
  d4.setCursorProvider(require("./src/games/d4/mouse").cursor);
  d4.laterVariants = settings.d4LaterVariants !== false;
  diablo4Game.context = ({ question }) => Promise.resolve(d4.context(question));

  d4.on("status", (status, detail) => broadcast("d4:status", { status, detail }));
  // Fiche d'objet au survol : verdict local, sans IA
  d4.on("item", (payload) => {
    if (settings.d4ItemCard === false) return;
    showOverlay();
    send("d4-item", payload);
  });
  d4.on("equipped", () => broadcast("d4:summary", d4.summary()));
  d4.on("plans", () => broadcast("d4:summary", d4.summary()));
  // Compétences / Parangon : pastille ✓ / ✗ à côté du curseur, sans IA
  d4.on("hint", (h) => {
    if (settings.d4Hints === false) return;
    showHint(h);
  });
  // Personnage détecté dans le jeu (fiche de personnage) ou compétence d'une autre classe
  d4.on("character", (c) => {
    broadcast("d4:summary", d4.summary());
    const msg = {
      switched: `Personnage : ${c.name}${c.build ? ` — build « ${c.build} »` : " — aucun build associé"}.`,
      named: `Personnage reconnu : ${c.name}${c.build ? ` (build « ${c.build} »)` : ""}.`,
      created: `Nouveau personnage : ${c.name}. Associe-lui un build dans le panneau Diablo IV.`,
      mismatch: `Ces compétences sont celles d'un ${c.className}, pas de ${c.name}. Ouvre ta fiche de personnage (C) pour changer de personnage.`,
    }[c.kind];
    if (!msg) return;
    showOverlay();
    send("notice", msg);
  });
  d4.on("sync", (p) => {
    showOverlay();
    send("d4-sync", { ...p, slots: EQUIP_SLOTS });
    broadcast("d4:summary", d4.summary());
  });
  d4.on("calibrate", ({ step }) => {
    showOverlay();
    const msg = [
      "Calibrage : ouvre l'inventaire (I), place la souris sur la case en HAUT À GAUCHE du sac, puis appuie sur " + label(hotkeys.bindings.d4scan) + ".",
      "Maintenant la case en BAS À DROITE du sac, puis " + label(hotkeys.bindings.d4scan) + ".",
      "Inventaire calibré ! Appuie sur " + label(hotkeys.bindings.d4scan) + " (inventaire ouvert) pour scanner.",
    ][step];
    send("notice", msg);
    if (step === 2) showMarkers(d4.inventoryCells().map((c) => ({ ...c, level: "calib" })), 4000);
    broadcast("d4:summary", d4.summary());
  });
  d4.on("scan", (p) => {
    if (p.phase === "start") {
      hideMarkers();
      showOverlay();
      send("notice", "Scan en cours… ne touche pas à la souris (Échap ou " + label(hotkeys.bindings.d4scan) + " pour arrêter).");
    } else if (p.phase === "done" || p.phase === "aborted") {
      const cells = p.cells.filter((c) => c.item);
      showMarkers(cells.map((c) => ({ x: c.x, y: c.y, level: c.eval?.verdict.level || "neutral", label: c.eval?.verdict.text || "" })), 30000);
      const keep = cells.filter((c) => ["top", "good", "later"].includes(c.eval?.verdict.level));
      showOverlay();
      send("d4-scan", {
        aborted: p.phase === "aborted",
        total: cells.length,
        keep: keep.map((c) => ({ name: c.item.name, slot: c.eval.slotName, verdict: c.eval.verdict.text, level: c.eval.verdict.level })),
        salvage: cells.filter((c) => ["bad", "meh"].includes(c.eval?.verdict.level)).length,
      });
    }
  });
  d4.start();
}

function onD4ScanKey() {
  if (!d4) return;
  if (d4.mode && d4.mode.calibrate) return d4.calibrationPoint();
  if (!d4.state.positions.inventory) return d4.startCalibration();
  if (!d4.build) {
    showOverlay();
    return send("notice", "Importe d'abord ton build (icône de notification → Diablo IV…).");
  }
  d4.scan().catch((err) => send("error", "Scan : " + err.message));
}

// Fenêtre transparente plein écran : ✓ / ✗ sur les cases de l'inventaire (comme la surbrillance de D4LF)
function showMarkers(cells, durationMs) {
  if (!cells.length) return;
  const dip = cells.map((c) => ({ ...c, ...screen.screenToDipPoint({ x: c.x, y: c.y }) }));
  const display = screen.getDisplayNearestPoint(dip[0]);
  const payload = dip.map((c) => ({ x: c.x - display.bounds.x, y: c.y - display.bounds.y, level: c.level, label: c.label }));
  // Repère : 26 px, décalé de +10 px à droite et -38 px vers le haut, plus sa lueur
  ensureMarkersWin(display, "markers", boxAround(payload, { left: 20, right: 56, top: 60, bottom: 24 }));
  const show = () => {
    layoutMarkersWin();
    markersWin.webContents.send("markers", payload);
    markersWin.showInactive();
  };
  if (markersWin.webContents.isLoading()) markersWin.webContents.once("did-finish-load", show);
  else show();
  markersOn = true;
  clearTimeout(markersTimer);
  markersTimer = setTimeout(hideMarkers, durationMs);
}

// La fenêtre ne reste affichée que tant qu'il y a des repères, une pastille ou une annotation
let markersOn = false;
let hintOn = false;
let annotOn = false;
function hideMarkersWinIfIdle() {
  if (!markersOn && !hintOn && !annotOn && markersWin && !markersWin.isDestroyed()) markersWin.hide();
}

// Annotations de l'IA (<mark x y label shape/>) : coordonnées en pixels de la capture,
// replacées sur la zone de l'écran qu'elle couvrait.
let annotTimer = null;
function showAnnotations(marks, shot) {
  if (!shot?.rect || !shot.width || !shot.height) return;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const points = marks
    .slice(0, 3)
    .map((m) => ({ x: Number(m.x), y: Number(m.y), label: String(m.label || "").slice(0, 40), shape: m.shape === "arrow" ? "arrow" : "circle" }))
    .filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y))
    .map((m) => ({ ...m, x: shot.rect.x + clamp(m.x / shot.width) * shot.rect.width, y: shot.rect.y + clamp(m.y / shot.height) * shot.rect.height }));
  if (!points.length) return;
  const display = screen.getDisplayNearestPoint({ x: Math.round(points[0].x), y: Math.round(points[0].y) });
  const payload = points.map((p) => ({ ...p, x: p.x - display.bounds.x, y: p.y - display.bounds.y }));
  // Cercle ou flèche (110 px) suivi d'un libellé d'au plus 40 caractères, d'un côté ou de l'autre
  ensureMarkersWin(display, "annot", boxAround(payload, { left: 470, right: 470, top: 160, bottom: 160 }));
  const show = () => {
    layoutMarkersWin();
    markersWin.webContents.send("annotations", payload);
    markersWin.showInactive();
  };
  if (markersWin.webContents.isLoading()) markersWin.webContents.once("did-finish-load", show);
  else show();
  annotOn = true;
  clearTimeout(annotTimer);
  annotTimer = setTimeout(hideAnnotations, 12000);
}

function hideAnnotations() {
  clearTimeout(annotTimer);
  annotOn = false;
  if (markersWin && !markersWin.isDestroyed()) markersWin.webContents.send("annotations", []);
  dropMarkersLayer("annot");
  hideMarkersWinIfIdle();
}

// Mode léger : la fenêtre ne couvre que la zone occupée par ses éléments (repères, pastille,
// annotations), pas tout l'écran : Windows a moins de surface transparente à superposer au jeu.
// Les éléments restent placés en coordonnées de l'écran ; la page reçoit le décalage (« origin »).
const markersBoxes = {}; // calque -> { x0, y0, x1, y1 } relatif à l'écran
let markersDisplay = null;

function boxAround(points, pad) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x0: Math.min(...xs) - pad.left, y0: Math.min(...ys) - pad.top, x1: Math.max(...xs) + pad.right, y1: Math.max(...ys) + pad.bottom };
}

function layoutMarkersWin() {
  const boxes = Object.values(markersBoxes);
  if (!boxes.length || !markersDisplay || !markersWin || markersWin.isDestroyed()) return;
  const { bounds: b } = markersDisplay;
  const x0 = Math.max(0, Math.floor(Math.min(...boxes.map((r) => r.x0))));
  const y0 = Math.max(0, Math.floor(Math.min(...boxes.map((r) => r.y0))));
  const x1 = Math.min(b.width, Math.ceil(Math.max(...boxes.map((r) => r.x1))));
  const y1 = Math.min(b.height, Math.ceil(Math.max(...boxes.map((r) => r.y1))));
  if (x1 <= x0 || y1 <= y0) return;
  markersWin.webContents.send("origin", { x: x0, y: y0, width: b.width, height: b.height });
  markersWin.setBounds({ x: b.x + x0, y: b.y + y0, width: x1 - x0, height: y1 - y0 });
}

// Un calque disparaît : la fenêtre se resserre sur ceux qui restent.
function dropMarkersLayer(layer) {
  delete markersBoxes[layer];
  if (Object.keys(markersBoxes).length) layoutMarkersWin();
}

function ensureMarkersWin(display, layer, box) {
  // Changement d'écran : les autres calques étaient placés sur l'ancien
  if (markersDisplay && markersDisplay.id !== display.id) for (const k of Object.keys(markersBoxes)) delete markersBoxes[k];
  markersDisplay = display;
  markersBoxes[layer] = box;
  if (!markersWin || markersWin.isDestroyed()) {
    markersWin = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: 100,
      height: 100,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, "preload.js") },
    });
    markersWin.setAlwaysOnTop(true, "screen-saver");
    markersWin.setIgnoreMouseEvents(true);
    markersWin.setContentProtection(true);
    markersWin.loadFile(path.join(__dirname, "src", "d4-markers.html"));
  }
}

// Pastille de verdict près du curseur (compétences, Parangon), dans la même fenêtre transparente
let hintTimer = null;
function showHint({ cursor, level, text, sub }) {
  if (!cursor) return;
  const dip = screen.screenToDipPoint(cursor);
  const display = screen.getDisplayNearestPoint(dip);
  const payload = { x: dip.x - display.bounds.x, y: dip.y - display.bounds.y, level, text, sub };
  // Pastille (340 px de large au plus) d'un côté ou de l'autre du curseur
  ensureMarkersWin(display, "hint", boxAround([payload], { left: 400, right: 400, top: 190, bottom: 190 }));
  const show = () => {
    layoutMarkersWin();
    markersWin.webContents.send("hint", payload);
    markersWin.showInactive();
  };
  if (markersWin.webContents.isLoading()) markersWin.webContents.once("did-finish-load", show);
  else show();
  hintOn = true;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hintOn = false;
    if (markersWin && !markersWin.isDestroyed()) markersWin.webContents.send("hint", null);
    dropMarkersLayer("hint");
    hideMarkersWinIfIdle();
  }, 4000);
}

// Masque les repères (sans toucher à un scan en cours)
function hideMarkers() {
  clearTimeout(markersTimer);
  markersOn = false;
  if (markersWin && !markersWin.isDestroyed()) markersWin.webContents.send("markers", []);
  dropMarkersLayer("markers");
  hideMarkersWinIfIdle();
}

ipcMain.handle("d4:summary", () => d4?.summary());
ipcMain.handle("d4:equipment", () => ({ equipment: d4.equipmentView(), inventory: d4.inventoryView() }));
ipcMain.handle("d4:affix-choices", () => d4.affixChoices());
ipcMain.handle("d4:new-build", (_e, { name, className }) => d4.newBuild(name, className));
ipcMain.handle("d4:add-character", (_e, c) => d4.addCharacter(c));
ipcMain.handle("d4:active-character", (_e, id) => d4.setActiveCharacter(id));
ipcMain.handle("d4:update-character", (_e, { id, ...patch }) => d4.updateCharacter(id, patch));
ipcMain.handle("d4:delete-character", (_e, id) => d4.deleteCharacter(id));
ipcMain.handle("d4:active-build", (_e, id) => d4.setActiveBuild(id));
ipcMain.handle("d4:delete-build", (_e, id) => d4.deleteBuild(id));
ipcMain.handle("d4:rename-build", (_e, { id, name }) => d4.renameBuild(id, name));
ipcMain.handle("d4:save-variant", async (_e, { buildId, variant }) => {
  try {
    return { ok: true, summary: await d4.saveVariant(buildId, variant) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle("d4:settings", (_e, patch) => {
  if (patch) {
    settings = { ...settings, ...patch };
    store.save(settings);
    if ("d4LaterVariants" in patch) {
      d4.laterVariants = patch.d4LaterVariants !== false;
      d4.reevaluate();
    }
  }
  return {
    d4ItemCard: settings.d4ItemCard !== false,
    d4Hints: settings.d4Hints !== false,
    d4LaterVariants: settings.d4LaterVariants !== false,
    scanKey: label(hotkeys.bindings.d4scan),
  };
});

// Panneau Diablo IV : fenêtre dédiée (builds, priorités, équipement, connexion)
let d4Win = null;
function openD4Panel() {
  if (d4Win && !d4Win.isDestroyed()) {
    d4Win.show();
    d4Win.focus();
    return;
  }
  d4Win = new BrowserWindow({
    width: 980,
    height: 820,
    title: "GitGud — Diablo IV",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  d4Win.setMenu(null);
  d4Win.loadFile(path.join(__dirname, "src", "d4panel.html"));
}
ipcMain.handle("d4:open-panel", () => openD4Panel());
ipcMain.handle("d4:import", async (_e, url) => {
  try {
    return { ok: true, summary: await d4.importBuild(url) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle("d4:variant", (_e, id) => {
  d4.setVariant(id);
  return d4.summary();
});
ipcMain.handle("d4:sync", (_e, on) => (on ? d4.startSync() : d4.stopSync(), d4.summary()));
ipcMain.handle("d4:calibrate", () => d4.startCalibration());

function registerHotkeys() {
  hotkeys.setBindings(settings.hotkeys);
  if (hotkeys.start()) return;
  // Repli sans uiohook : raccourcis par défaut, Alt+V bascule l'enregistrement.
  console.warn("uiohook indisponible : raccourcis par défaut en mode bascule");
  globalShortcut.register("Alt+V", () => (recording ? onPttUp() : onPttDown()));
  globalShortcut.register("Alt+X", hideOverlay);
  globalShortcut.register("Alt+T", openTextInput);
  globalShortcut.register("Alt+O", toggleOverlay);
}

ipcMain.handle("hotkeys:get", () => ({
  bindings: hotkeys.bindings,
  labels: hotkeys.labels(),
  actions: ACTION_LABELS,
  available: hotkeys.available,
}));

// Attend la prochaine touche / bouton pressé, n'importe où (même en jeu).
ipcMain.handle("hotkeys:capture", async (_e, action) => {
  const binding = await hotkeys.capture();
  if (!binding) return null;
  return { binding, label: label(binding), action };
});

ipcMain.handle("hotkeys:cancel", () => hotkeys.cancelCapture());

ipcMain.handle("hotkeys:defaults", () => ({
  bindings: DEFAULT_HOTKEYS,
  labels: Object.fromEntries(Object.entries(DEFAULT_HOTKEYS).map(([k, b]) => [k, label(b)])),
}));

// ---------- IPC ----------

ipcMain.handle("settings:get", () => ({
  settings,
  version: app.getVersion(),
  personalities: Object.fromEntries(Object.entries(PERSONALITIES).map(([k, v]) => [k, { name: v.name, title: v.title, tagline: v.tagline, sample: v.sample, voice: v.voice, systemVoice: v.systemVoice }])),
}));

ipcMain.handle("settings:save", (_e, next) => {
  const prev = settings;
  settings = { ...settings, ...next };
  store.save(settings);
  hotkeys.setBindings(settings.hotkeys);
  applyOverlayLook();
  refreshTrayMenu();
  for (const k of Object.keys(fastBroken)) delete fastBroken[k]; // on retente la voie rapide
  if (prev.provider !== settings.provider) resetConversation();
  else prewarm(); // modèle ou options changés : le process chaud est relancé si besoin
  preloadModels();
  send("config", overlayConfig());
  return true;
});

ipcMain.handle("setup:finish", (_e, patch) => {
  settings = { ...settings, ...patch, setupDone: true };
  store.save(settings);
  hotkeys.setBindings(settings.hotkeys);
  refreshTrayMenu();
  resetConversation();
  preloadModels();
  send("config", overlayConfig());
  wizardWin?.close();
  showOverlay();
  send("assistant-done", "Tout est prêt ! Maintiens Alt+V pour me parler, ou Alt+T pour écrire.");
  send("state", "idle");
  return true;
});

// Mémoire du joueur (paramètres)
ipcMain.handle("memory:list", () => memory.list());
ipcMain.handle("memory:delete", (_e, id) => (memory.deleteFact(id), memory.list()));
ipcMain.handle("memory:clear", (_e, key) => (memory.clear(key || null), memory.list()));

// Modules de jeu (paramètres)
ipcMain.handle("games:list", () => listGames());
ipcMain.handle("games:open-folder", () => shell.openPath(gamesDir()));

function gamesDir() {
  const dir = path.join(app.getPath("userData"), "games");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const readme = path.join(dir, "LISEZ-MOI.md");
    if (!fs.existsSync(readme)) fs.copyFileSync(path.join(__dirname, "src", "games", "packs", "README.md"), readme);
  } catch (err) {
    console.warn("Modules de jeu :", err.message);
  }
  return dir;
}

ipcMain.handle("sources:list", async () => {
  const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 } });
  return sources
    .filter((s) => s.name && !s.name.startsWith("GitGud"))
    .map((s) => ({ id: s.id, name: s.name }));
});

// pcm : Float32Array mono 16 kHz envoyé par l'overlay
ipcMain.handle("audio:question", async (_e, pcm) => {
  // Pas de parole détectée (appui bref, micro coupé…) : on n'envoie rien à l'IA.
  if (speechSeconds(pcm) < 0.3) {
    send("notice", "Je n'ai rien entendu. Maintiens la touche pendant que tu parles.");
    send("state", "idle");
    return;
  }
  send("state", "transcribing");
  try {
    const text = await ai.transcribe(settings, pcm);
    if (isHallucination(text)) {
      send("notice", "Je n'ai pas compris, tu peux répéter ?");
      send("state", "idle");
      return;
    }
    ask(text);
  } catch (err) {
    send("error", "Transcription : " + (err.message || err));
    send("state", "idle");
  }
});

ipcMain.on("text:question", (_e, text) => {
  textInputOpen = false;
  updateMouseCapture();
  overlay.setFocusable(false);
  ask(text);
});

ipcMain.on("text:cancel", () => {
  textInputOpen = false;
  updateMouseCapture();
  overlay.setFocusable(false);
});

ipcMain.on("overlay:autohide", () => {
  if (!busy && !recording && !pinned && !overlayHover && !drag) overlay.hide();
});

function overlayConfig(context) {
  return {
    hotkeys: hotkeys.labels(),
    pinned,
    name: (PERSONALITIES[settings.mascot] || PERSONALITIES.slime).name,
    mascot: settings.mascot,
    version: app.getVersion(),
    autoHideSeconds: settings.autoHideSeconds,
    compact: !!settings.overlayCompact,
    opacity: settings.overlayOpacity ?? 0.9,
    context: context || (settings.target?.id === "screen" ? "Écran entier" : settings.target?.name) || "",
  };
}

ipcMain.handle("overlay:config", () => overlayConfig());

// Liens cités dans les réponses : ouverts dans le navigateur (http/https uniquement).
ipcMain.on("open-url", (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

// Icône de la zone de notification = mascotte choisie (dessinée par l'overlay).
ipcMain.on("tray:icon", (_e, dataUrl) => {
  const img = nativeImage.createFromDataURL(dataUrl);
  if (!img.isEmpty() && tray && !tray.isDestroyed()) tray.setImage(img.resize({ width: 32, height: 32, quality: "best" }));
});

// ---------- Démarrage ----------

function preloadModels() {
  preloadWhisper();
  preloadVoice();
}

function preloadWhisper() {
  Promise.resolve(ai.preloadWhisper(settings))
    .then(() => tray?.setToolTip("GitGud — Alt+V pour parler"))
    .catch((err) => console.warn("Whisper :", err.message));
}

function onDownloadProgress(p) {
  const what = p.kind === "voice" ? "de la voix" : "de Whisper";
  tray?.setToolTip(`GitGud — téléchargement ${what} ${p.progress}%`);
  send("download", p);
  broadcast("setup:progress", p);
}

app.whenReady().then(() => {
  settings = store.load();
  // Modèles Whisper fournis par l'installateur « complet » (absents sinon).
  const bundledModels = app.isPackaged ? path.join(process.resourcesPath, "models") : path.join(__dirname, "build", "models");
  ai = new AI(app.getPath("userData"), onDownloadProgress, bundledModels);
  memory = new Memory(app.getPath("userData"));
  configurePacks({ user: gamesDir() });
  registerSetupIpc({ getSettings: () => settings, ai });
  // Autorise le micro pour nos propres pages.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media"));

  createOverlay();
  createTray();
  registerHotkeys();
  initD4();
  updater = initUpdater({
    onReady: (version) => {
      updateReady = version;
      refreshTrayMenu();
      tray.displayBalloon?.({ title: "GitGud", content: `Version ${version} prête : elle s'installera à la fermeture.` });
    },
    onStatus: (msg) => console.log("[mise à jour]", msg),
  });
  refreshTrayMenu();
  if (settings.setupDone) {
    preloadModels();
    prewarm();
  } else openWizard();
  if (process.env.GITGUD_OPEN === "settings") openSettings(); // développement : ouvre les paramètres
  if (process.env.GITGUD_OPEN === "d4") openD4Panel();
});

app.on("window-all-closed", (e) => e.preventDefault()); // reste dans la zone de notification
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  ai?.dispose();
  timers.dispose();
  d4?.bridge.stop();
  hotkeys.stop();
});
