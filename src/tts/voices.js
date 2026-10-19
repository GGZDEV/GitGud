// Voix Piper de chaque personnage (clé = mascotte), par langue. Chaque voix n'est téléchargée
// qu'à sa première utilisation (60 à 80 Mo), sauf celle de KIN incluse dans l'installateur complet.
// lengthScale < 1 : débit plus rapide ; > 1 : plus lent.
// pitch : lecture accélérée (> 1, plus aiguë) ou ralentie (< 1, plus grave) sans conserver la
// hauteur ; lengthScale compense le tempo (VEX : voix d'AXIOM, ≈ 2 demi-tons plus grave).
const VOICES = {
  fr: {
    slime: { voice: "fr_FR-siwis-medium", lengthScale: 0.95 },
    mech: { voice: "fr_FR-tom-medium", lengthScale: 1.0 },
    wraith: { voice: "fr_FR-upmc-medium", speaker: "jessica", lengthScale: 1.15 },
    wolf: { voice: "fr_FR-gilles-low", lengthScale: 0.95 },
    lich: { voice: "fr_FR-tom-medium", lengthScale: 0.9, pitch: 0.88 },
    orc: { voice: "fr_FR-upmc-medium", speaker: "pierre", lengthScale: 0.85 },
  },
  en: {
    slime: { voice: "en_US-amy-medium", lengthScale: 0.95 },
    mech: { voice: "en_GB-alan-medium", lengthScale: 1.0 },
    wraith: { voice: "en_GB-jenny_dioco-medium", lengthScale: 1.15 },
    wolf: { voice: "en_US-joe-medium", lengthScale: 0.95 },
    lich: { voice: "en_GB-northern_english_male-medium", lengthScale: 1.05 },
    orc: { voice: "en_US-ryan-medium", lengthScale: 0.85 },
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
function voiceFor(mascot, language, text) {
  const lang = language === "auto" ? guessLanguage(text) || "fr" : language;
  const table = VOICES[lang];
  return table ? table[mascot] || table.slime : null;
}

module.exports = { VOICES, voiceFor };
