// Test de bout en bout hors interface : npx electron scripts/smoke-test.js [fichier.wav]
// Vérifie la capture d'écran, les moteurs IA par abonnement et Whisper local.
const { app, desktopCapturer } = require("electron");
const fs = require("fs");
const path = require("path");
const { AI } = require("../src/ai");
const store = require("../src/store");
const { buildSystemPrompt } = require("../src/personalities");

function readWav(file) {
  const buf = fs.readFileSync(file);
  const start = buf.indexOf("data") + 8;
  const n = Math.floor((buf.length - start) / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(start + i * 2) / 32768;
  return out;
}

async function timed(label, fn) {
  const t = Date.now();
  try {
    const r = await fn();
    console.log(`✓ ${label} (${((Date.now() - t) / 1000).toFixed(1)} s) → ${String(r).slice(0, 200)}`);
  } catch (err) {
    console.log(`✗ ${label} (${((Date.now() - t) / 1000).toFixed(1)} s) → ${err.message.slice(0, 300)}`);
  }
}

app.whenReady().then(async () => {
  const settings = { ...store.DEFAULTS, ...store.load(), webSearch: false };
  const ai = new AI(path.join(app.getPath("temp"), "gitgud-smoke"));

  // Capture réelle pour vérifier qu'elle fonctionne, mais on envoie une image fournie
  // (--image=fichier.jpg) si présente, pour ne pas transmettre le contenu de l'écran.
  const [screen] = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1600, height: 900 } });
  console.log(`✓ capture écran ${screen.thumbnail.getSize().width}x${screen.thumbnail.getSize().height}`);
  const imageArg = process.argv.find((a) => a.startsWith("--image="));
  const jpeg = imageArg
    ? fs.readFileSync(imageArg.slice(8)).toString("base64")
    : screen.thumbnail.toJPEG(80).toString("base64");

  const system = buildSystemPrompt("kin", "fr", "Jeu de test");
  const question = "Décris en une phrase ce que tu vois à l'écran.";
  for (const provider of ["codex-cli", "claude-cli"]) {
    await timed(provider, () =>
      ai.chat({ settings: { ...settings, provider }, system, history: [], question, imageJpegB64: jpeg, onDelta: () => {} })
    );
  }

  const wav = process.argv.find((a) => a.endsWith(".wav"));
  if (wav) {
    const s = { ...settings, sttEngine: "local", whisperModel: "onnx-community/whisper-small", language: "fr" };
    await timed("whisper chargement", () => ai.preloadWhisper(s));
    await timed("whisper transcription", () => ai.transcribe(s, readWav(wav)));
  }

  ai.dispose();
  app.quit();
});
