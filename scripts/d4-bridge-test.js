// Test du récepteur Diablo IV sans le jeu : simule la DLL (une ligne par écriture, en rafale).
// Usage : ELECTRON_RUN_AS_NODE=1 npx electron scripts/d4-bridge-test.js
const { Worker } = require("worker_threads");
const fs = require("fs");
const path = require("path");

const lines = [
  "BOUCLIER DE L'AUBE",
  "Bouclier légendaire",
  "800 Puissance de l'objet",
  "+12,5 % de chances de coup critique [10 - 15] %",
  "+412 points de vie maximum [350 - 450]",
  "Propriétés perdues si équipé :",
  "+8 % de vitesse d'attaque",
  "Prix de vente : 45 212 or",
  "Bouton gauche de la souris",
];

const worker = new Worker(path.join(__dirname, "../src/games/d4/tts-bridge-worker.js"));
const got = [];
let started = false;

worker.on("message", (m) => {
  if (m.type === "listening" && !started) {
    started = true;
    const fd = fs.openSync("\\\\.\\pipe\\d4lf", "w");
    fs.writeSync(fd, "CONNECTED");
    for (const l of lines) fs.writeSync(fd, Buffer.from(l, "utf8"));
    fs.writeSync(fd, "DISCONNECTED");
    fs.closeSync(fd);
  } else if (m.type === "line") {
    got.push(m.text);
  } else if (m.type === "disconnected") {
    console.log(`${got.length}/${lines.length} lignes reçues, intactes : ${JSON.stringify(got) === JSON.stringify(lines)}`);
    console.log(got.slice(0, 4));
    worker.terminate();
  } else if (m.type === "error") {
    console.log("erreur :", m.error);
    worker.terminate();
  }
});
