// Test du module Diablo IV sans le jeu ni le tube : lignes injectées dans le pont →
// découpage → lecture → évaluation → événements (fiche d'objet, synchronisation, contexte IA).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { D4Manager } = require("../src/games/d4/manager");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d4test-"));
fs.mkdirSync(path.join(dir, "d4"));
fs.copyFileSync(path.join(__dirname, "..", "build", "d4", "dict.json"), path.join(dir, "d4", "dict.json"));
const build = require("../build/d4/test-build.json");

const GANTS_PORTES = ["POIGNES DU CRÉPUSCULE", "Gants ancestraux légendaires", "800 Puissance de l'objet", "890 Armure", "+96 dextérité [86 - 100]", "+11,5 % de chances d’infliger un coup critique [8 - 14] %", "Multiplicateur de dégâts sur la durée : x18 % [12 - 20] %", "+7,2 % à la vitesse d’attaque [5 - 9] %", "Vos attaques de base infligent 25 % de dégâts de poison supplémentaires pendant 4 secondes.", "Prix de vente : 54 120 or", "Bouton droit de la souris"];
const GANTS_SAC = ["Menu", "PRISE DE LA PESTILENCE", "Gants ancestraux légendaires", "800 Puissance de l'objet", "910 Armure", "+99 dextérité [86 - 100]", "Multiplicateur de dégâts contre les cibles vulnérables : x17 % [12 - 20] %", "Multiplicateur de dégâts sur la durée : x19,5 % [12 - 20] %", "+8,5 % à la vitesse d’attaque [5 - 9] %", "Vos attaques de base infligent 25 % de dégâts de poison supplémentaires pendant 4 secondes.", "Propriétés perdues si équipé :", "+11,5 % de chances d’infliger un coup critique", "Prix de vente : 61 802 or", "Bouton droit de la souris"];

const feed = (m, lines) => new Promise((resolve) => { lines.forEach((l) => m.bridge.onLine(l)); setTimeout(resolve, 400); });

(async () => {
  const m = new D4Manager(dir);
  m.setCursorProvider(() => ({ x: 300, y: 400 }));
  m.addBuild(JSON.parse(JSON.stringify(build)));
  m.setVariant(build.variants.find((v) => v.name === "Endgame").id);
  m.on("sync", (e) => e.slot && console.log(`synchro : ${e.slot} = ${e.item.name} (pièces connues : ${e.done.join(", ")})`));
  m.on("item", ({ item, eval: ev }) => console.log(`fiche : ${item.name} → ${ev.verdict.text} | ${ev.checks.map((c) => (c.wanted ? "✓" : "✗")).join("")}`));

  m.startSync();
  await feed(m, GANTS_PORTES);
  m.stopSync();
  m.setCursorProvider(() => ({ x: 900, y: 700 })); // ailleurs (dans le sac)
  await feed(m, GANTS_SAC);
  console.log("\n--- contexte envoyé à l'IA (extrait) ---\n" + m.context("je garde cet objet ?").split("\n").slice(-6).join("\n"));
})();
