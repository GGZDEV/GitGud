// Synthèse vocale neuronale locale avec Piper (modèles VITS, ONNX Runtime) :
// des voix naturelles, différentes par personnalité, gratuites et hors ligne.
// Texte → phonèmes IPA (espeak-ng compilé en WASM) → identifiants → modèle Piper → audio.
const fs = require("fs");
const path = require("path");
const https = require("https");

const VOICES_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

let ort = null;
let espeakFactory = null;
const sessions = new Map(); // modèle → { session, config }

async function loadEspeak() {
  if (!espeakFactory) espeakFactory = (await import("espeak-ng")).default;
  return espeakFactory;
}

const PUNCT = /[,.;:!?…]+/g;

// Phonèmes IPA (langue espeak, ex. "fr"). espeak sort une ligne par proposition mais perd
// la ponctuation, qui donne les pauses à Piper : on la remet d'après le texte d'origine.
async function textToPhonemes(text, lang) {
  const clean = text.replace(/[\r\n]+/g, " ").replace(/[*_#`"«»]/g, "").trim();
  if (!clean) return "";
  const ESpeakNg = await loadEspeak();
  const es = await ESpeakNg({
    // Le texte passe par un fichier : les arguments de la version WASM perdent l'UTF-8.
    arguments: ["--phonout", "out", "--sep=", "-q", "-b", "1", "--ipa=3", "-v", lang, "-f", "in.txt"],
    preRun: [(M) => M.FS.writeFile("in.txt", clean)],
  });
  const lines = es.FS.readFile("out", { encoding: "utf8" }).split("\n").map((l) => l.replace(/-/g, "").trim()).filter(Boolean);
  const clauses = clean.split(PUNCT).filter((c) => /[\p{L}\p{N}]/u.test(c));
  const puncts = clean.match(PUNCT) || [];
  if (lines.length !== clauses.length) return lines.join(", ");
  return lines.map((l, i) => l + (puncts[i] || "").replace("…", ".").slice(0, 1)).join(" ");
}

function phonemesToIds(phonemes, idMap) {
  const ids = [...idMap["^"], ...idMap["_"]];
  for (const ch of phonemes) {
    if (!idMap[ch]) continue; // caractère inconnu du modèle : ignoré
    ids.push(...idMap[ch], ...idMap["_"]);
  }
  ids.push(...idMap["$"]);
  return ids;
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const tmp = dest + ".part";
    const get = (u) =>
      https
        .get(u, { headers: { "User-Agent": "GameHelper" } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return get(new URL(res.headers.location, u).toString());
          }
          if (res.statusCode !== 200) return reject(new Error(`Téléchargement impossible (${res.statusCode}) : ${u}`));
          const total = Number(res.headers["content-length"]) || 0;
          let received = 0;
          let last = -1;
          res.on("data", (chunk) => {
            received += chunk.length;
            const pct = total ? Math.floor((received / total) * 100) : 0;
            if (onProgress && pct !== last) onProgress(pct);
            last = pct;
          });
          const file = fs.createWriteStream(tmp);
          res.pipe(file);
          file.on("finish", () => file.close(() => fs.rename(tmp, dest, (e) => (e ? reject(e) : resolve()))));
          file.on("error", reject);
        })
        .on("error", reject);
    get(url);
  });
}

class Piper {
  constructor(dirs, onProgress) {
    this.dirs = dirs; // dossiers où chercher les voix (inclus, puis cache) ; le dernier reçoit les téléchargements
    this.onProgress = onProgress || (() => {});
  }

  find(voice, ext) {
    for (const d of this.dirs) {
      const f = path.join(d, `${voice}${ext}`);
      if (fs.existsSync(f)) return f;
    }
    return null;
  }

  has(voice) {
    return !!(this.find(voice, ".onnx") && this.find(voice, ".onnx.json"));
  }

  // voice : "fr_FR-siwis-medium" → fr/fr_FR/siwis/medium/
  async ensure(voice) {
    if (this.has(voice)) return;
    const [locale, name, quality] = voice.split("-");
    const base = `${VOICES_URL}/${locale.split("_")[0]}/${locale}/${name}/${quality}/${voice}`;
    const dir = this.dirs[this.dirs.length - 1];
    fs.mkdirSync(dir, { recursive: true });
    await download(`${base}.onnx.json`, path.join(dir, `${voice}.onnx.json`));
    await download(`${base}.onnx`, path.join(dir, `${voice}.onnx`), (progress) => this.onProgress({ file: voice, progress }));
  }

  async load(voice) {
    if (sessions.has(voice)) return sessions.get(voice);
    await this.ensure(voice);
    if (!ort) ort = require("onnxruntime-node");
    const config = JSON.parse(fs.readFileSync(this.find(voice, ".onnx.json"), "utf8"));
    const session = await ort.InferenceSession.create(this.find(voice, ".onnx"));
    const entry = { session, config };
    sessions.set(voice, entry);
    return entry;
  }

  // Retourne { samples: Float32Array, sampleRate }
  async synthesize(text, { voice, speaker = null, lengthScale = 1, noiseScale, noiseW }) {
    const { session, config } = await this.load(voice);
    const phonemes = await textToPhonemes(text, config.espeak.voice);
    const ids = phonemesToIds(phonemes, config.phoneme_id_map);
    const inf = config.inference;
    const feeds = {
      input: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor("float32", Float32Array.from([noiseScale ?? inf.noise_scale, lengthScale * inf.length_scale, noiseW ?? inf.noise_w]), [3]),
    };
    if (config.num_speakers > 1) {
      const sid = typeof speaker === "string" ? config.speaker_id_map[speaker] ?? 0 : speaker ?? 0;
      feeds.sid = new ort.Tensor("int64", BigInt64Array.from([BigInt(sid)]), [1]);
    }
    const result = await session.run(feeds);
    return { samples: result.output.data, sampleRate: config.audio.sample_rate };
  }
}

function toWav(samples, sampleRate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

module.exports = { Piper, toWav, textToPhonemes };
