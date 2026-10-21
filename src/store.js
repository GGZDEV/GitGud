// Persistance des réglages dans %APPDATA%/gitgud/settings.json.
// Les clés API sont chiffrées avec safeStorage (DPAPI Windows).
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const { PERSONALITIES, LEGACY } = require("./personalities");

const DEFAULTS = {
  // "claude-cli" | "codex-cli" (abonnements) | "anthropic-api" | "openai-api" (clés API)
  provider: "codex-cli",
  claudeCliModel: "opus",
  codexModel: "",
  codexEffort: "low",
  anthropicModel: "claude-opus-5-5",
  openaiModel: "gpt-5-mini",
  effort: "low", // Claude API : low = réponses rapides en jeu
  fastLane: true, // questions courtes → modèle léger sans recherche web (voir src/fastlane.js)
  claudeFastModel: "haiku", // voie rapide via Claude Code
  codexFastModel: "", // voie rapide via Codex (vide = même modèle, sans recherche web)
  codexFastEffort: "low",
  anthropicFastModel: "claude-haiku-5-5",
  openaiFastModel: "", // vide = même modèle, sans recherche web
  memoryEnabled: true, // mémoire du joueur entre les sessions (locale)
  annotations: true, // repères dessinés sur le jeu par l'IA
  mascot: "slime", // personnage = mascotte + ton + voix : slime | mech | wraith | wolf | lich | orc
  language: "auto",
  target: { id: "screen", name: "Écran entier" },
  useVision: true,
  webSearch: true,
  voiceEnabled: true,
  sttEngine: "local", // "local" (Whisper, gratuit) | "openai"
  whisperModel: "onnx-community/whisper-small",
  whisperDevice: "cpu", // "cpu" | "dml" (GPU via DirectML)
  ttsEngine: "piper", // "piper" (voix neuronales locales) | "system" (voix Windows) | "openai"
  systemVoice: "",
  ttsVoice: "auto",
  sttModel: "gpt-4o-mini-transcribe",
  ttsModel: "gpt-4o-mini-tts",
  autoHideSeconds: 20,
  setupDone: false,
  hotkeys: null, // null = raccourcis par défaut (voir src/hotkeys.js)
  overlayPosition: null, // { x, y } après un déplacement
  overlayScale: 1, // 0.8 à 1.4
  overlayOpacity: 0.9, // opacité du fond de la carte
  overlayCompact: false, // mascotte + une ligne
  deadlockAccountId: "", // facultatif : historique de parties Deadlock
  d4ItemCard: true, // Diablo IV : fiche ✓ / ✗ à chaque objet survolé
  d4Hints: true, // Diablo IV : pastille ✓ / ✗ au survol des compétences et du Parangon
  d4LaterVariants: true, // Diablo IV : objet utile à une autre variante (Endgame…) → « à garder »
  anthropicKey: "",
  openaiKey: "",
};

const SECRET_FIELDS = ["anthropicKey", "openaiKey"];
const file = () => path.join(app.getPath("userData"), "settings.json");

function encrypt(v) {
  if (!v) return "";
  if (!safeStorage.isEncryptionAvailable()) return "plain:" + v;
  return "enc:" + safeStorage.encryptString(v).toString("base64");
}

function decrypt(v) {
  if (!v) return "";
  if (v.startsWith("plain:")) return v.slice(6);
  if (v.startsWith("enc:")) {
    try {
      return safeStorage.decryptString(Buffer.from(v.slice(4), "base64"));
    } catch {
      return "";
    }
  }
  return v;
}

function load() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {}
  const s = { ...DEFAULTS, ...raw };
  // Anciennes valeurs (v0.1)
  if (s.provider === "anthropic") s.provider = "anthropic-api";
  if (s.provider === "openai") s.provider = "openai-api";
  // Avant la fusion personnalité / mascotte : le personnage suit l'ancienne personnalité.
  if (!raw.mascot && raw.personality) s.mascot = LEGACY[raw.personality] || DEFAULTS.mascot;
  if (!PERSONALITIES[s.mascot]) s.mascot = DEFAULTS.mascot;
  delete s.personality;
  for (const k of SECRET_FIELDS) s[k] = decrypt(raw[k]);
  return s;
}

function save(settings) {
  const out = { ...settings };
  for (const k of SECRET_FIELDS) out[k] = encrypt(settings[k]);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(out, null, 2));
}

const exists = () => fs.existsSync(file());

module.exports = { load, save, exists, DEFAULTS };
