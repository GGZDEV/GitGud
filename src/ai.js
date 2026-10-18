// Point d'entrée IA : choisit le fournisseur de réponses, de transcription et de voix.
//
// Réponses :
//   claude-cli    → Claude Code local, abonnement Claude (Pro/Max)
//   codex-cli     → Codex local, abonnement ChatGPT
//   anthropic-api → clé API Anthropic
//   openai-api    → clé API OpenAI
// Transcription : whisper local (gratuit) ou API OpenAI.
// Voix : Piper local (une voix par personnalité), voix Windows, ou API OpenAI.
const path = require("path");
const api = require("./providers/api");
const { ClaudeCli } = require("./providers/claude-cli");
const { CodexCli } = require("./providers/codex-cli");
const { LocalWhisper } = require("./stt/whisper");
const { LocalTTS } = require("./tts/local-tts");

class AI {
  // onProgress({ kind: "whisper" | "voice", file, progress }) : avancement des téléchargements
  constructor(dataDir, onProgress = () => {}, bundledModelsDir) {
    this.claudeCli = new ClaudeCli(path.join(dataDir, "claude-workdir"));
    this.codexCli = new CodexCli(path.join(dataDir, "codex-workdir"));
    this.whisper = new LocalWhisper(path.join(dataDir, "models"), (p) => onProgress({ kind: "whisper", ...p }), bundledModelsDir);
    const voiceDirs = [bundledModelsDir && path.join(bundledModelsDir, "piper"), path.join(dataDir, "voices")].filter(Boolean);
    this.tts = new LocalTTS(voiceDirs, (p) => onProgress({ kind: "voice", ...p }));
  }

  chat(opts) {
    switch (opts.settings.provider) {
      case "claude-cli":
        return this.claudeCli.chat(opts);
      case "codex-cli":
        return this.codexCli.chat(opts);
      default:
        return api.chat(opts);
    }
  }

  // Coupe une réponse en cours et oublie le contexte gardé par les CLI.
  reset() {
    this.claudeCli.reset();
    this.codexCli.reset();
  }

  preloadWhisper(settings) {
    if (settings.sttEngine === "local") return this.whisper.preload(settings.whisperModel, settings.whisperDevice);
  }

  whisperStatus(model) {
    return this.whisper.status(model);
  }

  // pcm : Float32Array mono 16 kHz
  async transcribe(settings, pcm) {
    if (settings.sttEngine === "openai") {
      return api.transcribe({ settings, wavBuffer: encodeWav(pcm, 16000) });
    }
    return this.whisper.transcribe(pcm, settings.whisperModel, settings.language, settings.whisperDevice);
  }

  speak(opts) {
    return api.speak(opts);
  }

  dispose() {
    this.reset();
    this.whisper.dispose();
    this.tts.dispose();
  }
}

function encodeWav(samples, sampleRate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

module.exports = { AI };
