// Accès aux fournisseurs IA : chat (Claude ou OpenAI), transcription et synthèse vocale (OpenAI).
const Anthropic = require("@anthropic-ai/sdk");
const OpenAI = require("openai");
const { toFile } = require("openai");

// Modèles Claude qui acceptent fallbacks: "default" et web_search_20260209.
const CLAUDE_FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const CLAUDE_NEW_SEARCH_MODELS = /^claude-(opus-(5|4-[678])|sonnet-(5|4-6))/;

let anthropic = null;
let anthropicKey = null;
let openai = null;
let openaiKey = null;

function getAnthropic(key) {
  if (!key) throw new Error("Clé API Anthropic manquante (Paramètres).");
  if (!anthropic || anthropicKey !== key) {
    anthropic = new Anthropic({ apiKey: key });
    anthropicKey = key;
  }
  return anthropic;
}

function getOpenAI(key) {
  if (!key) throw new Error("Clé API OpenAI manquante (Paramètres).");
  if (!openai || openaiKey !== key) {
    openai = new OpenAI({ apiKey: key });
    openaiKey = key;
  }
  return openai;
}

// history : [{ role: "user" | "assistant", text }] — texte uniquement (vision éphémère :
// seule la question en cours porte la capture).
async function chat({ settings, system, history, question, imageJpegB64, onDelta }) {
  if (settings.provider === "openai-api") {
    return chatOpenAI({ settings, system, history, question, imageJpegB64, onDelta });
  }
  return chatClaude({ settings, system, history, question, imageJpegB64, onDelta });
}

async function chatClaude({ settings, system, history, question, imageJpegB64, onDelta }) {
  const client = getAnthropic(settings.anthropicKey);
  const model = settings.anthropicModel;

  const current = [];
  if (imageJpegB64) {
    current.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageJpegB64 } });
  }
  current.push({ type: "text", text: question });

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.text })),
    { role: "user", content: current },
  ];

  const params = {
    model,
    max_tokens: 4000,
    system,
    messages,
    output_config: { effort: settings.effort || "low" },
  };
  if (settings.webSearch) {
    params.tools = [
      CLAUDE_NEW_SEARCH_MODELS.test(model)
        ? { type: "web_search_20260209", name: "web_search", max_uses: 3 }
        : { type: "web_search_20250305", name: "web_search", max_uses: 3 },
    ];
  }
  if (CLAUDE_FALLBACK_MODELS.has(model)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }

  let fullText = "";
  // La recherche web côté serveur peut renvoyer pause_turn : on relance avec le contenu partiel.
  for (let i = 0; i < 4; i++) {
    const stream = client.beta.messages.stream(params);
    stream.on("text", (delta) => {
      fullText += delta;
      onDelta(delta);
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") {
      throw new Error("Claude a refusé de répondre à cette demande.");
    }
    if (msg.stop_reason !== "pause_turn") break;
    params.messages = [...params.messages, { role: "assistant", content: msg.content }];
  }
  return fullText.trim();
}

async function chatOpenAI({ settings, system, history, question, imageJpegB64, onDelta }) {
  const client = getOpenAI(settings.openaiKey);

  const current = [{ type: "input_text", text: question }];
  if (imageJpegB64) {
    current.push({ type: "input_image", image_url: `data:image/jpeg;base64,${imageJpegB64}` });
  }
  const input = [
    ...history.map((m) => ({ role: m.role, content: m.text })),
    { role: "user", content: current },
  ];

  const stream = await client.responses.create({
    model: settings.openaiModel,
    instructions: system,
    input,
    tools: settings.webSearch ? [{ type: "web_search" }] : [],
    stream: true,
  });

  let fullText = "";
  for await (const ev of stream) {
    if (ev.type === "response.output_text.delta") {
      fullText += ev.delta;
      onDelta(ev.delta);
    } else if (ev.type === "error" || ev.type === "response.failed") {
      throw new Error(ev.error?.message || ev.response?.error?.message || "Erreur OpenAI");
    }
  }
  return fullText.trim();
}

// wavBuffer : fichier WAV complet (PCM 16 bits, 16 kHz, mono)
async function transcribe({ settings, wavBuffer }) {
  const client = getOpenAI(settings.openaiKey);
  const res = await client.audio.transcriptions.create({
    file: await toFile(wavBuffer, "question.wav", { type: "audio/wav" }),
    model: settings.sttModel,
    ...(settings.language !== "auto" ? { language: settings.language } : {}),
  });
  return (res.text || "").trim();
}

async function speak({ settings, text, voice, instructions }) {
  const client = getOpenAI(settings.openaiKey);
  const res = await client.audio.speech.create({
    model: settings.ttsModel,
    voice,
    input: text,
    instructions,
    response_format: "mp3",
  });
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { chat, transcribe, speak };
