// Façade côté process principal pour le worker Whisper.
const { Worker } = require("worker_threads");
const path = require("path");
const fs = require("fs");

// Fichiers nécessaires pour un modèle (même noms que transformers.js avec DTYPE du worker).
const MODEL_FILES = ["config.json", "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_q4.onnx"];

class LocalWhisper {
  constructor(cacheDir, onProgress, bundledDir) {
    this.cacheDir = cacheDir;
    this.bundledDir = bundledDir;
    this.onProgress = onProgress || (() => {});
    this.worker = null;
    this.pending = new Map();
    this.seq = 0;
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(path.join(__dirname, "whisper-worker.js"), { workerData: { cacheDir: this.cacheDir, bundledDir: this.bundledDir } });
    this.worker.on("message", (m) => {
      if (m.type === "progress") return this.onProgress(m);
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.type === "error" ? p.reject(new Error(m.error)) : p.resolve(m.text);
    });
    this.worker.on("error", (err) => {
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.worker = null;
    });
    return this.worker;
  }

  call(msg, transfer) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ensureWorker().postMessage({ ...msg, id }, transfer);
    });
  }

  // "bundled" (fourni avec l'installateur), "cached" (déjà téléchargé) ou null.
  status(model) {
    for (const [where, dir] of [["bundled", this.bundledDir], ["cached", this.cacheDir]]) {
      if (dir && MODEL_FILES.every((f) => fs.existsSync(path.join(dir, model, f)))) return where;
    }
    return null;
  }

  preload(model, device) {
    return this.call({ type: "preload", model, device });
  }

  // audio : Float32Array mono 16 kHz
  transcribe(audio, model, language, device) {
    return this.call({ type: "transcribe", audio, model, language, device }, [audio.buffer]);
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}

module.exports = { LocalWhisper };
