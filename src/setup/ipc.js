// IPC de l'assistant de configuration : détection, connexion, installation, tests.
const { ipcMain, shell, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const os = require("os");
const path = require("path");
const { detectAll, getBins } = require("./detect");
const { ClaudeCli } = require("../providers/claude-cli");
const { CodexCli } = require("../providers/codex-cli");
const api = require("../providers/api");
const { voiceFor } = require("../tts/voices");

const broadcast = (channel, payload) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload));

// Ouvre une commande dans sa propre fenêtre de console, pour que l'utilisateur voie
// le lien de connexion si le navigateur ne s'ouvre pas tout seul.
function openConsole(command, args, env = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    env: { ...process.env, ...env },
  });
  child.unref();
}

function registerSetupIpc({ getSettings, ai }) {
  ipcMain.handle("setup:detect", async () => {
    const result = await detectAll();
    const settings = getSettings();
    result.whisper = Object.fromEntries(
      ["onnx-community/whisper-base", "onnx-community/whisper-small", "onnx-community/whisper-large-v3-turbo"].map((m) => [m, ai.whisperStatus(m)])
    );
    result.keys = { anthropic: !!settings.anthropicKey, openai: !!settings.openaiKey };
    return result;
  });

  ipcMain.handle("setup:login", async (_e, tool) => {
    const bins = await getBins();
    const bin = bins[tool];
    if (!bin) return false;
    if (tool === "codex") {
      openConsole(bin.command, [...bin.prefixArgs, "login"], bin.env);
    } else if (bin.version.parts[0] > 2 || (bin.version.parts[0] === 2 && bin.version.parts[1] >= 1)) {
      openConsole(bin.command, [...bin.prefixArgs, "auth", "login"], bin.env);
    } else {
      // Anciennes versions : pas de « auth login », on ouvre Claude Code (taper /login).
      openConsole(bin.command, bin.prefixArgs, bin.env);
    }
    return true;
  });

  ipcMain.handle("setup:install", async (_e, { tool, npm }) => {
    if (tool === "codex") {
      if (npm) openConsole("cmd.exe", ["/k", "npm install -g @openai/codex && echo. && echo Installation terminee, tu peux fermer cette fenetre."]);
      else shell.openExternal("https://developers.openai.com/codex/cli");
    } else if (tool === "claude") {
      // Installateur officiel d'Anthropic (version native, sans Node.js).
      openConsole("powershell.exe", ["-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"]);
    }
    return true;
  });

  // Vrai test de bout en bout : une question minimale au moteur choisi.
  ipcMain.handle("setup:test", async (_e, { provider, overrides }) => {
    const settings = { ...getSettings(), ...overrides, provider, webSearch: false };
    if (provider === "claude-cli") settings.claudeCliModel = "haiku";
    if (provider === "codex-cli") settings.codexEffort = "low";
    // Instance dédiée : les tests tournent en parallèle sans couper la conversation en cours.
    const dir = path.join(os.tmpdir(), "gamehelper-test", provider);
    const engine = provider === "claude-cli" ? new ClaudeCli(dir) : provider === "codex-cli" ? new CodexCli(dir) : api;
    const t = Date.now();
    try {
      const answer = await Promise.race([
        engine.chat({ settings, system: "Réponds uniquement par le mot OK.", history: [], question: "Test de connexion.", onDelta: () => {} }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Pas de réponse après 90 s.")), 90000)),
      ]);
      return { ok: true, seconds: (Date.now() - t) / 1000, answer };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      engine.reset?.();
    }
  });

  ipcMain.handle("setup:whisper-download", async (_e, { model, device }) => {
    try {
      await ai.whisper.preload(model, device);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("setup:transcribe", async (_e, { pcm, model, device, language }) => {
    const t = Date.now();
    try {
      const text = await ai.transcribe({ ...getSettings(), sttEngine: "local", whisperModel: model, whisperDevice: device, language }, pcm);
      return { ok: true, text, seconds: (Date.now() - t) / 1000 };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("setup:tts-test", async (_e, { text, voice, openaiKey }) => {
    try {
      const mp3 = await ai.speak({ settings: { ...getSettings(), openaiKey }, text, voice, instructions: "Ton chaleureux." });
      return { ok: true, mp3 };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Extrait de la voix Piper d'une personnalité (téléchargée au besoin).
  ipcMain.handle("setup:voice-sample", async (_e, { personality, language, text }) => {
    const v = voiceFor(personality, language, text);
    if (!v) return { ok: false, error: "Pas de voix locale pour cette langue." };
    try {
      return { ok: true, wav: await ai.tts.speak(text, v), pitch: v.pitch || 1 };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("cli:status", async () => {
    const bins = await getBins();
    return { claude: !!bins.claude, codex: !!bins.codex };
  });
}

module.exports = { registerSetupIpc, broadcast };
