// Voix Piper de chaque personnalité, par langue. Chaque voix n'est téléchargée qu'à sa
// première utilisation (60 à 80 Mo), sauf celle de KIN incluse dans l'installateur complet.
// lengthScale < 1 : débit plus rapide ; > 1 : plus lent.
// pitch : lecture accélérée sans conserver la hauteur → voix plus aiguë ; lengthScale compense
// le tempo (GREMLIN : même voix que KIN, 3 demi-tons plus haut, intelligibilité vérifiée).
const VOICES = {
  fr: {
    kin: { voice: "fr_FR-siwis-medium", lengthScale: 0.95 },
    axiom: { voice: "fr_FR-tom-medium", lengthScale: 1.0 },
    razor: { voice: "fr_FR-upmc-medium", speaker: "pierre", lengthScale: 0.85 },
    gremlin: { voice: "fr_FR-siwis-medium", lengthScale: 1.1, pitch: 1.2 },
    zenith: { voice: "fr_FR-upmc-medium", speaker: "jessica", lengthScale: 1.15 },
  },
  en: {
    kin: { voice: "en_US-amy-medium", lengthScale: 0.95 },
    axiom: { voice: "en_GB-alan-medium", lengthScale: 1.0 },
    razor: { voice: "en_US-ryan-medium", lengthScale: 0.85 },
    gremlin: { voice: "en_US-amy-medium", lengthScale: 1.1, pitch: 1.2 },
    zenith: { voice: "en_GB-jenny_dioco-medium", lengthScale: 1.15 },
  },
};

// Langue d'une réponse quand le réglage est « Automatique » (heuristique simple).
function guessLanguage(text) {
  const t = ` ${text.toLowerCase()} `;
  if (/[éèêàâùûçîôœ]/.test(t) || /\s(le|la|les|des|est|pas|tu|vous|une|pour|avec)\s/.test(t)) return "fr";
  if (/\s(the|you|is|are|and|your|with|this|that)\s/.test(t)) return "en";
  return null;
}

// Retourne la voix à utiliser, ou null si la langue n'a pas de voix Piper (→ voix Windows).
function voiceFor(personality, language, text) {
  const lang = language === "auto" ? guessLanguage(text) || "fr" : language;
  const table = VOICES[lang];
  return table ? table[personality] || table.kin : null;
}

module.exports = { VOICES, voiceFor };
