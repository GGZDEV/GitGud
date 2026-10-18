// Garde-fous contre les fausses questions : Whisper « entend » des phrases dans le silence
// (« you », « Thank you », « Sous-titres réalisés par Amara.org »…), par exemple après un
// appui bref sur la touche pour parler.

// Durée de parole réelle (s) dans un enregistrement mono 16 kHz : trames de 20 ms dont
// l'énergie dépasse nettement le bruit de fond.
function speechSeconds(pcm, sampleRate = 16000) {
  const frame = Math.round(sampleRate * 0.02);
  const rms = [];
  for (let i = 0; i + frame <= pcm.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += pcm[j] * pcm[j];
    rms.push(Math.sqrt(sum / frame));
  }
  if (!rms.length) return 0;
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)];
  const threshold = Math.max(0.012, floor * 3);
  return rms.filter((r) => r > threshold).length * 0.02;
}

const HALLUCINATIONS = new Set([
  "you", "thank you", "thanks", "thanks for watching", "thank you for watching", "bye", "okay",
  "merci", "merci beaucoup", "merci d avoir regarde", "merci de votre attention", "au revoir",
  "sous titres realises par la communaute d amara org", "sous titrage st 501", "sous titrage societe radio canada",
]);

const normalize = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Vrai si la transcription ressemble à une hallucination de Whisper plutôt qu'à une question.
function isHallucination(text) {
  const n = normalize(text);
  return !n || HALLUCINATIONS.has(n) || n.includes("amara org");
}

module.exports = { speechSeconds, isHallucination };
