// Transcription locale avec Whisper (transformers.js + ONNX Runtime), dans un thread séparé
// pour ne pas bloquer l'app. Le modèle est téléchargé une seule fois depuis Hugging Face
// puis mis en cache dans le dossier de données de l'app — sauf s'il est fourni avec
// l'installateur « complet » (resources/models).
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");

// Encodeur quantifié 8 bits : même précision mesurée que fp32, 4× plus léger à télécharger.
const DTYPE = { encoder_model: "q8", decoder_model_merged: "q4" };

let transcriber = null;
let loadedKey = null;

async function getTranscriber(model, device) {
  const key = `${model}|${device}`;
  if (transcriber && loadedKey === key) return transcriber;
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = workerData.cacheDir;
  const bundled = !!workerData.bundledDir && fs.existsSync(path.join(workerData.bundledDir, model));
  if (bundled) {
    env.localModelPath = workerData.bundledDir;
    env.allowLocalModels = true;
  }
  transcriber = await pipeline("automatic-speech-recognition", model, {
    dtype: DTYPE,
    device: device || "cpu",
    progress_callback: (p) => {
      // Un modèle inclus se charge depuis le disque : pas de « téléchargement » à afficher.
      if (!bundled && p.status === "progress" && p.file?.endsWith(".onnx")) {
        parentPort.postMessage({ type: "progress", file: p.file, progress: Math.round(p.progress) });
      }
    },
  });
  loadedKey = key;
  return transcriber;
}

parentPort.on("message", async (msg) => {
  try {
    const t = await getTranscriber(msg.model, msg.device);
    if (msg.type === "preload") {
      parentPort.postMessage({ id: msg.id, type: "result", text: "" });
      return;
    }
    const out = await t(msg.audio, {
      language: msg.language === "auto" ? null : msg.language,
      task: "transcribe",
      chunk_length_s: 30,
    });
    parentPort.postMessage({ id: msg.id, type: "result", text: (out.text || "").trim() });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, type: "error", error: err.message || String(err) });
  }
});
