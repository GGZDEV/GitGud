// Enregistre le texte envoyé par le lecteur d'écran de Diablo IV pendant N secondes
// (aucune action sur le jeu). Usage : ELECTRON_RUN_AS_NODE=1 npx electron scripts/d4-capture.js <sortie.json> [secondes]
const { Worker } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const [out, seconds = "180"] = process.argv.slice(2);
const lines = [];
const w = new Worker(path.join(__dirname, "../src/games/d4/tts-bridge-worker.js"));
w.on("message", (m) => {
  if (m.type === "line") lines.push({ at: m.at, text: m.text });
  else console.log(new Date().toLocaleTimeString(), m.type, m.error || "");
});
setTimeout(() => {
  fs.writeFileSync(out, JSON.stringify(lines, null, 1));
  console.log(`${lines.length} lignes enregistrées → ${out}`);
  w.terminate();
}, Number(seconds) * 1000);
