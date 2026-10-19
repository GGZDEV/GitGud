// Installateur « complet » : même configuration que package.json + modèle Whisper inclus.
const base = require("./electron-builder.config.js");

module.exports = {
  ...base,
  extraResources: [{ from: "build/models", to: "models" }],
  nsis: { ...base.nsis, artifactName: "GitGud-Setup-${version}-complet.${ext}" },
};
