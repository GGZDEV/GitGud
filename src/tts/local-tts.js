// Façade côté process principal pour le thread de synthèse vocale Piper.
const { Worker } = require("worker_threads");
const path = require("path");

class LocalTTS {
  constructor(dirs, onProgress) {
    this.dirs = dirs;
    this.onProgress = onProgress || (() => {});
    this.worker = null;
    this.pending = new Map();
    this.seq = 0;
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(path.join(__dirname, "tts-worker.js"), { workerData: { dirs: this.dirs } });
    this.worker.on("message", (m) => {
      if (m.type === "progress") return this.onProgress(m);
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.type === "error" ? p.reject(new Error(m.error)) : p.resolve(m.value);
    });
    this.worker.on("error", (err) => {
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.worker = null;
    });
    return this.worker;
  }

  call(msg) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ensureWorker().postMessage({ ...msg, id });
    });
  }

  has(voice) {
    return this.call({ type: "has", voice });
  }

  // Télécharge si besoin et charge la voix en mémoire (première réponse plus rapide).
  preload(voice) {
    return this.call({ type: "preload", voice });
  }

  // options : { voice, speaker, lengthScale } → Buffer WAV
  async speak(text, options) {
    return Buffer.from(await this.call({ type: "speak", text, options }));
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}

module.exports = { LocalTTS };
