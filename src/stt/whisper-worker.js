// Transcription locale avec Whisper (transformers.js + ONNX Runtime), dans un thread séparé
// pour ne pas bloquer l'app. Le modèle est téléchargé une seule fois depuis Hugging Face
// puis mis en cache dans le dossier de données de l'app — sauf s'il est fourni avec
// l'installateur « complet » (resources/models).
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");

// Encodeur quantifié 8 bits : même précision mesurée que fp32, 4× plus léger à télécharger.
const DTYPE = { encoder_model: "q8", decoder_model_merged: "q4" };

// Langues proposées par l'app : la détection automatique choisit parmi elles.
const LANGUAGES = ["fr", "en", "de", "es", "it", "pt"];

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

// « Automatique » : sans langue imposée, transformers.js transcrit toujours en anglais (et traduit
// donc le français). On détecte la langue comme Whisper : un seul pas de décodage après
// <|startoftranscript|>, puis le jeton de langue le plus probable. L'encodage de l'audio fait pour
// la détection est réutilisé par la transcription (sinon l'audio serait encodé deux fois).
async function transcribeAuto(t, audio) {
  const { Tensor } = await import("@huggingface/transformers");
  const gc = t.model.generation_config;
  const { input_features } = await t.processor(audio);
  const encoded = await t.model.sessions.model.run({ input_features: input_features.ort_tensor });
  const encoder_outputs = new Tensor(encoded.last_hidden_state);
  const start = new Tensor("int64", BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1]);
  const { logits } = await t.model({ input_features, encoder_outputs, decoder_input_ids: start });
  const scores = logits.data;
  let language = "en";
  let top = -Infinity;
  for (const code of LANGUAGES) {
    const id = gc.lang_to_id?.[`<|${code}|>`];
    if (id != null && scores[id] > top) [language, top] = [code, scores[id]];
  }
  // generate() ne garde que les paramètres listés dans forward_params : on y ajoute encoder_outputs
  if (!t.model.forward_params.includes("encoder_outputs")) t.model.forward_params = [...t.model.forward_params, "encoder_outputs"];
  const ids = await t.model.generate({ inputs: input_features, encoder_outputs, language, task: "transcribe" });
  return t.tokenizer.batch_decode(ids, { skip_special_tokens: true })[0] || "";
}

async function transcribeWith(t, audio, language) {
  const out = await t(audio, { language, task: "transcribe", chunk_length_s: 30 });
  return out.text || "";
}

parentPort.on("message", async (msg) => {
  try {
    const t = await getTranscriber(msg.model, msg.device);
    if (msg.type === "preload") {
      parentPort.postMessage({ id: msg.id, type: "result", text: "" });
      return;
    }
    const fixed = msg.language && msg.language !== "auto";
    // Une prise de push-to-talk tient dans une fenêtre de 30 s ; au-delà, découpage du pipeline
    const text = fixed
      ? await transcribeWith(t, msg.audio, msg.language)
      : msg.audio.length <= 16000 * 30
        ? await transcribeAuto(t, msg.audio)
        : await transcribeWith(t, msg.audio, null);
    parentPort.postMessage({ id: msg.id, type: "result", text: text.trim() });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, type: "error", error: err.message || String(err) });
  }
});
