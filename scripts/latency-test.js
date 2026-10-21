// Mesure du délai avant le premier mot, sans capture d'écran : npx electron scripts/latency-test.js
// Compare, pour chaque moteur par abonnement installé : démarrage à froid, process lancé à
// l'avance, et voie rapide. Mesure aussi la synthèse de la première phrase (Piper).
const { app } = require("electron");
const path = require("path");
const { AI } = require("../src/ai");
const store = require("../src/store");
const { buildSystemPrompt } = require("../src/personalities");
const { getBins } = require("../src/setup/detect");
const { voiceFor } = require("../src/tts/voices");

const QUESTION = "[Jeu ou fenêtre observée] Elden Ring\n\n[Question du joueur]\nFaiblesse de Margit ?";

async function firstWord(ai, opts) {
  const t0 = Date.now();
  let first = null;
  const text = await ai.chat({ ...opts, history: [], question: QUESTION, onDelta: () => first ?? (first = Date.now() - t0) });
  return { first: first ?? Date.now() - t0, total: Date.now() - t0, text: text.replace(/\s+/g, " ").slice(0, 90) };
}

const show = (label, r) => console.log(`${label.padEnd(34)} premier mot ${(r.first / 1000).toFixed(1)} s · total ${(r.total / 1000).toFixed(1)} s · « ${r.text} »`);

app.whenReady().then(async () => {
  const settings = { ...store.DEFAULTS, ...store.load() };
  const ai = new AI(path.join(app.getPath("temp"), "gitgud-latency"));
  const system = buildSystemPrompt(settings.mascot, "fr", { memory: true, annotations: true, timers: true });
  const bins = await getBins();

  if (bins.claude) {
    const s = { ...settings, provider: "claude-cli" };
    try {
      show(`Claude (${s.claudeCliModel}) à froid`, await firstWord(ai, { settings: s, system }));
      ai.reset();
      ai.prewarm(s, system);
      await new Promise((r) => setTimeout(r, 6000)); // le temps que le process démarre
      show(`Claude (${s.claudeCliModel}) lancé à l'avance`, await firstWord(ai, { settings: s, system }));
      show(`Claude voie rapide (${s.claudeFastModel})`, await firstWord(ai, { settings: s, system, fast: true }));
    } catch (err) {
      console.log("Claude :", err.message);
    }
  } else console.log("Claude Code non installé : ignoré");

  if (bins.codex) {
    const s = { ...settings, provider: "codex-cli" };
    try {
      show("Codex moteur complet", await firstWord(ai, { settings: s, system }));
      show("Codex voie rapide", await firstWord(ai, { settings: s, system, fast: true }));
    } catch (err) {
      console.log("Codex :", err.message);
    }
  } else console.log("Codex non installé : ignoré");

  const v = voiceFor(settings.mascot, "fr", "");
  if (v) {
    try {
      await ai.tts.preload(v.voice);
      let t = Date.now();
      await ai.tts.speak("Esquive à droite, il frappe deux fois.", v);
      const sentence = Date.now() - t;
      t = Date.now();
      await ai.tts.speak("Esquive à droite, il frappe deux fois. Puis il saute : attends la fin du saut pour taper, et garde ton endurance pour la deuxième phase.", v);
      console.log(`Piper : 1re phrase ${sentence} ms, réponse entière ${Date.now() - t} ms`);
    } catch (err) {
      console.log("Piper :", err.message);
    }
  }

  ai.dispose();
  app.quit();
});
