// Télécharge le modèle Whisper par défaut dans build/models pour l'installateur « complet ».
// Usage : node scripts/prepare-models.js [modèle]
const path = require("path");
const model = process.argv[2] || "onnx-community/whisper-small";
const out = path.join(__dirname, "..", "build", "models");

(async () => {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = out;
  let last = -1;
  await pipeline("automatic-speech-recognition", model, {
    dtype: { encoder_model: "q8", decoder_model_merged: "q4" },
    progress_callback: (p) => {
      if (p.status === "progress" && p.file?.endsWith(".onnx") && Math.round(p.progress) % 10 === 0 && Math.round(p.progress) !== last) {
        last = Math.round(p.progress);
        console.log(`${p.file} ${last}%`);
      }
    },
  });
  console.log(`Modèle prêt dans ${out}`);

  // Voix Piper de KIN (et GREMLIN), la personnalité par défaut.
  const { Piper } = require("../src/tts/piper");
  const piper = new Piper([path.join(out, "piper")]);
  await piper.ensure("fr_FR-siwis-medium");
  console.log("Voix fr_FR-siwis-medium prête");
})();
